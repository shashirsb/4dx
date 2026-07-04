#!/usr/bin/env python3
"""Test meeting-to-action parse via Vite proxy (5173)."""
import json
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]
PROJECT = "6a44c66b9dc94cf43bb8cfd2"
NOTES = "WIG: Test via proxy\nAction: Review by 2026-07-20"

req = urllib.request.Request(
    f"http://127.0.0.1:5173/api/projects/{PROJECT}/meeting-to-action/parse",
    data=json.dumps({"notes": NOTES}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    data = json.load(resp)
    print("proxy status:", resp.status)
    print("llm_status:", data.get("llm_status"))
    print("actions:", len(data.get("proposed_actions", [])))
