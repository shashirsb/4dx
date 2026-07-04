#!/usr/bin/env python3
"""Direct backend test for contextual insight fix (no HTTP auth)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

from app import db, generate_contextual_insight

project = db.projects.find_one({})
if not project:
    print("No project found")
    sys.exit(1)

project_id = str(project["_id"])
wig = next(w for w in project.get("wigs", []) if not w.get("archived_at"))
measure = next(m for m in wig.get("lead_measures", []) if not m.get("archived_at"))

cases = [
    ("project", project_id, None, None),
    ("wig", project_id, wig["id"], None),
    ("measure", project_id, wig["id"], measure["id"]),
]

failed = 0
for label, pid, wid, mid in cases:
    data = generate_contextual_insight(pid, wig_id=wid, measure_id=mid)
    summary = (data.get("summary") or "").strip()
    risks = data.get("risks") or []
    print(f"\n=== {label} ===")
    print("llm_status:", data.get("llm_status"))
    print("summary_len:", len(summary))
    print("risks:", len(risks))
    if summary:
        print("preview:", summary[:180])
    if not summary:
        print("FAIL")
        failed += 1
    else:
        print("OK")

sys.exit(1 if failed else 0)
