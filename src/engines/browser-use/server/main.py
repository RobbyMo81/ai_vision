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
_llm_cache = None        # cached LLM client — recreated only when config changes
_llm_cache_key = None    # cache key: <provider>:<model>

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

def _normalize_provider(provider: str | None) -> str:
    if not provider:
        return "anthropic"
    lowered = provider.strip().lower()
    return lowered if lowered in ("anthropic", "openai") else "anthropic"


def _provider_has_credentials(provider: str) -> bool:
    if provider == "anthropic":
        return bool(os.getenv("ANTHROPIC_API_KEY"))
    return bool(os.getenv("OPENAI_API_KEY"))


def _resolve_model(provider: str) -> str:
    generic = os.getenv("STAGEHAND_LLM_MODEL", "").strip()
    if provider == "anthropic":
        return (
            os.getenv("STAGEHAND_LLM_MODEL_ANTHROPIC")
            or (generic if generic and not generic.startswith("gpt") and generic != "o3" else "claude-sonnet-4-6")
        )
    return (
        os.getenv("STAGEHAND_LLM_MODEL_OPENAI")
        or (generic if generic and (generic.startswith("gpt") or generic == "o3") else "gpt-4o")
    )


def _provider_candidates(primary_override: str | None = None) -> list[str]:
    primary = _normalize_provider(primary_override or os.getenv("STAGEHAND_LLM_PROVIDER", "anthropic"))
    configured_fallback = _normalize_provider(os.getenv("STAGEHAND_LLM_FALLBACK_PROVIDER", ""))
    default_fallback = "openai" if primary == "anthropic" else "anthropic"

    candidates: list[str] = [primary]
    for candidate in (configured_fallback, default_fallback):
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    return [provider for provider in candidates if _provider_has_credentials(provider)]


def _looks_like_provider_failure(message: str | None) -> bool:
    if not message:
        return False
    lowered = message.lower()
    signals = (
        "credit balance is too low",
        "insufficient_quota",
        "quota",
        "invalid api key",
        "authentication_error",
        "api key",
        "rate limit",
        "rate_limit",
    )
    return any(signal in lowered for signal in signals)


def _llm(provider_override: str | None = None):
    """Return (llm, provider, model), using cache per provider/model pair."""
    global _llm_cache, _llm_cache_key

    candidates = _provider_candidates(provider_override)
    if not candidates:
        raise RuntimeError(
            "No LLM credentials found. Set ANTHROPIC_API_KEY and/or OPENAI_API_KEY in .env or environment.",
        )

    provider = candidates[0]
    model = _resolve_model(provider)
    cache_key = f"{provider}:{model}"

    if _llm_cache is not None and _llm_cache_key == cache_key:
        return _llm_cache, provider, model

    if provider == "anthropic":
        from browser_use.llm.anthropic.chat import ChatAnthropic

        _llm_cache = ChatAnthropic(
            model=model,
            api_key=os.getenv("ANTHROPIC_API_KEY"),
        )
    else:
        from browser_use.llm.openai.chat import ChatOpenAI

        _llm_cache = ChatOpenAI(
            model=model,
            api_key=os.getenv("OPENAI_API_KEY"),
        )

    _llm_cache_key = cache_key
    return _llm_cache, provider, model


async def _get_session():
    """Return a healthy BrowserSession, reconnecting when the shared CDP link goes stale.

    FIX-08: Protected by asyncio.Lock to prevent concurrent init race.

    If BROWSER_CDP_URL is set (by SessionManager when running under ai-vision serve),
    attach to the existing shared Chrome instance so auth cookies are preserved
    across HITL handoffs. Otherwise launch a standalone headless browser.

    Sequential browser-use tasks can leave the BrowserSession object alive while its
    underlying CDP websocket has gone stale. Reconnect or recreate the session here
    so the next task does not fail on its first action."""
    global _session
    async with _session_lock:
        if _session is None:
            _session = await _create_session()
        else:
            _session = await _recover_session(_session)

        await _ensure_page_focus(_session)
    return _session


async def _get_page():
    session = await _get_session()
    page = await session.get_current_page()
    if page is None:
        raise RuntimeError("No current browser page is available after session recovery")
    return page


_STARTUP_CHROME_ARGS = [
    "--disable-session-crashed-bubble",   # suppress "Restore pages?" dialog
    "--hide-crash-restore-bubble",        # Chromium 110+ alias for above
    "--no-first-run",                     # skip first-run UI
    "--no-default-browser-check",         # skip default browser check
    "--disable-infobars",                 # suppress "unsupported flag" info bar
    "--suppress-message-center-popups",   # suppress notification center popups
]


