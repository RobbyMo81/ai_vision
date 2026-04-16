"""
Browser-use FastAPI bridge server.
Exposes REST endpoints that the TypeScript AutomationEngine client calls.
Updated for browser-use 0.12.x API (BrowserSession replaces Browser/BrowserConfig).

Fixes applied (see Application_Fixes.md):
  FIX-03 — Correct success/failure detection from AgentHistoryList
  FIX-07 — Forward wait_until to page.goto()
  FIX-08 — asyncio lock protects global session from concurrent init race
  FIX-09 — Microsecond timestamp precision prevents screenshot filename collisions
  FIX-13 — Agent step screenshots collected via save_conversation_path
"""

import asyncio
import base64
import glob as _glob
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_session = None          # BrowserSession instance
_session_lock = asyncio.Lock()  # FIX-08: prevent concurrent initialisation race

SESSION_DIR = Path(os.getenv("SESSION_DIR", "./sessions"))
SESSION_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    global _session
    if _session is not None:
        try:
            await _session.stop()
        except Exception:
            pass


app = FastAPI(title="browser-use bridge", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class TaskRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = None


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

def _llm():
    """Return a browser-use native LLM client based on env config."""
    provider = os.getenv("STAGEHAND_LLM_PROVIDER", "anthropic")
    if provider == "anthropic":
        from browser_use.llm.anthropic.chat import ChatAnthropic
        return ChatAnthropic(
            model=os.getenv("STAGEHAND_LLM_MODEL", "claude-sonnet-4-6"),
            api_key=os.getenv("ANTHROPIC_API_KEY"),
        )
    else:
        from browser_use.llm.openai.chat import ChatOpenAI
        return ChatOpenAI(
            model=os.getenv("STAGEHAND_LLM_MODEL", "gpt-4o"),
            api_key=os.getenv("OPENAI_API_KEY"),
        )


async def _get_session():
    """Return (or lazily create) the global BrowserSession.
    FIX-08: Protected by asyncio.Lock to prevent concurrent init race.

    If BROWSER_CDP_URL is set (by SessionManager when running under ai-vision serve),
    attach to the existing shared Chrome instance so auth cookies are preserved
    across HITL handoffs.  Otherwise launch a standalone headless browser."""
    global _session
    async with _session_lock:
        if _session is None:
            from browser_use.browser.session import BrowserSession
            cdp_url = os.getenv("BROWSER_CDP_URL", "")
            if cdp_url:
                # Connect to the shared Chrome session managed by SessionManager
                _session = BrowserSession(cdp_url=cdp_url)
            else:
                _session = BrowserSession(headless=True)
            await _session.start()
    return _session


async def _get_page():
    session = await _get_session()
    return await session.get_current_page()


def _now_us() -> str:
    """FIX-09: Microsecond-precision UTC timestamp for unique filenames.
    Uses timezone-aware datetime to avoid DeprecationWarning in Python 3.12+."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "engine": "browser-use"}


@app.post("/initialize")
async def initialize():
    try:
        await _get_session()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/close")
async def close():
    global _session
    async with _session_lock:
        try:
            if _session is not None:
                await _session.stop()
                _session = None
            return {"success": True}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/task")
async def run_task(req: TaskRequest):
    start = time.time()
    screenshots: list[dict] = []
    try:
        from browser_use.agent.service import Agent
        session = await _get_session()
        llm = _llm()

        # FIX-13: save_conversation_path causes the agent to write step
        # screenshots to disk; we collect them after the run.
        conversation_path = SESSION_DIR / f"agent_{req.session_id or _now_us()}"

        agent = Agent(
            task=req.prompt,
            llm=llm,
            browser_session=session,
            save_conversation_path=str(conversation_path),
        )
        result = await agent.run()
        duration_ms = int((time.time() - start) * 1000)

        # FIX-03: agent.run() never raises — it returns AgentHistoryList
        # whether steps succeeded or failed.  Inspect the result explicitly.
        # browser-use 0.12.x: final_result() → str|None, action_results → list
        final = result.final_result()
        action_errors = (
            [r.error for r in result.action_results() if r.error]
            if callable(getattr(result, "action_results", None))
            else []
        )

        if final is not None:
            success = True
            output = str(final)
        elif action_errors:
            success = False
            output = action_errors[-1]  # most recent error is most informative
        else:
            success = False
            output = "Agent completed without producing a result"

        # Collect screenshots saved by the agent during execution
        for img_path in sorted(_glob.glob(str(conversation_path) + "/**/*.png", recursive=True)):
            try:
                with open(img_path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                screenshots.append({"path": img_path, "base64": b64, "taken_at": _now_us()})
            except Exception:
                pass

        return {
            "success": success,
            "output": output,
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
    # FIX-07: forward wait_until to page.goto() instead of ignoring it
    try:
        page = await _get_page()
        await page.goto(req.url, wait_until=req.wait_until or "load")
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/click")
async def click(req: ClickRequest):
    try:
        page = await _get_page()
        await page.click(req.selector)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/type")
async def type_text(req: TypeRequest):
    try:
        page = await _get_page()
        if req.clear_first:
            await page.fill(req.selector, "")
        await page.type(req.selector, req.text)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    # FIX-09: use microsecond timestamp to prevent filename collisions
    try:
        page = await _get_page()
        timestamp = _now_us()
        path = req.output_path or str(SESSION_DIR / f"browser-use-{timestamp}.png")
        await page.screenshot(path=path)
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        return {"success": True, "path": path, "base64": b64, "taken_at": timestamp}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BROWSER_USE_PORT", "8001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
