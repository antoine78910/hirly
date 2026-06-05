/** Start Google OAuth; optional path to return to after login (e.g. /onboarding). */
export function startGoogleLogin(returnPath) {
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  const emergentAuthUrl = process.env.REACT_APP_AUTH_URL;
  const path = returnPath && returnPath.startsWith("/") ? returnPath : "/swipe";

  if (backendUrl) {
    window.location.href = `${backendUrl}/api/auth/google/login?redirect=${encodeURIComponent(path)}`;
    return true;
  }

  if (emergentAuthUrl) {
    const redirectUrl = `${window.location.origin}${path}`;
    window.location.href = `${emergentAuthUrl}?redirect=${encodeURIComponent(redirectUrl)}`;
    return true;
  }

  console.error("REACT_APP_BACKEND_URL is not configured.");
  return false;
}
