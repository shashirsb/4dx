"""Shared LLM client: OpenAI → Claude → Google → Local Ollama → heuristic fallback.

Set USE_LLM=false (default) to skip cloud providers and use Ollama → heuristic only.
Set USE_LLM=true for the full cloud chain before local fallback.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-3-5-haiku-20241022")
GOOGLE_MODEL = os.getenv("GOOGLE_MODEL", "gemini-2.0-flash")
LOCAL_LLM_ENABLED = os.getenv("LOCAL_LLM_ENABLED", "true").lower() in {"1", "true", "yes"}
LOCAL_LLM_PROVIDER = os.getenv("LOCAL_LLM_PROVIDER", "ollama").strip().lower()
LOCAL_LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "llama3.2:1b")
OLLAMA_BASE_URL = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")
OLLAMA_TIMEOUT_SEC = int(
    os.getenv("OLLAMA_TIMEOUT_SECONDS") or os.getenv("OLLAMA_TIMEOUT_SEC") or "45"
)
OLLAMA_CONNECT_TIMEOUT_SEC = int(os.getenv("OLLAMA_CONNECT_TIMEOUT_SEC", "2"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "1024"))

STATUS_LOCAL_INSIGHT = "Local insight engine (cloud unavailable)"
STATUS_LOCAL_ANALYSIS = "Local analysis (cloud unavailable)"


def is_cloud_llm_enabled() -> bool:
    """True only when USE_LLM (or useLLM alias) is explicitly true/1/yes. Default: false."""
    raw = os.getenv("USE_LLM")
    if raw is None:
        raw = os.getenv("useLLM")
    if raw is None:
        return False
    return raw.strip().lower() in {"1", "true", "yes"}


def get_openai_api_key() -> str | None:
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    return key or None


def get_claude_api_key() -> str | None:
    key = (os.getenv("CLAUDE_API_KEY") or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    return key or None


def get_google_api_key() -> str | None:
    key = (os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or "").strip()
    return key or None


def is_local_llm_enabled() -> bool:
    return LOCAL_LLM_ENABLED and LOCAL_LLM_PROVIDER == "ollama"


def _safe_error(exc: Exception, limit: int = 180) -> str:
    text = str(exc).replace("\n", " ").strip()
    if len(text) > limit:
        text = text[: limit - 3] + "..."
    return text


def _log_provider_errors(errors: list[str]) -> None:
    if errors:
        logger.warning("LLM provider chain failed: %s", "; ".join(errors))


def format_fallback_status(feature: str = "insight") -> str:
    if feature in {"meeting", "meeting_to_action", "analysis"}:
        return STATUS_LOCAL_ANALYSIS
    return STATUS_LOCAL_INSIGHT


def sanitize_llm_status(status: str | None, *, feature: str = "insight") -> str:
    """User-facing status only — never expose raw API errors."""
    if not status:
        return format_fallback_status(feature)
    text = status.strip()
    dirty_markers = (
        "Error code:",
        "insufficient_quota",
        "credit balance is too low",
        "Local fallback ·",
        "OpenAI:",
        "Claude:",
        "Google:",
        "Local LLM:",
        "timed out",
        "429",
        "400",
    )
    if any(marker in text for marker in dirty_markers):
        if text.startswith("Local ·") and "context enriched" in text:
            return text.split(" · context enriched")[0].strip()
        if text.startswith("OpenAI ·") or text.startswith("Claude ·") or text.startswith("Google ·"):
            return text.split(" · context enriched")[0].strip()
        if text.startswith("Local ·") and not any(m in text for m in dirty_markers[4:]):
            return text
        return format_fallback_status(feature)
    if text in {"Local fallback", "Local heuristic parser"}:
        return format_fallback_status(feature)
    return text


def _parse_json_content(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("LLM response was not a JSON object")
    return parsed


def _repair_json_content(content: str) -> dict[str, Any]:
    try:
        return _parse_json_content(content)
    except json.JSONDecodeError:
        text = (content or "").strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return _parse_json_content(text[start : end + 1])
        raise ValueError("Could not parse JSON from local LLM response")


def _looks_like_echoed_prompt(data: dict[str, Any]) -> bool:
    echo_keys = {"question", "required_json_shape", "context", "portfolio_context", "meeting_notes", "existing_catalog"}
    output_keys = {"summary", "headline", "executive_position", "proposed_wigs", "proposed_measures", "proposed_actions", "risks"}
    if not echo_keys.intersection(data):
        return False
    return not output_keys.intersection(data)


def insight_payload_valid(data: dict[str, Any]) -> bool:
    if not isinstance(data, dict) or _looks_like_echoed_prompt(data):
        return False
    summary = (data.get("summary") or "").strip()
    return bool(summary) and summary.lower() not in {"text", "string", "3-5 sentence executive summary with concrete numbers and names"}


def insight_ask_payload_valid(data: dict[str, Any]) -> bool:
    if not isinstance(data, dict) or _looks_like_echoed_prompt(data):
        return False
    answer = (data.get("answer") or "").strip()
    return bool(answer) and answer.lower() not in {"text", "string", "concise answer grounded in context"}


def portfolio_insight_payload_valid(data: dict[str, Any]) -> bool:
    if not isinstance(data, dict) or _looks_like_echoed_prompt(data):
        return False
    headline = (data.get("headline") or "").strip()
    summary = (data.get("summary") or "").strip()
    return bool(headline or summary)


def decision_brief_payload_valid(data: dict[str, Any]) -> bool:
    if not isinstance(data, dict) or _looks_like_echoed_prompt(data):
        return False
    return bool((data.get("executive_position") or "").strip())


def meeting_action_payload_valid(data: dict[str, Any]) -> bool:
    if not isinstance(data, dict):
        return False
    if _looks_like_echoed_prompt(data):
        return False
    actions = data.get("proposed_actions") or []
    if len(actions) == 1:
        comment = (actions[0].get("comment") or "").strip()
        if len(comment) > 500:
            return False
    return any(isinstance(data.get(key), list) and data.get(key) for key in ("proposed_wigs", "proposed_measures", "proposed_actions"))


def _provider_success(provider: str, model: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "data": data,
        "provider": provider,
        "model": model,
        "llm_status": format_llm_status(provider, model),
    }


def _try_provider(
    label: str,
    call: Callable[[], dict[str, Any]],
    *,
    provider: str,
    model: str,
    validate: Callable[[dict[str, Any]], bool] | None,
    errors: list[str],
) -> dict[str, Any] | None:
    try:
        data = call()
        if validate and not validate(data):
            errors.append(f"{label}: response missing required fields")
            return None
        return _provider_success(provider, model, data)
    except Exception as exc:
        errors.append(f"{label}: {_safe_error(exc)}")
        return None


def _ollama_reachable() -> bool:
    try:
        req = urllib.request.Request(f"{OLLAMA_BASE_URL}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=OLLAMA_CONNECT_TIMEOUT_SEC) as resp:
            return resp.status == 200
    except Exception:
        return False


def _call_ollama_json(system_prompt: str, user_prompt: str, *, temperature: float) -> dict[str, Any]:
    payload = {
        "model": LOCAL_LLM_MODEL,
        "messages": [
            {
                "role": "system",
                "content": f"{system_prompt.strip()} Return only valid JSON with no markdown fences.",
            },
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "format": "json",
        "options": {
            "temperature": temperature,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
    }
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT_SEC) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:240]
        raise RuntimeError(f"Ollama HTTP {exc.code}: {detail}") from exc
    content = (body.get("message") or {}).get("content") or ""
    if not content.strip():
        raise ValueError("Ollama returned empty response")
    return _repair_json_content(content)


def _call_openai_json(system_prompt: str, user_prompt: str, *, temperature: float) -> dict[str, Any]:
    from openai import OpenAI

    client = OpenAI(api_key=get_openai_api_key())
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        temperature=temperature,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = response.choices[0].message.content or "{}"
    return _parse_json_content(content)


def _call_claude_json(system_prompt: str, user_prompt: str, *, temperature: float) -> dict[str, Any]:
    from anthropic import Anthropic

    client = Anthropic(api_key=get_claude_api_key())
    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4096,
        temperature=temperature,
        system=f"{system_prompt.strip()} Return only valid JSON with no markdown fences.",
        messages=[{"role": "user", "content": user_prompt}],
    )
    parts = [block.text for block in response.content if getattr(block, "type", None) == "text" and block.text]
    content = "\n".join(parts).strip()
    return _parse_json_content(content)


def _call_google_json(system_prompt: str, user_prompt: str, *, temperature: float) -> dict[str, Any]:
    import google.generativeai as genai

    genai.configure(api_key=get_google_api_key())
    model = genai.GenerativeModel(
        GOOGLE_MODEL,
        system_instruction=f"{system_prompt.strip()} Return only valid JSON with no markdown fences.",
    )
    response = model.generate_content(
        user_prompt,
        generation_config={
            "temperature": temperature,
            "response_mime_type": "application/json",
        },
    )
    content = (response.text or "").strip()
    if not content:
        raise ValueError("Google Gemini returned empty response")
    return _parse_json_content(content)


def format_llm_status(provider: str | None, model: str | None) -> str:
    if provider == "openai":
        return f"OpenAI · {model or OPENAI_MODEL}"
    if provider == "claude":
        return f"Claude · {model or CLAUDE_MODEL}"
    if provider == "google":
        return f"Google · {model or GOOGLE_MODEL}"
    if provider == "local":
        return f"Local · {model or LOCAL_LLM_MODEL}"
    return format_fallback_status()


def get_llm_provider_status() -> dict[str, Any]:
    """Admin diagnostics — includes last-configured provider availability."""
    ollama_up = _ollama_reachable()
    return {
        "use_llm": is_cloud_llm_enabled(),
        "openai_configured": bool(get_openai_api_key()),
        "openai_model": OPENAI_MODEL,
        "claude_configured": bool(get_claude_api_key()),
        "claude_model": CLAUDE_MODEL,
        "google_configured": bool(get_google_api_key()),
        "google_model": GOOGLE_MODEL,
        "local_llm_enabled": is_local_llm_enabled(),
        "local_llm_model": LOCAL_LLM_MODEL,
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_reachable": ollama_up,
        "ollama_timeout_sec": OLLAMA_TIMEOUT_SEC,
    }


def call_llm_json(
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.2,
    max_user_chars: int = 24000,
    validate: Callable[[dict[str, Any]], bool] | None = None,
    local_max_user_chars: int = 4000,
    feature: str = "insight",
) -> dict[str, Any]:
    """Try cloud providers (if USE_LLM=true), then local Ollama. Returns data + clean llm_status for UI."""
    user_text = user_prompt[:max_user_chars]
    local_text = user_prompt[:local_max_user_chars]
    errors: list[str] = []

    if is_cloud_llm_enabled():
        if get_openai_api_key():
            result = _try_provider(
                "OpenAI",
                lambda: _call_openai_json(system_prompt, user_text, temperature=temperature),
                provider="openai",
                model=OPENAI_MODEL,
                validate=validate,
                errors=errors,
            )
            if result:
                return result
        else:
            errors.append("OpenAI: API key not configured")

        if get_claude_api_key():
            result = _try_provider(
                "Claude",
                lambda: _call_claude_json(system_prompt, user_text, temperature=temperature),
                provider="claude",
                model=CLAUDE_MODEL,
                validate=validate,
                errors=errors,
            )
            if result:
                return result
        else:
            errors.append("Claude: API key not configured")

        if get_google_api_key():
            result = _try_provider(
                "Google",
                lambda: _call_google_json(system_prompt, user_text, temperature=temperature),
                provider="google",
                model=GOOGLE_MODEL,
                validate=validate,
                errors=errors,
            )
            if result:
                return result
        else:
            errors.append("Google: API key not configured")
    else:
        errors.append("Cloud LLM: skipped (USE_LLM=false)")

    if is_local_llm_enabled():
        if _ollama_reachable():
            result = _try_provider(
                "Local LLM",
                lambda: _call_ollama_json(system_prompt, local_text, temperature=temperature),
                provider="local",
                model=LOCAL_LLM_MODEL,
                validate=validate,
                errors=errors,
            )
            if result:
                return result
        else:
            errors.append(f"Local LLM: Ollama not reachable at {OLLAMA_BASE_URL}")
    else:
        errors.append("Local LLM: disabled")

    _log_provider_errors(errors)
    return {
        "data": None,
        "provider": None,
        "model": None,
        "llm_status": format_fallback_status(feature),
    }
