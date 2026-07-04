#!/usr/bin/env python3
"""Verify USE_LLM flag skips or enables cloud provider calls."""

from __future__ import annotations

import importlib
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


def run_mode(use_llm: str) -> tuple[bool, float, str | None]:
    os.environ["USE_LLM"] = use_llm
    os.environ.pop("useLLM", None)
    import llm_client

    importlib.reload(llm_client)

    called = {"openai": False, "claude": False, "google": False}

    def wrap(name: str, fn):
        def inner(*args, **kwargs):
            called[name] = True
            raise RuntimeError(f"{name} should not be called when USE_LLM={use_llm}")

        return inner

    llm_client.get_openai_api_key = lambda: "test-key"
    llm_client.get_claude_api_key = lambda: "test-key"
    llm_client.get_google_api_key = lambda: "test-key"
    llm_client._call_openai_json = wrap("openai", llm_client._call_openai_json)
    llm_client._call_claude_json = wrap("claude", llm_client._call_claude_json)
    llm_client._call_google_json = wrap("google", llm_client._call_google_json)
    llm_client._ollama_reachable = lambda: False
    llm_client.is_local_llm_enabled = lambda: False

    start = time.perf_counter()
    result = llm_client.call_llm_json('Return {"summary":"ok"}', "{}", validate=None)
    elapsed = time.perf_counter() - start
    cloud_called = any(called.values())
    return cloud_called, elapsed, result.get("llm_status")


def main() -> None:
    cloud_false, t_false, status_false = run_mode("false")
    if cloud_false:
        print("FAIL: USE_LLM=false still attempted cloud providers")
        sys.exit(1)
    print(f"OK USE_LLM=false: no cloud calls, {t_false:.2f}s, status={status_false!r}")

    cloud_true, t_true, status_true = run_mode("true")
    if not cloud_true:
        print("FAIL: USE_LLM=true did not attempt cloud providers")
        sys.exit(1)
    print(f"OK USE_LLM=true: cloud attempted, {t_true:.2f}s, status={status_true!r}")

    os.environ["USE_LLM"] = "false"
    os.environ["useLLM"] = "true"
    import llm_client

    importlib.reload(llm_client)
    assert llm_client.is_cloud_llm_enabled() is False, "USE_LLM=false should win over useLLM alias when both set..."

    # Actually: user said useLLM alias if easy - when USE_LLM is set it takes precedence.
    # Test alias alone:
    os.environ.pop("USE_LLM", None)
    os.environ["useLLM"] = "yes"
    importlib.reload(llm_client)
    assert llm_client.is_cloud_llm_enabled() is True
    print("OK useLLM=yes alias works")

    print("All USE_LLM checks passed")


if __name__ == "__main__":
    main()
