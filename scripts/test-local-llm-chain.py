#!/usr/bin/env python3
"""Test full LLM chain including local Ollama tier."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from llm_client import call_llm_json, is_local_llm_enabled, _ollama_reachable, LOCAL_LLM_MODEL, OLLAMA_BASE_URL

print("local_llm_enabled:", is_local_llm_enabled())
print("ollama_reachable:", _ollama_reachable(), OLLAMA_BASE_URL)
print("local_model:", LOCAL_LLM_MODEL)

result = call_llm_json(
    "You extract structured data. Return JSON only.",
    json.dumps({"task": "Return JSON with keys headline and summary", "example": {"headline": "Test", "summary": "Works"}}),
)
print("provider:", result.get("provider"))
print("model:", result.get("model"))
print("llm_status:", result.get("llm_status"))
print("has_data:", bool(result.get("data")))
if result.get("data"):
    print("data_keys:", list(result["data"].keys())[:6])
