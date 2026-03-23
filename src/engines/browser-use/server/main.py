"""
Browser-use FastAPI bridge server.
Exposes REST endpoints that the TypeScript AutomationEngine client calls.
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
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv()

# ---------------------------------------------------------------------------
# Lazy imports — browser-use and playwright are optional at import time
# ---------------------------------------------------------------------------
_agent = None
_browser = None
_controller = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Cleanup on shutdown
    global _browser
    if _browser is not None:
        try:
            await _browser.close()
        except Exception:
            pass


app = FastAPI(title="browser-use bridge", lifespan=lifespan)

SESSION_DIR = Path(os.getenv("SESSION_DIR", "./sessions"))
SESSION_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Models
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
    """Return a LangChain LLM based on env config."""
    provider = os.getenv("STAGEHAND_LLM_PROVIDER", "openai")
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=os.getenv("STAGEHAND_LLM_MODEL", "claude-opus-4-6"),
            api_key=os.getenv("ANTHROPIC_API_KEY"),
        )
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=os.getenv("STAGEHAND_LLM_MODEL", "gpt-4o"),
            api_key=os.getenv("OPENAI_API_KEY"),
        )


async def _get_browser():
    global _browser
    if _browser is None:
        from browser_use import Browser, BrowserConfig
        _browser = Browser(config=BrowserConfig(headless=True))
    return _browser


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "engine": "browser-use"}


@app.post("/initialize")
async def initialize():
    try:
        await _get_browser()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/close")
async def close():
    global _browser, _agent
    try:
        if _browser is not None:
            await _browser.close()
            _browser = None
        _agent = None
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/task")
async def run_task(req: TaskRequest):
    start = time.time()
    screenshots: list[dict] = []
    try:
        from browser_use import Agent
        browser = await _get_browser()
        llm = _llm()
        agent = Agent(task=req.prompt, llm=llm, browser=browser)
        result = await agent.run()
        duration_ms = int((time.time() - start) * 1000)
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
        from browser_use import Browser
        browser = await _get_browser()
        page = await browser.get_current_page()
        await page.goto(req.url)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/click")
async def click(req: ClickRequest):
    try:
        browser = await _get_browser()
        page = await browser.get_current_page()
        await page.click(req.selector)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/type")
async def type_text(req: TypeRequest):
    try:
        browser = await _get_browser()
        page = await browser.get_current_page()
        if req.clear_first:
            await page.fill(req.selector, "")
        await page.type(req.selector, req.text)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    try:
        browser = await _get_browser()
        page = await browser.get_current_page()
        timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
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
