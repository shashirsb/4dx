#!/usr/bin/env python3
"""Verify contextual insight returns non-empty summary at all levels."""
import json
import os
import sys
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]

def api_get(path):
    req = urllib.request.Request(f"http://127.0.0.1:8000{path}", headers={"Authorization": f"Bearer {TOKEN}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)

def api_post(path):
    req = urllib.request.Request(
        f"http://127.0.0.1:8000{path}",
        data=b"{}",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)

projects = api_get("/api/projects")
project_id = projects[0]["_id"]
bundle = api_get(f"/api/projects/{project_id}/evidence")
project = bundle["project"]
wig = next(w for w in project["wigs"] if not w.get("archived_at"))
measure = next(m for m in wig["lead_measures"] if not m.get("archived_at"))

paths = [
    ("project", f"/api/ai/insight/project/{project_id}"),
    ("wig", f"/api/ai/insight/wig/{project_id}/{wig['id']}"),
    ("measure", f"/api/ai/insight/measure/{project_id}/{wig['id']}/{measure['id']}"),
]

failed = 0
for label, path in paths:
    data = api_post(path)
    summary = (data.get("summary") or "").strip()
    risks = data.get("risks") or []
    print(f"\n=== {label} ===")
    print("llm_status:", data.get("llm_status"))
    print("summary_len:", len(summary))
    print("risks:", len(risks))
    if not summary:
        print("FAIL: empty summary")
        failed += 1
    elif len(risks) == 0:
        print("WARN: no risks")
    else:
        print("OK")
        print("summary preview:", summary[:160])

sys.exit(1 if failed else 0)
