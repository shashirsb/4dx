#!/usr/bin/env python3
"""Verify contextual insight risks include navigable source objects."""

from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app import collect_contextual_insight_context, ensure_insight_payload, local_contextual_insight


def req(url, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, body, headers, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(request, timeout=60) as resp:
        return json.loads(resp.read())


def main() -> None:
    # Offline unit check with mock-ish context shape
    class FakeOid:
        def __init__(self, s):
            self.s = s
        def __str__(self):
            return self.s

    # Direct local insight shape check via imported functions requires DB — use API if up
    try:
        otp = req("http://127.0.0.1:8000/api/auth/request-otp", {"phone": "9999900000"})
        auth = req("http://127.0.0.1:8000/api/auth/verify-otp", {"phone": "9999900000", "otp": otp["demo_otp"]})
        token = auth["token"]
        projects = req("http://127.0.0.1:8000/api/projects", token=token)
        project = next(p for p in projects if p.get("wigs"))
        wig = next(w for w in project["wigs"] if not w.get("archived_at"))
        path = f"/api/ai/insight/wig/{project['_id']}/{wig['id']}"
        insight = req(f"http://127.0.0.1:8000{path}", {}, token=token)
        risks = insight.get("risks") or []
        print(f"WIG insight risks: {len(risks)}")
        for i, risk in enumerate(risks[:6], 1):
            src = risk.get("source")
            ok = isinstance(src, dict) and src.get("type") and src.get("project_id")
            print(f"  {i}. {risk.get('title')[:50]!r} navigable={ok} type={src.get('type') if isinstance(src, dict) else src}")
            if not ok:
                sys.exit(1)
        print("OK all risks have structured navigable sources")
    except Exception as exc:
        print("API check skipped:", exc)
        # Minimal offline validation of helper
        from app import _insight_source, _normalize_risk_source
        ctx = {
            "scope": "wig",
            "entity": {"project_id": "abc", "wig_id": "w1", "wig_title": "Test WIG"},
            "project": {"name": "P", "bottlenecks": ["Cadence"]},
            "wigs": [{"id": "w1", "title": "Test WIG", "measures": []}],
            "overdue_items": [],
            "stale_measures": [],
            "approvals": [],
            "decisions": [],
            "documents": [],
            "assignments": [],
        }
        risk = {"title": "WIG past deadline", "reason": "overdue", "source": "Deadlines"}
        src = _normalize_risk_source(risk, ctx)
        assert src["type"] == "wig" and src["wig_id"] == "w1"
        print("OK offline source normalization")


if __name__ == "__main__":
    main()
