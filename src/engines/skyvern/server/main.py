"""
Skyvern FastAPI bridge server.
Skyvern uses computer vision + LLMs to interact with browser UIs.
Exposes the same REST shape as the browser-use bridge for a consistent TS client contract.
"""

import asyncio
import base64
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

SESSION_DIR = Path(os.getenv("SESSION_DIR", "./sessions"))
SESSION_DIR.mkdir(parents=True, exist_ok=True)

_skyvern_app = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    global _skyvern_app
    if _skyvern_app is not None:
        try:
            await _skyvern_app.close()
        except Exception:
            pass


app = FastAPI(title="skyvern bridge", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Models (same shape as browser-use bridge)
# ---------------------------------------------------------------------------

class TaskRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = None
    url: Optional[str] = None


class NavigateRequest(BaseModel):
    url: str
    wait_until: Optional[str] = "load"


class ClickRequest(BaseModel):
    selector: str
    description: Optional[str] = None


class TypeRequest(BaseModel):
    selector: str
    text: str
    description: Optional[str] = None
    clear_first: bool = False


class ScreenshotRequest(BaseModel):
    output_path: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_skyvern():
    global _skyvern_app
    if _skyvern_app is None:
        from skyvern import Skyvern
        _skyvern_app = Skyvern(
            openai_api_key=os.getenv("OPENAI_API_KEY"),
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY"),
        )
        await _skyvern_app.initialize()
    return _skyvern_app


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "engine": "skyvern"}


@app.post("/initialize")
async def initialize():
    try:
        await _get_skyvern()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/close")
async def close():
    global _skyvern_app
    try:
        if _skyvern_app is not None:
            await _skyvern_app.close()
            _skyvern_app = None
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/task")
async def run_task(req: TaskRequest):
    start = time.time()
    screenshots: list[dict] = []
    try:
        skyvern = await _get_skyvern()
        result = await skyvern.run_task(
            prompt=req.prompt,
            url=req.url,
        )
        duration_ms = int((time.time() - start) * 1000)
        # Collect any screenshots produced by Skyvern
        if hasattr(result, "screenshots"):
            for s in result.screenshots:
                timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
                path = str(SESSION_DIR / f"skyvern-{timestamp}.png")
                if isinstance(s, bytes):
                    with open(path, "wb") as f:
                        f.write(s)
                    screenshots.append({
                        "path": path,
                        "base64": base64.b64encode(s).decode(),
                        "taken_at": timestamp,
                    })
        return {
            "success": True,
            "output": str(result),
            "screenshots": screenshots,
            "duration_ms": duration_ms,
        }
    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        return {
            "success": False,
            "error": str(e),
            "screenshots": screenshots,
            "duration_ms": duration_ms,
        }


@app.post("/navigate")
async def navigate(req: NavigateRequest):
    try:
        skyvern = await _get_skyvern()
        await skyvern.navigate(req.url)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/click")
async def click(req: ClickRequest):
    try:
        skyvern = await _get_skyvern()
        # Skyvern prefers natural language descriptions for vision-based clicking
        target = req.description or req.selector
        await skyvern.click(target)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/type")
async def type_text(req: TypeRequest):
    try:
        skyvern = await _get_skyvern()
        target = req.description or req.selector
        await skyvern.type(target, req.text)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    try:
        skyvern = await _get_skyvern()
        timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        path = req.output_path or str(SESSION_DIR / f"skyvern-{timestamp}.png")
        image_bytes = await skyvern.screenshot()
        with open(path, "wb") as f:
            f.write(image_bytes)
        b64 = base64.b64encode(image_bytes).decode()
        return {"success": True, "path": path, "base64": b64, "taken_at": timestamp}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("SKYVERN_PORT", "8002"))
    uvicorn.run(app, host="127.0.0.1", port=port)
