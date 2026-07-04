"""Meeting notes → WIG / lead measure / action item parser and applier."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Any, Callable

from llm_client import call_llm_json, format_fallback_status, meeting_action_payload_valid, sanitize_llm_status


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, (a or "").lower().strip(), (b or "").lower().strip()).ratio()


def build_project_catalog(project: dict[str, Any]) -> dict[str, Any]:
    wigs: list[dict[str, Any]] = []
    for wig in project.get("wigs", []):
        if wig.get("archived_at"):
            continue
        measures = []
        for measure in wig.get("lead_measures", []):
            if measure.get("archived_at"):
                continue
            measures.append({
                "id": measure.get("id"),
                "title": measure.get("title"),
                "assigned_to": measure.get("assigned_to") or [],
                "deadline": measure.get("deadline"),
                "priority": measure.get("priority", 5),
            })
        wigs.append({
            "id": wig.get("id"),
            "title": wig.get("title"),
            "owner": wig.get("owner"),
            "deadline": wig.get("deadline"),
            "update_frequency": wig.get("update_frequency", "weekly"),
            "priority": wig.get("priority", 5),
            "lead_measures": measures,
        })
    return {
        "project_id": str(project.get("_id", "")),
        "project_name": project.get("name"),
        "project_owner": project.get("owner"),
        "project_due_date": project.get("due_date"),
        "wigs": wigs,
    }


def build_ministry_catalog(ministry_projects: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate WIGs across all projects in a ministry for portfolio-level MTA."""
    projects: list[dict[str, Any]] = []
    all_wigs: list[dict[str, Any]] = []
    for proj in ministry_projects:
        cat = build_project_catalog(proj)
        project_id = cat.get("project_id")
        projects.append({
            "project_id": project_id,
            "project_name": cat.get("project_name"),
            "project_owner": cat.get("project_owner"),
            "project_due_date": cat.get("project_due_date"),
            "wigs": cat.get("wigs", []),
        })
        for wig in cat.get("wigs", []):
            enriched = dict(wig)
            enriched["project_id"] = project_id
            enriched["project_name"] = cat.get("project_name")
            all_wigs.append(enriched)
    return {"projects": projects, "wigs": all_wigs}


