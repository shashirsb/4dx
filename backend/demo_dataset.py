"""Bundled demo dataset builder and loader for dev-mode reseed."""

from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from bson import ObjectId

DEMO_VERSION = "demo_story_v1"

DATA_COLLECTIONS = [
    "ministries",
    "projects",
    "documents",
    "vectors",
    "assignments",
    "decisions",
    "approvals",
    "notifications",
    "weekly_meetings",
    "health_snapshots",
    "ai_insights",
    "ai_decision_briefs",
]

ALLOWED_COLLECTIONS = {
    "users",
    "sessions",
    "otp_requests",
    *DATA_COLLECTIONS,
    "settings",
    "audit_events",
}


def _iso(dt: datetime | date) -> str:
    if isinstance(dt, datetime):
        return dt.isoformat()
    return dt.isoformat()


def _days_ago(n: int) -> datetime:
    return datetime.utcnow() - timedelta(days=n)


def build_karnataka_demo_dataset() -> dict[str, Any]:
    today = datetime.utcnow().date()
    week_ago = (today - timedelta(days=7)).isoformat()
    soon = (today + timedelta(days=14)).isoformat()
    month = (today + timedelta(days=31)).isoformat()
    quarter = (today + timedelta(days=92)).isoformat()
    year_end = (today + timedelta(days=180)).isoformat()
    overdue = (today - timedelta(days=6)).isoformat()

    approval_blocker = (
        "Approval pending with Finance and district land cell. "
        "Escalation required before next weekly review."
    )

    return {
        "version": "karnataka_4dx_demo_v2",
        "ministries": [
            {"name": "Water Resources", "minister": "Minister for Water Resources", "mandate": "Drinking water, irrigation, reservoir safety and inter-district water delivery"},
            {"name": "Public Works", "minister": "Minister for Public Works", "mandate": "Roads, bridges, highways and public infrastructure execution"},
            {"name": "Urban Development", "minister": "Minister for Urban Development", "mandate": "Metro, municipal infrastructure, urban mobility and city services"},
            {"name": "Education", "minister": "Minister for School Education", "mandate": "Government schools, digital learning, classrooms and learning outcomes"},
            {"name": "Health & Family Welfare", "minister": "Minister for Health & Family Welfare", "mandate": "Hospitals, public health facilities, emergency care and diagnostics"},
        ],
        "projects": [
            {
                "name": "Belagavi Water Supply",
                "ministry": "Water Resources",
                "owner": "Ramesh H.",
                "current_state": "22% water supply coverage in priority Belagavi wards",
                "target_state": "24x7 water supply coverage for priority wards by November",
                "phase": "Approvals",
                "wig": "Deliver 24x7 drinking water service to priority wards",
                "due_date": (today + timedelta(days=123)).isoformat(),
                "budget_crore": 860,
                "spent_crore": 210,
                "priority": 9,
                "kpis": {"schedule": 33, "budget": 48, "quality": 68, "citizen_impact": 52, "cadence": 35, "lead_measures": 25, "document_confidence": 44, "compliance": 38},
                "wigs": [
                    {
                        "id": "wig-bws-1",
                        "title": "Deliver 24x7 drinking water service to priority wards",
                        "current_state": "Water supply at 22% coverage; land handover pending in 3 wards",
                        "target_state": "100% coverage in 18 priority wards",
                        "from_value": 20,
                        "to_value": 100,
                        "unit": "% coverage",
                        "current_value": 22,
                        "deadline": (today + timedelta(days=85)).isoformat(),
                        "owner": "Water Resources Mission Director",
                        "update_frequency": "weekly",
                        "budget_allocated": 520,
                        "priority": 9,
                        "lead_measures": [
                            {
                                "id": "lm-bws-1",
                                "title": "Close approval and dependency actions",
                                "current_state": "4 of 11 approval actions closed",
                                "target_state": "11 of 11 approval actions closed",
                                "from_value": 4,
                                "to_value": 11,
                                "unit": "actions",
                                "current_value": 4,
                                "deadline": soon,
                                "assigned_to": ["District Nodal Officer", "Finance Representative"],
                                "budget_allocated": 110,
                                "priority": 9,
                                "status": "Open",
                                "comments": [{"comment": approval_blocker, "health_state": "blocker", "author": "Review Cell", "created_at": _iso(_days_ago(2))}],
                            },
                            {
                                "id": "lm-bws-2",
                                "title": "Verify weekly pipeline laying progress",
                                "current_state": "8 km verified out of 42 km",
                                "target_state": "42 km verified and certified",
                                "from_value": 8,
                                "to_value": 42,
                                "unit": "km",
                                "current_value": 8,
                                "deadline": month,
                                "assigned_to": ["Executive Engineer", "Third Party Quality Cell"],
                                "budget_allocated": 190,
                                "priority": 8,
                                "status": "Open",
                                "comments": [{"comment": "Contractor mobilisation remains slow in two packages.", "health_state": "red", "author": "Executive Engineer", "created_at": _iso(_days_ago(5))}],
                            },
                        ],
                    },
                    {
                        "id": "wig-bws-2",
                        "title": "Strengthen weekly scoreboard discipline",
                        "current_state": "45% weekly commitments closed before review",
                        "target_state": "90% weekly commitments closed before Friday review",
                        "from_value": 45,
                        "to_value": 90,
                        "unit": "% commitments",
                        "current_value": 45,
                        "deadline": quarter,
                        "owner": "4DX Coach",
                        "update_frequency": "weekly",
                        "budget_allocated": 60,
                        "priority": 6,
                        "lead_measures": [
                            {
                                "id": "lm-bws-3",
                                "title": "Publish ward-wise scoreboard every Friday",
                                "current_state": "3 of 8 Friday scoreboards published on time",
                                "target_state": "8 of 8 Friday scoreboards published on time",
                                "from_value": 3,
                                "to_value": 8,
                                "unit": "scoreboards",
                                "current_value": 3,
                                "deadline": quarter,
                                "assigned_to": ["PMU Analyst"],
                                "budget_allocated": 20,
                                "priority": 6,
                                "status": "Open",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Mysore Ring Road",
                "ministry": "Public Works",
                "owner": "Suresh M.",
                "current_state": "28% package physical progress; statutory approvals delayed",
                "target_state": "Open eastern ring-road package for traffic",
                "phase": "Construction",
                "wig": "Open the eastern ring-road package for traffic by December",
                "due_date": (today + timedelta(days=96)).isoformat(),
                "budget_crore": 1240,
                "spent_crore": 360,
                "priority": 9,
                "kpis": {"schedule": 50, "budget": 55, "quality": 72, "citizen_impact": 40, "cadence": 30, "lead_measures": 33, "document_confidence": 58, "compliance": 25},
                "wigs": [
                    {
                        "id": "wig-mrr-1",
                        "title": "Open the eastern ring-road package for traffic by December",
                        "current_state": "Package-1 physical progress at 28%; 2 land parcels unresolved",
                        "target_state": "Eastern ring road open for controlled traffic",
                        "from_value": 26,
                        "to_value": 100,
                        "unit": "% completion",
                        "current_value": 28,
                        "deadline": (today + timedelta(days=90)).isoformat(),
                        "owner": "Public Works Mission Director",
                        "update_frequency": "weekly",
                        "budget_allocated": 780,
                        "priority": 9,
                        "lead_measures": [
                            {
                                "id": "lm-mrr-1",
                                "title": "Move clearance files from 2 to 9 authorities",
                                "current_state": "2 of 9 authorities cleared",
                                "target_state": "9 of 9 authorities cleared",
                                "from_value": 2,
                                "to_value": 9,
                                "unit": "authorities",
                                "current_value": 2,
                                "deadline": overdue,
                                "assigned_to": ["Clearance Cell"],
                                "budget_allocated": 70,
                                "priority": 10,
                                "status": "Open",
                                "comments": [{"comment": "Environmental clearance is on critical path for downstream approvals.", "health_state": "blocker", "author": "Clearance Cell", "created_at": _iso(_days_ago(1))}],
                            },
                            {
                                "id": "lm-mrr-2",
                                "title": "Complete land handover for pending parcels",
                                "current_state": "16 of 24 parcels handed over",
                                "target_state": "24 of 24 parcels handed over",
                                "from_value": 16,
                                "to_value": 24,
                                "unit": "parcels",
                                "current_value": 16,
                                "deadline": month,
                                "assigned_to": ["Land Acquisition Officer", "Deputy Commissioner Office"],
                                "budget_allocated": 220,
                                "priority": 9,
                                "status": "Open",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Bangalore Metro Phase 2",
                "ministry": "Urban Development",
                "owner": "Vikram S.",
                "current_state": "51% overall civil work progress across priority reaches",
                "target_state": "Priority stretches operational with safety certification",
                "phase": "Civil Works",
                "wig": "Commission priority metro stretches",
                "due_date": (today + timedelta(days=171)).isoformat(),
                "budget_crore": 9500,
                "spent_crore": 5600,
                "priority": 8,
                "kpis": {"schedule": 75, "budget": 60, "quality": 78, "citizen_impact": 45, "cadence": 60, "lead_measures": 50, "document_confidence": 66, "compliance": 55},
                "wigs": [
                    {
                        "id": "wig-bmp2-1",
                        "title": "Commission priority metro stretches",
                        "current_state": "Civil work at 51%; utility shifting pending at 5 locations",
                        "target_state": "Priority stretches certified for operations",
                        "from_value": 51,
                        "to_value": 100,
                        "unit": "% civil work",
                        "current_value": 51,
                        "deadline": year_end,
                        "owner": "Urban Development Mission Director",
                        "update_frequency": "weekly",
                        "budget_allocated": 6200,
                        "priority": 8,
                        "lead_measures": [
                            {
                                "id": "lm-bmp2-1",
                                "title": "Close utility shifting at critical locations",
                                "current_state": "7 of 12 locations shifted",
                                "target_state": "12 of 12 locations shifted",
                                "from_value": 7,
                                "to_value": 12,
                                "unit": "locations",
                                "current_value": 7,
                                "deadline": month,
                                "assigned_to": ["Utility Coordination Cell", "BBMP Liaison"],
                                "budget_allocated": 430,
                                "priority": 8,
                                "status": "Open",
                                "comments": [{"comment": "Utility shifting and night work permissions need joint review.", "health_state": "amber", "author": "Metro PMU", "created_at": _iso(_days_ago(3))}],
                            },
                            {
                                "id": "lm-bmp2-2",
                                "title": "Complete safety documentation packages",
                                "current_state": "4 of 10 packages ready",
                                "target_state": "10 of 10 packages submitted for review",
                                "from_value": 4,
                                "to_value": 10,
                                "unit": "packages",
                                "current_value": 4,
                                "deadline": quarter,
                                "assigned_to": ["Safety Certification Lead"],
                                "budget_allocated": 55,
                                "priority": 7,
                                "status": "Open",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Digital Learning Mission",
                "ministry": "Education",
                "owner": "Meena R.",
                "current_state": "66% schools onboarded to digital learning platform",
                "target_state": "All government schools digital learning enabled",
                "phase": "Rollout",
                "wig": "Enable digital learning across government schools",
                "due_date": (today + timedelta(days=226)).isoformat(),
                "budget_crore": 720,
                "spent_crore": 390,
                "priority": 7,
                "kpis": {"schedule": 80, "budget": 72, "quality": 76, "citizen_impact": 70, "cadence": 70, "lead_measures": 70, "document_confidence": 80, "compliance": 72},
                "wigs": [
                    {
                        "id": "wig-dlm-1",
                        "title": "Deploy tablets, content, and teacher training for grades 8-12",
                        "current_state": "41% completion; 1,850 schools onboarded",
                        "target_state": "100% completion; 4,500 schools onboarded",
                        "from_value": 41,
                        "to_value": 100,
                        "unit": "% completion",
                        "current_value": 66,
                        "deadline": (today + timedelta(days=180)).isoformat(),
                        "owner": "Education Mission Director",
                        "update_frequency": "weekly",
                        "budget_allocated": 460,
                        "priority": 7,
                        "lead_measures": [
                            {
                                "id": "lm-dlm-1",
                                "title": "Enable 300000 children on database",
                                "current_state": "198000 children enabled on learning database",
                                "target_state": "300000 children enabled on learning database",
                                "from_value": 0,
                                "to_value": 300000,
                                "unit": "children",
                                "current_value": 198000,
                                "deadline": quarter,
                                "assigned_to": ["SATS Data Team", "District Education Officers"],
                                "budget_allocated": 80,
                                "priority": 7,
                                "status": "Open",
                                "comments": [{"comment": "Evidence upload overdue from 6 districts.", "health_state": "amber", "author": "Education PMU", "created_at": _iso(_days_ago(4))}],
                            },
                            {
                                "id": "lm-dlm-2",
                                "title": "Kick off training with all Department heads",
                                "current_state": "12 of 34 districts completed kickoff",
                                "target_state": "34 of 34 districts completed kickoff",
                                "from_value": 12,
                                "to_value": 34,
                                "unit": "districts",
                                "current_value": 12,
                                "deadline": month,
                                "assigned_to": ["Teacher Training Cell"],
                                "budget_allocated": 60,
                                "priority": 6,
                                "status": "Open",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "School Infrastructure Renewal",
                "ministry": "Education",
                "owner": "Meena R.",
                "current_state": "77% facilities under renovation",
                "target_state": "2,500 government schools renewed",
                "phase": "Execution",
                "wig": "Repair and digitize 2,500 government school facilities",
                "due_date": (today + timedelta(days=149)).isoformat(),
                "budget_crore": 1180,
                "spent_crore": 780,
                "priority": 6,
                "kpis": {"schedule": 90, "budget": 82, "quality": 84, "citizen_impact": 80, "cadence": 85, "lead_measures": 80, "document_confidence": 90, "compliance": 86},
                "wigs": [
                    {
                        "id": "wig-sir-1",
                        "title": "Repair and digitize 2,500 government school facilities",
                        "current_state": "1,925 school facilities renewed",
                        "target_state": "2,500 school facilities renewed",
                        "from_value": 0,
                        "to_value": 2500,
                        "unit": "schools",
                        "current_value": 1925,
                        "deadline": year_end,
                        "owner": "School Infrastructure Cell",
                        "update_frequency": "weekly",
                        "budget_allocated": 840,
                        "priority": 6,
                        "lead_measures": [
                            {
                                "id": "lm-sir-1",
                                "title": "Move weekly verified progress",
                                "current_state": "54% verified school repair progress",
                                "target_state": "92% verified school repair progress",
                                "from_value": 54,
                                "to_value": 92,
                                "unit": "% verified",
                                "current_value": 77,
                                "deadline": quarter,
                                "assigned_to": ["Project Director", "District Nodal Officer"],
                                "budget_allocated": 120,
                                "priority": 6,
                                "status": "Open",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "District Hospital ICU Upgrade",
                "ministry": "Health & Family Welfare",
                "owner": "Dr. Kavita N.",
                "current_state": "44% ICU upgrade complete across selected district hospitals",
                "target_state": "ICU capacity upgraded in all selected hospitals",
                "phase": "Procurement",
                "wig": "Complete ICU and oxygen system commissioning",
                "due_date": (today + timedelta(days=148)).isoformat(),
                "budget_crore": 640,
                "spent_crore": 280,
                "priority": 7,
                "kpis": {"schedule": 60, "budget": 48, "quality": 70, "citizen_impact": 55, "cadence": 50, "lead_measures": 45, "document_confidence": 62, "compliance": 40},
                "wigs": [
                    {
                        "id": "wig-dhi-1",
                        "title": "Complete ICU and oxygen system commissioning",
                        "current_state": "8 of 18 hospitals commissioned",
                        "target_state": "18 of 18 hospitals commissioned",
                        "from_value": 8,
                        "to_value": 18,
                        "unit": "hospitals",
                        "current_value": 8,
                        "deadline": quarter,
                        "owner": "Health Mission Director",
                        "update_frequency": "weekly",
                        "budget_allocated": 410,
                        "priority": 7,
                        "lead_measures": [
                            {
                                "id": "lm-dhi-1",
                                "title": "Install oxygen manifold and ventilator banks",
                                "current_state": "96 of 220 oxygen points installed",
                                "target_state": "220 oxygen points installed and tested",
                                "from_value": 96,
                                "to_value": 220,
                                "unit": "oxygen points",
                                "current_value": 96,
                                "deadline": month,
                                "assigned_to": ["Biomedical Engineer", "District Surgeon"],
                                "budget_allocated": 170,
                                "priority": 7,
                                "status": "Open",
                                "comments": [{"comment": "Vendor mobilization delayed in two districts.", "health_state": "amber", "author": "Health PMU", "created_at": _iso(_days_ago(3))}],
                            },
                        ],
                    },
                ],
            },
        ],
        "documents": [
            {"project": "Belagavi Water Supply", "wig_id": "wig-bws-1", "measure_id": "lm-bws-1", "title": "Belagavi Approval Dependency Note", "document_type": "Approval Note", "content": "Finance concurrence and district land handover are blocking 24x7 water supply progress. Recommend CM office intervention for joint review with Water Resources, Finance and district administration."},
            {"project": "Mysore Ring Road", "wig_id": "wig-mrr-1", "measure_id": "lm-mrr-1", "title": "Mysore Ring Road Environmental Clearance Status", "document_type": "Statutory Approval", "content": "Environmental clearance from KSEA is on the critical path. Downstream contractor mobilisation and land possession will slip unless approval is expedited within the next review cycle."},
            {"project": "Bangalore Metro Phase 2", "wig_id": "wig-bmp2-1", "measure_id": "lm-bmp2-1", "title": "Utility Shifting Joint Inspection Report", "document_type": "Inspection Report", "content": "Utility shifting remains pending at five high-impact locations. BBMP, BESCOM and BWSSB coordination meeting requested to clear night work and traffic permissions."},
            {"project": "Digital Learning Mission", "wig_id": "wig-dlm-1", "measure_id": "lm-dlm-1", "title": "Student Database Enablement Evidence", "document_type": "Progress Note", "content": "198000 children enabled in the learning database. Six districts have not uploaded validation evidence. Data team recommends district-level follow-up before next CM dashboard."},
            {"project": "School Infrastructure Renewal", "wig_id": "wig-sir-1", "measure_id": "lm-sir-1", "title": "School Repair Verification Summary", "document_type": "Field Report", "content": "Third-party verification confirms strong progress in repair and digitisation. Remaining work is concentrated in remote clusters with procurement dependency for smart classroom kits."},
            {"project": "District Hospital ICU Upgrade", "wig_id": "wig-dhi-1", "measure_id": "lm-dhi-1", "title": "ICU Oxygen System Procurement Status", "document_type": "Procurement Note", "content": "Oxygen manifold installation is delayed in two districts due to vendor mobilisation and site readiness. Biomedical validation SOP is ready for commissioned sites."},
        ],
        "assignments": [
            {"project": "Belagavi Water Supply", "title": "Resolve finance and land handover blocker", "owner": "Water Resources Mission Director", "role": "Mission Director", "due_date": (today + timedelta(days=3)).isoformat(), "status": "Open", "priority": "Critical", "discipline": "Lead Measures", "decision_needed": "Finance concurrence and district land cell closure"},
            {"project": "Mysore Ring Road", "title": "Escalate environmental clearance for eastern package", "owner": "Suresh M.", "role": "Mission Director", "due_date": (today + timedelta(days=2)).isoformat(), "status": "In Progress", "priority": "Critical", "discipline": "Approvals", "decision_needed": "KSEA clearance hearing date"},
            {"project": "Bangalore Metro Phase 2", "title": "Run joint utility shifting review", "owner": "Vikram S.", "role": "Mission Director", "due_date": (today + timedelta(days=7)).isoformat(), "status": "Open", "priority": "High", "discipline": "Cadence"},
            {"project": "Digital Learning Mission", "title": "Collect missing district evidence uploads", "owner": "Education PMU", "role": "PMU Lead", "due_date": (today + timedelta(days=5)).isoformat(), "status": "Open", "priority": "High", "discipline": "Evidence"},
        ],
        "decisions": [
            {"project": "Belagavi Water Supply", "title": "Place Belagavi approvals on CM daily intervention watch", "decision_type": "Intervention", "requested_by": "Water Resources Mission Director", "due_date": (today + timedelta(days=2)).isoformat(), "summary": "Approval blocker is delaying priority drinking water service. Recommend CM office intervention until finance and land handover actions are closed.", "status": "Pending"},
            {"project": "Mysore Ring Road", "title": "Expedite KSEA environmental clearance hearing", "decision_type": "Approval", "requested_by": "Public Works Mission Director", "due_date": (today + timedelta(days=3)).isoformat(), "summary": "Eastern ring-road opening depends on environmental clearance. Recommend empowered review this week.", "status": "Pending"},
            {"project": "Bangalore Metro Phase 2", "title": "Authorize joint night-work utility shifting protocol", "decision_type": "Policy", "requested_by": "Urban Development Mission Director", "due_date": (today + timedelta(days=8)).isoformat(), "summary": "Metro priority stretches need coordinated utility shifting permissions across agencies.", "status": "Pending"},
        ],
        "approvals": [
            {"project": "Belagavi Water Supply", "wig_id": "wig-bws-1", "measure_id": "lm-bws-1", "title": "Finance concurrence for water package", "requested_by": "Water Resources Mission Director", "summary": "Approve finance concurrence for package release and district land handover dependency closure.", "due_date": soon, "status": "Pending"},
            {"project": "Mysore Ring Road", "wig_id": "wig-mrr-1", "measure_id": "lm-mrr-1", "title": "KSEA environmental clearance", "requested_by": "Clearance Cell", "summary": "Approve environmental clearance hearing for eastern ring-road package.", "due_date": (today + timedelta(days=4)).isoformat(), "status": "Pending"},
            {"project": "Bangalore Metro Phase 2", "wig_id": "wig-bmp2-1", "measure_id": "lm-bmp2-1", "title": "Night work and traffic diversion approval", "requested_by": "Metro PMU", "summary": "Permit night work for utility shifting at priority locations.", "due_date": (today + timedelta(days=9)).isoformat(), "status": "Pending"},
        ],
        "notifications": [
            {"project": "Belagavi Water Supply", "title": "Approval blocker", "message": "Finance concurrence and land handover pending for priority wards.", "severity": "critical", "status": "Open", "due_date": soon},
            {"project": "Mysore Ring Road", "title": "Overdue clearance lead measure", "message": "Clearance files from 2 to 9 authorities is overdue.", "severity": "critical", "status": "Open", "due_date": overdue},
            {"project": "Digital Learning Mission", "title": "Evidence upload overdue", "message": "Six districts have not uploaded student database validation evidence.", "severity": "warning", "status": "Open", "due_date": soon},
        ],
        "weekly_meetings": [
            {"project": "Belagavi Water Supply", "meeting_date": week_ago, "facilitator": "Water Resources Mission Director", "notes": "Reviewed ward supply, finance concurrence and land handover blockers. Commitments captured for next Friday.", "commitments": ["Finance Representative: close concurrence note", "District Nodal Officer: verify handover documents"]},
            {"project": "Mysore Ring Road", "meeting_date": (today - timedelta(days=5)).isoformat(), "facilitator": "Public Works Mission Director", "notes": "Environmental clearance and land possession remain top risks. Escalation route agreed.", "commitments": ["Clearance Cell: secure KSEA hearing date", "Land Officer: close 2 pending parcels"]},
            {"project": "Bangalore Metro Phase 2", "meeting_date": (today - timedelta(days=4)).isoformat(), "facilitator": "Urban Development Mission Director", "notes": "Utility shifting locations reviewed with agencies. Night-work approval required.", "commitments": ["BBMP Liaison: traffic diversion plan", "Utility Cell: agency-wise work calendar"]},
        ],
        "health_snapshots": [
            {"date": (today - timedelta(days=28)).isoformat(), "health_score": 58},
            {"date": (today - timedelta(days=21)).isoformat(), "health_score": 60},
            {"date": (today - timedelta(days=14)).isoformat(), "health_score": 61},
            {"date": (today - timedelta(days=7)).isoformat(), "health_score": 63},
            {"date": today.isoformat(), "health_score": 64},
        ],
    }


def build_demo_dataset() -> dict[str, Any]:
    return build_karnataka_demo_dataset()
    today = datetime.utcnow().date()
    past = (today - timedelta(days=14)).isoformat()
    soon = (today + timedelta(days=21)).isoformat()
    project_due = (today + timedelta(days=120)).isoformat()
    overdue = (today - timedelta(days=9)).isoformat()

    multiline_comment = (
        "Field verification summary:\n\n"
        "- Ward 12 pipeline laying complete\n"
        "- Ward 7 awaiting utility clearance\n"
        "- Contractor mobilisation delayed 5 days\n\n"
        "Next: escalate with municipal commissioner."
    )

    return {
        "version": DEMO_VERSION,
        "ministries": [
            {"name": "Urban Development", "minister": "Minister Chen Wei", "mandate": "City infrastructure and smart services"},
            {"name": "Water Resources", "minister": "Minister Ananya Rao", "mandate": "Drinking water and irrigation delivery"},
            {"name": "Public Works", "minister": "Minister James Okonkwo", "mandate": "Roads, bridges, and transport corridors"},
            {"name": "Health", "minister": "Minister Sofia Lindström", "mandate": "Hospital upgrades and emergency response"},
        ],
        "projects": [
            {
                "name": "Marina Bay Resilience Programme",
                "ministry": "Urban Development",
                "owner": "Ms. Priya Menon",
                "current_state": "62% integrated command rollout; flood sensors live in 4 districts",
                "target_state": "City-wide resilience command by Q4 with 95% sensor uptime",
                "phase": "Rollout",
                "wig": "Deploy integrated civic command centres",
                "due_date": project_due,
                "budget_crore": 420,
                "spent_crore": 198,
                "priority": 8,
                "kpis": {"schedule": 72, "budget": 78, "quality": 81, "citizen_impact": 85, "cadence": 80, "lead_measures": 76, "document_confidence": 70, "compliance": 82},
                "wigs": [
                    {
                        "id": "wig-mbr-1",
                        "title": "Deploy integrated civic command centres",
                        "current_state": "4 of 8 cities live",
                        "target_state": "8 cities operational with unified dashboard",
                        "from_value": 0, "to_value": 8, "unit": "cities", "current_value": 4,
                        "deadline": soon, "owner": "Ms. Priya Menon",
                        "update_frequency": "weekly", "budget_allocated": 240, "priority": 8,
                        "lead_measures": [
                            {
                                "id": "lm-mbr-1",
                                "title": "Commission sensor mesh in priority wards",
                                "current_state": "312 sensors installed",
                                "target_state": "600 sensors with live telemetry",
                                "from_value": 0, "to_value": 600, "unit": "sensors", "current_value": 312,
                                "deadline": soon, "assigned_to": ["IoT Lead", "District Engineer"],
                                "budget_allocated": 95, "priority": 7, "status": "Open",
                                "comments": [{"comment": multiline_comment, "health_state": "amber", "author": "IoT Lead", "created_at": _iso(_days_ago(2))}],
                                "progress_history": [{"current_value": 312, "note": "Batch 4 deployed", "health_state": "amber", "author": "IoT Lead", "created_at": _iso(_days_ago(2))}],
                            },
                            {
                                "id": "lm-mbr-2",
                                "title": "Train ward operators on escalation protocol",
                                "current_state": "18 operators certified",
                                "target_state": "40 operators certified",
                                "from_value": 0, "to_value": 40, "unit": "operators", "current_value": 18,
                                "deadline": overdue, "assigned_to": ["Training PMU"],
                                "budget_allocated": 35, "priority": 6, "status": "Open",
                                "comments": [{"comment": "Training backlog in eastern cluster.\nSchedule makeup sessions next week.", "health_state": "red", "author": "PMU Coach", "created_at": _iso(_days_ago(16))}],
                            },
                        ],
                    },
                    {
                        "id": "wig-mbr-2",
                        "title": "Strengthen weekly cadence discipline",
                        "current_state": "71% commitments closed",
                        "target_state": "90% commitments closed each Friday",
                        "from_value": 50, "to_value": 90, "unit": "% closed", "current_value": 71,
                        "deadline": project_due, "owner": "4DX Coach Tan",
                        "update_frequency": "bi-weekly", "budget_allocated": 80, "priority": 5,
                        "lead_measures": [
                            {
                                "id": "lm-mbr-3",
                                "title": "Publish scoreboard before WIG session",
                                "from_value": 0, "to_value": 12, "unit": "sessions", "current_value": 7,
                                "deadline": project_due, "assigned_to": ["PMU Analyst"],
                                "budget_allocated": 20, "priority": 5, "status": "Open",
                                "current_state": "7 sessions published", "target_state": "12 sessions on time",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Northern Aqueduct Restoration",
                "ministry": "Water Resources",
                "owner": "Dr. Rahul Verma",
                "current_state": "48% pipeline rehabilitation; 2 clearances pending",
                "target_state": "24x7 supply to 1.2M residents by December",
                "phase": "Clearances",
                "wig": "Secure statutory approvals and complete Phase 1 pipeline",
                "due_date": (today + timedelta(days=95)).isoformat(),
                "budget_crore": 680,
                "spent_crore": 410,
                "priority": 9,
                "kpis": {"schedule": 48, "budget": 62, "quality": 70, "citizen_impact": 74, "cadence": 55, "lead_measures": 42, "document_confidence": 58, "compliance": 51},
                "wigs": [
                    {
                        "id": "wig-nar-1",
                        "title": "Secure statutory approvals and complete Phase 1 pipeline",
                        "from_value": 20, "to_value": 100, "unit": "% pipeline", "current_value": 48,
                        "deadline": overdue, "owner": "Dr. Rahul Verma",
                        "update_frequency": "daily", "budget_allocated": 400, "priority": 9,
                        "current_state": "48% Phase 1 complete", "target_state": "100% Phase 1 commissioned",
                        "lead_measures": [
                            {
                                "id": "lm-nar-1",
                                "title": "Move clearance files from 2 to 9 authorities",
                                "from_value": 2, "to_value": 9, "unit": "authorities", "current_value": 4,
                                "deadline": overdue, "assigned_to": ["Officer A", "Officer B"],
                                "budget_allocated": 120, "priority": 9, "status": "Open",
                                "current_state": "4 authorities cleared", "target_state": "9 authorities cleared",
                                "comments": [{"comment": "Forest clearance blocked.\nLegal review scheduled Thursday.", "health_state": "blocker", "author": "Officer A", "created_at": _iso(_days_ago(3))}],
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Trans-European Corridor Upgrade",
                "ministry": "Public Works",
                "owner": "Elena Müller",
                "current_state": "71% earthworks complete on Package B",
                "target_state": "420 km upgraded corridor open to traffic",
                "phase": "Construction",
                "wig": "Complete Package B earthworks and bridge deck",
                "due_date": (today + timedelta(days=140)).isoformat(),
                "budget_crore": 1240,
                "spent_crore": 720,
                "priority": 7,
                "kpis": {"schedule": 71, "budget": 74, "quality": 79, "citizen_impact": 68, "cadence": 77, "lead_measures": 73, "document_confidence": 65, "compliance": 70},
                "wigs": [
                    {
                        "id": "wig-tec-1",
                        "title": "Complete Package B earthworks and bridge deck",
                        "from_value": 55, "to_value": 100, "unit": "% complete", "current_value": 71,
                        "deadline": (today + timedelta(days=60)).isoformat(), "owner": "Elena Müller",
                        "update_frequency": "weekly", "budget_allocated": 720, "priority": 7,
                        "current_state": "71% earthworks", "target_state": "100% Package B ready",
                        "lead_measures": [
                            {
                                "id": "lm-tec-1",
                                "title": "Weekly verified progress submissions",
                                "from_value": 0, "to_value": 20, "unit": "reports", "current_value": 14,
                                "deadline": (today + timedelta(days=45)).isoformat(),
                                "assigned_to": ["Site Engineer", "QA Lead"],
                                "budget_allocated": 45, "priority": 6, "status": "Open",
                                "current_state": "14 reports filed", "target_state": "20 verified reports",
                            },
                        ],
                    },
                ],
            },
            {
                "name": "Regional Hospital Modernisation",
                "ministry": "Health",
                "owner": "Dr. Sofia Lindström",
                "current_state": "9 of 12 hospitals upgraded; ICU equipment installed",
                "target_state": "12 hospitals with full ICU and diagnostics capacity",
                "phase": "Procurement",
                "wig": "Complete ICU commissioning across remaining sites",
                "due_date": (today + timedelta(days=85)).isoformat(),
                "budget_crore": 310,
                "spent_crore": 245,
                "priority": 6,
                "kpis": {"schedule": 82, "budget": 88, "quality": 86, "citizen_impact": 90, "cadence": 84, "lead_measures": 80, "document_confidence": 72, "compliance": 85},
                "wigs": [
                    {
                        "id": "wig-rhm-1",
                        "title": "Complete ICU commissioning across remaining sites",
                        "from_value": 6, "to_value": 12, "unit": "hospitals", "current_value": 9,
                        "deadline": (today + timedelta(days=50)).isoformat(), "owner": "Dr. Sofia Lindström",
                        "update_frequency": "monthly", "budget_allocated": 180, "priority": 6,
                        "current_state": "9 hospitals commissioned", "target_state": "12 hospitals live",
                        "lead_measures": [
                            {
                                "id": "lm-rhm-1",
                                "title": "Install ventilator banks per site plan",
                                "from_value": 0, "to_value": 36, "unit": "units", "current_value": 28,
                                "deadline": (today + timedelta(days=40)).isoformat(),
                                "assigned_to": ["Biomedical Engineer"],
                                "budget_allocated": 60, "priority": 6, "status": "Open",
                                "current_state": "28 units installed", "target_state": "36 units operational",
                            },
                        ],
                    },
                ],
            },
        ],
        "documents": [
            {
                "project": "Marina Bay Resilience Programme",
                "wig_id": "wig-mbr-1",
                "measure_id": "lm-mbr-1",
                "title": "Sensor Deployment Field Report",
                "document_type": "Progress Note",
                "content": "Sensor mesh deployment progressing in Wards 12-15. Telemetry uptime at 94%. Minor firmware rollback required on batch 3 devices. Recommend weekly vendor sync.",
            },
            {
                "project": "Northern Aqueduct Restoration",
                "title": "Forest Clearance Legal Memo",
                "document_type": "Statutory Approval",
                "content": "Forest clearance application pending inter-state review. Legal counsel advises 21-day escalation path via empowered committee. Budget release contingent on clearance milestone.",
            },
            {
                "project": "Trans-European Corridor Upgrade",
                "title": "Bridge Deck Inspection Summary",
                "document_type": "Inspection Report",
                "content": "Package B bridge deck concrete strength tests pass specification. Minor rework needed on expansion joints. Contractor schedule recovery plan submitted.",
            },
            {
                "project": "Regional Hospital Modernisation",
                "title": "ICU Equipment Procurement Status",
                "document_type": "Procurement Note",
                "content": "Ventilator procurement orders issued for remaining 3 sites. Delivery expected within 6 weeks. Biomedical validation SOP updated.",
            },
        ],
        "assignments": [
            {"project": "Northern Aqueduct Restoration", "title": "Escalate forest clearance to empowered committee", "owner": "Dr. Rahul Verma", "role": "Mission Director", "due_date": (today + timedelta(days=5)).isoformat(), "status": "In Progress", "priority": "Critical", "discipline": "Lead Measures", "decision_needed": "Committee date confirmation required"},
            {"project": "Marina Bay Resilience Programme", "title": "Close overdue operator training backlog", "owner": "4DX Coach Tan", "role": "PMU Lead", "due_date": (today + timedelta(days=7)).isoformat(), "status": "Open", "priority": "High", "discipline": "Cadence"},
            {"project": "Trans-European Corridor Upgrade", "title": "Review bridge deck rework schedule", "owner": "Elena Müller", "role": "Project Director", "due_date": (today + timedelta(days=10)).isoformat(), "status": "In Progress", "priority": "Medium", "discipline": "Scoreboard"},
        ],
        "decisions": [
            {"project": "Northern Aqueduct Restoration", "title": "Approve emergency clearance escalation", "decision_type": "Intervention", "requested_by": "Dr. Rahul Verma", "due_date": (today + timedelta(days=3)).isoformat(), "summary": "Forest clearance delay threatens 24x7 supply target. Recommend empowered committee hearing.", "status": "Pending"},
            {"project": "Marina Bay Resilience Programme", "title": "Release contingency for sensor firmware fix", "decision_type": "Budget", "requested_by": "Ms. Priya Menon", "due_date": (today + timedelta(days=6)).isoformat(), "summary": "Batch 3 firmware rollback requires vendor sprint budget.", "status": "Pending"},
        ],
        "approvals": [
            {"project": "Northern Aqueduct Restoration", "wig_id": "wig-nar-1", "measure_id": "lm-nar-1", "title": "Forest clearance escalation approval", "requested_by": "Officer A", "summary": "Seek approval to escalate clearance via empowered committee.", "due_date": (today + timedelta(days=4)).isoformat(), "status": "Pending"},
            {"project": "Marina Bay Resilience Programme", "wig_id": "wig-mbr-1", "measure_id": "lm-mbr-2", "title": "Training vendor contract amendment", "requested_by": "PMU Coach Tan", "summary": "Additional training sessions for eastern cluster operators.", "due_date": (today + timedelta(days=8)).isoformat(), "status": "Pending"},
        ],
        "notifications": [
            {"project": "Northern Aqueduct Restoration", "title": "Overdue lead measure", "message": "Move clearance files from 2 to 9 is past deadline.", "severity": "critical", "status": "Open", "due_date": overdue},
            {"project": "Marina Bay Resilience Programme", "title": "Lead measure due soon", "message": "Train ward operators on escalation protocol due in 3 days.", "severity": "warning", "status": "Open", "due_date": soon},
        ],
        "weekly_meetings": [
            {"project": "Marina Bay Resilience Programme", "meeting_date": (today - timedelta(days=7)).isoformat(), "facilitator": "4DX Coach Tan", "notes": "Reviewed sensor rollout and training backlog. Commitments captured for Ward 7 clearance.", "commitments": ["IoT Lead: firmware patch by Friday", "PMU: schedule 2 makeup training sessions"]},
            {"project": "Northern Aqueduct Restoration", "meeting_date": (today - timedelta(days=5)).isoformat(), "facilitator": "Dr. Rahul Verma", "notes": "Clearance escalation path agreed. Legal memo attached as evidence.", "commitments": ["Officer A: file empowered committee request", "Finance: hold tranche 3 pending clearance"]},
        ],
        "health_snapshots": [
            {"date": (today - timedelta(days=14)).isoformat(), "health_score": 68},
            {"date": (today - timedelta(days=7)).isoformat(), "health_score": 71},
            {"date": today.isoformat(), "health_score": 73},
        ],
    }


def _parse_dt(value: Any) -> Any:
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+00:00", ""))
        except ValueError:
            return value
    return value


def _ensure_ids(entity: dict[str, Any], id_key: str = "id") -> None:
    if not entity.get(id_key):
        entity[id_key] = str(uuid.uuid4())


def _normalize_measure(measure: dict[str, Any]) -> None:
    _ensure_ids(measure)
    measure.setdefault("status", "Open")
    measure.setdefault("comments", [])
    measure.setdefault("progress_history", [])
    for comment in measure.get("comments", []):
        _ensure_ids(comment)
        comment["created_at"] = _parse_dt(comment.get("created_at")) or datetime.utcnow()
    for entry in measure.get("progress_history", []):
        _ensure_ids(entry)
        entry["created_at"] = _parse_dt(entry.get("created_at")) or datetime.utcnow()


def _normalize_wig(wig: dict[str, Any]) -> None:
    _ensure_ids(wig)
    wig.setdefault("lead_measures", [])
    for measure in wig.get("lead_measures", []):
        _normalize_measure(measure)


def load_demo_data(db: Any, data: dict[str, Any], insert_document_fn: Any, vectorize_all_fn: Any, refresh_health_fn: Any) -> dict[str, Any]:
    """Load demo JSON into MongoDB, preserving users and branding settings."""
    ministry_ids: dict[str, ObjectId] = {}
    project_ids: dict[str, ObjectId] = {}
    project_meta: dict[str, dict[str, Any]] = {}

    for name in DATA_COLLECTIONS:
        db[name].delete_many({})
    db.vectors.delete_many({})

    for ministry in data.get("ministries", []):
        doc = {**ministry, "created_at": datetime.utcnow()}
        result = db.ministries.insert_one(doc)
        ministry_ids[ministry["name"]] = result.inserted_id

    for project in data.get("projects", []):
        ministry_name = project["ministry"]
        ministry_id = ministry_ids[ministry_name]
        wigs = project.get("wigs", [])
        for wig in wigs:
            _normalize_wig(wig)
        doc = {
            k: v for k, v in project.items() if k not in {"ministry", "wigs"}
        }
        doc["ministry_id"] = ministry_id
        doc["ministry"] = ministry_name
        doc["wigs"] = wigs
        doc["created_at"] = datetime.utcnow()
        doc.setdefault("milestones", [])
        doc.setdefault("lead_measures", [])
        result = db.projects.insert_one(doc)
        project_ids[project["name"]] = result.inserted_id
        project_meta[project["name"]] = {"_id": result.inserted_id, "ministry_id": ministry_id}

    for item in data.get("documents", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        insert_document_fn(
            meta["_id"],
            meta["ministry_id"],
            item["title"],
            item.get("document_type", "Progress Note"),
            item["content"],
            "demo_seed",
            wig_id=item.get("wig_id"),
            measure_id=item.get("measure_id"),
        )

    for item in data.get("assignments", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        db.assignments.insert_one({
            **{k: v for k, v in item.items() if k != "project"},
            "project_id": meta["_id"],
            "ministry_id": meta["ministry_id"],
            "created_at": datetime.utcnow(),
        })

    for item in data.get("decisions", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        db.decisions.insert_one({
            **{k: v for k, v in item.items() if k != "project"},
            "project_id": meta["_id"],
            "ministry_id": meta["ministry_id"],
            "created_at": datetime.utcnow(),
        })

    for item in data.get("approvals", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        db.approvals.insert_one({
            **{k: v for k, v in item.items() if k != "project"},
            "project_id": meta["_id"],
            "created_at": datetime.utcnow(),
        })

    for item in data.get("notifications", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        db.notifications.insert_one({
            **{k: v for k, v in item.items() if k != "project"},
            "project_id": meta["_id"],
            "created_at": datetime.utcnow(),
        })

    for item in data.get("weekly_meetings", []):
        meta = project_meta.get(item["project"])
        if not meta:
            continue
        db.weekly_meetings.insert_one({
            **{k: v for k, v in item.items() if k != "project"},
            "project_id": meta["_id"],
            "created_at": datetime.utcnow(),
        })

    for item in data.get("health_snapshots", []):
        db.health_snapshots.insert_one({
            "date": item["date"],
            "health_score": item["health_score"],
            "recorded_at": _parse_dt(item.get("recorded_at")) or datetime.utcnow(),
        })

    refresh_health_fn(force=True)
    vectorize_all_fn()
    db.settings.update_one(
        {"key": "seed_version"},
        {"$set": {"value": data.get("version", DEMO_VERSION), "updated_at": datetime.utcnow(), "source": "demo_data"}},
        upsert=True,
    )
    return {"projects": len(project_ids), "ministries": len(ministry_ids), "version": data.get("version", DEMO_VERSION)}


def load_bundled_demo_data(db: Any, insert_document_fn: Any, vectorize_all_fn: Any, refresh_health_fn: Any, path: str | None = None) -> dict[str, Any]:
    demo_path = path or os.path.join(os.path.dirname(__file__), "demo_data.json")
    if os.path.exists(demo_path):
        with open(demo_path, encoding="utf-8") as handle:
            data = json.load(handle)
    else:
        data = build_demo_dataset()
        with open(demo_path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
    return load_demo_data(db, data, insert_document_fn, vectorize_all_fn, refresh_health_fn)


def list_orphan_collections(db: Any) -> list[dict[str, Any]]:
    existing = set(db.list_collection_names())
    orphans = sorted(existing - ALLOWED_COLLECTIONS)
    result = []
    for name in orphans:
        try:
            count = db[name].count_documents({})
        except Exception:
            count = -1
        result.append({"name": name, "count": count, "safe_to_drop": count == 0})
    return result


def cleanup_orphan_collections(db: Any, dry_run: bool = True) -> dict[str, Any]:
    orphans = list_orphan_collections(db)
    dropped = []
    skipped = []
    for item in orphans:
        if item["safe_to_drop"]:
            if not dry_run:
                db[item["name"]].drop()
            dropped.append(item["name"])
        else:
            skipped.append(item)
    return {"dry_run": dry_run, "dropped": dropped, "skipped": skipped, "orphans": orphans}
