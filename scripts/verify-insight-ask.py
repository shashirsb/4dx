#!/usr/bin/env python3
"""Verify contextual insight follow-up ask endpoints."""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
SESSION_PATH = "/tmp/4dx-session.json"


def load_token():
    try:
        with open(SESSION_PATH, encoding="utf-8") as fh:
            return json.load(fh)["token"]
    except OSError as exc:
        print(f"Missing session at {SESSION_PATH}: {exc}", file=sys.stderr)
        sys.exit(2)


def api_get(path, token):
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def api_post(path, token, payload):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)


def main():
    token = load_token()
    projects = api_get("/api/projects", token)
    project_id = projects[0]["_id"]
    bundle = api_get(f"/api/projects/{project_id}/evidence", token)
    project = bundle["project"]
    wig = next(w for w in project["wigs"] if not w.get("archived_at"))
    measure = next(m for m in wig["lead_measures"] if not m.get("archived_at"))

    cases = [
        ("project", f"/api/ai/insight/project/{project_id}/ask", "What are the main risks?"),
        ("wig", f"/api/ai/insight/wig/{project_id}/{wig['id']}/ask", "Is this WIG on track?"),
        (
            "measure",
            f"/api/ai/insight/measure/{project_id}/{wig['id']}/{measure['id']}/ask",
            "Who is assigned to this lead measure?",
        ),
    ]

    failed = 0
    for label, path, question in cases:
        print(f"\n=== {label} ask ===")
        try:
            data = api_post(path, token, {"question": question})
        except urllib.error.HTTPError as exc:
            print(f"FAIL: HTTP {exc.code}: {exc.read().decode()[:240]}")
            failed += 1
            continue
        answer = (data.get("answer") or "").strip()
        print("question:", question)
        print("llm_status:", data.get("llm_status"))
        print("answer_len:", len(answer))
        if not answer:
            print("FAIL: empty answer")
            failed += 1
        else:
            print("OK")
            print("answer preview:", answer[:180])

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