def build_ministry_scoped_catalog(
    project: dict[str, Any],
    ministry_projects: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Primary project catalog plus sibling projects in the same ministry for matching."""
    catalog = build_project_catalog(project)
    ministry_projects = ministry_projects or [project]
    sibling_projects: list[dict[str, Any]] = []
    for sibling in ministry_projects:
        sibling_id = str(sibling.get("_id", ""))
        if sibling_id and sibling_id == catalog.get("project_id"):
            continue
        sibling_cat = build_project_catalog(sibling)
        sibling_projects.append({
            "project_id": sibling_cat.get("project_id"),
            "project_name": sibling_cat.get("project_name"),
            "wigs": sibling_cat.get("wigs", []),
        })
    catalog["ministry_projects"] = sibling_projects
    return catalog


def _catalog_wigs(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    wigs = list(catalog.get("wigs") or [])
    for sibling in catalog.get("ministry_projects") or []:
        for wig in sibling.get("wigs") or []:
            enriched = dict(wig)
            enriched["project_id"] = sibling.get("project_id")
            enriched["project_name"] = sibling.get("project_name")
            wigs.append(enriched)
    return wigs


def _default_deadline(project: dict[str, Any], days: int = 30) -> str:
    due = project.get("due_date")
    if due:
        return due
    return (datetime.utcnow().date() + timedelta(days=days)).isoformat()


def _best_wig_match(title: str, catalog: dict[str, Any], threshold: float = 0.72) -> tuple[dict[str, Any] | None, float]:
    best = None
    score = 0.0
    for wig in _catalog_wigs(catalog):
        s = _similarity(title, wig.get("title", ""))
        if s > score:
            score = s
            best = wig
    if best and score >= threshold:
        return best, score
    return None, score


def _best_measure_match(title: str, wig: dict[str, Any] | None, catalog: dict[str, Any], threshold: float = 0.72) -> tuple[dict[str, Any] | None, dict[str, Any] | None, float]:
    best_measure = None
    best_wig = wig
    score = 0.0
    wigs = [wig] if wig else _catalog_wigs(catalog)
    for w in wigs:
        if not w:
            continue
        for measure in w.get("lead_measures", []):
            s = _similarity(title, measure.get("title", ""))
            if s > score:
                score = s
                best_measure = measure
                best_wig = w
    if best_measure and score >= threshold:
        return best_measure, best_wig, score
    return None, best_wig, score


def _parse_owner_due(line: str) -> tuple[str | None, str | None]:
    owner = None
    due = None
    owner_match = re.search(
        r"(?:owner|assigned to|assignee|led by|prepare[d]? by|submit(?:ted)? by)[:\s]+([^|,\n.]+)",
        line,
        re.I,
    )
    if owner_match:
        owner = owner_match.group(1).strip()
    due_match = re.search(
        r"(?:due|deadline|by|before)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?|\d+\s+weeks?)",
        line,
        re.I,
    )
    if due_match:
        due = _normalize_due_date(due_match.group(1).strip())
    return owner, due


def _normalize_due_date(raw: str) -> str:
    text = (raw or "").strip().lower()
    weeks = re.match(r"(\d+)\s+weeks?", text)
    if weeks:
        return (datetime.utcnow().date() + timedelta(weeks=int(weeks.group(1)))).isoformat()
    for fmt in ("%Y-%m-%d", "%B %d, %Y", "%B %d %Y", "%b %d, %Y", "%b %d %Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    month_day = re.match(
        r"(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})",
        text,
        re.I,
    )
    if month_day:
        month_name, day = month_day.group(1), int(month_day.group(2))
        year = datetime.utcnow().year
        try:
            return datetime.strptime(f"{month_name} {day} {year}", "%B %d %Y").date().isoformat()
        except ValueError:
            pass
    return raw


_ACTION_HINTS = re.compile(
    r"(?i)(?:^action:|^todo:|^commitment:|agreed to|will prepare|will submit|must |need to|"
    r"cm (?:asked|directed|requested|instructed)|schedule |hold a |progress report|"
    r"scope creep|review |tripartite|follow up|ensure |complete |deliver |restore |report back|revert with)"
)


def _split_note_segments(notes: str) -> list[str]:
    segments: list[str] = []
    seen: set[str] = set()
    for block in re.split(r"\n\s*\n", notes):
        block = block.strip()
        if not block:
            continue
        parts = re.split(r"(?<=[.!?;])\s+", block) if len(block) > 80 else [block]
        for part in parts:
            for line in part.splitlines():
                cleaned = re.sub(r"^[-*•\d.)]+\s*", "", line.strip())
                if len(cleaned) >= 10 and cleaned not in seen:
                    seen.add(cleaned)
                    segments.append(cleaned)
    return segments


def _catalog_keyword_match(text: str, catalog: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any] | None, float]:
    words = {w for w in re.findall(r"[a-z]{3,}", text.lower()) if len(w) >= 3}
    project_words = {w for w in re.findall(r"[a-z]{3,}", (catalog.get("project_name") or "").lower())}
    words |= project_words
    best_kind = "wig"
    best_wig: dict[str, Any] | None = None
    best_measure: dict[str, Any] | None = None
    best_score = 0.0
    for wig in _catalog_wigs(catalog):
        wig_words = {w for w in re.findall(r"[a-z]{3,}", (wig.get("title") or "").lower())}
        score = len(words & wig_words)
        if score > best_score:
            best_score = score
            best_kind = "wig"
            best_wig = wig
            best_measure = None
        for measure in wig.get("lead_measures", []):
            measure_words = {w for w in re.findall(r"[a-z]{3,}", (measure.get("title") or "").lower())}
            score = len(words & measure_words) + len(words & wig_words) * 0.4
            if score > best_score:
                best_score = score
                best_kind = "measure"
                best_wig = wig
                best_measure = measure
    confidence = min(0.85, 0.45 + best_score * 0.12) if best_score else 0.0
    return best_kind, best_wig or {}, best_measure, confidence


def _looks_like_action(text: str) -> bool:
    return bool(_ACTION_HINTS.search(text))


def _default_targets(catalog: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    wigs = catalog.get("wigs") or []
    if not wigs:
        return None, None
    wig = wigs[0]
    measure = (wig.get("lead_measures") or [None])[0]
    return wig, measure


def _build_action_item(
    text: str,
    catalog: dict[str, Any],
    project: dict[str, Any],
    default_deadline: str,
    *,
    confidence: float = 0.58,
    reasoning: str = "Parsed from meeting notes.",
) -> dict[str, Any]:
    owner, due = _parse_owner_due(text)
    kind, wig, measure, kw_score = _catalog_keyword_match(text, catalog)
    if kw_score >= 0.45 and wig:
        target_wig = wig
        target_measure = measure if kind == "measure" else None
        confidence = max(confidence, kw_score)
        reasoning = f"Matched to existing {'measure' if target_measure else 'WIG'} by keywords."
    else:
        target_wig, target_measure = _default_targets(catalog)
    comment = text.strip()[:500]
    title = comment[:140]
    if len(comment) > 160:
        title = comment[:137] + "..."
    action_project_id = None
    if target_wig:
        action_project_id = target_wig.get("project_id") or catalog.get("project_id")
    return {
        "target": "measure" if target_measure else "wig",
        "project_id": action_project_id,
        "target_wig_id": target_wig.get("id") if target_wig else None,
        "target_measure_id": target_measure.get("id") if target_measure else None,
        "comment": comment,
        "owner": owner or project.get("owner"),
        "due_date": due or (target_measure or target_wig or {}).get("deadline") or default_deadline,
        "create_assignment": bool(owner or due or _looks_like_action(text)),
        "assignment_title": title,
        "confidence": round(confidence, 2),
        "reasoning": reasoning,
        "selected": True,
    }


def _meeting_payload_quality_ok(data: dict[str, Any], notes: str) -> bool:
    if not meeting_action_payload_valid(data):
        return False
    actions = data.get("proposed_actions") or []
    notes_len = len(notes.strip())
    if len(actions) == 1 and notes_len > 120:
        comment = (actions[0].get("comment") or "").strip()
        if len(comment) > max(500, int(notes_len * 0.65)):
            return False
    for action in actions:
        if len((action.get("comment") or "")) > 800:
            return False
    return True


def local_parse_meeting_notes(notes: str, project: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    lines = [line.strip() for line in notes.splitlines() if line.strip()]
    proposed_wigs: list[dict[str, Any]] = []
    proposed_measures: list[dict[str, Any]] = []
    proposed_actions: list[dict[str, Any]] = []
    wig_ref_counter = 0
    measure_ref_counter = 0
    default_deadline = _default_deadline(project)

    for line in lines:
        cleaned = re.sub(r"^[-*•\d.)]+\s*", "", line).strip()
        lower = cleaned.lower()

        if lower.startswith("wig:") or lower.startswith("new wig:"):
            title = re.sub(r"^wig:\s*", "", cleaned, flags=re.I).strip()
            match, score = _best_wig_match(title, catalog)
            if match:
                proposed_actions.append({
                    "target": "wig",
                    "project_id": match.get("project_id") or catalog.get("project_id"),
                    "target_wig_id": match["id"],
                    "comment": f"Meeting note linked to existing WIG: {cleaned}",
                    "owner": project.get("owner"),
                    "due_date": match.get("deadline") or default_deadline,
                    "create_assignment": False,
                    "assignment_title": None,
                    "confidence": round(score, 2),
                    "reasoning": f"Matched existing WIG '{match['title']}' ({int(score * 100)}% similarity).",
                    "selected": True,
                })
            else:
                ref = f"new_wig_{wig_ref_counter}"
                wig_ref_counter += 1
                proposed_wigs.append({
                    "proposed_ref": ref,
                    "title": title,
                    "current_state": "Identified in meeting notes",
                    "target_state": "Delivered per meeting commitment",
                    "from_value": 0,
                    "to_value": 100,
                    "unit": "%",
                    "deadline": default_deadline,
                    "owner": project.get("owner") or "Unassigned",
                    "update_frequency": "weekly",
                    "priority": project.get("priority", 5),
                    "budget_allocated": 0,
                    "confidence": 0.62,
                    "match_existing_wig_id": None,
                    "reasoning": "No close existing WIG match — proposed as new.",
                    "selected": True,
                })
            continue

        if "lead measure" in lower or lower.startswith("measure:"):
            title = re.sub(r"^(?:new\s+)?(?:lead\s+measure|measure):\s*", "", cleaned, flags=re.I).strip()
            owner, due = _parse_owner_due(cleaned)
            match, match_wig, score = _best_measure_match(title, None, catalog)
            if match and match_wig:
                proposed_actions.append({
                    "target": "measure",
                    "project_id": match_wig.get("project_id") or catalog.get("project_id"),
                    "target_wig_id": match_wig["id"],
                    "target_measure_id": match["id"],
                    "comment": cleaned,
                    "owner": owner or (match.get("assigned_to") or [None])[0],
                    "due_date": due or match.get("deadline") or default_deadline,
                    "create_assignment": bool(owner or due),
                    "assignment_title": title[:120] if owner or due else None,
                    "confidence": round(score, 2),
                    "reasoning": f"Matched existing measure '{match['title']}'.",
                    "selected": True,
                })
            else:
                ref = f"new_measure_{measure_ref_counter}"
                measure_ref_counter += 1
                parent_wig = catalog["wigs"][0] if catalog.get("wigs") else None
                proposed_measures.append({
                    "proposed_ref": ref,
                    "wig_id": parent_wig["id"] if parent_wig else None,
                    "proposed_wig_ref": None,
                    "title": title,
                    "current_state": "Raised in meeting",
                    "target_state": "Completed",
                    "from_value": 0,
                    "to_value": 100,
                    "unit": "%",
                    "deadline": due or default_deadline,
                    "assigned_to": [owner] if owner else [project.get("owner") or "Unassigned"],
                    "priority": project.get("priority", 5),
                    "budget_allocated": 0,
                    "confidence": 0.58,
                    "match_existing_measure_id": None,
                    "reasoning": "No close measure match — proposed as new lead measure.",
                    "selected": True,
                })
            continue

        if lower.startswith("action:") or lower.startswith("commitment:") or lower.startswith("todo:"):
            text = re.sub(r"^(?:action|commitment|todo):\s*", "", cleaned, flags=re.I).strip()
            proposed_actions.append(_build_action_item(
                text,
                catalog,
                project,
                default_deadline,
                confidence=0.62,
                reasoning="Parsed as labeled action/commitment.",
            ))
            continue

    if not proposed_actions:
        for segment in _split_note_segments(notes):
            lower = segment.lower()
            if lower.startswith("wig:") or lower.startswith("new wig:") or lower.startswith("measure:"):
                continue
            if "lead measure" in lower and lower.startswith("measure"):
                continue
            if _looks_like_action(segment):
                proposed_actions.append(_build_action_item(
                    segment,
                    catalog,
                    project,
                    default_deadline,
                    confidence=0.56,
                    reasoning="Extracted commitment from meeting narrative.",
                ))
            else:
                owner, due = _parse_owner_due(segment)
                if owner or due:
                    proposed_actions.append(_build_action_item(
                        segment,
                        catalog,
                        project,
                        default_deadline,
                        confidence=0.54,
                        reasoning="Extracted owner/due date from meeting narrative.",
                    ))

    if not proposed_wigs and not proposed_measures and not proposed_actions and notes.strip():
        for segment in _split_note_segments(notes)[:12]:
            if len(segment) >= 20:
                proposed_actions.append(_build_action_item(
                    segment,
                    catalog,
                    project,
                    default_deadline,
                    confidence=0.48,
                    reasoning="Segment parsed from meeting notes.",
                ))

    return {
        "proposed_wigs": proposed_wigs,
        "proposed_measures": proposed_measures,
        "proposed_actions": proposed_actions,
        "llm_status": format_fallback_status("meeting"),
    }


def _compact_meeting_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_name": catalog.get("project_name"),
        "wigs": [
            {
                "id": w.get("id"),
                "title": w.get("title"),
                "lead_measures": [{"id": m.get("id"), "title": m.get("title")} for m in w.get("lead_measures", [])[:8]],
            }
            for w in catalog.get("wigs", [])[:8]
        ],
    }


def openai_parse_meeting_notes(notes: str, project: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    system = (
        "You parse WIG session / meeting notes for a 4DX execution platform. "
        "Given existing WIGs and lead measures, propose ONLY new WIGs/measures when not closely related to existing ones. "
        "For related items, set match_existing_wig_id or match_existing_measure_id and prefer actions instead of duplicates. "
        "Use proposed_wig_ref / proposed_measure_ref (e.g. new_wig_0) to link new measures/actions to new WIGs not yet created. "
        "Extract action items with owners and due dates when mentioned. create_assignment=true when owner or due date present. "
        "confidence is 0-1. Return only valid JSON."
    )
    schema = {
        "proposed_wigs": [{
            "proposed_ref": "new_wig_0",
            "title": "string",
            "current_state": "string",
            "target_state": "string",
            "from_value": 0,
            "to_value": 100,
            "unit": "string",
            "deadline": "YYYY-MM-DD",
            "owner": "string",
            "update_frequency": "daily|weekly|bi-weekly|monthly",
            "priority": 5,
            "budget_allocated": 0,
            "confidence": 0.8,
            "match_existing_wig_id": "uuid or null",
            "reasoning": "string",
        }],
        "proposed_measures": [{
            "proposed_ref": "new_measure_0",
            "wig_id": "existing wig uuid or null",
            "proposed_wig_ref": "new_wig_0 or null",
            "title": "string",
            "current_state": "string",
            "target_state": "string",
            "from_value": 0,
            "to_value": 100,
            "unit": "string",
            "deadline": "YYYY-MM-DD",
            "assigned_to": ["Owner"],
            "priority": 5,
            "budget_allocated": 0,
            "confidence": 0.8,
            "match_existing_measure_id": "uuid or null",
            "reasoning": "string",
        }],
        "proposed_actions": [{
            "target": "wig|measure",
            "target_wig_id": "uuid or null",
            "target_measure_id": "uuid or null",
            "proposed_wig_ref": "new_wig_0 or null",
            "proposed_measure_ref": "new_measure_0 or null",
            "comment": "string",
            "owner": "string or null",
            "due_date": "YYYY-MM-DD or null",
            "create_assignment": True,
            "assignment_title": "string or null",
            "confidence": 0.8,
            "reasoning": "string",
        }],
    }
    prompt = {
        "meeting_notes": notes,
        "project": {
            "name": project.get("name"),
            "owner": project.get("owner"),
            "due_date": project.get("due_date"),
            "priority": project.get("priority", 5),
        },
        "existing_catalog": _compact_meeting_catalog(catalog),
        "required_json_shape": schema,
        "rules": [
            "Do not duplicate existing WIGs/measures unless confidence of match is low",
            "When matching existing, use match_existing_* id from catalog and skip creating duplicate",
            "Action comments go on measures when possible; wig-level actions may omit measure_id",
            "Split meeting notes into multiple concise action items — never one giant comment with all notes",
        ],
    }
    llm = call_llm_json(
        system,
        json.dumps(prompt, default=str),
        validate=meeting_action_payload_valid,
        feature="meeting",
    )
    if llm.get("data") and _meeting_payload_quality_ok(llm["data"], notes):
        data = llm["data"]
        for key in ("proposed_wigs", "proposed_measures", "proposed_actions"):
            if not isinstance(data.get(key), list):
                data[key] = []
        for item in data["proposed_wigs"]:
            item.setdefault("selected", True)
            item.setdefault("from_value", 0)
            item.setdefault("to_value", 100)
            item.setdefault("unit", "%")
            item.setdefault("budget_allocated", 0)
            item.setdefault("update_frequency", "weekly")
            item.setdefault("priority", project.get("priority", 5))
        for item in data["proposed_measures"]:
            item.setdefault("selected", True)
            item.setdefault("from_value", 0)
            item.setdefault("to_value", 100)
            item.setdefault("unit", "%")
            item.setdefault("budget_allocated", 0)
            item.setdefault("assigned_to", [project.get("owner") or "Unassigned"])
        for item in data["proposed_actions"]:
            item.setdefault("selected", True)
            item.setdefault("create_assignment", bool(item.get("owner") or item.get("due_date")))
            if len((item.get("comment") or "")) > 500:
                item["comment"] = item["comment"][:497] + "..."
        data["llm_status"] = sanitize_llm_status(llm["llm_status"], feature="meeting")
        return data
    result = local_parse_meeting_notes(notes, project, catalog)
    result["llm_status"] = sanitize_llm_status(llm.get("llm_status"), feature="meeting")
    return result


def parse_meeting_notes(
    notes: str,
    project: dict[str, Any],
    ministry_projects: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    catalog = build_ministry_scoped_catalog(project, ministry_projects)
    text = (notes or "").strip()
    if not text:
        return {
            "proposed_wigs": [],
            "proposed_measures": [],
            "proposed_actions": [],
            "llm_status": "No notes provided",
        }
    if len(text) < 40:
        return local_parse_meeting_notes(text, project, catalog)
    return openai_parse_meeting_notes(text, project, catalog)


def _resolve_wig_id(
    wig_id: str | None,
    proposed_wig_ref: str | None,
    wig_ref_map: dict[str, str],
) -> str | None:
    if wig_id:
        return wig_id
    if proposed_wig_ref:
        return wig_ref_map.get(proposed_wig_ref)
    return None


def _resolve_measure_id(
    measure_id: str | None,
    proposed_measure_ref: str | None,
    measure_ref_map: dict[str, str],
) -> str | None:
    if measure_id:
        return measure_id
    if proposed_measure_ref:
        return measure_ref_map.get(proposed_measure_ref)
    return None


def _inline_wigs_from_actions(payload: dict[str, Any], project: dict[str, Any]) -> list[dict[str, Any]]:
    """Promote action-level create_new_wig into proposed_wigs when not already in batch."""
    existing_refs = {w.get("proposed_ref") for w in payload.get("proposed_wigs", []) if w.get("proposed_ref")}
    extras: list[dict[str, Any]] = []
    default_deadline = _default_deadline(project)
    for index, action in enumerate(payload.get("proposed_actions", [])):
        if not action.get("selected", True) or not action.get("create_new_wig"):
            continue
        ref = action.get("proposed_wig_ref") or f"inline_wig_{index}"
        action["proposed_wig_ref"] = ref
        action["target_wig_id"] = None
        if ref in existing_refs:
            continue
        existing_refs.add(ref)
        extras.append({
            "proposed_ref": ref,
            "title": action.get("new_wig_title") or action.get("assignment_title") or "Meeting WIG",
            "current_state": action.get("new_wig_current_state") or "Identified in meeting",
            "target_state": action.get("new_wig_target_state") or "Delivered per meeting commitment",
            "from_value": float(action.get("new_wig_from_value") or 0),
            "to_value": float(action.get("new_wig_to_value") or 100),
            "unit": action.get("new_wig_unit") or "%",
            "deadline": action.get("new_wig_deadline") or default_deadline,
            "owner": action.get("new_wig_owner") or action.get("owner") or project.get("owner") or "Unassigned",
            "update_frequency": action.get("new_wig_update_frequency") or "weekly",
            "priority": int(action.get("new_wig_priority") or project.get("priority", 5)),
            "budget_allocated": float(action.get("new_wig_budget_allocated") or 0),
            "confidence": action.get("confidence", 0.5),
            "selected": True,
        })
    return extras


def _inline_measures_from_actions(payload: dict[str, Any], project: dict[str, Any]) -> list[dict[str, Any]]:
    existing_refs = {m.get("proposed_ref") for m in payload.get("proposed_measures", []) if m.get("proposed_ref")}
    extras: list[dict[str, Any]] = []
    default_deadline = _default_deadline(project)
    for index, action in enumerate(payload.get("proposed_actions", [])):
        if not action.get("selected", True) or not action.get("create_new_measure"):
            continue
        ref = action.get("proposed_measure_ref") or f"inline_measure_{index}"
        action["proposed_measure_ref"] = ref
        action["target_measure_id"] = None
        action["wig_only"] = False
        if ref in existing_refs:
            continue
        existing_refs.add(ref)
        assigned_raw = action.get("new_measure_assigned_to")
        if isinstance(assigned_raw, list):
            assigned_to = assigned_raw
        elif assigned_raw:
            assigned_to = [part.strip() for part in str(assigned_raw).split(",") if part.strip()]
        elif action.get("owner"):
            assigned_to = [action.get("owner")]
        else:
            assigned_to = [project.get("owner") or "Unassigned"]
        extras.append({
            "proposed_ref": ref,
            "wig_id": action.get("target_wig_id"),
            "proposed_wig_ref": action.get("proposed_wig_ref"),
            "title": action.get("new_measure_title") or action.get("assignment_title") or "Meeting lead measure",
            "current_state": action.get("new_measure_current_state") or "Raised in meeting",
            "target_state": action.get("new_measure_target_state") or "Completed",
            "from_value": float(action.get("new_measure_from_value") or 0),
            "to_value": float(action.get("new_measure_to_value") or 100),
            "unit": action.get("new_measure_unit") or "%",
            "deadline": action.get("new_measure_deadline") or action.get("due_date") or default_deadline,
            "assigned_to": assigned_to,
            "priority": int(action.get("new_measure_priority") or project.get("priority", 5)),
            "budget_allocated": float(action.get("new_measure_budget_allocated") or 0),
            "confidence": action.get("confidence", 0.5),
            "selected": True,
        })
    return extras


def apply_meeting_to_action(
    project: dict[str, Any],
    payload: dict[str, Any],
    user: dict[str, Any],
    *,
    db: Any,
    normalize_update_frequency: Callable[[str | None], str],
    validate_project_wig_budget: Callable[..., None],
    validate_wig_deadline: Callable[..., None],
    validate_wig_measure_budget: Callable[..., None],
    validate_measure_deadline: Callable[..., None],
    refresh_project_health: Callable[..., Any],
    log_audit: Callable[..., None],
    upsert_project_after_nested_change: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    project_oid = project["_id"]
    wig_ref_map: dict[str, str] = {}
    measure_ref_map: dict[str, str] = {}
    created_wigs = 0
    created_measures = 0
    comments_posted = 0
    assignments_created = 0

    payload = dict(payload)
    payload["proposed_wigs"] = list(payload.get("proposed_wigs") or []) + _inline_wigs_from_actions(payload, project)
    payload["proposed_measures"] = list(payload.get("proposed_measures") or []) + _inline_measures_from_actions(payload, project)

    def reload_project() -> dict[str, Any]:
        doc = db.projects.find_one({"_id": project_oid})
        return doc or project

    current = reload_project()

    for item in payload.get("proposed_wigs", []):
        if not item.get("selected", True):
            continue
        if item.get("match_existing_wig_id"):
            ref = item.get("proposed_ref")
            if ref:
                wig_ref_map[ref] = item["match_existing_wig_id"]
            continue
        wig = {
            "title": item["title"],
            "current_state": item.get("current_state") or "Identified in meeting",
            "target_state": item.get("target_state") or "Delivered",
            "from_value": float(item.get("from_value") or 0),
            "to_value": float(item.get("to_value") or 100),
            "unit": item.get("unit") or "%",
            "deadline": item.get("deadline") or _default_deadline(current),
            "owner": item.get("owner") or current.get("owner") or "Unassigned",
            "update_frequency": normalize_update_frequency(item.get("update_frequency") or "weekly"),
            "priority": int(item.get("priority") or current.get("priority", 5)),
            "budget_allocated": float(item.get("budget_allocated") or 0),
            "id": str(uuid.uuid4()),
            "lead_measures": [],
        }
        validate_project_wig_budget(current, additional=float(wig.get("budget_allocated") or 0))
        validate_wig_deadline(current, wig.get("deadline"))
        db.projects.update_one(
            {"_id": project_oid},
            {"$push": {"wigs": wig}, "$set": {"updated_by": user["phone"], "updated_at": datetime.utcnow()}},
        )
        created_wigs += 1
        ref = item.get("proposed_ref")
        if ref:
            wig_ref_map[ref] = wig["id"]
        log_audit("create", "wig", current, user, after=wig, metadata={"source": "meeting_to_action"})
        current = reload_project()

    for item in payload.get("proposed_measures", []):
        if not item.get("selected", True):
            continue
        if item.get("match_existing_measure_id"):
            ref = item.get("proposed_ref")
            if ref:
                measure_ref_map[ref] = item["match_existing_measure_id"]
            continue
        wig_id = item.get("wig_id")
        if not wig_id and item.get("proposed_wig_ref"):
            wig_id = wig_ref_map.get(item["proposed_wig_ref"])
        if not wig_id and current.get("wigs"):
            wig_id = active_wigs(current)[0].get("id") if active_wigs(current) else None
        if not wig_id:
            continue
        measure = {
            "title": item["title"],
            "current_state": item.get("current_state") or "Raised in meeting",
            "target_state": item.get("target_state") or "Completed",
            "from_value": float(item.get("from_value") or 0),
            "to_value": float(item.get("to_value") or 100),
            "unit": item.get("unit") or "%",
            "deadline": item.get("deadline") or _default_deadline(current),
            "assigned_to": item.get("assigned_to") or [current.get("owner") or "Unassigned"],
            "priority": int(item.get("priority") or current.get("priority", 5)),
            "budget_allocated": float(item.get("budget_allocated") or 0),
            "id": str(uuid.uuid4()),
            "current_value": float(item.get("from_value") or 0),
            "status": "Open",
            "comments": [],
            "progress_history": [],
        }
        parent_wig = next((w for w in current.get("wigs", []) if w.get("id") == wig_id), None)
        if not parent_wig:
            continue
        validate_wig_measure_budget(parent_wig, additional=float(measure.get("budget_allocated") or 0))
        validate_measure_deadline(current, parent_wig, measure.get("deadline"))
        db.projects.update_one(
            {"_id": project_oid, "wigs.id": wig_id},
            {"$push": {"wigs.$.lead_measures": measure}, "$set": {"updated_by": user["phone"], "updated_at": datetime.utcnow()}},
        )
        created_measures += 1
        ref = item.get("proposed_ref")
        if ref:
            measure_ref_map[ref] = measure["id"]
        log_audit("create", "lead_measure", current, user, after=measure, metadata={"wig_id": wig_id, "source": "meeting_to_action"})
        current = reload_project()

    current = reload_project()
    pending_assignments: list[dict[str, Any]] = []
    project_dirty = False

    for item in payload.get("proposed_actions", []):
        if not item.get("selected", True):
            continue

        wig_id = _resolve_wig_id(
            item.get("target_wig_id"),
            item.get("proposed_wig_ref"),
            wig_ref_map,
        )
        wig_only = bool(item.get("wig_only"))
        measure_id = None if wig_only else _resolve_measure_id(
            item.get("target_measure_id"),
            item.get("proposed_measure_ref"),
            measure_ref_map,
        )

        wig = next((w for w in current.get("wigs", []) if w.get("id") == wig_id), None) if wig_id else None
        if not wig and current.get("wigs"):
            wig = active_wigs(current)[0]
            wig_id = wig.get("id") if wig else None

        measure = None
        if measure_id and wig:
            measure = next(
                (m for m in wig.get("lead_measures", []) if m.get("id") == measure_id and not m.get("archived_at")),
                None,
            )
        if not measure and wig and not wig_only:
            measures = [m for m in wig.get("lead_measures", []) if not m.get("archived_at")]
            measure = measures[0] if measures else None
            measure_id = measure.get("id") if measure else None

        comment_text = (item.get("comment") or "").strip()
        if comment_text and measure_id and wig_id and not wig_only:
            comment = {
                "id": str(uuid.uuid4()),
                "comment": comment_text,
                "health_state": "green",
                "author": item.get("owner") or user.get("phone") or "Meeting notes",
                "created_by": user["phone"],
                "created_at": datetime.utcnow(),
            }
            for w in current.get("wigs", []):
                if w.get("id") != wig_id:
                    continue
                for m in w.get("lead_measures", []):
                    if m.get("id") == measure_id:
                        m.setdefault("comments", []).append(comment)
                        project_dirty = True
                        comments_posted += 1
                        break

        if item.get("create_assignment") and (item.get("owner") or item.get("due_date")):
            title = item.get("assignment_title") or comment_text[:140] or "Meeting action item"
            pending_assignments.append({
                "project_id": project_oid,
                "ministry_id": current.get("ministry_id"),
                "title": title,
                "owner": item.get("owner") or current.get("owner") or "Unassigned",
                "role": "Project Director",
                "due_date": item.get("due_date") or _default_deadline(current),
                "priority": "High",
                "discipline": "Cadence",
                "decision_needed": comment_text[:500] if comment_text else None,
                "status": "Open",
                "created_by": user["phone"],
                "created_at": datetime.utcnow(),
            })

    if project_dirty:
        db.projects.update_one(
            {"_id": project_oid},
            {"$set": {"wigs": current.get("wigs", []), "updated_by": user["phone"], "updated_at": datetime.utcnow()}},
        )

    if pending_assignments:
        db.assignments.insert_many(pending_assignments)
        assignments_created = len(pending_assignments)

    refreshed = refresh_project_health(project_oid, vectorize=False)
    return {
        "project": refreshed,
        "created_wigs": created_wigs,
        "created_measures": created_measures,
        "comments_posted": comments_posted,
        "assignments_created": assignments_created,
    }


def apply_ministry_meeting_to_action(
    ministry_id: str,
    payload: dict[str, Any],
    user: dict[str, Any],
    *,
    db: Any,
    find_project: Callable[[str], dict[str, Any] | None],
    normalize_update_frequency: Callable[[str | None], str],
    validate_project_wig_budget: Callable[..., None],
    validate_wig_deadline: Callable[..., None],
    validate_wig_measure_budget: Callable[..., None],
    validate_measure_deadline: Callable[..., None],
    refresh_project_health: Callable[..., Any],
    log_audit: Callable[..., None],
) -> dict[str, Any]:
    """Apply MTA preview items grouped by per-item project_id within a ministry."""
    groups: dict[str, dict[str, list[dict[str, Any]]]] = {}

    def bucket(project_id: str | None) -> dict[str, list[dict[str, Any]]]:
        pid = (project_id or "").strip()
        if not pid:
            raise ValueError("Each selected item must have a target project")
        if pid not in groups:
            groups[pid] = {"proposed_wigs": [], "proposed_measures": [], "proposed_actions": []}
        return groups[pid]

    for key in ("proposed_wigs", "proposed_measures", "proposed_actions"):
        for item in payload.get(key) or []:
            if not item.get("selected", True):
                continue
            bucket(item.get("project_id"))[key].append(item)

    if not groups:
        raise ValueError("No selected items to apply")

    totals = {
        "created_wigs": 0,
        "created_measures": 0,
        "comments_posted": 0,
        "assignments_created": 0,
        "projects_updated": 0,
    }
    last_project: dict[str, Any] | None = None

    for project_id, group_payload in groups.items():
        project = find_project(project_id)
        if not project:
            raise ValueError(f"Project not found: {project_id}")
        if str(project.get("ministry_id")) != ministry_id:
            raise ValueError(f"Project {project_id} does not belong to selected ministry")
        project = refresh_project_health(project["_id"], vectorize=False)
        result = apply_meeting_to_action(
            project,
            group_payload,
            user,
            db=db,
            normalize_update_frequency=normalize_update_frequency,
            validate_project_wig_budget=validate_project_wig_budget,
            validate_wig_deadline=validate_wig_deadline,
            validate_wig_measure_budget=validate_wig_measure_budget,
            validate_measure_deadline=validate_measure_deadline,
            refresh_project_health=refresh_project_health,
            log_audit=log_audit,
        )
        totals["created_wigs"] += result["created_wigs"]
        totals["created_measures"] += result["created_measures"]
        totals["comments_posted"] += result["comments_posted"]
        totals["assignments_created"] += result["assignments_created"]
        totals["projects_updated"] += 1
        last_project = result["project"]

    return {**totals, "project": last_project}


def active_wigs(project: dict[str, Any]) -> list[dict[str, Any]]:
    return [wig for wig in project.get("wigs", []) if not wig.get("archived_at")]
