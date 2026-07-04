#!/usr/bin/env python3
"""Test LLM fallback chain via meeting-to-action parse."""
import json
import sys
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]
PROJECT = sys.argv[1] if len(sys.argv) > 1 else "6a44c66b9dc94cf43bb8cfd2"
NOTES = """WIG: Expand rural clinic coverage to 95% by Q4
Lead measure: Train 50 community health workers — owner: Priya, due: 2026-08-01
Action: John to finalize vendor contract by 2026-07-20"""

req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/projects/{PROJECT}/meeting-to-action/parse",
    data=json.dumps({"notes": NOTES}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as resp:
    data = json.load(resp)
    print("status:", resp.status)
    print("llm_status:", data.get("llm_status"))
    print("wigs:", len(data.get("proposed_wigs", [])))
    print("measures:", len(data.get("proposed_measures", [])))
    print("actions:", len(data.get("proposed_actions", [])))
