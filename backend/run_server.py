"""Railway/Heroku entrypoint — binds to $PORT reliably (no shell expansion)."""
from __future__ import annotations

import os
import shutil
import subprocess
import time


def _maybe_start_xvfb() -> None:
    """Start a virtual display for headed Chromium without wrapping uvicorn.

    Wrapping the whole process in ``xvfb-run`` broke Railway healthchecks.
    Browser launches call ensure_virtual_display() too; this just warms DISPLAY.
    """
    if os.name == "nt":
        return
    if os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        return
    if os.environ.get("BROWSER_HEADLESS", "0").lower() in ("1", "true", "yes", "on"):
        return
    xvfb = shutil.which("Xvfb")
    if not xvfb:
        return
    for display_num in range(99, 110):
        display = f":{display_num}"
        try:
            proc = subprocess.Popen(
                [xvfb, display, "-screen", "0", "1920x1080x24", "-nolisten", "tcp"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            continue
        time.sleep(0.3)
        if proc.poll() is None:
            os.environ["DISPLAY"] = display
            return


_maybe_start_xvfb()

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info")
