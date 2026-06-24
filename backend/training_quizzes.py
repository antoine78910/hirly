"""Training chapter quizzes — keep in sync with frontend/src/lib/trainingQuizzes.js."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

PASS_PERCENT = 67


def _q(qid: str, prompt: str, options: List[Dict[str, str]], correct: str) -> Dict[str, Any]:
    return {"id": qid, "prompt": prompt, "options": options, "correct": correct}


QUIZZES: Dict[str, Dict[str, Any]] = {
    "quiz_mod_getting_started": {
        "quiz_id": "quiz_mod_getting_started",
        "module_id": "mod_getting_started",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("gs1", "How many main parts is the course divided into?", [
                {"id": "a", "label": "3 parts — warm-up, content, payment only"},
                {"id": "b", "label": "5 parts — warm-up, content, account, submission & payment, resources"},
                {"id": "c", "label": "7 parts — one per weekday"},
            ], "b"),
            _q("gs2", "Skip or mishandle warm-up — you risk?", [
                {"id": "a", "label": "Hashtags fix reach in 24h"},
                {"id": "b", "label": "Limited reach or algorithm penalties"},
                {"id": "c", "label": "Automatic payment after 3 posts"},
            ], "b"),
            _q("gs3", "English US competitor example videos are for?", [
                {"id": "a", "label": "Reposting as-is"},
                {"id": "b", "label": "Inspiration/templates — not copying in English"},
                {"id": "c", "label": "Replacing Content Bank scripts"},
            ], "b"),
            _q("gs4", "Published content language?", [
                {"id": "a", "label": "English to match examples"},
                {"id": "b", "label": "French for France and Francophone countries"},
                {"id": "c", "label": "Any language if Hirly is on screen"},
            ], "b"),
            _q("gs5", "Problem or question during course?", [
                {"id": "a", "label": "Wait until all modules done"},
                {"id": "b", "label": "Contact team via WhatsApp"},
                {"id": "c", "label": "Ask publicly on TikTok"},
            ], "b"),
        ],
    },
    "quiz_mod_warm_up": {
        "quiz_id": "quiz_mod_warm_up",
        "module_id": "mod_warm_up",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("wu1", "Phase 0 (Lurker Mode) days?", [
                {"id": "a", "label": "Days 1-2 — no posting"},
                {"id": "b", "label": "Days 3-5 — first posts"},
                {"id": "c", "label": "Day 1 only then 2 videos Day 2"},
            ], "a"),
            _q("wu2", "Day 1 like limit?", [
                {"id": "a", "label": "5-10 posts only"},
                {"id": "b", "label": "20-30 posts"},
                {"id": "c", "label": "Like every video watched"},
            ], "a"),
            _q("wu3", "Day 1 follows + Phase 1 time?", [
                {"id": "a", "label": "Up to 10 follows; 15-20 min/day"},
                {"id": "b", "label": "0-3 follows max; Phase 1 = 30-60 min/day"},
                {"id": "c", "label": "0-3 follows; Phase 1 = 30-45 min total only"},
            ], "b"),
            _q("wu4", "Controlled posting from Day 5?", [
                {"id": "a", "label": "D5: 1 video · D6: 2 · D7+: 2-4/day max"},
                {"id": "b", "label": "D5: 3 · D6: 5 · D7+: unlimited"},
                {"id": "c", "label": "D5: 1 · D6: 1 · D7+: 1/week"},
            ], "a"),
            _q("wu5", "450 views most likely means?", [
                {"id": "a", "label": "Healthy — post 10/day now"},
                {"id": "b", "label": "Still testing (300-700) — one video insufficient"},
                {"id": "c", "label": "Compromised — restart account"},
            ], "b"),
        ],
    },
    "quiz_mod_creating_content": {
        "quiz_id": "quiz_mod_creating_content",
        "module_id": "mod_creating_content",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("cc1", "Hook window in Filming Playbook?", [
                {"id": "a", "label": "First 3 seconds — no slow buildup"},
                {"id": "b", "label": "First 10 seconds — logo first"},
                {"id": "c", "label": "First 30 seconds — suspense"},
            ], "a"),
            _q("cc2", "Video length guidance?", [
                {"id": "a", "label": "7-60s total; under 45s for new accounts"},
                {"id": "b", "label": "45-90s; always above 60s"},
                {"id": "c", "label": "3-7 minutes minimum"},
            ], "a"),
            _q("cc3", "Viewers without sound?", [
                {"id": "a", "label": "~50% — captions matter"},
                {"id": "b", "label": "~10%"},
                {"id": "c", "label": "~90%"},
            ], "a"),
            _q("cc4", "In-video caption rule?", [
                {"id": "a", "label": "3-4 lines per block"},
                {"id": "b", "label": "1-2 lines max, centered, Custom/Standard font"},
                {"id": "c", "label": "No captions needed"},
            ], "b"),
            _q("cc5", "Hirly demo flow order?", [
                {"id": "a", "label": "History → swipe → AI → upload"},
                {"id": "b", "label": "Upload → swipe → AI → history"},
                {"id": "c", "label": "Swipe only, skip upload"},
            ], "b"),
        ],
    },
    "quiz_mod_account_management": {
        "quiz_id": "quiz_mod_account_management",
        "module_id": "mod_account_management",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("am1", "Post-warmup daily rhythm?", [
                {"id": "a", "label": "1-2 posts/day + 2-3 scroll sessions 10-15 min"},
                {"id": "b", "label": "4-6 posts/day + weekly 45 min scroll"},
                {"id": "c", "label": "1 post/week, scroll only when posting"},
            ], "a"),
            _q("am2", "View thresholds?", [
                {"id": "a", "label": "700+ healthy · 300-700 testing · <300 repeated = compromised"},
                {"id": "b", "label": "1000+ · 500-1000 · <500"},
                {"id": "c", "label": "300+ · 100-300 · <100"},
            ], "a"),
            _q("am3", "US posting windows (ET)?", [
                {"id": "a", "label": "7-9 AM · 11 AM-1 PM · 6-9 PM"},
                {"id": "b", "label": "5-7 AM · 2-4 PM · 10 PM-midnight"},
                {"id": "c", "label": "Any time — timezone irrelevant"},
            ], "a"),
            _q("am4", "Phase 1 comments per session?", [
                {"id": "a", "label": "1-3 comments max"},
                {"id": "b", "label": "10-15 comments"},
                {"id": "c", "label": "Unlimited with emojis"},
            ], "a"),
            _q("am5", "Dead account behavior?", [
                {"id": "a", "label": "Open app only to publish, disappear for weeks"},
                {"id": "b", "label": "1-2 posts/day with daily scrolling"},
                {"id": "c", "label": "650 views on one post"},
            ], "a"),
        ],
    },
    "quiz_mod_submit_drafts": {
        "quiz_id": "quiz_mod_submit_drafts",
        "module_id": "mod_submit_drafts",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("sd1", "Where to submit finished video?", [
                {"id": "a", "label": "Instagram DMs to Hirly"},
                {"id": "b", "label": "Topr link below module video"},
                {"id": "c", "label": "Email MP4 to support"},
            ], "b"),
            _q("sd2", "Before Topr submit you must?", [
                {"id": "a", "label": "Post on your account first, paste post URL"},
                {"id": "b", "label": "Submit script PDF only"},
                {"id": "c", "label": "Receive payment before posting"},
            ], "a"),
            _q("sd3", "Right after Topr submit, status is?", [
                {"id": "a", "label": "Live with immediate payment"},
                {"id": "b", "label": "Under review — answer within a few hours"},
                {"id": "c", "label": "Auto-rejected if not English caption"},
            ], "b"),
            _q("sd4", "To receive payment?", [
                {"id": "a", "label": "Connect PayPal email on Topr profile/balance"},
                {"id": "b", "label": "Bank wire via WhatsApp only"},
                {"id": "c", "label": "Manual monthly invoice to Hirly"},
            ], "a"),
            _q("sd5", "First-time Topr flow includes?", [
                {"id": "a", "label": "Sign up → Creator → join campaign → create content → submit URL"},
                {"id": "b", "label": "Skip sign-up, submit without account"},
                {"id": "c", "label": "Creator → delete account → weekly resubmit"},
            ], "a"),
        ],
    },
    "quiz_mod_content_bank": {
        "quiz_id": "quiz_mod_content_bank",
        "module_id": "mod_content_bank",
        "pass_percent": PASS_PERCENT,
        "questions": [
            _q("cb1", "Content Bank script usage?", [
                {"id": "a", "label": "Adapt delivery, keep core hook + Hirly"},
                {"id": "b", "label": "Verbatim only"},
                {"id": "c", "label": "Ignore scripts"},
            ], "a"),
            _q("cb2", "Warm Up B-roll slow to?", [
                {"id": "a", "label": "0.5-1x speed"},
                {"id": "b", "label": "2-3x only"},
                {"id": "c", "label": "Never slow footage"},
            ], "a"),
            _q("cb3", "Hirly demo should lead with?", [
                {"id": "a", "label": "Swipe right to auto-apply"},
                {"id": "b", "label": "Settings page"},
                {"id": "c", "label": "Billing tab"},
            ], "a"),
            _q("cb4", "Best product demo method?", [
                {"id": "a", "label": "POV tutorial from another device"},
                {"id": "b", "label": "Static screenshot collage"},
                {"id": "c", "label": "Voiceover only, no UI"},
            ], "a"),
            _q("cb5", "Brand name in scripts?", [
                {"id": "a", "label": "Hirly — no competitor swaps"},
                {"id": "b", "label": "Generic job app only"},
                {"id": "c", "label": "Whoever paid most recently"},
            ], "a"),
        ],
    },
}


def get_quiz(quiz_id: str) -> Optional[Dict[str, Any]]:
    return QUIZZES.get(quiz_id)


def score_quiz(quiz: Dict[str, Any], answers: Dict[str, str]) -> Dict[str, Any]:
    questions = quiz.get("questions") or []
    if not questions:
        return {"score": 0, "passed": False, "total": 0, "correct": 0}
    correct = sum(1 for q in questions if answers.get(q["id"]) == q["correct"])
    total = len(questions)
    score = round((correct / total) * 100)
    passed = score >= int(quiz.get("pass_percent") or PASS_PERCENT)
    return {"score": score, "passed": passed, "total": total, "correct": correct}


def quiz_id_for_module(module_id: str) -> str:
    return f"quiz_{module_id}"
