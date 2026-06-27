"""Google OAuth 2.0 helpers for Swiipr sign-up / sign-in."""
import json
import base64
import secrets
from urllib.parse import urlencode

import httpx

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
SCOPES = "openid email profile https://www.googleapis.com/auth/gmail.readonly"


def encode_state(redirect_path: str) -> str:
    payload = json.dumps({"redirect": redirect_path, "nonce": secrets.token_urlsafe(16)})
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_state(state: str) -> str:
    padded = state + "=" * (-len(state) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    redirect = data.get("redirect") or "/swipe"
    return redirect if redirect.startswith("/") else "/swipe"


def build_google_login_url(client_id: str, redirect_uri: str, redirect_path: str) -> str:
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent select_account",
        "include_granted_scopes": "true",
        "state": encode_state(redirect_path),
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_user(code: str, client_id: str, client_secret: str, redirect_uri: str) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as http:
        token_res = await http.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            raise ValueError(f"Google token exchange failed: {token_res.text}")

        access_token = token_res.json().get("access_token")
        if not access_token:
            raise ValueError("Google token response missing access_token")

        user_res = await http.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code != 200:
            raise ValueError(f"Google userinfo failed: {user_res.text}")

        return user_res.json()
