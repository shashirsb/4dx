#!/usr/bin/env python3
import json
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]
PROJECT = "6a44c66b9dc94cf43bb8cfd2"

req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/ai/insight/project/{PROJECT}",
    data=b"{}",
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as resp:
    data = json.load(resp)
    print("contextual llm_status:", data.get("llm_status"))