async def _create_session():
    from browser_use.browser.session import BrowserSession

    cdp_url = os.getenv("BROWSER_CDP_URL", "")
    if cdp_url:
        # keep_alive=True prevents browser-use from firing BrowserStopEvent/reset()
        # at the end of each agent run, eliminating inter-task session teardown latency.
        session = BrowserSession(cdp_url=cdp_url, keep_alive=True)
    else:
        headless = os.getenv("BROWSER_HEADLESS", "true").lower() not in ("0", "false", "no")
        session = BrowserSession(headless=headless, args=_STARTUP_CHROME_ARGS, keep_alive=True)
    await session.start()
    return session


async def _recover_session(session):
    using_shared_cdp = bool(os.getenv("BROWSER_CDP_URL", ""))

    if _needs_fresh_session(session):
        # When Chrome is managed externally (shared CDP), skip stop() — it would
        # tear down a browser we don't own.  Just attach a fresh BrowserSession.
        if not using_shared_cdp:
            try:
                await session.stop()
            except Exception:
                pass
        return await _create_session()

    try:
        if session.is_cdp_connected:
            return session

        if session.cdp_url:
            await session.reconnect()
            return session
    except Exception:
        pass

    if not using_shared_cdp:
        try:
            await session.stop()
        except Exception:
            pass

    return await _create_session()


def _needs_fresh_session(session) -> bool:
    if getattr(session, "session_manager", None) is None:
        return True

    handlers = getattr(getattr(session, "event_bus", None), "handlers", {}) or {}
    required_events = (
        "BrowserStartEvent",
        "BrowserStopEvent",
        "NavigateToUrlEvent",
        "SwitchTabEvent",
    )
    return any(not handlers.get(event_name) for event_name in required_events)


async def _ensure_page_focus(session):
    try:
        if await session.get_current_page() is not None:
            return
    except Exception:
        pass

    page_targets = (
        session.session_manager.get_all_page_targets()
        if getattr(session, "session_manager", None) is not None
        else []
    )
    if page_targets:
        from browser_use.browser.events import SwitchTabEvent

        target_id = page_targets[-1].target_id
        event = session.event_bus.dispatch(SwitchTabEvent(target_id=target_id))
        await event
        await event.event_result(raise_if_any=True, raise_if_none=False)
        return

    await session.new_page()


def _looks_like_cdp_session_failure(message: str | None) -> bool:
    if not message:
        return False
    lowered = message.lower()
    signals = (
        "cdp client not initialized",
        "browser may not be connected yet",
        "browserstaterequestevent",
        "no current browser page",
        "no current target found",
        "websocket",
    )
    return any(signal in lowered for signal in signals)


async def _run_agent_once(req: TaskRequest, provider_override: str | None = None):
    from browser_use.agent.service import Agent

    session = await _get_session()
    llm, provider, model = _llm(provider_override)

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

    screenshots: list[dict] = []
    for img_path in sorted(_glob.glob(str(conversation_path) + "/**/*.png", recursive=True)):
        try:
            with open(img_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            screenshots.append({"path": img_path, "base64": b64, "taken_at": _now_us()})
        except Exception:
            pass

    # FIX-03: agent.run() never raises — it returns AgentHistoryList whether steps
    # succeeded or failed. Inspect the result explicitly.
    final = result.final_result()
    action_errors = (
        [r.error for r in result.action_results() if r.error]
        if callable(getattr(result, "action_results", None))
        else []
    )

    if final is not None:
        return {
            "success": True,
            "output": str(final),
            "screenshots": screenshots,
            "provider": provider,
            "model": model,
        }

    if action_errors:
        return {
            "success": False,
            "output": action_errors[-1],
            "screenshots": screenshots,
            "provider": provider,
            "model": model,
        }

    return {
        "success": False,
        "output": "Agent completed without producing a result",
        "screenshots": screenshots,
        "provider": provider,
        "model": model,
    }


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
    try:
        result = await _run_agent_once(req)

        # Provider failover: if primary provider fails due quota/auth/rate limits,
        # retry once with the alternate configured provider.
        if (not result["success"]) and _looks_like_provider_failure(result.get("output")):
            for fallback_provider in _provider_candidates():
                if fallback_provider == result.get("provider"):
                    continue
                retry = await _run_agent_once(req, provider_override=fallback_provider)
                if retry["success"] or not _looks_like_provider_failure(retry.get("output")):
                    result = retry
                    break

        if (not result["success"]) and _looks_like_cdp_session_failure(result.get("output")):
            global _session
            async with _session_lock:
                if _session is not None:
                    _session = await _recover_session(_session)
                    await _ensure_page_focus(_session)
            result = await _run_agent_once(req)

        return {
            "success": result["success"],
            "output": result.get("output"),
            "screenshots": result["screenshots"],
            "provider": result.get("provider"),
            "model": result.get("model"),
            "duration_ms": int((time.time() - start) * 1000),
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "screenshots": [],
            "duration_ms": int((time.time() - start) * 1000),
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
