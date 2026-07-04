#!/usr/bin/env python3
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))
from app import collect_contextual_insight_context, call_llm_json
import urllib.request

SESSION = json.load(open("/tmp/4dx-session.json"))
req = urllib.request.Request("http://127.0.0.1:8000/api/projects", headers={"Authorization": f"Bearer {SESSION['token']}"})
projects = json.load(urllib.request.urlopen(req))
pid = projects[0]["_id"]
ctx = collect_contextual_insight_context(pid)
scope = ctx["scope"]
entity = ctx["entity"]
focus = entity.get("title") or ctx["project"].get("name")
system = "You are a 4DX delivery advisor. Return only valid JSON with summary, risks, highlights."
schema = {"summary": "text", "risks": [], "highlights": []}
prompt = {"question": f"Summarize {scope} {focus}", "required_json_shape": schema, "context": ctx}
llm = call_llm_json(system, json.dumps(prompt, default=str)[:8000])
print("provider:", llm.get("provider"))
print("data:", json.dumps(llm.get("data"), indent=2)[:1500])
