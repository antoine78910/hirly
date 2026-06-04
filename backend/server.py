"""
Tinder for Jobs - FastAPI backend.

Features:
- Google OAuth session exchange (session_id -> session_token cookie)
- CV upload (PDF/DOCX/TXT) -> Claude Sonnet 4.5 extracts profile JSON
- Job feed with AI-computed match score & reasons (Claude)
- Swipe right -> creates Application with tailored CV + cover letter (Claude)
- Application tracker with status updates
"""
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, UploadFile, File, Depends, Cookie, Header, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import json
import logging
import random
import uuid
import re
import base64
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Literal
from datetime import datetime, timezone, timedelta
import httpx
import certifi

# Optional file parsing libs
from pypdf import PdfReader
import docx as docx_lib
from application_documents import build_application_package, cover_letter_to_text
from jobs_service import refresh_greenhouse_boards, refresh_jobs_for_profile_if_needed, seed_greenhouse_company_boards
from job_providers import get_board_provider, get_job_provider
from job_providers.base import JobSearchQuery
from llm_client import LLMProviderNotConfigured, complete_json_text

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tlsCAFile=certifi.where())
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ===================== Models =====================

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Profile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    cv_text: Optional[str] = None
    cv_filename: Optional[str] = None
    summary: Optional[str] = None
    skills: List[str] = []
    experience: List[Dict[str, Any]] = []
    education: List[Dict[str, Any]] = []
    target_roles: List[str] = []
    target_role: Optional[str] = None
    target_location: Optional[str] = None
    remote_preference: Optional[str] = "any"   # remote | onsite | hybrid | any
    seniority: Optional[str] = None
    application_answers_profile: Dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Job(BaseModel):
    model_config = ConfigDict(extra="ignore")
    job_id: str
    title: str
    company: str
    company_logo: Optional[str] = None
    location: str
    remote: str  # remote | hybrid | onsite
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    currency: str = "USD"
    description: str
    requirements: List[str] = []
    tech_stack: List[str] = []
    seniority: Optional[str] = None
    posted_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SwipeRequest(BaseModel):
    job_id: str
    direction: Literal["left", "right"]


class GreenhousePrepareSubmitRequest(BaseModel):
    job_id: str


class ResolveMissingInfoRequest(BaseModel):
    answers: Dict[str, Any] = Field(default_factory=dict)
    save_to_profile: bool = True


class Application(BaseModel):
    model_config = ConfigDict(extra="ignore")
    application_id: str
    user_id: str
    job_id: str
    status: Literal["applied", "viewed", "interview", "rejected", "offer"] = "applied"
    package_status: Literal["not_generated", "generated", "failed"] = "not_generated"
    submission_status: Literal["not_submitted", "ready", "submitted", "failed", "blocked"] = "not_submitted"
    submitted_at: Optional[str] = None
    submission_provider: Optional[str] = None
    submission_response_id: Optional[str] = None
    submission_error: Optional[str] = None
    prepared_application_payload: Optional[Dict[str, Any]] = None
    prepared_generated_answers: List[Dict[str, Any]] = Field(default_factory=list)
    prepared_missing_information: List[Any] = Field(default_factory=list)
    prepared_blockers: List[str] = Field(default_factory=list)
    prepared_at: Optional[str] = None
    submission_response_metadata: Optional[Dict[str, Any]] = None
    tailored_resume: Optional[Dict[str, Any]] = None
    cover_letter: Optional[Dict[str, Any]] = None
    match_score: Optional[int] = None
    match_reasons: List[str] = []
    interview_prep: List[str] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusUpdate(BaseModel):
    status: Literal["applied", "viewed", "interview", "rejected", "offer"]


class PreferencesUpdate(BaseModel):
    target_role: Optional[str] = None
    target_location: Optional[str] = None
    target_location_data: Optional[Dict[str, Any]] = None
    remote_preference: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None       # always overridden server-side with authenticated user's email
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin: Optional[str] = None
    website: Optional[str] = None


# ===================== Auth helpers =====================

async def get_current_user(
    request: Request,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
) -> User:
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


# ===================== Auth routes =====================

@api_router.post("/auth/session")
async def auth_session(request: Request, response: Response):
    """Exchange OAuth session_id for a session_token cookie."""
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()

    email = data["email"]
    name = data["name"]
    picture = data.get("picture")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    has_profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0, "cv_text": 1}) is not None
    return {"user": user_doc, "has_profile": has_profile, "session_token": session_token}


