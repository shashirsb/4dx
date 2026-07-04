#!/usr/bin/env python3
"""Reproduce contextual insight empty summary bug."""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]

def api_get(path):
    req = urllib.request.Request(
        f"http://127.0.0.1:8000{path}",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req) as resp:
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

print("project:", project["name"])
print("wig:", wig["title"])
print("measure:", measure["title"])

for label, path in [
    ("project", f"/api/ai/insight/project/{project_id}"),
    ("wig", f"/api/ai/insight/wig/{project_id}/{wig['id']}"),
    ("measure", f"/api/ai/insight/measure/{project_id}/{wig['id']}/{measure['id']}"),
]:
    data = api_post(path)
    summary = (data.get("summary") or "").strip()
    risks = data.get("risks") or []
    highlights = data.get("highlights") or []
    print(f"\n=== {label} ===")
    print("llm_status:", data.get("llm_status"))
    print("summary_len:", len(summary), repr(summary[:120]))
    print("risks:", len(risks))
    print("highlights:", len(highlights))
