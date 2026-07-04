#!/usr/bin/env python3
"""Verify Meeting to Action parse quality with Belagavi Water Supply sample notes."""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from meeting_to_action import build_project_catalog, local_parse_meeting_notes, parse_meeting_notes

BELAGAVI_NOTES = """Belagavi Water Supply — WIG session with CM on 3 July 2026.

CM asked the project team to hold a tripartite meeting with BWSSB and contractor on July 12 to resolve pipeline land disputes. PD agreed to schedule and send invites by July 8.

Progress report on 24x7 water supply coverage due in 2 weeks — prepared by Priya and submitted to CM office.

Road restoration works have seen scope creep beyond original BOQ. PM must review scope with finance and revert with revised estimates before next cadence.

Follow up with district collector on land acquisition for booster pump station."""


def sample_project() -> dict:
    return {
        "name": "Belagavi Water Supply",
        "owner": "Project Director",
        "due_date": "2026-12-31",
        "priority": 8,
        "wigs": [
            {
                "id": "wig-water-1",
                "title": "Ensure 24x7 water supply across Belagavi city",
                "owner": "Project Director",
                "deadline": "2026-12-31",
                "lead_measures": [
                    {
                        "id": "m-coverage",
                        "title": "Household coverage with 24x7 supply",
                        "assigned_to": ["Priya"],
                        "deadline": "2026-10-01",
                    },
                    {
                        "id": "m-pipeline",
                        "title": "Pipeline network expansion km completed",
                        "assigned_to": ["Rajesh"],
                        "deadline": "2026-09-15",
                    },
                ],
            },
            {
                "id": "wig-road-1",
                "title": "Road restoration after pipeline laying",
                "owner": "PM Civil",
                "deadline": "2026-11-30",
                "lead_measures": [
                    {
                        "id": "m-road",
                        "title": "Road restoration km completed",
                        "assigned_to": ["PM Civil"],
                        "deadline": "2026-11-01",
                    }
                ],
            },
        ],
    }


def main() -> None:
    project = sample_project()
    catalog = build_project_catalog(project)
    result = local_parse_meeting_notes(BELAGAVI_NOTES, project, catalog)
    actions = result.get("proposed_actions") or []

    print("=== Local heuristic parser ===")
    print("llm_status:", result.get("llm_status"))
    print("actions:", len(actions))
    for i, action in enumerate(actions, 1):
        comment = (action.get("comment") or "")[:120]
        print(f"  {i}. [{action.get('confidence')}] {comment!r}")
        if len(action.get("comment") or "") > 500:
            print("     FAIL: comment too long")
            sys.exit(1)

    if len(actions) < 3:
        print(f"FAIL: expected at least 3 actions, got {len(actions)}")
        sys.exit(1)

    comments = " ".join(a.get("comment", "") for a in actions).lower()
    for keyword in ("tripartite", "progress report", "scope"):
        if keyword not in comments:
            print(f"WARN: missing keyword '{keyword}' in action comments")

    full = parse_meeting_notes(BELAGAVI_NOTES, project)
    print("\n=== Full parse_meeting_notes (may use LLM) ===")
    print("llm_status:", full.get("llm_status"))
    print("actions:", len(full.get("proposed_actions") or []))
    status = full.get("llm_status") or ""
    dirty = any(m in status for m in ("Error code:", "429", "OpenAI:", "Local fallback ·"))
    if dirty:
        print("FAIL: raw error in llm_status:", status[:200])
        sys.exit(1)
    print("OK")

if __name__ == "__main__":
    main()
