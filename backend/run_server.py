"""Railway/Heroku entrypoint — binds to $PORT reliably (no shell expansion)."""
import os

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    uvicorn.run("server:app", host="0.0.0.0", port=port, log_level="info")