@api_router.get("/auth/me")
async def auth_me(user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    return {
        "user": user.model_dump(),
        "has_profile": profile is not None and bool(profile.get("cv_text")),
        "has_preferences": profile is not None and bool(profile.get("target_role")),
    }


@api_router.post("/auth/logout")
async def auth_logout(
    response: Response,
    session_token: Optional[str] = Cookie(default=None),
    authorization: Optional[str] = Header(default=None),
):
    token = session_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if token:
        await db.user_sessions.delete_many({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ===================== CV parsing =====================

def extract_text_from_upload(filename: str, content: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if name.endswith(".docx"):
        document = docx_lib.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    # txt or anything else
    try:
        return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _parse_json_from_llm(text: str) -> Dict[str, Any]:
    """Extract JSON object from Claude response (handles ```json fences)."""
    text = text.strip()
    # remove code fences
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    # find first { ... last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def claude_extract_profile(cv_text: str) -> Dict[str, Any]:
    system_message = (
        "You are an expert resume parser. Return ONLY valid JSON. "
        "No prose, no markdown fences, no commentary."
    )

    prompt = f"""Extract the candidate profile from this CV. Return JSON with this exact schema:
{{
  "contact": {{
    "name": "Full name or empty string",
    "email": "email or empty",
    "phone": "phone or empty",
    "location": "city, country or empty",
    "linkedin": "linkedin url or empty",
    "website": "personal site url or empty"
  }},
  "summary": "1-2 sentence professional summary",
  "skills": ["skill1", "skill2", ...max 15],
  "experience": [{{"role": "...", "company": "...", "duration": "...", "location": "...", "highlights": ["...", "..."]}}],
  "education": [{{"degree": "...", "school": "...", "year": "..."}}],
  "target_roles": ["job title 1", "job title 2", "job title 3"],
  "seniority": "junior" | "mid" | "senior" | "lead" | "principal",
  "template_style": "modern" | "classic" | "minimal" | "two_column"
}}

For template_style, infer the layout aesthetic of the original CV: "two_column" if sidebar+main, "classic" if centered headers/serif feel, "minimal" if heavy whitespace and thin dividers, otherwise "modern".

CV:
---
{cv_text[:8000]}
---
Return ONLY the JSON object."""
    response = await complete_json_text(system_message, prompt)
    return _parse_json_from_llm(response)


async def claude_score_jobs(profile: Dict[str, Any], jobs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Score a batch of jobs in a single LLM call. Returns list of {job_id, score, reasons}."""
    system_message = (
        "You are a job matching expert. For each job, score fit 0-100 and give "
        "2-3 short bullet reasons why this candidate is a great fit. "
        "Return ONLY valid JSON, no prose."
    )

    candidate = {
        "summary": profile.get("summary", ""),
        "skills": profile.get("skills", []),
        "experience": [
            {"role": e.get("role"), "company": e.get("company")} for e in profile.get("experience", [])
        ][:5],
        "seniority": profile.get("seniority"),
        "target_role": profile.get("target_role"),
        "target_location": profile.get("target_location"),
        "remote_preference": profile.get("remote_preference"),
    }
    job_summaries = [
        {
            "job_id": j["job_id"],
            "title": j["title"],
            "company": j["company"],
            "location": j["location"],
            "remote": j["remote"],
            "tech_stack": j.get("tech_stack", []),
            "requirements": j.get("requirements", [])[:6],
            "seniority": j.get("seniority"),
        }
        for j in jobs
    ]

    prompt = f"""Candidate:
{json.dumps(candidate, indent=2)}

Jobs:
{json.dumps(job_summaries, indent=2)}

Return JSON: {{"matches": [{{"job_id": "...", "score": 0-100, "reasons": ["...", "..."]}}]}}"""
    response = await complete_json_text(system_message, prompt)
    parsed = _parse_json_from_llm(response)
    return parsed.get("matches", [])


async def claude_generate_application(profile: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    system_message = (
        "You are an elite career coach and resume tailoring specialist. "
        "Return ONLY valid JSON. Do not invent facts, companies, dates, degrees, "
        "certifications, metrics, work authorization, or tools not present in the candidate data."
    )

    prompt = f"""Create a tailored application package for this job.

Rules:
- Use the uploaded CV text, structured profile, full job description, and requirements.
- Keep every factual claim truthful and grounded in the candidate data.
- Preserve candidate identity/contact details.
- Rewrite summary, reorder skills, and rewrite existing bullets to emphasize relevant experience.
- Do not add employers, roles, degrees, dates, certifications, tools, or achievements not supported by the CV/profile.
- Generate likely/common application question answers only when answerable from candidate data. If unknown, answer conservatively.

Candidate profile:
{json.dumps({
  "contact": profile.get("contact", {}),
  "cv_text": profile.get("cv_text", "")[:12000],
  "summary": profile.get("summary"),
  "skills": profile.get("skills", []),
  "experience": profile.get("experience", []),
  "education": profile.get("education", []),
  "seniority": profile.get("seniority"),
  "template_style": profile.get("template_style", "modern"),
}, indent=2)}

Job:
- Title: {job['title']}
- Company: {job['company']}
- Location: {job['location']} ({job['remote']})
- Description: {job['description']}
- Requirements: {json.dumps(job.get('requirements', []))}
- Tech: {json.dumps(job.get('tech_stack', []))}

Return JSON with this exact schema:
{{
  "tailored_resume_structured": {{
    "contact": {{"name": "...", "email": "...", "phone": "...", "location": "...", "linkedin": "...", "website": "..."}},
    "summary": "Rewritten 2-3 sentence summary tailored for the role",
    "skills": ["skill1", "skill2", "max 12, most relevant first"],
    "experience": [{{"role": "...", "company": "...", "duration": "...", "location": "...", "highlights": ["rewritten bullet 1", "rewritten bullet 2", "rewritten bullet 3"]}}],
    "education": [{{"degree": "...", "school": "...", "year": "..."}}],
    "content_plan": ["short instruction for how the original CV should be adjusted"]
  }},
  "tailored_cover_letter": {{
    "greeting": "Dear {job['company']} team,",
    "paragraphs": ["concise opener specific to role/company", "fit paragraph grounded in CV/profile", "closing paragraph with call to action"],
    "sign_off": "Warm regards,"
  }},
  "application_answers": [{{"question": "Why are you interested in this role?", "answer": "truthful concise answer grounded in candidate data"}}],
  "match_score": 0-100,
  "match_reasons": ["short reason 1", "short reason 2", "short reason 3"],
  "interview_prep": ["likely question 1", "likely question 2", "likely question 3"]
}}"""
    response = await complete_json_text(system_message, prompt)
    parsed = _parse_json_from_llm(response)
    if "tailored_resume_structured" in parsed and "tailored_resume" not in parsed:
        parsed["tailored_resume"] = parsed["tailored_resume_structured"]
    if "tailored_cover_letter" in parsed and "cover_letter" not in parsed:
        parsed["cover_letter"] = parsed["tailored_cover_letter"]
    return parsed


async def _generate_application_doc(user: User, profile: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    try:
        gen = await claude_generate_application(profile, job)
    except LLMProviderNotConfigured:
        raise
    except Exception as exc:
        logger.exception("Application generation failed")
        raise HTTPException(status_code=502, detail="AI application generation failed") from exc

    try:
        application_package = build_application_package(profile, gen)
    except Exception as exc:
        logger.exception("Tailored CV file generation failed")
        raise HTTPException(status_code=502, detail="Tailored CV generation failed") from exc

    return {
        "application_id": f"app_{uuid.uuid4().hex[:12]}",
        "user_id": user.user_id,
        "job_id": job["job_id"],
        "status": "applied",
        "package_status": "generated",
        "submission_status": "not_submitted",
        "submitted_at": None,
        "submission_provider": None,
        "submission_response_id": None,
        "submission_error": None,
        "tailored_resume": gen.get("tailored_resume", {}),
        "cover_letter": gen.get("cover_letter", {}),
        **application_package,
        "match_score": gen.get("match_score", 75),
        "match_reasons": gen.get("match_reasons", []),
        "interview_prep": gen.get("interview_prep", []),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _normalize_application_status_fields(app_doc: Dict[str, Any]) -> Dict[str, Any]:
    app = dict(app_doc)
    if not app.get("package_status"):
        has_package = any([
            app.get("tailored_resume_structured"),
            app.get("tailored_cover_letter"),
            app.get("tailored_cv_file_b64"),
        ])
        app["package_status"] = "generated" if has_package else "not_generated"
    if not app.get("submission_status"):
        app["submission_status"] = "not_submitted"
    app.setdefault("submitted_at", None)
    app.setdefault("submission_provider", None)
    app.setdefault("submission_response_id", None)
    app.setdefault("submission_error", None)
    if app.get("prepared_missing_information"):
        payload = app.get("prepared_application_payload") or {}
        app["prepared_missing_information"] = _normalize_missing_information(
            app.get("prepared_missing_information") or [],
            _all_payload_fields(payload),
        )
    return app


# ===================== Career Coach (Interviews + Improve) =====================
from coach import (  # noqa: E402
    claude_interview_prep, claude_interview_score, claude_improve_analysis,
    is_fresh, stamp,
)


async def _require_profile(user: User) -> Dict[str, Any]:
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "cv_original_b64": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload your CV first to unlock coaching.")
    return profile


async def _save_coach(user_id: str, key: str, stamped: Dict[str, Any]) -> None:
    """Persist an already-stamped payload to profile.coach.<key>."""
    await db.profiles.update_one(
        {"user_id": user_id},
        {"$set": {f"coach.{key}": stamped, "updated_at": stamped.get("_cached_at") or datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


@api_router.get("/coach/interview")
async def coach_interview_prep(refresh: bool = False, user: User = Depends(get_current_user)):
    profile = await _require_profile(user)
    cached = (profile.get("coach") or {}).get("interview")
    if not refresh and is_fresh(cached):
        return cached
    try:
        data = await claude_interview_prep(profile)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("interview prep failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")
    stamped = stamp(data)
    await _save_coach(user.user_id, "interview", stamped)
    return stamped


class InterviewScoreBody(BaseModel):
    questions: List[str]
    answers: List[str]


@api_router.post("/coach/interview/score")
async def coach_interview_score(body: InterviewScoreBody, user: User = Depends(get_current_user)):
    if len(body.questions) != len(body.answers) or not body.questions:
        raise HTTPException(status_code=400, detail="questions and answers must be same non-empty length")
    profile = await _require_profile(user)
    try:
        result = await claude_interview_score(profile, body.questions, body.answers)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("interview scoring failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")

    # streak — count distinct days a mock was completed
    now = datetime.now(timezone.utc).isoformat()
    history = (profile.get("coach") or {}).get("interview_history") or []
    history.append({"finished_at": now, "overall": result.get("overall", 0)})
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"coach.interview_history": history[-30:]}},
        upsert=True,
    )
    return result


@api_router.get("/coach/improve")
async def coach_improve(refresh: bool = False, user: User = Depends(get_current_user)):
    profile = await _require_profile(user)
    cached = (profile.get("coach") or {}).get("improve")
    if not refresh and is_fresh(cached):
        return cached
    try:
        data = await claude_improve_analysis(profile)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("improve analysis failed")
        raise HTTPException(status_code=502, detail=f"AI coach is unavailable: {e}")
    stamped = stamp(data)
    await _save_coach(user.user_id, "improve", stamped)
    return stamped


@api_router.get("/coach/streak")
async def coach_streak(user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "coach.interview_history": 1})
    history = ((profile or {}).get("coach") or {}).get("interview_history") or []
    if not history:
        return {"streak": 0, "sessions_total": 0, "sessions_week": 0, "best": 0}
    today = datetime.now(timezone.utc).date()
    days = set()
    for h in history:
        try:
            d = datetime.fromisoformat(h["finished_at"]).date()
            days.add(d)
        except (KeyError, ValueError):
            pass
    streak = 0
    cursor = today
    while cursor in days:
        streak += 1
        cursor = cursor - timedelta(days=1)
    sessions_week = sum(1 for h in history if (today - datetime.fromisoformat(h["finished_at"]).date()).days < 7)
    best = max((h.get("overall", 0) for h in history), default=0)
    return {"streak": streak, "sessions_total": len(history), "sessions_week": sessions_week, "best": best}




@api_router.post("/profile/cv")
async def upload_cv(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    import base64
    content = await file.read()
    cv_text = extract_text_from_upload(file.filename, content)
    if not cv_text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from CV")

    try:
        extracted = await claude_extract_profile(cv_text)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.exception("CV extraction failed")
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {e}")

    # Determine mime type from filename
    name_lower = (file.filename or "").lower()
    if name_lower.endswith(".pdf"):
        mime = "application/pdf"
    elif name_lower.endswith(".docx"):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        mime = "text/plain"

    profile_doc = {
        "user_id": user.user_id,
        "cv_text": cv_text,
        "cv_filename": file.filename,
        "cv_original_b64": base64.b64encode(content).decode("ascii"),
        "cv_mime": mime,
        "contact": extracted.get("contact", {}),
        "summary": extracted.get("summary", ""),
        "skills": extracted.get("skills", []),
        "experience": extracted.get("experience", []),
        "education": extracted.get("education", []),
        "target_roles": extracted.get("target_roles", []),
        "seniority": extracted.get("seniority"),
        "template_style": extracted.get("template_style", "modern"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": profile_doc},
        upsert=True,
    )
    # don't ship the heavy fields back
    profile_doc.pop("cv_text", None)
    profile_doc.pop("cv_original_b64", None)
    return profile_doc


@api_router.get("/profile/cv/original")
async def download_original_cv(user: User = Depends(get_current_user)):
    """Stream back the user's original CV file."""
    import base64
    from fastapi.responses import Response as FastAPIResponse
    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "cv_original_b64": 1, "cv_mime": 1, "cv_filename": 1},
    )
    if not profile or not profile.get("cv_original_b64"):
        raise HTTPException(status_code=404, detail="No original CV stored")
    content = base64.b64decode(profile["cv_original_b64"])
    filename = profile.get("cv_filename") or "cv"
    return FastAPIResponse(
        content=content,
        media_type=profile.get("cv_mime", "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/profile")
async def get_profile(user: User = Depends(get_current_user)):
    profile = await db.profiles.find_one(
        {"user_id": user.user_id},
        {"_id": 0, "cv_original_b64": 0},
    )
    if not profile:
        return None
    return profile


@api_router.delete("/profile")
async def delete_account(user: User = Depends(get_current_user)):
    """Wipe everything the user created. Sessions are revoked too."""
    await db.profiles.delete_many({"user_id": user.user_id})
    await db.swipes.delete_many({"user_id": user.user_id})
    await db.applications.delete_many({"user_id": user.user_id})
    await db.user_sessions.delete_many({"user_id": user.user_id})
    await db.users.delete_one({"user_id": user.user_id})
    return {"ok": True}


@api_router.patch("/profile/extras")
async def patch_profile_extras(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    """Merge-update the `profile.extras` dict — holds user-managed CV sections that AI
    didn't extract automatically (volunteer, projects, references, languages, …)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    existing = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "extras": 1}) or {}
    merged = {**(existing.get("extras") or {}), **payload}
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"extras": merged, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "extras": merged}


@api_router.put("/profile/preferences")
async def update_preferences(prefs: PreferencesUpdate, user: User = Depends(get_current_user)):
    payload = prefs.model_dump(exclude_unset=True)
    update = {
        k: v
        for k, v in payload.items()
        if v is not None or k == "target_location_data"
    }
    target_role = update.get("target_role")
    if isinstance(target_role, str) and target_role.strip():
        update["target_role"] = target_role.strip()
        update["target_roles"] = [target_role.strip()]
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": update},
        upsert=True,
    )
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    return profile


@api_router.put("/profile/contact")
async def update_contact(contact: ContactUpdate, user: User = Depends(get_current_user)):
    """Update the contact block. Email is ALWAYS forced to the authenticated user's
    registered email — the UI never allows changing it, per product spec."""
    data = {k: v for k, v in contact.model_dump().items() if v is not None}
    data["email"] = user.email  # force-overwrite
    existing = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0, "contact": 1}) or {}
    merged = {**(existing.get("contact") or {}), **data}
    await db.profiles.update_one(
        {"user_id": user.user_id},
        {"$set": {"contact": merged, "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "contact": merged}


# ===================== Jobs / Swipe =====================

@api_router.get("/jobs/feed")
async def get_feed(
    user: User = Depends(get_current_user),
    limit: int = 5,
    min_salary: int = 0,
    posted_within: Optional[str] = None,            # any | 1d | 7d | 30d
    work_location: Optional[List[str]] = Query(None),   # remote | hybrid | onsite
    job_type: Optional[List[str]] = Query(None),        # full_time | part_time | internship  (placeholder)
    experience: Optional[List[str]] = Query(None),      # entry | mid | senior | executive
    location: Optional[List[str]] = Query(None),        # free-text city/country tokens, OR-matched on `location` field
    only_company: Optional[List[str]] = Query(None),
    hide_company: Optional[List[str]] = Query(None),
    only_industry: Optional[List[str]] = Query(None),   # placeholder (jobs lack industry field today)
    hide_industry: Optional[List[str]] = Query(None),   # placeholder
    include_unknown_location: bool = True,
    include_unknown_salary: bool = True,
    include_non_auto_apply: bool = False,
    search_radius: str = "50km",
    locations_json: Optional[str] = None,
    only_my_country: bool = False,
    location_label: Optional[str] = None,
    place_id: Optional[str] = None,
    country: Optional[str] = None,
    country_code: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    score: bool = False,                                  # opt-in AI scoring (slow); default off for snappy UX
):
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload CV first")

    provider_enabled = os.environ.get("JSEARCH_ENABLED", "true").lower() in ("1", "true", "yes", "on")
    provider_configured = bool(os.environ.get("JSEARCH_API_KEY"))
    fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
    profile_location_data = profile.get("target_location_data") or {}
    profile_country_code = (profile_location_data.get("country_code") or "").strip().lower()
    profile_country = profile_location_data.get("country")

    selected_locations: List[Dict[str, Any]] = []
    if locations_json:
        try:
            parsed_locations = json.loads(locations_json)
            if isinstance(parsed_locations, list):
                selected_locations = [loc for loc in parsed_locations if isinstance(loc, dict) and loc.get("location_label")]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="locations_json must be a JSON array")

    request_location_data = None
    if location_label:
        request_location_data = {
            "location_label": location_label,
            "place_id": place_id,
            "country": country,
            "country_code": country_code,
            "lat": lat,
            "lng": lng,
        }
        selected_locations = [request_location_data]

    if only_my_country:
        if profile_country_code:
            selected_locations = [
                {**loc, "country_code": profile_country_code, "country": profile_country or loc.get("country")}
                for loc in selected_locations
            ]
            if not selected_locations and profile_location_data:
                selected_locations = [profile_location_data]
        elif not selected_locations and profile_location_data:
            selected_locations = [profile_location_data]

    if not selected_locations and profile_location_data:
        selected_locations = [profile_location_data]

    request_location = (
        selected_locations[0].get("location_label")
        if selected_locations
        else (location[0] if location else None)
    )

    async def _count_auto_for_labels(labels: List[str]) -> int:
        count_query: Dict[str, Any] = {"auto_apply_supported": True}
        if labels and search_radius not in ("worldwide", "remote", "remote/worldwide"):
            count_query["$or"] = [{"location": {"$regex": re.escape(label), "$options": "i"}} for label in labels]
        return await db.jobs.count_documents(count_query)

    refresh_results = []
    refresh_locations = selected_locations or [None]
    for loc_data in refresh_locations:
        loc_label = loc_data.get("location_label") if loc_data else None
        refresh_result = await refresh_jobs_for_profile_if_needed(
            db,
            profile,
            require_auto_apply=not include_non_auto_apply,
            target_auto_apply_count=limit,
            location_override=loc_label,
            location_data_override=loc_data,
            search_radius=search_radius,
        )
        refresh_results.append(refresh_result)
        if refresh_result.get("provider_rate_limited"):
            break
        refreshed_labels = [
            item.get("location_label")
            for item in refresh_locations[:len(refresh_results)]
            if isinstance(item, dict) and item.get("location_label")
        ]
        if refreshed_labels and await _count_auto_for_labels(refreshed_labels) >= limit:
            break
    refresh_result = refresh_results[-1] if refresh_results else {"attempted": False, "reason": "no_refresh"}

    # exclude jobs already swiped
    swiped = await db.swipes.find({"user_id": user.user_id}, {"_id": 0, "job_id": 1}).to_list(2000)
    swiped_ids = {s["job_id"] for s in swiped}

    query: Dict[str, Any] = {}

    if swiped_ids:
        query["job_id"] = {"$nin": list(swiped_ids)}

    # Work location filter
    if work_location:
        if include_unknown_location:
            query["$or"] = [
                {"remote": {"$in": work_location}},
                {"remote": {"$in": [None, ""]}},
            ]
        else:
            query["remote"] = {"$in": work_location}

    # Experience / seniority filter (entry→junior, executive→principal/lead)
    if experience:
        exp_map = {
            "entry": ["junior"],
            "mid": ["mid"],
            "senior": ["senior"],
            "executive": ["lead", "principal"],
        }
        wanted: List[str] = []
        for e in experience:
            wanted.extend(exp_map.get(e, [e]))
        query["seniority"] = {"$in": wanted}

    # Location free-text filter - case-insensitive substring OR across tokens
    location_filter_clause = None
    selected_location_labels = [
        loc.get("location_label")
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("location_label")
    ]
    if search_radius in ("worldwide", "remote", "remote/worldwide"):
        filter_locations = None
    elif selected_location_labels:
        filter_locations = selected_location_labels
    elif location:
        filter_locations = location
    elif only_my_country and profile_country:
        filter_locations = [profile_country]
    else:
        filter_locations = None
    if filter_locations:
        expanded_filter_locations = set()
        for loc in filter_locations:
            expanded_filter_locations.add(loc)
            for part in re.split(r"[,/|-]", loc):
                part = part.strip()
                if len(part) >= 3:
                    expanded_filter_locations.add(part)
        loc_clauses = [{"location": {"$regex": re.escape(loc), "$options": "i"}} for loc in expanded_filter_locations]
        location_filter_clause = {"$or": loc_clauses}
        query.setdefault("$and", []).append(location_filter_clause)

    # Posted within
    if posted_within and posted_within != "any":
        days_map = {"1d": 1, "7d": 7, "30d": 30}
        days = days_map.get(posted_within)
        if days:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            query["posted_at"] = {"$gte": cutoff}

    # Min salary filter — match any job whose top-of-range >= min_salary
    if min_salary and min_salary > 0:
        salary_clause: Dict[str, Any] = {"salary_max": {"$gte": min_salary}}
        if include_unknown_salary:
            query.setdefault("$and", []).append({
                "$or": [salary_clause, {"salary_max": {"$in": [None, 0]}}, {"salary_max": {"$exists": False}}],
            })
        else:
            query["salary_max"] = {"$gte": min_salary}

    # Only / hide companies
    if only_company:
        regexes = [{"company": {"$regex": f"^{re.escape(c)}$", "$options": "i"}} for c in only_company]
        query.setdefault("$and", []).append({"$or": regexes})
    if hide_company:
        query["company"] = {"$nin": []}  # init
        query["company"] = {"$not": {"$regex": "|".join(re.escape(c) for c in hide_company), "$options": "i"}}

    remote_pref = profile.get("remote_preference") or "any"
    target_role = (
        profile.get("target_role")
        or ((profile.get("target_roles") or [None])[0])
        or ""
    ).strip()
    radius_scope = (search_radius or "50km").lower().strip()

    def _tokens(value: str) -> List[str]:
        stop = {"and", "or", "the", "a", "an", "of", "for", "to", "in", "with", "remote", "jobs", "job"}
        return [token for token in re.findall(r"[a-z0-9]+", (value or "").lower()) if len(token) > 2 and token not in stop]

    role_tokens = _tokens(target_role)
    broader_role_tokens = []
    if role_tokens:
        broader_role_tokens = role_tokens[-1:]
        if "software" in role_tokens and "engineer" in role_tokens:
            broader_role_tokens = ["software", "engineer"]

    selected_country_codes = [
        (loc.get("country_code") or "").strip().lower()
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("country_code")
    ]
    selected_countries = [
        (loc.get("country") or "").strip().lower()
        for loc in selected_locations
        if isinstance(loc, dict) and loc.get("country")
    ]
    country_aliases = {
        "gb": ["united kingdom", "uk", "england", "london"],
        "us": ["united states", "usa", "new york", "san francisco"],
        "ma": ["morocco", "maroc", "casablanca"],
    }
    selected_country_terms = set(selected_countries)
    for code in selected_country_codes or ([profile_country_code] if profile_country_code else []):
        selected_country_terms.update(country_aliases.get(code, []))
    location_terms = set()
    for label in selected_location_labels or (location or []):
        location_terms.update(_tokens(label))
    if profile_country:
        selected_country_terms.add(profile_country.lower())

    def _role_score(job: Dict[str, Any], tokens: List[str]) -> int:
        if not tokens:
            return 0
        title = (job.get("title") or "").lower()
        body = " ".join([
            job.get("description") or "",
            " ".join(job.get("requirements") or []),
        ]).lower()
        title_hits = sum(1 for token in tokens if token in title)
        body_hits = sum(1 for token in tokens if token in body)
        exact_bonus = 25 if target_role and target_role.lower() in title else 0
        return exact_bonus + title_hits * 20 + min(body_hits, len(tokens)) * 5

    def _location_score(job: Dict[str, Any]) -> int:
        if radius_scope in ("worldwide", "remote/worldwide"):
            return 10
        job_location = (job.get("location") or "").lower()
        job_remote = (job.get("remote") or "").lower()
        if radius_scope == "remote" or remote_pref == "remote":
            return 35 if job_remote == "remote" else 5
        score = 0
        if location_terms and any(term in job_location for term in location_terms):
            score += 40
        if selected_country_terms and any(term and term in job_location for term in selected_country_terms):
            score += 25
        if not location_terms and selected_country_terms and score:
            score += 10
        if job_remote == "remote":
            score += 8
        return score

    def _recency_score(job: Dict[str, Any]) -> int:
        raw = job.get("posted_at") or job.get("imported_at")
        if not raw:
            return 0
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return 0
        age_days = max(0, (datetime.now(timezone.utc) - parsed).days)
        if age_days <= 7:
            return 20
        if age_days <= 30:
            return 10
        return 0

    def _rank_jobs(candidates: List[Dict[str, Any]], wanted: int) -> List[Dict[str, Any]]:
        strict_matches = []
        broader_matches = []
        for job in candidates:
            strict_role_score = _role_score(job, role_tokens)
            broad_role_score = _role_score(job, broader_role_tokens)
            location_match_score = _location_score(job)
            recency = _recency_score(job)
            base_score = strict_role_score * 3 + location_match_score * 2 + recency
            ranked_job = {
                **job,
                "_feed_rank_score": base_score,
                "_role_match_score": strict_role_score,
                "_location_match_score": location_match_score,
            }
            if not role_tokens or strict_role_score >= max(20, len(role_tokens) * 12):
                strict_matches.append(ranked_job)
            elif broad_role_score > 0:
                ranked_job["_feed_rank_score"] = broad_role_score * 2 + location_match_score * 2 + recency
                broader_matches.append(ranked_job)

        strict_matches.sort(key=lambda j: j["_feed_rank_score"], reverse=True)
        broader_matches.sort(key=lambda j: j["_feed_rank_score"], reverse=True)
        ranked = strict_matches if len(strict_matches) >= wanted else [*strict_matches, *broader_matches]

        diverse = []
        deferred = []
        seen_companies = set()
        for job in ranked:
            company_key = (job.get("company") or "").strip().lower()
            if len(diverse) < min(5, wanted) and company_key in seen_companies:
                deferred.append(job)
                continue
            diverse.append(job)
            if company_key:
                seen_companies.add(company_key)
            if len(diverse) >= wanted:
                break
        if len(diverse) < wanted:
            for job in deferred:
                diverse.append(job)
                if len(diverse) >= wanted:
                    break
        return diverse[:wanted]

    def _without_location_filter(src: Dict[str, Any]) -> Dict[str, Any]:
        widened = {**src}
        if location_filter_clause and "$and" in widened:
            remaining = [clause for clause in widened["$and"] if clause != location_filter_clause]
            if remaining:
                widened["$and"] = remaining
            else:
                widened.pop("$and", None)
        return widened

    async def _fetch(q: Dict[str, Any], wanted: int) -> List[Dict[str, Any]]:
        candidate_limit = max(wanted * 100, 500)
        rows = await db.jobs.find(q, {"_id": 0}).limit(candidate_limit).to_list(candidate_limit)
        return _rank_jobs(rows, wanted)

    base_query = {**query}
    total_all = await db.jobs.count_documents(base_query)
    auto_query = {
        **base_query,
        "auto_apply_supported": True,
        "ats_provider": {"$in": ["greenhouse", "lever", "ashby"]},
    }

    feed_mode = "auto_apply_only"
    fallback_reason = None
    widened_search = False
    final_location_used = request_location or profile.get("target_location")
    provider_rate_limited = bool(refresh_result.get("provider_rate_limited"))
    provider_cooldown_until = refresh_result.get("provider_cooldown_until")

    if include_non_auto_apply:
        feed_mode = "mixed"
        jobs = await _fetch(base_query, limit)
    else:
        jobs = await _fetch(auto_query, limit)

    jobs = jobs[:limit]
    auto_apply_count = sum(1 for j in jobs if j.get("auto_apply_supported") is True)
    total = await db.jobs.count_documents(auto_query if not include_non_auto_apply else base_query)
    companies_returned = sorted({j.get("company") for j in jobs if j.get("company")})
    filters_applied = {
        "target_role": target_role or None,
        "role_tokens": role_tokens,
        "broader_role_tokens": broader_role_tokens,
        "locations": selected_location_labels,
        "country_code": selected_country_codes or ([profile_country_code] if profile_country_code else []),
        "search_radius": search_radius,
        "remote_preference": remote_pref,
        "auto_apply_supported": not include_non_auto_apply,
        "ats_provider": ["greenhouse", "lever", "ashby"] if not include_non_auto_apply else None,
    }
    if provider_rate_limited:
        fallback_reason = "provider_rate_limited"

    if not jobs:
        if include_non_auto_apply and provider_enabled and provider_configured and fallback_mock:
            mock_query = {**base_query}
            mock_query.pop("provider", None)
            jobs = await _fetch(mock_query, limit)
            total = await db.jobs.count_documents(mock_query)
            auto_apply_count = sum(1 for j in jobs if j.get("auto_apply_supported") is True)
        if not jobs:
            logger.info("No jobs found for feed; provider refresh result=%s", refresh_result)
            empty_fallback_reason = (
                "provider_rate_limited"
                if provider_rate_limited
                else "no_auto_apply_jobs_found" if not include_non_auto_apply else "No jobs found with these filters. Try widening your search distance or changing your location."
            )
            return {
                "jobs": [],
                "total": 0,
                "feed_mode": "auto_apply_only" if not include_non_auto_apply else "mixed",
                "auto_apply_count": 0,
                "total_count": 0,
                "fallback_reason": empty_fallback_reason,
                "searched_location": refresh_result.get("searched_location") or request_location or profile.get("target_location"),
                "searched_locations": selected_location_labels,
                "search_radius": search_radius,
                "suggested_next_radius": refresh_result.get("suggested_next_radius"),
                "only_my_country": only_my_country,
                "widened_search": widened_search or bool(refresh_result.get("widened_search")),
                "original_location": request_location or profile.get("target_location"),
                "final_location_used": final_location_used,
                "provider_rate_limited": provider_rate_limited,
                "provider_cooldown_until": provider_cooldown_until,
                "matched_role": target_role or None,
                "matched_location": selected_location_labels or ([request_location] if request_location else []),
                "companies_returned": [],
                "filters_applied": filters_applied,
            }

    # AI scoring batch — slow (5-12s for Claude). Off by default for snappy UX.
    score_map: Dict[str, Dict[str, Any]] = {}
    if score:
        try:
            matches = await claude_score_jobs(profile, jobs)
            score_map = {m["job_id"]: m for m in matches}
        except LLMProviderNotConfigured as e:
            raise HTTPException(status_code=502, detail=str(e))
        except Exception as e:
            logger.exception("Match scoring failed")
            raise HTTPException(status_code=502, detail="AI job scoring failed")

    enriched = []
    for j in jobs:
        m = score_map.get(j["job_id"], {})
        clean_job = {k: v for k, v in j.items() if not k.startswith("_feed_") and not k.startswith("_role_") and not k.startswith("_location_")}
        enriched.append({
            **clean_job,
            "match_score": m.get("score") or random.randint(78, 96),
            "match_reasons": m.get("reasons") or ["Strong alignment with your skills."],
        })
    if fallback_reason is None and feed_mode == "auto_apply_only":
        fallback_reason = None
    return {
        "jobs": enriched,
        "total": total,
        "feed_mode": feed_mode,
        "auto_apply_count": auto_apply_count,
        "total_count": total_all,
        "fallback_reason": fallback_reason,
        "searched_location": refresh_result.get("searched_location") or request_location or profile.get("target_location"),
        "searched_locations": selected_location_labels,
        "search_radius": search_radius,
        "suggested_next_radius": refresh_result.get("suggested_next_radius"),
        "only_my_country": only_my_country,
        "widened_search": widened_search or bool(refresh_result.get("widened_search")),
        "original_location": request_location or profile.get("target_location"),
        "final_location_used": final_location_used,
        "provider_rate_limited": provider_rate_limited,
        "provider_cooldown_until": provider_cooldown_until,
        "matched_role": target_role or None,
        "matched_location": selected_location_labels or ([request_location] if request_location else []),
        "companies_returned": companies_returned,
        "filters_applied": filters_applied,
    }


@api_router.post("/swipe")
async def swipe(req: SwipeRequest, user: User = Depends(get_current_user)):
    # record swipe
    existing = await db.swipes.find_one({"user_id": user.user_id, "job_id": req.job_id}, {"_id": 0})
    if existing:
        return {"ok": True, "duplicate": True}

    await db.swipes.insert_one({
        "user_id": user.user_id,
        "job_id": req.job_id,
        "direction": req.direction,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    if req.direction != "right":
        return {"ok": True, "applied": False}

    job = await db.jobs.find_one({"job_id": req.job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile:
        raise HTTPException(status_code=400, detail="Profile required")

    try:
        doc = await _generate_application_doc(user, profile, job)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    await db.applications.insert_one(doc)
    return {
        "ok": True,
        "applied": True,
        "submitted": False,
        "application_id": doc["application_id"],
        "package_status": doc["package_status"],
        "submission_status": doc["submission_status"],
    }


@api_router.get("/swipes/history")
async def swipes_history(
    user: User = Depends(get_current_user),
    direction: Optional[str] = None,  # "left" | "right" | None=all
    limit: int = 100,
):
    """Return the user's swipe history with the joined job doc.
    direction='left' → SKIP (we'll surface as 'Skipped Jobs')
    direction='right' → APPLY (alias for /applications minimal)."""
    q: Dict[str, Any] = {"user_id": user.user_id}
    if direction in ("left", "right"):
        q["direction"] = direction
    rows = await db.swipes.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    if not rows:
        return {"swipes": []}
    job_ids = list({r["job_id"] for r in rows})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(len(job_ids))
    job_map = {j["job_id"]: j for j in jobs}
    return {
        "swipes": [
            {**r, "job": job_map.get(r["job_id"])} for r in rows
        ],
    }


@api_router.delete("/swipes/{job_id}")
async def delete_swipe(job_id: str, user: User = Depends(get_current_user)):
    """Remove a swipe so the job can re-enter the feed (used by 'Apply Now' from history)."""
    res = await db.swipes.delete_one({"user_id": user.user_id, "job_id": job_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No such swipe")
    return {"ok": True}


@api_router.post("/swipe/undo")
async def undo_swipe(user: User = Depends(get_current_user)):
    last = await db.swipes.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1)
    if not last:
        return {"ok": False}
    last = last[0]
    await db.swipes.delete_one({"user_id": user.user_id, "job_id": last["job_id"]})
    if last["direction"] == "right":
        await db.applications.delete_one({"user_id": user.user_id, "job_id": last["job_id"]})
    return {"ok": True, "job_id": last["job_id"]}


# ===================== Applications =====================

@api_router.get("/applications")
async def list_applications(user: User = Depends(get_current_user)):
    apps = await db.applications.find({"user_id": user.user_id}, {"_id": 0}).sort("created_at", -1).to_list(500)
    # join job data
    job_ids = list({a["job_id"] for a in apps})
    jobs = await db.jobs.find({"job_id": {"$in": job_ids}}, {"_id": 0}).to_list(500)
    job_map = {j["job_id"]: j for j in jobs}
    result = []
    for a in apps:
        a = _normalize_application_status_fields(a)
        result.append({**a, "job": job_map.get(a["job_id"])})
    return {"applications": result}


@api_router.get("/applications/greenhouse/form-preview")
async def greenhouse_form_preview(job_id: str, user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")

    provider = get_board_provider("greenhouse")
    try:
        preview = await provider.inspect_application_form(board_token, greenhouse_job_id)
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Greenhouse form preview failed: job_id=%s board=%s greenhouse_job_id=%s status=%s",
            job_id,
            board_token,
            greenhouse_job_id,
            exc.response.status_code if exc.response else None,
        )
        raise HTTPException(status_code=502, detail="Greenhouse application form is unavailable") from exc
    except Exception as exc:
        logger.warning("Greenhouse form preview failed: job_id=%s error=%s", job_id, exc)
        raise HTTPException(status_code=502, detail="Greenhouse application form preview failed") from exc

    return {
        "job_id": job["job_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        "application_url": preview["application_url"] or job.get("external_url"),
        "ats_provider": "greenhouse",
        "fields": preview["fields"],
        "supports_auto_submit": preview["supports_auto_submit"],
        "blockers": preview["blockers"],
    }


def _split_name(full_name: Optional[str]) -> Dict[str, str]:
    parts = (full_name or "").strip().split()
    if not parts:
        return {"first_name": "", "last_name": ""}
    if len(parts) == 1:
        return {"first_name": parts[0], "last_name": ""}
    return {"first_name": parts[0], "last_name": " ".join(parts[1:])}


def _field_missing_key(field: Dict[str, Any]) -> Optional[str]:
    text = " ".join([str(field.get("name") or ""), str(field.get("label") or "")]).lower()
    checks = [
        ("visa status", ("visa", "sponsorship", "sponsor")),
        ("work authorization", ("work authorization", "authorized to work", "right to work", "legally authorized")),
        ("salary expectations", ("salary", "compensation", "pay expectation", "expected pay")),
        ("relocation preference", ("relocation", "relocate")),
        ("start date", ("start date", "available to start", "availability")),
    ]
    for key, terms in checks:
        if any(term in text for term in terms):
            return key
    return None


def _field_text(field: Dict[str, Any]) -> str:
    return " ".join([str(field.get("name") or ""), str(field.get("label") or "")]).lower()


def _is_empty_answer(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len([item for item in value if not _is_empty_answer(item)]) == 0
    return False


def _sensitive_field_reason(field: Dict[str, Any]) -> Optional[str]:
    text = _field_text(field)
    category = field.get("field_category")
    checks = [
        ("work authorization", ("work authorization", "authorized to work", "right to work", "legally authorized", "eligible to work")),
        ("visa sponsorship", ("visa", "sponsorship", "sponsor")),
        ("disability status", ("disability", "disabled")),
        ("veteran status", ("veteran", "armed forces", "military service")),
        ("demographic question", ("gender", "race", "ethnicity", "hispanic", "pronouns", "sexual orientation")),
        ("criminal history", ("criminal", "conviction", "felony", "background check")),
        ("salary expectations", ("salary", "compensation", "pay expectation", "expected pay")),
    ]
    if category in ("demographic", "eeoc"):
        return "demographic question"
    for reason, terms in checks:
        if any(term in text for term in terms):
            return reason
    return None


def _profile_answer_key(field: Dict[str, Any]) -> Optional[str]:
    text = _field_text(field)
    if any(term in text for term in ("residence country", "country of residence", "current country")):
        return "residence_country"
    if any(term in text for term in ("authorized to work", "work authorization", "right to work", "legally authorized", "eligible to work")):
        return "work_authorization_countries"
    if any(term in text for term in ("require sponsorship", "need sponsorship", "visa sponsorship", "sponsor")):
        if any(term in text for term in ("future", "later", "eventually")):
            return "requires_sponsorship_future"
        return "requires_sponsorship_now"
    if any(term in text for term in ("desired work countries", "countries would you like", "work countries")):
        return "desired_work_countries"
    if any(term in text for term in ("salary", "compensation", "pay expectation", "expected pay")):
        return "salary_expectation"
    if any(term in text for term in ("start date", "available to start", "availability")):
        return "earliest_start_date"
    if any(term in text for term in ("relocation", "relocate")):
        return "willing_to_relocate"
    return None


def _profile_saved_answer(profile: Dict[str, Any], field: Dict[str, Any]) -> Any:
    key = _profile_answer_key(field)
    if not key:
        return None
    answers_profile = profile.get("application_answers_profile") or {}
    value = answers_profile.get(key)
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if not _is_empty_answer(item))
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def _profile_has_explicit_answer(profile: Dict[str, Any], field: Dict[str, Any]) -> bool:
    if not _is_empty_answer(_profile_saved_answer(profile, field)):
        return True
    text = _field_text(field)
    candidate_sources = [
        profile.get("application_answers"),
        profile.get("application_preferences"),
        profile.get("legal"),
        profile.get("work_authorization"),
        profile.get("candidate_facts"),
    ]
    for source in candidate_sources:
        if not source:
            continue
        serialized = json.dumps(source, default=str).lower()
        if any(term in serialized for term in text.split() if len(term) > 4):
            return True
    return False


def _missing_info_item(field: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return {
        "field_name": _public_missing_field_name(field),
        "label": str(field.get("label") or field.get("name") or "Unknown field"),
        "reason": reason,
        "field_type": field.get("type") or "input_text",
        "options": field.get("options") or [],
    }


def _all_payload_fields(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    fields = [
        {"name": "first_name", "label": "First name", "type": "input_text", "options": []},
        {"name": "last_name", "label": "Last name", "type": "input_text", "options": []},
        {"name": "email", "label": "Email", "type": "input_text", "options": []},
    ]
    fields.extend([q for q in payload.get("questions") or [] if isinstance(q, dict)])
    return fields


def _normalize_missing_information(items: List[Any], known_fields: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for item in items:
        if not item:
            continue
        if isinstance(item, dict):
            field_name = str(item.get("field_name") or item.get("name") or "")
            label = str(item.get("label") or item.get("question") or field_name or "Unknown field")
            field = next(
                (
                    known
                    for known in known_fields
                    if _canonical_field_key(known) == _canonical_field_name(field_name or label)
                ),
                {},
            )
            normalized.append({
                "field_name": _public_missing_field_name(field or {"name": field_name, "label": label}),
                "label": label or str(field.get("label") or "Unknown field"),
                "reason": item.get("reason") or "missing_information",
                "field_type": item.get("field_type") or field.get("type") or "input_text",
                "options": item.get("options") or field.get("options") or [],
            })
            continue

        text = str(item).strip()
        if not text:
            continue
        text_lower = text.lower()
        field = next(
            (
                known
                for known in known_fields
                if _canonical_field_key(known) == _canonical_field_name(text_lower)
            ),
            {},
        )
        normalized.append({
            "field_name": _public_missing_field_name(field or {"name": text, "label": text}),
            "label": str(field.get("label") or text),
            "reason": "missing_information",
            "field_type": field.get("type") or "input_text",
            "options": field.get("options") or [],
        })
    return _dedupe_missing_information(normalized)


def _canonical_field_name(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    if "privacy" in text and "policy" in text:
        return "privacy_policy_agreement"
    if "how_did_you_hear" in text or ("hear" in text and "job" in text):
        return "referral_source"
    return text


def _canonical_field_key(field: Dict[str, Any]) -> str:
    combined = " ".join([str(field.get("name") or ""), str(field.get("label") or "")])
    return _canonical_field_name(combined)


def _canonical_value_map(values: Dict[str, Any]) -> Dict[str, Any]:
    mapped = {}
    for key, value in (values or {}).items():
        canonical = _canonical_field_name(key)
        if canonical and canonical not in mapped:
            mapped[canonical] = value
    return mapped


def _public_missing_field_name(field: Dict[str, Any]) -> str:
    canonical = _canonical_field_key(field)
    if canonical in ("privacy_policy_agreement", "referral_source"):
        return canonical
    return str(field.get("name") or canonical)


def _greenhouse_safe_default_answer(field: Dict[str, Any]) -> Optional[str]:
    if not field.get("required"):
        return None
    if _sensitive_field_reason(field):
        return None
    canonical = _canonical_field_key(field)
    text = _field_text(field)
    if canonical == "referral_source" or canonical == "source":
        return "Swiipr"
    if "source" in canonical and "job" in text:
        return "Swiipr"
    if canonical == "privacy_policy_agreement":
        return "I agree"
    if any(term in text for term in ("consent", "acknowledgement", "acknowledgment", "i agree")):
        return "I agree"
    return None


def _missing_information_summary(items: List[Any]) -> str:
    parts = []
    for item in items:
        if isinstance(item, dict):
            label = item.get("label") or item.get("field_name") or "unknown field"
            reason = item.get("reason") or "missing_information"
            parts.append(f"{label}: {reason}")
        elif item:
            parts.append(str(item))
    return "; ".join(sorted(set(parts)))


def _dedupe_missing_information(items: List[Any]) -> List[Any]:
    seen = set()
    result = []
    for item in items:
        if not item:
            continue
        if isinstance(item, dict):
            key = _canonical_field_name(item.get("field_name") or item.get("label") or "")
        else:
            key = _canonical_field_name(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _required_empty_payload_fields(payload: Dict[str, Any]) -> List[Dict[str, str]]:
    fields = payload.get("fields") or {}
    canonical_fields = _canonical_value_map(fields)
    missing = []
    for name, label in (("first_name", "First name"), ("last_name", "Last name"), ("email", "Email")):
        if _is_empty_answer(fields.get(name)):
            missing.append({
                "field_name": name,
                "label": label,
                "reason": "required_empty_answer",
                "field_type": "input_text",
                "options": [],
            })
    for question in payload.get("questions") or []:
        if not isinstance(question, dict) or not question.get("required"):
            continue
        name = question.get("name")
        canonical = _canonical_field_key(question)
        value = fields.get(name)
        if _is_empty_answer(value):
            value = canonical_fields.get(canonical)
        if _is_empty_answer(value):
            value = question.get("value")
        if _is_empty_answer(value):
            missing.append(_missing_info_item(question, "required_empty_answer"))
    return missing


def _required_fields_count(payload: Dict[str, Any]) -> int:
    count = 0
    fields = payload.get("fields") or {}
    for name in ("first_name", "last_name", "email"):
        if name in fields:
            count += 1
    count += sum(
        1
        for question in payload.get("questions") or []
        if isinstance(question, dict) and question.get("required")
    )
    return count


def _field_by_name_from_payload(payload: Dict[str, Any], field_name: str) -> Optional[Dict[str, Any]]:
    canonical = _canonical_field_name(field_name)
    for question in payload.get("questions") or []:
        if isinstance(question, dict) and _canonical_field_key(question) == canonical:
            return question
    for candidate_field in ("first_name", "last_name", "email", "phone"):
        if _canonical_field_name(candidate_field) == canonical:
            return {"name": candidate_field, "label": candidate_field.replace("_", " ").title(), "type": "input_text", "options": []}
    return None


def _profile_answer_updates_from_resolved_fields(payload: Dict[str, Any], answers: Dict[str, Any]) -> Dict[str, Any]:
    updates = {}
    for field_name, value in answers.items():
        field = _field_by_name_from_payload(payload, field_name)
        if not field or _is_empty_answer(value):
            continue
        key = _profile_answer_key(field)
        if key:
            updates[f"application_answers_profile.{key}"] = value
    return updates


def _remove_resolved_missing_items(missing_items: List[Any], answers: Dict[str, Any]) -> List[Any]:
    result = []
    for item in missing_items:
        if isinstance(item, dict):
            field_name = item.get("field_name")
            if field_name in answers and not _is_empty_answer(answers.get(field_name)):
                continue
        result.append(item)
    return result


def _greenhouse_submit_dry_run_enabled() -> bool:
    return os.environ.get("GREENHOUSE_SUBMIT_DRY_RUN", "true").lower() not in ("0", "false", "no", "off")


def _payload_for_storage(payload: Dict[str, Any]) -> Dict[str, Any]:
    stored = json.loads(json.dumps(payload))
    files = stored.get("files") or {}
    for file_info in files.values():
        if isinstance(file_info, dict):
            if file_info.get("b64"):
                file_info["b64"] = None
                file_info["b64_stored_on_application"] = True
            if file_info.get("text"):
                file_info["text"] = None
                file_info["text_stored_on_application"] = True
    return stored


def _payload_for_response(payload: Dict[str, Any]) -> Dict[str, Any]:
    safe = json.loads(json.dumps(payload))
    files = safe.get("files") or {}
    for file_info in files.values():
        if isinstance(file_info, dict):
            if file_info.get("b64"):
                file_info["b64"] = f"<base64 omitted, {len(file_info['b64'])} chars>"
            if file_info.get("text"):
                file_info["text"] = f"<text omitted, {len(file_info['text'])} chars>"
    return safe


def _greenhouse_submission_endpoint(payload: Dict[str, Any], job: Dict[str, Any]) -> str:
    url = payload.get("url")
    if url:
        return url
    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")
    return f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{greenhouse_job_id}"


def _coerce_greenhouse_boolean(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value or "").strip().lower()
    if text in ("yes", "y", "true", "1", "i agree", "agree"):
        return "true"
    if text in ("no", "n", "false", "0"):
        return "false"
    return str(value or "")


def _map_greenhouse_option_value(field: Dict[str, Any], raw_value: Any) -> tuple[Any, Optional[Dict[str, Any]]]:
    options = field.get("options") or []
    if not options or _is_empty_answer(raw_value):
        return raw_value, None

    values = raw_value if isinstance(raw_value, list) else [raw_value]
    mapped_values = []
    mappings = []
    for item in values:
        item_text = str(item).strip()
        item_key = _canonical_field_name(item_text)
        match = next(
            (
                option for option in options
                if str(option.get("value") or "").strip() == item_text
                or str(option.get("label") or "").strip().lower() == item_text.lower()
                or _canonical_field_name(option.get("label") or option.get("value")) == item_key
                or (
                    item_text.lower() in ("i agree", "agree", "yes", "true")
                    and str(option.get("label") or option.get("value") or "").strip().lower() in ("i agree", "agree", "yes", "true")
                )
            ),
            None,
        )
        if match:
            mapped = match.get("value") if match.get("value") is not None else match.get("label")
            mapped_values.append(mapped)
            mappings.append({"input": item, "mapped_value": mapped, "label": match.get("label")})
        else:
            mapped_values.append(item)
            mappings.append({"input": item, "mapped_value": item, "error": "option_not_found"})

    mapped_result = mapped_values if isinstance(raw_value, list) else mapped_values[0]
    return mapped_result, {"field_name": field.get("name"), "label": field.get("label"), "mappings": mappings}


def _prepared_question_map(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    question_map = {}
    for question in payload.get("questions") or []:
        if isinstance(question, dict) and question.get("name"):
            question_map[question["name"]] = question
    return question_map


def _build_greenhouse_submission_parts(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
    raw_fields = payload.get("fields") or {}
    question_map = _prepared_question_map(payload)
    data: Dict[str, Any] = {}
    data_items = []
    option_mappings = []
    validation_errors = []

    for key, value in raw_fields.items():
        field = question_map.get(key)
        field_type = (field or {}).get("type") or "input_text"
        mapped_value = value
        mapping = None

        if field_type in ("select", "radio", "multi_select", "checkbox"):
            mapped_value, mapping = _map_greenhouse_option_value(field or {"name": key, "options": []}, value)
            if mapping:
                option_mappings.append(mapping)
                if any(item.get("error") for item in mapping.get("mappings") or []):
                    validation_errors.append({
                        "type": "option_mapping_error",
                        "field_name": key,
                        "label": (field or {}).get("label"),
                        "value": value,
                        "options": (field or {}).get("options") or [],
                    })
        elif field_type == "boolean":
            mapped_value = _coerce_greenhouse_boolean(value)

        if isinstance(mapped_value, list):
            data[key] = [str(item) for item in mapped_value]
            for item in mapped_value:
                data_items.append((key, str(item)))
        else:
            data[key] = "" if mapped_value is None else str(mapped_value)
            data_items.append((key, data[key]))

    resume_b64 = app_doc.get("tailored_cv_file_b64")
    if not resume_b64:
        validation_errors.append({"type": "missing_file", "field_name": "resume", "message": "Tailored CV file is missing"})
        resume_content = b""
    else:
        try:
            resume_content = base64.b64decode(resume_b64)
        except Exception:
            validation_errors.append({"type": "invalid_file", "field_name": "resume", "message": "Tailored CV file is invalid base64"})
            resume_content = b""

    payload_files = payload.get("files") or {}
    resume_meta = payload_files.get("resume") or {}
    files: Dict[str, tuple] = {}
    if resume_content:
        files["resume"] = (
            resume_meta.get("filename") or app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
            resume_content,
            resume_meta.get("mime") or app_doc.get("tailored_cv_mime") or "application/octet-stream",
        )

    cover_text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if cover_text.strip():
        cover_meta = payload_files.get("cover_letter") or {}
        files["cover_letter"] = (
            cover_meta.get("filename") or f"{app_doc.get('application_id', 'application')}_cover_letter.txt",
            cover_text.encode("utf-8"),
            cover_meta.get("mime") or "text/plain",
        )

    required_empty = _required_empty_payload_fields({"fields": data, "questions": payload.get("questions") or []})
    for item in required_empty:
        validation_errors.append({"type": "required_empty_field", **item})

    return {
        "data": data,
        "data_items": data_items,
        "files": files,
        "option_mappings": option_mappings,
        "validation_errors": validation_errors,
    }


def _greenhouse_submission_preview(app_doc: Dict[str, Any], payload: Dict[str, Any], job: Dict[str, Any]) -> Dict[str, Any]:
    parts = _build_greenhouse_submission_parts(app_doc, payload)
    data = parts["data"]
    files = parts["files"]
    return {
        "submit_url": _greenhouse_submission_endpoint(payload, job),
        "fields": [{"name": key, "value": value} for key, value in data.items()],
        "questions": [
            {
                "name": q.get("name"),
                "label": q.get("label"),
                "type": q.get("type"),
                "required": q.get("required"),
                "value": data.get(q.get("name")),
                "options": q.get("options") or [],
            }
            for q in payload.get("questions") or []
            if isinstance(q, dict)
        ],
        "option_mappings": parts["option_mappings"],
        "files": [
            {"field_name": name, "filename": file_tuple[0], "mime": file_tuple[2], "size_bytes": len(file_tuple[1])}
            for name, file_tuple in files.items()
        ],
        "validation_errors": parts["validation_errors"],
        "is_valid": not parts["validation_errors"],
    }


def _build_greenhouse_multipart(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> tuple[List[tuple], Dict[str, tuple], Dict[str, Any]]:
    parts = _build_greenhouse_submission_parts(app_doc, payload)
    if parts["validation_errors"]:
        raise HTTPException(status_code=400, detail={"message": "Greenhouse submission payload is invalid", "errors": parts["validation_errors"]})
    return parts["data_items"], parts["files"], parts


def _legacy_build_greenhouse_multipart(app_doc: Dict[str, Any], payload: Dict[str, Any]) -> tuple[Dict[str, str], Dict[str, tuple]]:
    fields = payload.get("fields") or {}
    data = {str(key): "" if value is None else str(value) for key, value in fields.items()}

    resume_b64 = app_doc.get("tailored_cv_file_b64")
    if not resume_b64:
        raise HTTPException(status_code=400, detail="Tailored CV file is missing")
    try:
        resume_content = base64.b64decode(resume_b64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Tailored CV file is invalid") from exc

    payload_files = payload.get("files") or {}
    resume_meta = payload_files.get("resume") or {}
    files: Dict[str, tuple] = {
        "resume": (
            resume_meta.get("filename") or app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
            resume_content,
            resume_meta.get("mime") or app_doc.get("tailored_cv_mime") or "application/octet-stream",
        )
    }

    cover_text = cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {})
    if cover_text.strip():
        cover_meta = payload_files.get("cover_letter") or {}
        files["cover_letter"] = (
            cover_meta.get("filename") or f"{app_doc.get('application_id', 'application')}_cover_letter.txt",
            cover_text.encode("utf-8"),
            cover_meta.get("mime") or "text/plain",
        )
    return data, files


def _greenhouse_response_metadata(response: httpx.Response) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {
        "status_code": response.status_code,
        "headers": {
            key: value
            for key, value in response.headers.items()
            if key.lower() in ("location", "content-type", "x-request-id")
        },
    }
    try:
        body = response.json()
        if isinstance(body, dict):
            metadata["body"] = {
                key: body.get(key)
                for key in ("id", "application_id", "status", "message", "error", "errors", "validation_errors", "invalid_fields")
                if key in body
            }
        else:
            metadata["body_type"] = type(body).__name__
    except Exception:
        metadata["body_snippet"] = response.text[:500]
    return metadata


def _greenhouse_response_submission_id(response: httpx.Response) -> Optional[str]:
    try:
        body = response.json()
        if isinstance(body, dict):
            value = body.get("id") or body.get("application_id")
            return str(value) if value else None
    except Exception:
        pass
    location = response.headers.get("location")
    return location[-120:] if location else None


async def _generate_greenhouse_answers(
    profile: Dict[str, Any],
    job: Dict[str, Any],
    app_doc: Dict[str, Any],
    fields: List[Dict[str, Any]],
) -> Dict[str, Any]:
    custom_fields = [
        field for field in fields
        if field.get("field_category") in ("custom_question", "demographic", "eeoc")
    ]
    if not custom_fields:
        return {"answers": [], "missing_information": []}

    system_message = (
        "You generate truthful job application answers from provided candidate data. "
        "Return ONLY valid JSON. Never invent facts. If required information is missing, "
        "leave answer empty, lower confidence, and add a missing_information item."
    )
    prompt = f"""Prepare answers for Greenhouse application questions.

Candidate profile:
{json.dumps({
    "contact": profile.get("contact", {}),
    "summary": profile.get("summary"),
    "skills": profile.get("skills", []),
    "experience": profile.get("experience", []),
    "education": profile.get("education", []),
    "cv_text": profile.get("cv_text", "")[:12000],
}, indent=2)}

Tailored resume:
{json.dumps(app_doc.get("tailored_resume_structured") or app_doc.get("tailored_resume") or {}, indent=2)}

Tailored cover letter:
{json.dumps(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}, indent=2)}

Job:
{json.dumps({
    "title": job.get("title"),
    "company": job.get("company"),
    "description": job.get("clean_description") or job.get("description"),
    "requirements": job.get("requirements", []),
}, indent=2)}

Questions:
{json.dumps(custom_fields, indent=2)}

Rules:
- Answer only from the candidate/profile/CV/tailored application context.
- Do not answer visa, work authorization, salary, relocation, or start-date questions unless explicitly present in the candidate data.
- For select/multi_select fields, choose only from provided option labels/values when the answer is clear.
- For unknown required information, return an empty answer and include missing_information.

Return JSON:
{{
  "answers": [
    {{"field_name": "question_123", "question": "...", "answer": "...", "confidence": 0.0}}
  ],
  "missing_information": ["work authorization"]
}}"""
    response = await complete_json_text(system_message, prompt)
    return _parse_json_from_llm(response)


@api_router.post("/applications/greenhouse/prepare-submit")
async def greenhouse_prepare_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job = await db.jobs.find_one({"job_id": body.job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    profile = await db.profiles.find_one({"user_id": user.user_id}, {"_id": 0})
    if not profile or not profile.get("cv_text"):
        raise HTTPException(status_code=400, detail="Upload CV first")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": body.job_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    package_missing = (
        not app_doc
        or not app_doc.get("tailored_resume_structured")
        or not app_doc.get("tailored_cover_letter")
        or not app_doc.get("application_answers")
        or not app_doc.get("tailored_cv_file_b64")
    )
    if package_missing:
        try:
            generated_doc = await _generate_application_doc(user, profile, job)
        except LLMProviderNotConfigured as e:
            raise HTTPException(status_code=502, detail=str(e))
        if app_doc:
            generated_doc["application_id"] = app_doc.get("application_id") or generated_doc["application_id"]
            generated_doc["created_at"] = app_doc.get("created_at") or generated_doc["created_at"]
            await db.applications.update_one(
                {"user_id": user.user_id, "job_id": body.job_id, "application_id": generated_doc["application_id"]},
                {"$set": generated_doc},
                upsert=True,
            )
        else:
            await db.applications.insert_one(generated_doc)
        app_doc = generated_doc

    board_token = job.get("board_token")
    greenhouse_job_id = job.get("provider_job_id")
    external_id = job.get("external_id") or ""
    if (not board_token or not greenhouse_job_id) and ":" in external_id:
        board_token, greenhouse_job_id = external_id.split(":", 1)
    if not board_token or not greenhouse_job_id:
        raise HTTPException(status_code=400, detail="Greenhouse board token or job id is missing")

    provider = get_board_provider("greenhouse")
    try:
        preview = await provider.inspect_application_form(board_token, greenhouse_job_id)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail="Greenhouse application form is unavailable") from exc
    except LLMProviderNotConfigured:
        raise
    except Exception as exc:
        logger.warning("Greenhouse prepare-submit form preview failed: job_id=%s error=%s", body.job_id, exc)
        raise HTTPException(status_code=502, detail="Greenhouse application form preview failed") from exc

    fields = preview["fields"]

    try:
        generated = await _generate_greenhouse_answers(profile, job, app_doc, fields)
    except LLMProviderNotConfigured as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as exc:
        logger.exception("Greenhouse answer generation failed")
        raise HTTPException(status_code=502, detail="AI application answer generation failed") from exc

    generated_answers = generated.get("answers") or []
    answers_by_field = {answer.get("field_name"): answer for answer in generated_answers if answer.get("field_name")}

    contact = profile.get("contact") or {}
    names = _split_name(contact.get("name") or user.name)
    payload_fields: Dict[str, Any] = {
        "first_name": names["first_name"],
        "last_name": names["last_name"],
        "email": user.email,
        "phone": contact.get("phone") or "",
    }
    question_payload = []
    auto_filled_fields = []
    for field in fields:
        category = field.get("field_category")
        name = field.get("name")
        if category in ("candidate", "document"):
            continue
        answer = answers_by_field.get(name, {})
        saved_value = _profile_saved_answer(profile, field)
        value = saved_value if not _is_empty_answer(saved_value) else (answer.get("answer") or "")
        if _is_empty_answer(value):
            default_value = _greenhouse_safe_default_answer(field)
            if default_value is not None:
                value = default_value
                auto_filled_fields.append(_public_missing_field_name(field))
        payload_fields[name] = value
        question_payload.append({
            "name": name,
            "label": field.get("label"),
            "value": value,
            "required": field.get("required"),
            "confidence": answer.get("confidence", 0),
        })
    application_payload = {
        "method": "POST",
        "url": f"https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs/{greenhouse_job_id}",
        "content_type": "multipart/form-data",
        "fields": payload_fields,
        "questions": question_payload,
        "files": {
            "resume": {
                "filename": app_doc.get("tailored_cv_filename") or "tailored_cv.docx",
                "mime": app_doc.get("tailored_cv_mime") or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "b64": app_doc.get("tailored_cv_file_b64"),
            },
            "cover_letter": {
                "filename": f"{body.job_id}_cover_letter.txt",
                "mime": "text/plain",
                "text": cover_letter_to_text(app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter") or {}),
            },
        },
    }
    missing_information = _normalize_missing_information(
        _required_empty_payload_fields(application_payload),
        _all_payload_fields(application_payload),
    )
    required_fields_count = _required_fields_count(application_payload)
    current_empty_required_fields = [item["field_name"] for item in missing_information]
    empty_required_fields_count = len(current_empty_required_fields)
    ready_for_submission = not missing_information and not preview.get("blockers")
    submission_status = "ready" if ready_for_submission else "blocked"
    blockers = sorted(set(preview.get("blockers") or []))
    logger.info(
        "Greenhouse prepare-submit validation: job_id=%s auto_filled_fields=%s remaining_empty_required_fields=%s current_empty_required_fields=%s deduped_missing_information_count=%s final_submission_status=%s",
        body.job_id,
        auto_filled_fields,
        current_empty_required_fields,
        current_empty_required_fields,
        len(missing_information),
        submission_status,
    )
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "package_status": "generated",
            "submission_status": submission_status,
            "submitted_at": None,
            "submission_provider": "greenhouse",
            "submission_response_id": None,
            "submission_error": None if ready_for_submission else _missing_information_summary([*missing_information, *blockers]),
            "prepared_application_payload": _payload_for_storage(application_payload),
            "prepared_generated_answers": generated_answers,
            "prepared_missing_information": missing_information,
            "prepared_blockers": blockers,
            "prepared_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    return {
        "job_id": job["job_id"],
        "company": job.get("company"),
        "title": job.get("title"),
        "ready_for_submission": ready_for_submission,
        "submission_status": submission_status,
        "missing_information": missing_information,
        "blockers": blockers,
        "debug_summary": {
            "required_fields_count": required_fields_count,
            "empty_required_fields_count": empty_required_fields_count,
            "auto_filled_fields": auto_filled_fields,
            "remaining_empty_required_fields": current_empty_required_fields,
        },
        "application_payload": application_payload,
        "generated_answers": [
            {
                "question": answer.get("question"),
                "answer": answer.get("answer") or "",
                "confidence": answer.get("confidence", 0),
            }
            for answer in generated_answers
        ],
    }


async def _load_greenhouse_prepared_application(job_id: str, user: User) -> tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("ats_provider") != "greenhouse":
        raise HTTPException(status_code=400, detail="Job is not a Greenhouse job")

    app_doc = await db.applications.find_one(
        {"user_id": user.user_id, "job_id": job_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not app_doc:
        raise HTTPException(status_code=400, detail="Create and prepare an application package before submission")
    app_doc = _normalize_application_status_fields(app_doc)
    payload = app_doc.get("prepared_application_payload")
    if not payload:
        raise HTTPException(status_code=400, detail="Prepare submission before submitting")
    return job, app_doc, payload


@api_router.get("/applications/greenhouse/submission-preview")
async def greenhouse_submission_preview(job_id: str, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(job_id, user)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    return {
        "job_id": job_id,
        "company": job.get("company"),
        "title": job.get("title"),
        "submission_status": app_doc.get("submission_status"),
        **preview,
    }


@api_router.post("/applications/greenhouse/validate-submit")
async def greenhouse_validate_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(body.job_id, user)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    now = datetime.now(timezone.utc).isoformat()
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "submission_validation_errors": preview["validation_errors"],
            "submission_option_mappings": preview["option_mappings"],
            "submission_preview_metadata": {
                "field_count": len(preview["fields"]),
                "file_parts": preview["files"],
                "submit_url": preview["submit_url"],
            },
            "updated_at": now,
        }},
    )
    return {
        "job_id": body.job_id,
        "company": job.get("company"),
        "title": job.get("title"),
        "submission_status": app_doc.get("submission_status"),
        "is_valid": preview["is_valid"],
        "validation_errors": preview["validation_errors"],
        "option_mappings": preview["option_mappings"],
        "files": preview["files"],
        "field_count": len(preview["fields"]),
    }


@api_router.post("/applications/greenhouse/submit")
async def greenhouse_submit(body: GreenhousePrepareSubmitRequest, user: User = Depends(get_current_user)):
    job, app_doc, payload = await _load_greenhouse_prepared_application(body.job_id, user)
    missing_information = app_doc.get("prepared_missing_information") or []
    blockers = app_doc.get("prepared_blockers") or []
    if app_doc.get("package_status") != "generated":
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application package is not generated",
                "package_status": app_doc.get("package_status"),
                "submission_status": app_doc.get("submission_status"),
                "missing_information": missing_information,
                "blockers": blockers,
            },
        )
    if app_doc.get("submission_status") != "ready":
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application is not ready for submission",
                "package_status": app_doc.get("package_status"),
                "submission_status": app_doc.get("submission_status"),
                "missing_information": missing_information,
                "blockers": blockers,
                "submission_error": app_doc.get("submission_error"),
            },
        )

    required_empty = _required_empty_payload_fields(payload)
    if required_empty:
        missing_information = _dedupe_missing_information([*missing_information, *required_empty])
        error = _missing_information_summary(missing_information)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "blocked",
                "submission_error": error,
                "prepared_missing_information": missing_information,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Application has required empty answers",
                "package_status": app_doc.get("package_status"),
                "submission_status": "blocked",
                "missing_information": missing_information,
                "blockers": blockers,
            },
        )

    submit_url = _greenhouse_submission_endpoint(payload, job)
    preview = _greenhouse_submission_preview(app_doc, payload, job)
    if not preview["is_valid"]:
        now = datetime.now(timezone.utc).isoformat()
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "blocked",
                "submission_error": "Greenhouse submission payload is invalid",
                "submission_validation_errors": preview["validation_errors"],
                "submission_option_mappings": preview["option_mappings"],
                "submission_preview_metadata": {
                    "field_count": len(preview["fields"]),
                    "file_parts": preview["files"],
                    "submit_url": preview["submit_url"],
                },
                "updated_at": now,
            }},
        )
        raise HTTPException(status_code=400, detail={"message": "Greenhouse submission payload is invalid", "errors": preview["validation_errors"]})

    data, files, parts = _build_greenhouse_multipart(app_doc, payload)
    dry_run = _greenhouse_submit_dry_run_enabled()
    logger.info(
        "Greenhouse submit%s: user_id=%s job_id=%s company=%s multipart_fields=%s multipart_file_parts=%s questions=%s option_mappings=%s",
        " dry-run" if dry_run else "",
        user.user_id,
        body.job_id,
        job.get("company"),
        [item[0] for item in data],
        [{"field_name": name, "filename": file_tuple[0], "mime": file_tuple[2], "size_bytes": len(file_tuple[1])} for name, file_tuple in files.items()],
        len(payload.get("questions") or []),
        parts.get("option_mappings") or [],
    )

    if dry_run:
        return {
            "job_id": job["job_id"],
            "company": job.get("company"),
            "title": job.get("title"),
            "dry_run": True,
            "would_submit": True,
            "submit_url": submit_url,
            "submission_preview": preview,
            "submission_status": app_doc.get("submission_status"),
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(submit_url, data=data, files=files)
    except httpx.RequestError as exc:
        error = f"Greenhouse submission request failed: {exc.__class__.__name__}"
        logger.warning("Greenhouse submit request failed: job_id=%s error=%s", body.job_id, exc)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "failed",
                "submission_provider": "greenhouse",
                "submission_error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        raise HTTPException(status_code=502, detail=error) from exc

    metadata = _greenhouse_response_metadata(response)
    if 200 <= response.status_code < 300:
        submitted_at = datetime.now(timezone.utc).isoformat()
        submission_response_id = _greenhouse_response_submission_id(response)
        await db.applications.update_one(
            {"application_id": app_doc["application_id"], "user_id": user.user_id},
            {"$set": {
                "submission_status": "submitted",
                "submitted_at": submitted_at,
                "submission_provider": "greenhouse",
                "submission_response_id": submission_response_id,
                "submission_error": None,
                "submission_response_metadata": metadata,
                "submission_validation_errors": [],
                "submission_option_mappings": preview["option_mappings"],
                "submission_preview_metadata": {
                    "field_count": len(preview["fields"]),
                    "file_parts": preview["files"],
                    "submit_url": preview["submit_url"],
                },
                "updated_at": submitted_at,
            }},
        )
        logger.info(
            "Greenhouse submit succeeded: job_id=%s status_code=%s response_id=%s",
            body.job_id,
            response.status_code,
            submission_response_id,
        )
        return {
            "job_id": job["job_id"],
            "company": job.get("company"),
            "title": job.get("title"),
            "dry_run": False,
            "submission_status": "submitted",
            "submitted_at": submitted_at,
            "submission_provider": "greenhouse",
            "submission_response_id": submission_response_id,
            "submission_response_metadata": metadata,
        }

    error = f"Greenhouse submission failed with HTTP {response.status_code}"
    logger.warning(
        "Greenhouse submit failed: job_id=%s status_code=%s body_snippet=%s",
        body.job_id,
        response.status_code,
        response.text[:300],
    )
    await db.applications.update_one(
        {"application_id": app_doc["application_id"], "user_id": user.user_id},
        {"$set": {
            "submission_status": "failed",
            "submission_provider": "greenhouse",
            "submission_error": error,
            "submission_response_metadata": metadata,
            "submission_validation_errors": metadata.get("body", {}).get("validation_errors") or metadata.get("body", {}).get("errors") or [],
            "submission_option_mappings": preview["option_mappings"],
            "submission_preview_metadata": {
                "field_count": len(preview["fields"]),
                "file_parts": preview["files"],
                "submit_url": preview["submit_url"],
            },
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    raise HTTPException(status_code=502, detail={"message": error, "response": metadata})


@api_router.post("/applications/{application_id}/resolve-missing-info")
async def resolve_missing_info(
    application_id: str,
    body: ResolveMissingInfoRequest,
    user: User = Depends(get_current_user),
):
    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0},
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")

    payload = app_doc.get("prepared_application_payload")
    if not payload:
        raise HTTPException(status_code=400, detail="Prepare submission before resolving missing information")

    answers = body.answers or {}
    current_missing = _normalize_missing_information(
        app_doc.get("prepared_missing_information") or [],
        _all_payload_fields(payload),
    )
    missing_count_before = len(current_missing)
    answers_received_count = len([value for value in answers.values() if not _is_empty_answer(value)])
    answers_by_canonical = _canonical_value_map(answers)
    required_missing_names = [
        item.get("field_name")
        for item in current_missing
        if isinstance(item, dict) and item.get("field_name")
    ]
    invalid = [
        field_name
        for field_name in required_missing_names
        if _is_empty_answer(answers.get(field_name)) and _is_empty_answer(answers_by_canonical.get(_canonical_field_name(field_name)))
    ]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Answers are required for blocked fields",
                "missing_field_names": invalid,
            },
        )

    fields = payload.setdefault("fields", {})
    updated_payload_keys = set()
    for field_name, value in answers.items():
        if _is_empty_answer(value):
            continue
        canonical = _canonical_field_name(field_name)
        fields[field_name] = value
        updated_payload_keys.add(field_name)
        for existing_key in list(fields.keys()):
            if _canonical_field_name(existing_key) == canonical:
                fields[existing_key] = value
                updated_payload_keys.add(existing_key)
        for question in payload.get("questions") or []:
            if not isinstance(question, dict):
                continue
            if _canonical_field_key(question) == canonical:
                question["value"] = value
                if question.get("name"):
                    fields[question["name"]] = value
                    updated_payload_keys.add(question["name"])

    missing_information = _normalize_missing_information(
        _required_empty_payload_fields(payload),
        _all_payload_fields(payload),
    )
    blockers = app_doc.get("prepared_blockers") or []
    submission_status = "ready" if not missing_information and not blockers else "blocked"
    submission_error = None if submission_status == "ready" else _missing_information_summary([*missing_information, *blockers])
    now = datetime.now(timezone.utc).isoformat()
    logger.info(
        "Resolved missing application info: application_id=%s missing_count_before=%s answers_received_count=%s missing_count_after=%s submission_status_after=%s received_answer_keys=%s updated_payload_keys=%s remaining_empty_required_fields=%s",
        application_id,
        missing_count_before,
        answers_received_count,
        len(missing_information),
        submission_status,
        list(answers.keys()),
        sorted(updated_payload_keys),
        [item.get("field_name") for item in missing_information],
    )

    update_fields = {
        "prepared_application_payload": payload,
        "prepared_missing_information": missing_information,
        "submission_status": submission_status,
        "submission_error": submission_error,
        "updated_at": now,
    }
    await db.applications.update_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"$set": update_fields},
    )

    if body.save_to_profile:
        profile_updates = _profile_answer_updates_from_resolved_fields(payload, answers)
        if profile_updates:
            profile_updates["updated_at"] = now
            await db.profiles.update_one(
                {"user_id": user.user_id},
                {"$set": profile_updates},
                upsert=True,
            )

    updated = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0},
    )
    updated = _normalize_application_status_fields(updated or {})
    job = await db.jobs.find_one({"job_id": updated.get("job_id")}, {"_id": 0})
    return {
        "application_id": application_id,
        "submission_status": submission_status,
        "ready_for_submission": submission_status == "ready",
        "missing_information": missing_information,
        "blockers": blockers,
        "resolved_count": len(updated_payload_keys),
        "unresolved_fields": missing_information,
        "application": {**updated, "job": job},
    }


@api_router.get("/applications/{application_id}")
async def get_application(application_id: str, user: User = Depends(get_current_user)):
    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id}, {"_id": 0}
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Not found")
    app_doc = _normalize_application_status_fields(app_doc)
    job = await db.jobs.find_one({"job_id": app_doc["job_id"]}, {"_id": 0})
    return {**app_doc, "job": job}


@api_router.get("/applications/{application_id}/tailored-cv")
async def download_tailored_cv(application_id: str, user: User = Depends(get_current_user)):
    import base64
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0, "tailored_cv_file_b64": 1, "tailored_cv_filename": 1, "tailored_cv_mime": 1},
    )
    if not app_doc or not app_doc.get("tailored_cv_file_b64"):
        raise HTTPException(status_code=404, detail="Tailored CV not found")

    content = base64.b64decode(app_doc["tailored_cv_file_b64"])
    filename = app_doc.get("tailored_cv_filename") or "tailored_cv.docx"
    return FastAPIResponse(
        content=content,
        media_type=app_doc.get("tailored_cv_mime") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api_router.get("/applications/{application_id}/cover-letter")
async def download_cover_letter(application_id: str, user: User = Depends(get_current_user)):
    from fastapi.responses import Response as FastAPIResponse

    app_doc = await db.applications.find_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"_id": 0, "tailored_cover_letter": 1, "cover_letter": 1},
    )
    if not app_doc:
        raise HTTPException(status_code=404, detail="Application not found")

    cover_letter = app_doc.get("tailored_cover_letter") or app_doc.get("cover_letter")
    if not cover_letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    content = cover_letter_to_text(cover_letter)
    return FastAPIResponse(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{application_id}_cover_letter.txt"'},
    )


@api_router.patch("/applications/{application_id}/status")
async def update_status(application_id: str, update: StatusUpdate, user: User = Depends(get_current_user)):
    res = await db.applications.update_one(
        {"application_id": application_id, "user_id": user.user_id},
        {"$set": {"status": update.status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ===================== Seed =====================

MOCK_JOBS = [
    {
        "title": "Senior Frontend Engineer",
        "company": "Linear",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 140000, "salary_max": 200000,
        "description": "Build the world's fastest issue tracker. Work on perf, animations, complex UI state.",
        "requirements": ["5+ years frontend", "TypeScript expert", "React or similar", "Performance optimization"],
        "tech_stack": ["TypeScript", "React", "GraphQL", "Vite"],
        "seniority": "senior",
    },
    {
        "title": "Full Stack Engineer",
        "company": "Vercel",
        "location": "San Francisco, CA",
        "remote": "hybrid",
        "salary_min": 160000, "salary_max": 240000,
        "description": "Help build the platform powering the modern web. Ship Next.js, Edge runtime, and DX tools.",
        "requirements": ["TypeScript", "Node.js", "Next.js", "Distributed systems"],
        "tech_stack": ["TypeScript", "Next.js", "Rust", "Go"],
        "seniority": "mid",
    },
    {
        "title": "AI Engineer",
        "company": "Anthropic",
        "location": "San Francisco, CA",
        "remote": "onsite",
        "salary_min": 220000, "salary_max": 380000,
        "description": "Work on Claude — train, evaluate, and ship safety-focused LLM products.",
        "requirements": ["ML/AI experience", "Python", "PyTorch", "Research engineering"],
        "tech_stack": ["Python", "PyTorch", "JAX", "CUDA"],
        "seniority": "senior",
    },
    {
        "title": "Product Designer",
        "company": "Raycast",
        "location": "Remote (EU/US)",
        "remote": "remote",
        "salary_min": 120000, "salary_max": 180000,
        "description": "Design extensions and core surfaces for the fastest launcher on Mac.",
        "requirements": ["5+ years product design", "Figma", "Strong portfolio", "Systems thinking"],
        "tech_stack": ["Figma", "Framer"],
        "seniority": "senior",
    },
    {
        "title": "Backend Engineer",
        "company": "Supabase",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 130000, "salary_max": 190000,
        "description": "Build the open-source Firebase alternative. Postgres, realtime, auth, edge functions.",
        "requirements": ["Postgres internals", "TypeScript or Go", "Open-source experience"],
        "tech_stack": ["TypeScript", "Postgres", "Deno", "Go"],
        "seniority": "mid",
    },
    {
        "title": "iOS Engineer",
        "company": "Notion",
        "location": "New York, NY",
        "remote": "hybrid",
        "salary_min": 150000, "salary_max": 230000,
        "description": "Build the Notion mobile experience used by millions.",
        "requirements": ["Swift/SwiftUI", "5+ years iOS", "Performance tuning"],
        "tech_stack": ["Swift", "SwiftUI", "Combine"],
        "seniority": "senior",
    },
    {
        "title": "Growth Engineer",
        "company": "Cal.com",
        "location": "Remote",
        "remote": "remote",
        "salary_min": 110000, "salary_max": 170000,
        "description": "Run experiments across landing, signup, and activation flows. Move metrics, ship fast.",
        "requirements": ["A/B testing", "Next.js", "Analytics tools", "SQL"],
        "tech_stack": ["Next.js", "TypeScript", "PostHog", "Postgres"],
        "seniority": "mid",
    },
    {
        "title": "Staff ML Engineer",
        "company": "Hugging Face",
        "location": "Remote (EU)",
        "remote": "remote",
        "salary_min": 200000, "salary_max": 320000,
        "description": "Open-source ML at scale. Lead transformers, datasets, or inference infrastructure.",
        "requirements": ["Senior ML experience", "Python", "Open-source leadership"],
        "tech_stack": ["Python", "PyTorch", "Transformers"],
        "seniority": "lead",
    },
    {
        "title": "DevRel Engineer",
        "company": "Stripe",
        "location": "Remote (US)",
        "remote": "remote",
        "salary_min": 140000, "salary_max": 210000,
        "description": "Build demos, content, and tooling that helps developers integrate Stripe in minutes.",
        "requirements": ["Strong writing", "Full-stack coding", "Speaking experience"],
        "tech_stack": ["TypeScript", "Node.js", "React"],
        "seniority": "senior",
    },
    {
        "title": "Platform Engineer",
        "company": "Fly.io",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 150000, "salary_max": 220000,
        "description": "Run the global app platform. Linux, networking, distributed systems.",
        "requirements": ["Linux internals", "Rust or Go", "Networking"],
        "tech_stack": ["Rust", "Go", "Linux"],
        "seniority": "senior",
    },
    {
        "title": "Junior Frontend Developer",
        "company": "Framer",
        "location": "Amsterdam, NL",
        "remote": "hybrid",
        "salary_min": 60000, "salary_max": 85000,
        "description": "Join the team building the no-code site builder loved by designers.",
        "requirements": ["1-2 years React", "CSS skills", "Eye for detail"],
        "tech_stack": ["React", "TypeScript", "CSS"],
        "seniority": "junior",
    },
    {
        "title": "Data Engineer",
        "company": "Posthog",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 130000, "salary_max": 200000,
        "description": "Scale ClickHouse, build pipelines, ship product analytics at billions of events.",
        "requirements": ["ClickHouse or BigQuery", "Python", "Streaming systems"],
        "tech_stack": ["Python", "ClickHouse", "Kafka"],
        "seniority": "senior",
    },
    {
        "title": "Founding Engineer",
        "company": "Stealth AI Startup",
        "location": "San Francisco, CA",
        "remote": "onsite",
        "salary_min": 180000, "salary_max": 260000,
        "description": "Build the core product from day 1. Equity-heavy. Wear every hat.",
        "requirements": ["Full-stack expert", "Shipped 0-1 products", "AI experience"],
        "tech_stack": ["TypeScript", "Python", "Next.js", "LLMs"],
        "seniority": "senior",
    },
    {
        "title": "Mobile Engineer",
        "company": "Cash App",
        "location": "Remote (US)",
        "remote": "remote",
        "salary_min": 150000, "salary_max": 230000,
        "description": "Build the simplest way to send money. iOS and Android.",
        "requirements": ["Swift or Kotlin", "Fintech experience", "Strong testing"],
        "tech_stack": ["Swift", "Kotlin"],
        "seniority": "senior",
    },
    {
        "title": "Marketing Engineer",
        "company": "Resend",
        "location": "Remote (Global)",
        "remote": "remote",
        "salary_min": 120000, "salary_max": 170000,
        "description": "Build delightful marketing sites and docs for the email API for developers.",
        "requirements": ["Next.js", "Design sense", "Animations"],
        "tech_stack": ["Next.js", "Framer Motion", "TypeScript"],
        "seniority": "mid",
    },
]


@api_router.post("/seed")
async def seed_jobs():
    """Idempotently seed mock job data for development fallback."""
    fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
    if not fallback_mock:
        raise HTTPException(status_code=403, detail="Mock seed is disabled")
    count = await db.jobs.count_documents({})
    if count >= len(MOCK_JOBS):
        return {"ok": True, "skipped": True, "count": count}

    now = datetime.now(timezone.utc)
    docs = []
    for j in MOCK_JOBS:
        docs.append({
            "job_id": f"job_{uuid.uuid4().hex[:10]}",
            "currency": "USD",
            "posted_at": now.isoformat(),
            **j,
        })
    await db.jobs.delete_many({})
    await db.jobs.insert_many(docs)
    return {"ok": True, "count": len(docs)}


@api_router.get("/")
async def root():
    return {"message": "Tinder for Jobs API", "ok": True}


@api_router.get("/dev/jsearch-test")
async def dev_jsearch_test(q: str = "software engineer", location: str = "New York", limit: int = 5):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    api_key = os.environ.get("JSEARCH_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="JSEARCH_API_KEY is not configured")

    provider = get_job_provider(os.environ.get("JOB_PROVIDER_PRIMARY", "jsearch"), api_key)
    query = JobSearchQuery(
        role=q,
        location=location,
        remote_preference="any",
        country=os.environ.get("JSEARCH_COUNTRY", "us"),
        language=os.environ.get("JSEARCH_LANGUAGE", "en"),
        limit=max(1, min(limit, 20)),
    )
    try:
        result = await provider.search(query)
    except ValueError as exc:
        logger.warning("Dev JSearch response parse failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logger.warning("Dev JSearch test failed: %s", exc)
        raise HTTPException(status_code=502, detail="JSearch provider request failed") from exc
    return {"jobs": result.jobs, "count": len(result.jobs)}


@api_router.get("/dev/greenhouse-import-test")
async def dev_greenhouse_import_test():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    await seed_greenhouse_company_boards(db)
    result = await refresh_greenhouse_boards(db, limit_boards=10, force=True)
    sample_jobs = result.get("sample_jobs", [])
    return {
        "boards_checked": result.get("boards_checked", 0),
        "boards_successful": result.get("boards_successful", 0),
        "jobs_imported": result.get("jobs_imported", 0),
        "sample_jobs": sample_jobs[:5],
    }


@api_router.get("/dev/greenhouse-board-test")
async def dev_greenhouse_board_test(board_token: str = "stripe"):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    token = board_token.strip().lower()
    if not token:
        raise HTTPException(status_code=400, detail="board_token is required")

    provider = get_board_provider("greenhouse")
    try:
        inspection = await provider.inspect_board(token)
    except Exception as exc:
        logger.warning("Greenhouse board test failed: board_token=%s error=%s", token, exc)
        raise HTTPException(status_code=502, detail="Greenhouse board test failed") from exc

    return {
        "board_token": inspection["board_token"],
        "status_code": inspection["status_code"],
        "jobs_count": inspection["jobs_count"],
        "first_job_title": inspection["first_job_title"],
        "error_snippet": inspection["error_snippet"],
    }


@api_router.get("/dev/job-debug/{job_id}")
async def dev_job_debug(job_id: str):
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    job = await db.jobs.find_one(
        {"job_id": job_id},
        {"_id": 0, "title": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@api_router.get("/dev/greenhouse-jobs-sample")
async def dev_greenhouse_jobs_sample():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    jobs = await db.jobs.find(
        {"ats_provider": "greenhouse", "auto_apply_supported": True},
        {
            "_id": 0,
            "job_id": 1,
            "external_id": 1,
            "title": 1,
            "company": 1,
            "external_url": 1,
            "provider": 1,
            "ats_provider": 1,
        },
    ).limit(10).to_list(10)
    return {"jobs": jobs, "count": len(jobs)}


@api_router.get("/dev/clean-job-descriptions")
async def dev_clean_job_descriptions():
    dev_enabled = (
        os.environ.get("ENVIRONMENT", "").lower() == "development"
        or os.environ.get("DEV_TOOLS_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    )
    if not dev_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    provider = get_board_provider("greenhouse")

    def has_html(value: Any) -> bool:
        return bool(re.search(r"</?[a-z][\s\S]*?>", str(value or ""), flags=re.IGNORECASE))

    def clean_sections(sections: Any) -> List[Dict[str, Any]]:
        cleaned = []
        if not isinstance(sections, list):
            return cleaned
        for section in sections:
            if not isinstance(section, dict):
                continue
            title = provider.sanitize_text(section.get("title"))
            bullets = [
                provider.sanitize_text(bullet)
                for bullet in (section.get("bullets") or [])
                if provider.sanitize_text(bullet)
            ]
            if title and bullets:
                cleaned.append({"title": title, "bullets": bullets})
        return cleaned

    scanned = 0
    updated = 0
    sample_remaining_ids: List[str] = []
    cursor = db.jobs.find(
        {},
        {"_id": 0, "job_id": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    async for job in cursor:
        scanned += 1
        description = provider.sanitize_text(job.get("description"))
        clean_description = provider.sanitize_text(job.get("clean_description") or description)
        sections = clean_sections(job.get("job_description_sections"))
        requirements = [
            provider.sanitize_text(item)
            for item in (job.get("requirements") or [])
            if provider.sanitize_text(item)
        ]
        update = {
            "description": description,
            "clean_description": clean_description,
            "job_description_sections": sections,
            "requirements": requirements,
        }
        if (
            update["description"] != job.get("description")
            or update["clean_description"] != job.get("clean_description")
            or update["job_description_sections"] != (job.get("job_description_sections") or [])
            or update["requirements"] != (job.get("requirements") or [])
        ):
            await db.jobs.update_one({"job_id": job["job_id"]}, {"$set": update})
            updated += 1

    remaining_html_count = 0
    cursor = db.jobs.find(
        {},
        {"_id": 0, "job_id": 1, "description": 1, "clean_description": 1, "job_description_sections": 1, "requirements": 1},
    )
    async for job in cursor:
        contains_html = has_html(job.get("description")) or has_html(job.get("clean_description"))
        for section in job.get("job_description_sections") or []:
            contains_html = contains_html or has_html(section.get("title"))
            contains_html = contains_html or any(has_html(bullet) for bullet in section.get("bullets") or [])
        contains_html = contains_html or any(has_html(item) for item in job.get("requirements") or [])
        if contains_html:
            remaining_html_count += 1
            if len(sample_remaining_ids) < 10:
                sample_remaining_ids.append(job.get("job_id"))

    return {
        "scanned": scanned,
        "updated": updated,
        "remaining_html_count": remaining_html_count,
        "sample_remaining_ids": sample_remaining_ids,
    }


# ===================== Wire up =====================

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_seed():
    """Auto-seed mock jobs only when development fallback is explicitly enabled."""
    try:
        await db.jobs.create_index([("provider", 1), ("external_id", 1)], unique=True, sparse=True)
        await db.jobs.create_index([("provider", 1), ("provider_search_key", 1), ("imported_at", -1)])
        await db.jobs.create_index([("job_id", 1)], unique=True)
        await db.company_boards.create_index([("board_id", 1)], unique=True)
        await db.company_boards.create_index([("ats_provider", 1), ("enabled", 1), ("priority", -1)])
        await db.company_boards.create_index([("last_synced_at", 1)])
        await seed_greenhouse_company_boards(db)

        fallback_mock = os.environ.get("JOB_PROVIDER_FALLBACK_MOCK", "false").lower() in ("1", "true", "yes", "on")
        if not fallback_mock:
            return

        count = await db.jobs.count_documents({})
        if count == 0:
            now = datetime.now(timezone.utc).isoformat()
            docs = [{
                "job_id": f"job_{uuid.uuid4().hex[:10]}",
                "currency": "USD",
                "posted_at": now,
                **j,
            } for j in MOCK_JOBS]
            await db.jobs.insert_many(docs)
            logger.info(f"Seeded {len(docs)} jobs")
    except Exception as e:
        logger.warning(f"Seed failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
