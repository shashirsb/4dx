#!/usr/bin/env python3
"""Quick test for meeting-to-action parse endpoints."""
import json
import urllib.error
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
TOKEN = SESSION["token"]
NOTES = "WIG: Test coverage goal\nAction: Owner to review plan by 2026-07-15"

projects_req = urllib.request.Request(
    "http://127.0.0.1:8000/api/projects",
    headers={"Authorization": f"Bearer {TOKEN}"},
)
with urllib.request.urlopen(projects_req) as resp:
    projects = json.load(resp)
project = projects[0]
PROJECT = project["_id"]
MINISTRY = project["ministry_id"]

project_req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/projects/{PROJECT}/meeting-to-action/parse",
    data=json.dumps({"notes": NOTES, "ministry_id": MINISTRY}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(project_req) as resp:
    data = json.load(resp)
    print("project parse status:", resp.status)
    print("llm_status:", data.get("llm_status"))
    print("catalog projects:", len(data.get("catalog", {}).get("projects", [])))
    print("wigs:", len(data.get("proposed_wigs", [])))
    print("measures:", len(data.get("proposed_measures", [])))
    print("actions:", len(data.get("proposed_actions", [])))

ministry_req = urllib.request.Request(
    f"http://127.0.0.1:8000/api/ministries/{MINISTRY}/meeting-to-action/parse",
    data=json.dumps({"notes": NOTES}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(ministry_req) as resp:
    data = json.load(resp)
    print("ministry parse status:", resp.status)
    print("llm_status:", data.get("llm_status"))
    print("catalog projects:", len(data.get("catalog", {}).get("projects", [])))
    print("wigs:", len(data.get("proposed_wigs", [])))
    print("measures:", len(data.get("proposed_measures", [])))
    print("actions:", len(data.get("proposed_actions", [])))
