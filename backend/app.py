import base64
import hashlib
import math
import os
import random
import re
import time
import uuid
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.errors import PyMongoError

MONGODB_URI = os.getenv(
    "MONGODB_URI",
    "mongodb+srv://main_user:main_user@cluster0.88oefbe.mongodb.net/?appName=Cluster0",
)
DB_NAME = os.getenv("DB_NAME", "4dx_dashboard")
EMBEDDING_DIMS = 128
SEED_VERSION = "milestone_leadmeasure_vector_v2"
HEALTH_STATES = {"green", "amber", "red", "blocker", "approval", "hold"}

app = FastAPI(title="4DX Government Execution API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):517[0-9]$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
db = client[DB_NAME]


class PhoneRequest(BaseModel):
    phone: str


class VerifyRequest(BaseModel):
    phone: str
    otp: str


class ProjectIn(BaseModel):
    name: str
    ministry_id: str
    owner: str
    current_state: str | None = None
    target_state: str | None = None
    wig: str | None = None
    due_date: str
    budget_crore: float = Field(ge=0)


class WigIn(BaseModel):
    title: str
    current_state: str | None = None
    target_state: str | None = None
    from_value: float = 0
    to_value: float
    unit: str
    deadline: str
    owner: str


class WigUpdateIn(BaseModel):
    title: str | None = None
    current_state: str | None = None
    target_state: str | None = None
    from_value: float | None = None
    to_value: float | None = None
    unit: str | None = None
    deadline: str | None = None
    owner: str | None = None


class LeadMeasureIn(BaseModel):
    title: str
    current_state: str | None = None
    target_state: str | None = None
    from_value: float = 0
    to_value: float
    unit: str
    deadline: str
    assigned_to: list[str]


class LeadMeasureUpdateIn(BaseModel):
    title: str | None = None
    current_state: str | None = None
    target_state: str | None = None
    from_value: float | None = None
    to_value: float | None = None
    current_value: float | None = None
    unit: str | None = None
    deadline: str | None = None
    assigned_to: list[str] | None = None
    status: str | None = None


class LeadProgressIn(BaseModel):
    current_value: float
    note: str | None = None
    health_state: str = "green"
    author: str


class CommentIn(BaseModel):
    comment: str
    health_state: str
    author: str


class CommentUpdateIn(BaseModel):
    comment: str | None = None
    health_state: str | None = None


class ApprovalIn(BaseModel):
    project_id: str
    wig_id: str
    measure_id: str
    title: str
    requested_by: str
    summary: str
    due_date: str


class WeeklyMeetingIn(BaseModel):
    project_id: str
    meeting_date: str
    facilitator: str
    notes: str
    commitments: list[str] = []


class AssignmentIn(BaseModel):
    project_id: str
    title: str
    owner: str
    role: str = "Project Director"
    due_date: str
    priority: str = "High"
    discipline: str = "Cadence"
    decision_needed: str | None = None


class DecisionIn(BaseModel):
    project_id: str
    title: str
    decision_type: str = "Intervention"
    requested_by: str
    due_date: str
    summary: str


class DocumentIn(BaseModel):
    project_id: str
    wig_id: str | None = None
    measure_id: str | None = None
    title: str
    document_type: str = "Progress Note"
    content: str


class SettingsIn(BaseModel):
    title: str | None = None
    department: str | None = None
    banner: str | None = None
    logo_url: str | None = None


def oid(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


def clean_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [clean_value(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_value(item) for key, item in value.items() if key != "embedding"}
    return value


def clean_id(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if doc is None:
        return None
    return clean_value(doc)


def token_for(user: dict[str, Any]) -> str:
    raw = f"{user['phone']}:{user['role']}:{int(time.time())}:{uuid.uuid4()}"
    token = base64.urlsafe_b64encode(raw.encode()).decode()
    db.sessions.insert_one({"token": token, "phone": user["phone"], "role": user["role"], "created_at": datetime.utcnow()})
    return token


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing session")
    token = authorization.removeprefix("Bearer ").strip()
    session = db.sessions.find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = db.users.find_one({"phone": session["phone"]})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return clean_id(user)


def require_admin(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def can_edit_project(project: dict[str, Any], user: dict[str, Any]) -> bool:
    if user.get("role") == "admin":
        return True
    phone = user.get("phone")
    return bool(phone and (project.get("created_by") == phone or phone in project.get("authorized_users", [])))


def require_project_editor(project: dict[str, Any], user: dict[str, Any]) -> None:
    if not can_edit_project(project, user):
        raise HTTPException(status_code=403, detail="Project editor access required")


def log_audit(
    action: str,
    entity_type: str,
    project: dict[str, Any],
    user: dict[str, Any],
    before: Any = None,
    after: Any = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.audit_events.insert_one({
        "action": action,
        "entity_type": entity_type,
        "project_id": project["_id"],
        "ministry_id": project["ministry_id"],
        "actor": user.get("phone"),
        "actor_role": user.get("role"),
        "before": before,
        "after": after,
        "metadata": metadata or {},
        "created_at": datetime.utcnow(),
    })


def create_notification(project: dict[str, Any], title: str, message: str, severity: str = "info", due_date: str | None = None) -> None:
    db.notifications.insert_one({
        "project_id": project["_id"],
        "ministry_id": project["ministry_id"],
        "title": title,
        "message": message,
        "severity": severity,
        "due_date": due_date,
        "status": "Open",
        "created_at": datetime.utcnow(),
    })


def find_wig(project: dict[str, Any], wig_id: str) -> dict[str, Any] | None:
    return next((wig for wig in project.get("wigs", []) if wig.get("id") == wig_id), None)


def find_measure(wig: dict[str, Any], measure_id: str) -> dict[str, Any] | None:
    return next((measure for measure in wig.get("lead_measures", []) if measure.get("id") == measure_id), None)


def upsert_project_after_nested_change(project: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    db.projects.update_one(
        {"_id": project["_id"]},
        {"$set": {"wigs": project.get("wigs", []), "updated_by": user["phone"], "updated_at": datetime.utcnow()}},
    )
    return refresh_project_health(project["_id"])


def refresh_project_sla_notifications(project: dict[str, Any]) -> None:
    today = datetime.utcnow().date()
    for wig in project.get("wigs", []):
        if wig.get("archived_at"):
            continue
        for measure in wig.get("lead_measures", []):
            if measure.get("archived_at"):
                continue
            deadline = measure.get("deadline")
            if not deadline:
                continue
            try:
                due = datetime.fromisoformat(deadline).date()
            except ValueError:
                continue
            remaining = (due - today).days
            if remaining < 0 and measure.get("status") != "Done":
                key = f"overdue:{measure.get('id')}"
                if not db.notifications.find_one({"project_id": project["_id"], "metadata.key": key, "status": "Open"}):
                    create_notification(project, "Overdue lead measure", f"{measure.get('title')} is past deadline.", "critical", deadline)
                    db.notifications.update_one({"project_id": project["_id"], "title": "Overdue lead measure", "message": f"{measure.get('title')} is past deadline."}, {"$set": {"metadata": {"key": key}}})
            elif 0 <= remaining <= 3:
                key = f"due-soon:{measure.get('id')}"
                if not db.notifications.find_one({"project_id": project["_id"], "metadata.key": key, "status": "Open"}):
                    create_notification(project, "Lead measure due soon", f"{measure.get('title')} is due in {remaining} days.", "warning", deadline)
                    db.notifications.update_one({"project_id": project["_id"], "title": "Lead measure due soon", "message": f"{measure.get('title')} is due in {remaining} days."}, {"$set": {"metadata": {"key": key}}})


def text_embedding(text: str, dims: int = EMBEDDING_DIMS) -> list[float]:
    tokens = re.findall(r"[a-z0-9]+", text.lower())
    vector = [0.0] * dims
    for token in tokens:
        digest = hashlib.sha256(token.encode()).digest()
        idx = int.from_bytes(digest[:4], "big") % dims
        sign = 1 if digest[4] % 2 == 0 else -1
        weight = 1.0 + min(len(token), 12) / 12
        vector[idx] += sign * weight
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [round(v / norm, 6) for v in vector]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    return sum(x * y for x, y in zip(a, b))


RISK_ARCHETYPES = [
    {
        "name": "Land Acquisition",
        "query": "land acquisition compensation award notification possession litigation encroachment title dispute",
        "weight": 0.16,
    },
    {
        "name": "Clearances & Approvals",
        "query": "approval clearance permission environment forest railway traffic police cabinet committee pending",
        "weight": 0.14,
    },
    {
        "name": "Utility Shifting",
        "query": "utility shifting electricity water pipeline cable sewer telecom relocation right of way",
        "weight": 0.12,
    },
    {
        "name": "Contractor Mobilization",
        "query": "contractor mobilization manpower equipment slow deployment procurement vendor performance",
        "weight": 0.12,
    },
    {
        "name": "Financial Closure",
        "query": "financial closure fund release budget overrun invoice payment escalation cost variance",
        "weight": 0.12,
    },
    {
        "name": "Public Service Impact",
        "query": "citizen service disruption complaints safety school hospital drinking water traffic congestion",
        "weight": 0.10,
    },
]
for item in RISK_ARCHETYPES:
    item["embedding"] = text_embedding(item["query"])

RISK_KEYWORDS = {
    "delay": 8,
    "delayed": 8,
    "pending": 6,
    "blocked": 8,
    "overrun": 8,
    "litigation": 9,
    "shortfall": 7,
    "escalation": 5,
    "unsafe": 8,
    "strike": 8,
    "approval": 4,
    "clearance": 4,
    "compensation": 5,
}


@app.on_event("startup")
def startup() -> None:
    try:
        client.admin.command("ping")
        seed_database()
    except PyMongoError as exc:
        print(f"MongoDB connection failed: {exc}")


def seed_database() -> None:
    db.users.create_index("phone", unique=True)
    db.sessions.create_index("token", unique=True)
    db.otp_requests.create_index("phone")
    db.projects.create_index("ministry_id")
    db.documents.create_index("project_id")
    db.vectors.create_index("entity_id", unique=True)
    db.vectors.create_index([("project_id", 1), ("entity_type", 1)])
    db.vectors.create_index("state")
    db.assignments.create_index("project_id")
    db.decisions.create_index("project_id")
    db.audit_events.create_index([("project_id", 1), ("created_at", -1)])
    db.approvals.create_index([("project_id", 1), ("status", 1)])
    db.notifications.create_index([("project_id", 1), ("status", 1)])
    db.weekly_meetings.create_index([("project_id", 1), ("meeting_date", -1)])
    ensure_branding()
    meta = db.settings.find_one({"key": "seed_version"})
    if meta and meta.get("value") == SEED_VERSION and db.projects.count_documents({}) >= 10:
        refresh_all_project_health()
        return
    for name in ("ministries", "projects", "documents", "vectors", "assignments", "decisions"):
        db[name].delete_many({})
    ministries = seed_ministries()
    projects = seed_projects(ministries)
    seed_documents(projects)
    seed_assignments_and_decisions(projects)
    refresh_all_project_health()
    vectorize_all_entities()
    db.settings.update_one({"key": "seed_version"}, {"$set": {"value": SEED_VERSION, "updated_at": datetime.utcnow()}}, upsert=True)
    try_create_vector_index()


def ensure_branding() -> None:
    if not db.settings.find_one({"key": "branding"}):
        db.settings.insert_one({
            "key": "branding",
            "title": "Government 4DX Execution Dashboard",
            "department": "Chief Minister Delivery Unit",
            "banner": "High level view. Right insights. Timely interventions. Better outcomes.",
            "logo_url": "",
        })


def seed_ministries() -> dict[str, ObjectId]:
    rows = [
        ("Public Works", "Minister of Public Works", "Roads, bridges, and public infrastructure delivery"),
        ("Urban Development", "Minister of Urban Development", "Urban mobility, city services, and municipal missions"),
        ("Water Resources", "Minister of Water Resources", "Irrigation, drinking water, dams, and river projects"),
        ("Health", "Minister of Health", "Hospitals, public health infrastructure, and emergency services"),
        ("Education", "Minister of Education", "Schools, colleges, skilling, and learning outcomes"),
    ]
    ids: dict[str, ObjectId] = {}
    for name, minister, mandate in rows:
        result = db.ministries.insert_one({
            "name": name,
            "minister": minister,
            "mandate": mandate,
            "owner": f"{name} Principal Secretary",
            "created_at": datetime.utcnow(),
        })
        ids[name] = result.inserted_id
    return ids


def seed_projects(ministries: dict[str, ObjectId]) -> list[dict[str, Any]]:
    today = datetime.utcnow().date()
    rows = [
        ("State Highway Expansion", "Public Works", "Complete 420 km of priority highway upgrades by Q4", 1840, 71, 82, 78, 80, 76, 78, 58, 74, "Construction"),
        ("Mysore Ring Road", "Public Works", "Open the eastern ring-road package for traffic by December", 960, 48, 61, 73, 54, 49, 44, 36, 58, "Construction"),
        ("Bangalore Metro Phase 2", "Urban Development", "Commission three high-ridership metro reaches by March", 6200, 56, 70, 88, 62, 58, 52, 44, 63, "Execution"),
        ("Smart City Mission", "Urban Development", "Deliver integrated command and civic services across 8 cities", 1430, 82, 86, 81, 88, 84, 86, 76, 82, "Rollout"),
        ("Kalasa Banduri Drinking Water", "Water Resources", "Secure water transfer milestones and complete priority works", 1120, 51, 63, 74, 56, 47, 48, 41, 68, "Clearances"),
        ("Belagavi Water Supply", "Water Resources", "Deliver 24x7 drinking water service to priority wards", 740, 42, 58, 72, 51, 45, 39, 33, 62, "Execution"),
        ("District Hospital Upgrade", "Health", "Upgrade 12 district hospitals with ICU and diagnostics capacity", 890, 78, 84, 86, 82, 81, 79, 72, 80, "Procurement"),
        ("Emergency Response Network", "Health", "Reduce emergency response time through integrated dispatch", 360, 68, 75, 80, 74, 69, 70, 66, 76, "Pilot"),
        ("School Infrastructure Renewal", "Education", "Repair and digitize 2,500 government school facilities", 670, 74, 80, 82, 77, 73, 74, 69, 78, "Execution"),
        ("Digital Learning Mission", "Education", "Deploy tablets, content, and teacher training for grades 8-12", 520, 63, 68, 76, 70, 64, 62, 55, 71, "Rollout"),
    ]
    projects: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        name, ministry, wig, budget, schedule, budget_score, quality, citizen, cadence, lead, doc, compliance, phase = row
        lead_measures = [
            {"name": "Weekly field verification", "target": 5, "actual": max(1, round(5 * lead / 100)), "unit": "visits"},
            {"name": "Approvals cleared", "target": 8, "actual": max(1, round(8 * compliance / 100)), "unit": "items"},
            {"name": "Critical commitments closed", "target": 10, "actual": max(1, round(10 * cadence / 100)), "unit": "commitments"},
        ]
        wigs = build_seed_wigs(name, wig, today, idx, schedule, lead, compliance, cadence)
        doc = {
            "name": name,
            "ministry_id": ministries[ministry],
            "ministry": ministry,
            "owner": f"{ministry} Mission Director",
            "current_state": f"{schedule}% schedule progress with {lead}% lead-measure execution",
            "target_state": wig,
            "phase": phase,
            "wig": wig,
            "due_date": (today + timedelta(days=75 + idx * 18)).isoformat(),
            "budget_crore": budget,
            "spent_crore": round(budget * random.uniform(0.34, 0.78), 1),
            "kpis": {
                "schedule": schedule,
                "budget": budget_score,
                "quality": quality,
                "citizen_impact": citizen,
                "cadence": cadence,
                "lead_measures": lead,
                "document_confidence": doc,
                "compliance": compliance,
            },
            "lead_measures": lead_measures,
            "wigs": wigs,
            "milestones": [
                {"name": "WIG", "progress": min(100, schedule + 10), "status": "On Track"},
                {"name": "Lead Measures", "progress": lead, "status": score_status(lead)},
                {"name": "Scoreboard", "progress": doc, "status": score_status(doc)},
                {"name": "Cadence", "progress": cadence, "status": score_status(cadence)},
                {"name": "Outcome", "progress": schedule, "status": score_status(schedule)},
            ],
            "created_at": datetime.utcnow(),
        }
        result = db.projects.insert_one(doc)
        doc["_id"] = result.inserted_id
        projects.append(doc)
    return projects


def seed_documents(projects: list[dict[str, Any]]) -> None:
    templates = {
        "State Highway Expansion": [
            ("Weekly Engineer Note", "Construction progress is steady. Land handover completed for package 4. Contractor mobilization and equipment deployment are adequate."),
            ("Finance Release Memo", "Second tranche fund release completed. No material budget overrun. Minor escalation claims under review."),
        ],
        "Mysore Ring Road": [
            ("District Review Minutes", "Land acquisition compensation objections remain pending in two villages. Contractor mobilization is slow and the bridge package is delayed."),
            ("Traffic Police Note", "Temporary diversion plan needs approval before excavation. Citizen complaints about congestion are increasing."),
        ],
        "Bangalore Metro Phase 2": [
            ("CM Review Brief", "Utility shifting and railway clearance are blocking tunnel access. Schedule risk is rising despite good civil progress."),
            ("Contract Package Report", "Contractor has requested night work permission. Equipment is available but approvals are pending."),
        ],
        "Smart City Mission": [
            ("Mission Dashboard Extract", "Integrated command center rollout is on track. Citizen service requests are closing within target."),
            ("Vendor Performance Note", "Procurement milestones completed. Training cadence is regular across city teams."),
        ],
        "Kalasa Banduri Drinking Water": [
            ("Clearance Tracker", "Forest clearance and inter-state approval are pending. Legal review has created a critical dependency."),
            ("Field Inspection Note", "Canal lining progress is moderate. Financial closure is adequate but clearances must be escalated."),
        ],
        "Belagavi Water Supply": [
            ("Utility Coordination Minutes", "Pipeline utility shifting is blocked in central wards. Road cutting permission and contractor mobilization are delayed."),
            ("Citizen Impact Note", "Drinking water complaints are increasing. Service disruption risk is high during summer demand."),
        ],
        "District Hospital Upgrade": [
            ("Procurement Status", "ICU equipment purchase orders issued. Civil works are on schedule and budget utilization is healthy."),
            ("Health Secretary Review", "Weekly site reviews are happening. Quality inspection closure is above target."),
        ],
        "Emergency Response Network": [
            ("Pilot Review", "Ambulance dispatch integration is progressing. Radio tower permission is pending in two districts."),
            ("Operations Note", "Response time improved in pilot districts. Training completion is slightly below target."),
        ],
        "School Infrastructure Renewal": [
            ("Education Works Note", "School repair works are ahead in rural blocks. Digital classroom installation is on schedule."),
            ("District Cadence Report", "Weekly accountability meetings are regular. Material supply is stable."),
        ],
        "Digital Learning Mission": [
            ("Teacher Training Note", "Teacher training is behind target in three districts. Device procurement is complete."),
            ("Content Rollout Memo", "Content localization is pending. Network readiness varies by school cluster."),
        ],
    }
    for project in projects:
        for title, content in templates[project["name"]]:
            insert_document(project["_id"], project["ministry_id"], title, "Seed Evidence", content, "system")


def seed_assignments_and_decisions(projects: list[dict[str, Any]]) -> None:
    today = datetime.utcnow().date()
    for idx, project in enumerate(projects):
        health = project.get("health_score", 70)
        priority = "Critical" if health < 50 else "High" if health < 68 else "Medium"
        db.assignments.insert_one({
            "project_id": project["_id"],
            "ministry_id": project["ministry_id"],
            "title": f"Close weekly 4DX commitments for {project['name']}",
            "owner": project["owner"],
            "role": "Mission Director",
            "due_date": (today + timedelta(days=7 + idx % 4)).isoformat(),
            "status": "In Progress",
            "priority": priority,
            "discipline": "Cadence",
            "decision_needed": "Escalate unresolved blocker if commitment misses two weekly cycles",
            "created_at": datetime.utcnow(),
        })
        if project["kpis"]["schedule"] < 60 or project["kpis"]["document_confidence"] < 55:
            db.decisions.insert_one({
                "project_id": project["_id"],
                "ministry_id": project["ministry_id"],
                "title": f"CM intervention required for {project['name']}",
                "decision_type": "Escalation",
                "requested_by": project["owner"],
                "due_date": (today + timedelta(days=5 + idx % 3)).isoformat(),
                "summary": "Resolve cross-department blocker identified by document evidence and lead-measure slippage.",
                "status": "Pending",
                "created_at": datetime.utcnow(),
            })


def score_status(score: float) -> str:
    if score >= 70:
        return "On Track"
    if score >= 50:
        return "At Risk"
    return "Off Track"


def state_from_score(score: float) -> str:
    if score >= 75:
        return "green"
    if score >= 55:
        return "amber"
    return "red"


def build_seed_wigs(project_name: str, main_wig: str, today: datetime.date, idx: int, schedule: int, lead: int, compliance: int, cadence: int) -> list[dict[str, Any]]:
    first_deadline = (today + timedelta(days=55 + idx * 9)).isoformat()
    final_deadline = (today + timedelta(days=110 + idx * 13)).isoformat()
    blocker_state = "blocker" if schedule < 55 else "approval" if compliance < 65 else state_from_score(lead)
    return [
        {
            "id": str(uuid.uuid4()),
            "title": main_wig,
            "current_state": f"{max(0, schedule - 22)}% completion baseline",
            "target_state": "100% completion achieved",
            "from_value": max(0, schedule - 22),
            "to_value": 100,
            "unit": "% completion",
            "deadline": final_deadline,
            "owner": "Mission Director",
            "lead_measures": [
                {
                    "id": str(uuid.uuid4()),
                    "title": "Move weekly verified progress",
                    "current_state": f"{max(0, lead - 20)}% verified",
                    "target_state": f"{min(100, lead + 18)}% verified",
                    "from_value": max(0, lead - 20),
                    "to_value": min(100, lead + 18),
                    "unit": "% verified",
                    "deadline": first_deadline,
                    "assigned_to": ["Project Director", "District Nodal Officer"],
                    "comments": [
                        {
                            "id": str(uuid.uuid4()),
                            "comment": f"{project_name} weekly field progress reviewed; escalation needed if trend does not improve.",
                            "health_state": blocker_state,
                            "author": "Review Cell",
                            "created_at": datetime.utcnow(),
                        }
                    ],
                },
                {
                    "id": str(uuid.uuid4()),
                    "title": "Close approval and dependency actions",
                    "current_state": f"{max(0, compliance - 25)}% dependencies closed",
                    "target_state": f"{min(100, compliance + 20)}% dependencies closed",
                    "from_value": max(0, compliance - 25),
                    "to_value": min(100, compliance + 20),
                    "unit": "% closed",
                    "deadline": first_deadline,
                    "assigned_to": ["Department Secretary", "Finance Representative"],
                    "comments": [
                        {
                            "id": str(uuid.uuid4()),
                            "comment": "Pending approvals and holds must be reviewed before next CM dashboard cycle.",
                            "health_state": "approval" if compliance < 70 else "green",
                            "author": "PMU",
                            "created_at": datetime.utcnow(),
                        }
                    ],
                },
            ],
        },
        {
            "id": str(uuid.uuid4()),
            "title": "Strengthen cadence and scoreboard discipline",
            "current_state": f"{max(0, cadence - 18)}% weekly commitments closed",
            "target_state": "95% weekly commitments closed",
            "from_value": max(0, cadence - 18),
            "to_value": 95,
            "unit": "% weekly commitments closed",
            "deadline": first_deadline,
            "owner": "PMU Lead",
            "lead_measures": [
                {
                    "id": str(uuid.uuid4()),
                    "title": "Close committed actions every Friday",
                    "current_state": f"{max(0, cadence - 20)}% actions closed",
                    "target_state": f"{min(100, cadence + 15)}% actions closed",
                    "from_value": max(0, cadence - 20),
                    "to_value": min(100, cadence + 15),
                    "unit": "% actions",
                    "deadline": first_deadline,
                    "assigned_to": ["PMU Lead", "Project Director"],
                    "comments": [
                        {
                            "id": str(uuid.uuid4()),
                            "comment": "Cadence meeting completed; owner-wise commitments captured for next review.",
                            "health_state": state_from_score(cadence),
                            "author": "4DX Coach",
                            "created_at": datetime.utcnow(),
                        }
                    ],
                }
            ],
        },
    ]


def flatten_project_states(project: dict[str, Any]) -> list[str]:
    states: list[str] = []
    for wig in project.get("wigs", []):
        for measure in wig.get("lead_measures", []):
            for comment in measure.get("comments", []):
                state = str(comment.get("health_state", "")).lower()
                if state:
                    states.append(state)
    return states


def vector_upsert(entity_type: str, entity_id: str, project: dict[str, Any], title: str, text: str, state: str | None = None) -> None:
    content = f"{entity_type} {title} {text} {state or ''}"
    db.vectors.update_one(
        {"entity_id": entity_id},
        {
            "$set": {
                "entity_id": entity_id,
                "entity_type": entity_type,
                "project_id": project["_id"],
                "ministry_id": project["ministry_id"],
                "project_name": project["name"],
                "ministry": project["ministry"],
                "title": title,
                "text": text,
                "state": state,
                "embedding": text_embedding(content),
                "updated_at": datetime.utcnow(),
            }
        },
        upsert=True,
    )


def vectorize_project_entities(project: dict[str, Any]) -> int:
    count = 0
    vector_upsert(
        "project",
        str(project["_id"]),
        project,
        project["name"],
        f"current state {project.get('current_state', '')} target state {project.get('target_state', '')} {project.get('wig', '')} {project.get('status', '')} {' '.join(project.get('bottlenecks', []))}",
        project.get("status"),
    )
    count += 1
    for wig in project.get("wigs", []):
        wig_text = f"current state {wig.get('current_state', '')} target state {wig.get('target_state', '')} from {wig.get('from_value')} to {wig.get('to_value')} {wig.get('unit')} by {wig.get('deadline')} owner {wig.get('owner')}"
        vector_upsert("wig", wig["id"], project, wig["title"], wig_text, None)
        count += 1
        for measure in wig.get("lead_measures", []):
            measure_text = f"current state {measure.get('current_state', '')} target state {measure.get('target_state', '')} from {measure.get('from_value')} to {measure.get('to_value')} {measure.get('unit')} by {measure.get('deadline')} assigned to {', '.join(measure.get('assigned_to', []))}"
            latest_state = None
            if measure.get("comments"):
                latest_state = str(measure["comments"][-1].get("health_state", "")).lower()
            vector_upsert("lead_measure", measure["id"], project, measure["title"], measure_text, latest_state)
            count += 1
            for comment in measure.get("comments", []):
                state = str(comment.get("health_state", "")).lower()
                vector_upsert("comment", comment["id"], project, measure["title"], comment.get("comment", ""), state)
                count += 1
    return count


def vectorize_all_entities() -> int:
    count = 0
    for project in db.projects.find({}):
        count += vectorize_project_entities(project)
    for doc in db.documents.find({}):
        project = db.projects.find_one({"_id": doc["project_id"]})
        if project:
            vector_text = f"{doc.get('content', '')} wig {doc.get('wig_title') or ''} lead measure {doc.get('measure_title') or ''} summary {doc.get('ai_summary', {}).get('headline', '')}"
            vector_upsert("document", str(doc["_id"]), project, doc.get("title", ""), vector_text, None)
            count += 1
    return count


def validate_document_target(project: dict[str, Any], wig_id: str | None, measure_id: str | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not wig_id and not measure_id:
        return None, None
    if measure_id and not wig_id:
        raise HTTPException(status_code=400, detail="measure_id requires wig_id")
    wig = find_wig(project, wig_id or "")
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    if not measure_id:
        return wig, None
    measure = find_measure(wig, measure_id)
    if not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")
    return wig, measure


def sentence_list(content: str) -> list[str]:
    return [item.strip() for item in re.split(r"(?<=[.!?])\s+", content.strip()) if item.strip()]


def summarize_document(content: str, risk: dict[str, Any], measure: dict[str, Any] | None = None) -> dict[str, Any]:
    sentences = sentence_list(content)
    lowered = content.lower()
    risk_words = sorted([word for word in RISK_KEYWORDS if word in lowered])[:5]
    priority = []
    for sentence in sentences:
        score = sum(1 for word in risk_words if word in sentence.lower())
        if measure:
            score += sum(1 for word in str(measure.get("title", "")).lower().split() if len(word) > 3 and word in sentence.lower())
        if score:
            priority.append((score, sentence))
    priority.sort(key=lambda item: item[0], reverse=True)
    highlights = [sentence for _, sentence in priority[:3]]
    if not highlights:
        highlights = sentences[:3]
    if not highlights and content.strip():
        highlights = [content.strip()[:260]]
    signal_names = [signal["name"] for signal in risk.get("signals", [])]
    if risk.get("score", 0) >= 65:
        decision = "High-risk evidence. Review in the next decision meeting and assign an unblock owner."
    elif risk.get("score", 0) >= 35:
        decision = "Moderate-risk evidence. Track in the next WIG cadence review."
    else:
        decision = "Low-risk evidence. Keep monitoring against the lead measure target."
    if measure:
        target = f"Mapped to lead measure: {measure.get('title')} current {measure.get('current_state') or measure.get('from_value')} target {measure.get('target_state') or measure.get('to_value')} {measure.get('unit')} by {measure.get('deadline')}."
    else:
        target = "Project-level evidence. Attach it to a lead measure for tighter accountability."
    return {
        "headline": highlights[0] if highlights else "No readable summary available.",
        "highlights": highlights[:3],
        "risk_score": risk.get("score", 0),
        "risk_signals": signal_names,
        "decision_hint": decision,
        "target_context": target,
    }


def insert_document(
    project_id: ObjectId,
    ministry_id: ObjectId,
    title: str,
    document_type: str,
    content: str,
    uploaded_by: str,
    wig_id: str | None = None,
    measure_id: str | None = None,
) -> dict[str, Any]:
    project = db.projects.find_one({"_id": project_id})
    wig, measure = validate_document_target(project, wig_id, measure_id) if project else (None, None)
    embedding = text_embedding(f"{title} {document_type} {content}")
    risk = extract_document_risk(content, embedding)
    summary = summarize_document(content, risk, measure)
    doc = {
        "project_id": project_id,
        "ministry_id": ministry_id,
        "wig_id": wig_id,
        "wig_title": wig.get("title") if wig else None,
        "measure_id": measure_id,
        "measure_title": measure.get("title") if measure else None,
        "title": title,
        "document_type": document_type,
        "content": content,
        "embedding": embedding,
        "risk_signals": risk["signals"],
        "risk_score": risk["score"],
        "ai_summary": summary,
        "uploaded_by": uploaded_by,
        "created_at": datetime.utcnow(),
    }
    result = db.documents.insert_one(doc)
    doc["_id"] = result.inserted_id
    if project:
        vector_text = f"{content} wig {doc.get('wig_title') or ''} lead measure {doc.get('measure_title') or ''} summary {summary.get('headline')}"
        vector_upsert("document", str(doc["_id"]), project, title, vector_text, None)
    return doc


def extract_document_risk(content: str, embedding: list[float]) -> dict[str, Any]:
    lowered = content.lower()
    keyword_score = sum(weight for word, weight in RISK_KEYWORDS.items() if word in lowered)
    signals = []
    semantic_score = 0.0
    for item in RISK_ARCHETYPES:
        similarity = max(0.0, cosine(embedding, item["embedding"]))
        if similarity > 0.11 or any(word in lowered for word in item["query"].split()[:4]):
            signals.append({"name": item["name"], "confidence": round(min(0.99, similarity + 0.35), 2)})
        semantic_score += similarity * item["weight"] * 100
    total = min(100, round(keyword_score + semantic_score, 1))
    return {"score": total, "signals": signals[:4]}


def calculate_project_health(project: dict[str, Any]) -> dict[str, Any]:
    kpis = project.get("kpis", {})
    docs = list(db.documents.find({"project_id": project["_id"]}))
    doc_risk = sum(doc.get("risk_score", 0) for doc in docs) / max(1, len(docs))
    evidence_confidence = min(100, 45 + len(docs) * 18)
    states = flatten_project_states(project)
    state_counts = {state: states.count(state) for state in HEALTH_STATES}
    state_penalty = (
        state_counts.get("blocker", 0) * 12
        + state_counts.get("red", 0) * 8
        + state_counts.get("approval", 0) * 6
        + state_counts.get("hold", 0) * 6
        + state_counts.get("amber", 0) * 3
    )
    weighted = (
        kpis.get("schedule", 0) * 0.22
        + kpis.get("budget", 0) * 0.14
        + kpis.get("quality", 0) * 0.10
        + kpis.get("citizen_impact", 0) * 0.12
        + kpis.get("cadence", 0) * 0.15
        + kpis.get("lead_measures", 0) * 0.17
        + kpis.get("compliance", 0) * 0.10
    )
    health = max(0, min(100, round(weighted - doc_risk * 0.24 - state_penalty + evidence_confidence * 0.08)))
    bottlenecks: dict[str, float] = {}
    for doc in docs:
        for signal in doc.get("risk_signals", []):
            bottlenecks[signal["name"]] = bottlenecks.get(signal["name"], 0) + signal.get("confidence", 0.5)
    if kpis.get("schedule", 100) < 60:
        bottlenecks["Schedule Slippage"] = bottlenecks.get("Schedule Slippage", 0) + 1
    if kpis.get("budget", 100) < 65:
        bottlenecks["Budget Utilization"] = bottlenecks.get("Budget Utilization", 0) + 1
    if state_counts.get("blocker", 0):
        bottlenecks["Blocker State"] = bottlenecks.get("Blocker State", 0) + state_counts["blocker"]
    if state_counts.get("approval", 0):
        bottlenecks["Approval Required"] = bottlenecks.get("Approval Required", 0) + state_counts["approval"]
    if state_counts.get("hold", 0):
        bottlenecks["On Hold"] = bottlenecks.get("On Hold", 0) + state_counts["hold"]
    top = sorted(bottlenecks.items(), key=lambda item: item[1], reverse=True)[:4]
    recommendations = build_recommendations(health, [name for name, _ in top], project)
    return {
        "health_score": health,
        "status": score_status(health),
        "evidence_count": len(docs),
        "evidence_risk_score": round(doc_risk, 1),
        "bottlenecks": [name for name, _ in top],
        "state_counts": state_counts,
        "recommendations": recommendations,
        "last_scored_at": datetime.utcnow(),
    }


def build_recommendations(health: int, bottlenecks: list[str], project: dict[str, Any]) -> list[str]:
    recs = []
    if health < 50:
        recs.append("Place on CM daily intervention watch until blockers are closed.")
    elif health < 70:
        recs.append("Review in the next weekly WIG session with named commitments.")
    else:
        recs.append("Keep current cadence and protect lead-measure execution.")
    if "Land Acquisition" in bottlenecks:
        recs.append("Convene district revenue review for land possession and compensation closure.")
    if "Clearances & Approvals" in bottlenecks:
        recs.append("Escalate pending approvals to the empowered committee.")
    if "Utility Shifting" in bottlenecks:
        recs.append("Assign utility war-room owner with 72-hour dependency closure plan.")
    if "Financial Closure" in bottlenecks or "Budget Utilization" in bottlenecks:
        recs.append("Ask finance department to confirm release date and utilization variance.")
    if "Blocker State" in bottlenecks:
        recs.append("Assign a named unblock owner and review daily until the blocker state is cleared.")
    if "Approval Required" in bottlenecks:
        recs.append("Route approval items to the next empowered committee agenda.")
    return recs[:4]


def refresh_project_health(project_id: ObjectId) -> dict[str, Any]:
    project = db.projects.find_one({"_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    health = calculate_project_health(project)
    db.projects.update_one({"_id": project_id}, {"$set": health})
    refreshed = db.projects.find_one({"_id": project_id})
    refresh_project_sla_notifications(refreshed)
    vectorize_project_entities(refreshed)
    return refreshed


def refresh_all_project_health() -> None:
    for project in db.projects.find({}):
        health = calculate_project_health(project)
        db.projects.update_one({"_id": project["_id"]}, {"$set": health})
        refreshed = db.projects.find_one({"_id": project["_id"]})
        refresh_project_sla_notifications(refreshed)


def try_create_vector_index() -> dict[str, Any]:
    definition = {
        "fields": [
            {"type": "vector", "path": "embedding", "numDimensions": EMBEDDING_DIMS, "similarity": "cosine"},
            {"type": "filter", "path": "project_id"},
            {"type": "filter", "path": "ministry_id"},
            {"type": "filter", "path": "state"},
        ]
    }
    try:
        db.command({
            "createSearchIndexes": "documents",
            "indexes": [{"name": "document_vector_index", "type": "vectorSearch", "definition": definition}],
        })
        db.command({
            "createSearchIndexes": "vectors",
            "indexes": [{"name": "entity_vector_index", "type": "vectorSearch", "definition": definition}],
        })
        return {"created": True, "message": "MongoDB Atlas Vector Search index creation requested"}
    except Exception as exc:
        return {
            "created": False,
            "message": "Vector index may already exist or this cluster/user cannot create it programmatically",
            "detail": str(exc),
            "manual_index": definition,
        }


def list_vector_search_indexes(collection_name: str) -> dict[str, Any]:
    try:
        result = db.command({"listSearchIndexes": collection_name})
        indexes = result.get("cursor", {}).get("firstBatch", [])
        return {
            "available": True,
            "names": [item.get("name") for item in indexes],
            "raw_status": [
                {"name": item.get("name"), "status": item.get("status") or item.get("queryable")}
                for item in indexes
            ],
        }
    except Exception as exc:
        return {"available": False, "names": [], "detail": str(exc)}


def vector_readiness() -> dict[str, Any]:
    entity_indexes = list_vector_search_indexes("vectors")
    document_indexes = list_vector_search_indexes("documents")
    probe = semantic_search_entities("blocker approval hold delayed", limit=3)
    return {
        "native_ready": probe.get("mode") == "mongodb_vector_search",
        "mode": probe.get("mode"),
        "entity_vectors": db.vectors.count_documents({}),
        "document_vectors": db.documents.count_documents({"embedding": {"$exists": True}}),
        "entity_index": {
            "expected": "entity_vector_index",
            "present": "entity_vector_index" in entity_indexes.get("names", []),
            **entity_indexes,
        },
        "document_index": {
            "expected": "document_vector_index",
            "present": "document_vector_index" in document_indexes.get("names", []),
            **document_indexes,
        },
        "fallback_detail": probe.get("detail"),
    }


def semantic_search_entities(query: str, state: str | None = None, limit: int = 10) -> dict[str, Any]:
    query_vector = text_embedding(query)
    filter_doc: dict[str, Any] = {}
    if state:
        filter_doc["state"] = state.lower()
    vector_stage: dict[str, Any] = {
        "index": "entity_vector_index",
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": 150,
        "limit": limit,
    }
    if filter_doc:
        vector_stage["filter"] = filter_doc
    try:
        rows = list(db.vectors.aggregate([
            {"$vectorSearch": vector_stage},
            {"$project": {
                "embedding": 0,
                "score": {"$meta": "vectorSearchScore"},
                "entity_type": 1,
                "project_id": 1,
                "project_name": 1,
                "ministry": 1,
                "title": 1,
                "text": 1,
                "state": 1,
            }},
        ]))
        mode = "mongodb_vector_search"
    except Exception as exc:
        rows = []
        for doc in db.vectors.find(filter_doc):
            cleaned = clean_id(doc)
            cleaned["score"] = round(cosine(query_vector, doc.get("embedding", [])), 4)
            rows.append(cleaned)
        rows.sort(key=lambda row: row["score"], reverse=True)
        rows = rows[:limit]
        mode = "local_vector_fallback"
        detail = str(exc)
    project_scores: dict[str, dict[str, Any]] = {}
    for row in rows:
        cleaned = clean_id(row)
        score = cleaned.get("score", 0.5)
        pid = cleaned["project_id"]
        if pid not in project_scores:
            project = db.projects.find_one({"_id": oid(pid)})
            project_scores[pid] = {"project": clean_id(project), "score": 0, "matches": []}
        project_scores[pid]["score"] += score if isinstance(score, (int, float)) else 0.5
        project_scores[pid]["matches"].append(cleaned)
    top_projects = sorted(project_scores.values(), key=lambda item: item["score"], reverse=True)
    response = {"mode": mode, "results": [clean_id(row) for row in rows], "top_projects": top_projects}
    if mode == "local_vector_fallback":
        response["detail"] = detail
    return response


def vector_search_documents(query: str, limit: int = 8, project_id: str | None = None) -> dict[str, Any]:
    query_vector = text_embedding(query)
    filter_doc: dict[str, Any] = {}
    if project_id:
        filter_doc["project_id"] = oid(project_id)
    vector_stage: dict[str, Any] = {
        "index": "document_vector_index",
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": 100,
        "limit": limit,
    }
    if filter_doc:
        vector_stage["filter"] = filter_doc
    try:
        rows = list(db.documents.aggregate([
            {"$vectorSearch": vector_stage},
            {"$project": {
                "embedding": 0,
                "score": {"$meta": "vectorSearchScore"},
                "title": 1,
                "document_type": 1,
                "content": 1,
                "project_id": 1,
                "ministry_id": 1,
                "risk_score": 1,
                "risk_signals": 1,
                "created_at": 1,
            }},
        ]))
        return {"mode": "mongodb_vector_search", "results": [clean_id(row) for row in rows]}
    except Exception as exc:
        docs = list(db.documents.find(filter_doc))
        scored = []
        for doc in docs:
            scored.append((cosine(query_vector, doc.get("embedding", [])), doc))
        scored.sort(key=lambda item: item[0], reverse=True)
        results = []
        for score, doc in scored[:limit]:
            cleaned = clean_id(doc)
            cleaned["score"] = round(score, 4)
            results.append(cleaned)
        return {"mode": "local_vector_fallback", "detail": str(exc), "results": results}


@app.get("/api/health")
def health() -> dict[str, str]:
    client.admin.command("ping")
    return {"status": "ok", "database": DB_NAME}


@app.get("/api/public/settings")
def public_settings() -> dict[str, Any]:
    settings = db.settings.find_one({"key": "branding"}, {"_id": 0})
    if not settings:
        return {"title": "Government 4DX Execution Dashboard", "department": "", "banner": "", "logo_url": ""}
    return settings


@app.post("/api/auth/request-otp")
def request_otp(payload: PhoneRequest) -> dict[str, str]:
    phone = payload.phone.strip()
    if len(phone) < 6:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    otp = f"{random.randint(100000, 999999)}"
    db.otp_requests.update_one(
        {"phone": phone},
        {"$set": {"otp": otp, "created_at": datetime.utcnow(), "used": False}},
        upsert=True,
    )
    return {"message": "OTP generated", "demo_otp": otp}


@app.post("/api/auth/verify-otp")
def verify_otp(payload: VerifyRequest) -> dict[str, Any]:
    phone = payload.phone.strip()
    record = db.otp_requests.find_one({"phone": phone, "otp": payload.otp, "used": False})
    if not record:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    role = "admin" if phone.endswith("0000") else "user"
    db.users.update_one(
        {"phone": phone},
        {"$set": {"phone": phone, "role": role, "updated_at": datetime.utcnow()}, "$setOnInsert": {"created_at": datetime.utcnow()}},
        upsert=True,
    )
    db.otp_requests.update_one({"_id": record["_id"]}, {"$set": {"used": True}})
    user = db.users.find_one({"phone": phone})
    token = token_for(user)
    return {"token": token, "user": clean_id(user)}


@app.get("/api/overview")
def overview(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    refresh_all_project_health()
    projects = [clean_id(doc) for doc in db.projects.find().sort("health_score", 1)]
    ministries = [clean_id(doc) for doc in db.ministries.find().sort("name", 1)]
    assignments = [clean_id(doc) for doc in db.assignments.find({"status": {"$ne": "Done"}}).sort("due_date", 1).limit(8)]
    decisions = [clean_id(doc) for doc in db.decisions.find({"status": "Pending"}).sort("due_date", 1).limit(8)]
    total = len(projects) or 1
    on = len([p for p in projects if p["status"] == "On Track"])
    risk = len([p for p in projects if p["status"] == "At Risk"])
    off = len([p for p in projects if p["status"] == "Off Track"])
    health_score = round(sum(p["health_score"] for p in projects) / total)
    bottlenecks: dict[str, int] = {}
    for project in projects:
        for item in project.get("bottlenecks", []):
            bottlenecks[item] = bottlenecks.get(item, 0) + 1
    return {
        "stats": {"total": len(projects), "on_track": on, "at_risk": risk, "off_track": off, "health_score": health_score},
        "projects": projects,
        "ministries": ministries,
        "assignments": assignments,
        "decisions": decisions,
        "bottlenecks": [{"name": name, "count": count} for name, count in sorted(bottlenecks.items(), key=lambda x: x[1], reverse=True)[:6]],
        "what_is_working": [
            "Projects with strong cadence retain higher health scores.",
            "Evidence-backed scoreboards are improving review quality.",
            "Health and Education projects show stable lead-measure execution.",
        ],
        "what_is_not_working": [
            "Cross-department approvals remain the biggest delay pattern.",
            "Utility shifting and land possession drive most critical escalations.",
            "Some teams still upload evidence after review instead of before review.",
        ],
    }


@app.get("/api/ministries")
def list_ministries(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return [clean_id(doc) for doc in db.ministries.find().sort("name", 1)]


@app.get("/api/projects")
def list_projects(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    refresh_all_project_health()
    return [clean_id(doc) for doc in db.projects.find().sort("health_score", 1)]


@app.post("/api/projects")
def create_project(payload: ProjectIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    ministry = db.ministries.find_one({"_id": oid(payload.ministry_id)})
    if not ministry:
        raise HTTPException(status_code=404, detail="Ministry not found")
    initial_wig = (payload.wig or "").strip()
    wigs = []
    if initial_wig:
        wigs.append({
            "id": str(uuid.uuid4()),
            "title": initial_wig,
            "current_state": payload.current_state or "Baseline not captured",
            "target_state": payload.target_state or initial_wig,
            "from_value": 0,
            "to_value": 100,
            "unit": "% completion",
            "deadline": payload.due_date,
            "owner": payload.owner,
            "lead_measures": [],
        })
    doc = {
        "name": payload.name,
        "ministry_id": ministry["_id"],
        "ministry": ministry["name"],
        "owner": payload.owner,
        "current_state": payload.current_state or "Baseline not captured",
        "target_state": payload.target_state or initial_wig or "Target state to be defined",
        "phase": "Planning",
        "wig": initial_wig or "Define WIG / Milestone",
        "due_date": payload.due_date,
        "budget_crore": payload.budget_crore,
        "spent_crore": 0,
        "kpis": {
            "schedule": 70,
            "budget": 75,
            "quality": 75,
            "citizen_impact": 70,
            "cadence": 60,
            "lead_measures": 62,
            "document_confidence": 30,
            "compliance": 70,
        },
        "lead_measures": [
            {"name": "Weekly field verification", "target": 5, "actual": 3, "unit": "visits"},
            {"name": "Critical commitments closed", "target": 10, "actual": 6, "unit": "commitments"},
        ],
        "wigs": wigs,
        "milestones": [
            {"name": "WIG", "progress": 70, "status": "On Track"},
            {"name": "Lead Measures", "progress": 62, "status": "At Risk"},
            {"name": "Scoreboard", "progress": 30, "status": "Off Track"},
            {"name": "Cadence", "progress": 60, "status": "At Risk"},
            {"name": "Outcome", "progress": 70, "status": "On Track"},
        ],
        "created_at": datetime.utcnow(),
        "created_by": user["phone"],
    }
    result = db.projects.insert_one(doc)
    refreshed = refresh_project_health(result.inserted_id)
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/wigs")
def add_wig(project_id: str, payload: WigIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = payload.model_dump()
    wig["id"] = str(uuid.uuid4())
    wig["lead_measures"] = []
    db.projects.update_one({"_id": project["_id"]}, {"$push": {"wigs": wig}, "$set": {"updated_by": user["phone"], "updated_at": datetime.utcnow()}})
    refreshed = refresh_project_health(project["_id"])
    log_audit("create", "wig", project, user, after=wig)
    return clean_id(refreshed)


@app.put("/api/projects/{project_id}/wigs/{wig_id}")
def update_wig(project_id: str, wig_id: str, payload: WigUpdateIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    before = dict(wig)
    for key, value in payload.model_dump(exclude_none=True).items():
        wig[key] = value
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("update", "wig", project, user, before=before, after=wig)
    return clean_id(refreshed)


@app.delete("/api/projects/{project_id}/wigs/{wig_id}")
def archive_wig(project_id: str, wig_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    before = dict(wig)
    wig["archived_at"] = datetime.utcnow()
    wig["archived_by"] = user["phone"]
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("archive", "wig", project, user, before=before, after=wig)
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/wigs/{wig_id}/lead-measures")
def add_lead_measure(project_id: str, wig_id: str, payload: LeadMeasureIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    measure = payload.model_dump()
    measure["id"] = str(uuid.uuid4())
    measure["current_value"] = measure["from_value"]
    measure["status"] = "Open"
    measure["comments"] = []
    result = db.projects.update_one(
        {"_id": oid(project_id), "wigs.id": wig_id},
        {"$push": {"wigs.$.lead_measures": measure}, "$set": {"updated_by": user["phone"], "updated_at": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project or WIG not found")
    refreshed = refresh_project_health(oid(project_id))
    log_audit("create", "lead_measure", project, user, after=measure, metadata={"wig_id": wig_id})
    return clean_id(refreshed)


@app.put("/api/projects/{project_id}/wigs/{wig_id}/lead-measures/{measure_id}")
def update_lead_measure(project_id: str, wig_id: str, measure_id: str, payload: LeadMeasureUpdateIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = find_measure(wig, measure_id)
    if not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")
    before = dict(measure)
    for key, value in payload.model_dump(exclude_none=True).items():
        measure[key] = value
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("update", "lead_measure", project, user, before=before, after=measure, metadata={"wig_id": wig_id})
    return clean_id(refreshed)


@app.delete("/api/projects/{project_id}/wigs/{wig_id}/lead-measures/{measure_id}")
def archive_lead_measure(project_id: str, wig_id: str, measure_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = find_measure(wig, measure_id)
    if not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")
    before = dict(measure)
    measure["status"] = "Archived"
    measure["archived_at"] = datetime.utcnow()
    measure["archived_by"] = user["phone"]
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("archive", "lead_measure", project, user, before=before, after=measure, metadata={"wig_id": wig_id})
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/wigs/{wig_id}/lead-measures/{measure_id}/progress")
def update_lead_measure_progress(project_id: str, wig_id: str, measure_id: str, payload: LeadProgressIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    state = payload.health_state.lower()
    if state not in HEALTH_STATES:
        raise HTTPException(status_code=400, detail=f"health_state must be one of {sorted(HEALTH_STATES)}")
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = find_measure(wig, measure_id)
    if not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")
    before = dict(measure)
    measure["current_value"] = payload.current_value
    measure["status"] = "Updated"
    measure.setdefault("progress_history", []).append({
        "id": str(uuid.uuid4()),
        "current_value": payload.current_value,
        "note": payload.note,
        "health_state": state,
        "author": payload.author,
        "created_by": user["phone"],
        "created_at": datetime.utcnow(),
    })
    if payload.note:
        measure.setdefault("comments", []).append({
            "id": str(uuid.uuid4()),
            "comment": payload.note,
            "health_state": state,
            "author": payload.author,
            "created_by": user["phone"],
            "created_at": datetime.utcnow(),
        })
    if state in {"blocker", "approval", "hold"}:
        create_notification(project, f"{state.title()} on {measure['title']}", payload.note or "Lead measure requires attention.", "critical", measure.get("deadline"))
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("progress_update", "lead_measure", project, user, before=before, after=measure, metadata={"wig_id": wig_id})
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/wigs/{wig_id}/lead-measures/{measure_id}/comments")
def add_lead_measure_comment(project_id: str, wig_id: str, measure_id: str, payload: CommentIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    state = payload.health_state.lower()
    if state not in HEALTH_STATES:
        raise HTTPException(status_code=400, detail=f"health_state must be one of {sorted(HEALTH_STATES)}")
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    comment = payload.model_dump()
    comment["health_state"] = state
    comment["id"] = str(uuid.uuid4())
    comment["created_by"] = user["phone"]
    comment["created_at"] = datetime.utcnow()
    updated = False
    for wig in project.get("wigs", []):
        if wig.get("id") != wig_id:
            continue
        for measure in wig.get("lead_measures", []):
            if measure.get("id") == measure_id:
                measure.setdefault("comments", []).append(comment)
                updated = True
                break
    if not updated:
        raise HTTPException(status_code=404, detail="WIG or lead measure not found")
    db.projects.update_one({"_id": project["_id"]}, {"$set": {"wigs": project.get("wigs", []), "updated_by": user["phone"], "updated_at": datetime.utcnow()}})
    if state in {"blocker", "approval", "hold"}:
        create_notification(project, f"{state.title()} comment added", payload.comment, "critical")
    refreshed = refresh_project_health(project["_id"])
    log_audit("comment", "lead_measure", project, user, after=comment, metadata={"wig_id": wig_id, "measure_id": measure_id})
    return clean_id(refreshed)


@app.put("/api/projects/{project_id}/wigs/{wig_id}/lead-measures/{measure_id}/comments/{comment_id}")
def update_lead_measure_comment(project_id: str, wig_id: str, measure_id: str, comment_id: str, payload: CommentUpdateIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = find_wig(project, wig_id)
    if not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = find_measure(wig, measure_id)
    if not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")
    comment = next((c for c in measure.get("comments", []) if c.get("id") == comment_id), None)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    before = dict(comment)
    update = payload.model_dump(exclude_none=True)
    if "health_state" in update:
        update["health_state"] = update["health_state"].lower()
        if update["health_state"] not in HEALTH_STATES:
            raise HTTPException(status_code=400, detail=f"health_state must be one of {sorted(HEALTH_STATES)}")
    comment.update(update)
    comment["updated_by"] = user["phone"]
    comment["updated_at"] = datetime.utcnow()
    refreshed = upsert_project_after_nested_change(project, user)
    log_audit("update", "comment", project, user, before=before, after=comment, metadata={"wig_id": wig_id, "measure_id": measure_id})
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/recalculate")
def recalculate_project(project_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return clean_id(refresh_project_health(oid(project_id)))


@app.get("/api/projects/{project_id}/evidence")
def project_evidence(project_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = refresh_project_health(oid(project_id))
    docs = [clean_id(doc) for doc in db.documents.find({"project_id": project["_id"]}).sort("created_at", -1)]
    assignments = [clean_id(doc) for doc in db.assignments.find({"project_id": project["_id"]}).sort("due_date", 1)]
    decisions = [clean_id(doc) for doc in db.decisions.find({"project_id": project["_id"]}).sort("due_date", 1)]
    approvals = [clean_id(doc) for doc in db.approvals.find({"project_id": project["_id"]}).sort("created_at", -1)]
    notifications = [clean_id(doc) for doc in db.notifications.find({"project_id": project["_id"], "status": "Open"}).sort("created_at", -1)]
    meetings = [clean_id(doc) for doc in db.weekly_meetings.find({"project_id": project["_id"]}).sort("meeting_date", -1).limit(8)]
    audit = [clean_id(doc) for doc in db.audit_events.find({"project_id": project["_id"]}).sort("created_at", -1).limit(20)]
    return {
        "project": clean_id(project),
        "documents": docs,
        "assignments": assignments,
        "decisions": decisions,
        "approvals": approvals,
        "notifications": notifications,
        "meetings": meetings,
        "audit": audit,
        "permissions": {"can_edit": can_edit_project(project, user), "role": user.get("role")},
    }


@app.post("/api/approvals")
def request_approval(payload: ApprovalIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    wig = find_wig(project, payload.wig_id)
    if not wig or not find_measure(wig, payload.measure_id):
        raise HTTPException(status_code=404, detail="WIG or lead measure not found")
    doc = payload.model_dump()
    doc["project_id"] = project["_id"]
    doc["ministry_id"] = project["ministry_id"]
    doc["status"] = "Pending"
    doc["created_by"] = user["phone"]
    doc["created_at"] = datetime.utcnow()
    result = db.approvals.insert_one(doc)
    doc["_id"] = result.inserted_id
    create_notification(project, payload.title, payload.summary, "approval", payload.due_date)
    log_audit("request", "approval", project, user, after=doc, metadata={"wig_id": payload.wig_id, "measure_id": payload.measure_id})
    return clean_id(doc)


@app.put("/api/approvals/{approval_id}/status")
def update_approval_status(approval_id: str, status: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    approval = db.approvals.find_one({"_id": oid(approval_id)})
    if not approval:
        raise HTTPException(status_code=404, detail="Approval not found")
    project = db.projects.find_one({"_id": approval["project_id"]})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    before = dict(approval)
    db.approvals.update_one({"_id": approval["_id"]}, {"$set": {"status": status, "updated_by": user["phone"], "updated_at": datetime.utcnow()}})
    updated = db.approvals.find_one({"_id": approval["_id"]})
    log_audit("status_update", "approval", project, user, before=before, after=updated)
    return clean_id(updated)


@app.post("/api/weekly-meetings")
def create_weekly_meeting(payload: WeeklyMeetingIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = payload.model_dump()
    doc["project_id"] = project["_id"]
    doc["ministry_id"] = project["ministry_id"]
    doc["created_by"] = user["phone"]
    doc["created_at"] = datetime.utcnow()
    result = db.weekly_meetings.insert_one(doc)
    doc["_id"] = result.inserted_id
    log_audit("create", "weekly_meeting", project, user, after=doc)
    for commitment in payload.commitments:
        create_notification(project, "Weekly commitment", commitment, "info", payload.meeting_date)
    return clean_id(doc)


@app.get("/api/search")
def semantic_search(q: str, state: str | None = None, limit: int = 10, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    normalized_state = state.lower() if state else None
    if normalized_state and normalized_state not in HEALTH_STATES:
        raise HTTPException(status_code=400, detail=f"state must be one of {sorted(HEALTH_STATES)}")
    return semantic_search_entities(q, state=normalized_state, limit=limit)


@app.post("/api/documents")
def add_document(payload: DocumentIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = insert_document(project["_id"], project["ministry_id"], payload.title, payload.document_type, payload.content, user["phone"], payload.wig_id, payload.measure_id)
    refreshed = refresh_project_health(project["_id"])
    return {"document": clean_id(doc), "project": clean_id(refreshed)}


@app.post("/api/documents/upload")
async def upload_document(
    project_id: str = Form(...),
    wig_id: str | None = Form(None),
    measure_id: str | None = Form(None),
    document_type: str = Form("Uploaded Document"),
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    raw = await file.read()
    content = raw.decode("utf-8", errors="ignore")
    if not content.strip():
        content = f"Uploaded binary file {file.filename}. Text extraction is pending."
    doc = insert_document(project["_id"], project["ministry_id"], file.filename or "Uploaded Document", document_type, content[:20000], user["phone"], wig_id, measure_id)
    refreshed = refresh_project_health(project["_id"])
    return {"document": clean_id(doc), "project": clean_id(refreshed)}


@app.get("/api/documents/search")
def search_documents(q: str, project_id: str | None = None, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return vector_search_documents(q, project_id=project_id)


@app.post("/api/vectorize")
def vectorize_documents(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    count = 0
    db.vectors.delete_many({})
    for doc in db.documents.find({}):
        embedding = text_embedding(f"{doc.get('title', '')} {doc.get('document_type', '')} {doc.get('content', '')}")
        risk = extract_document_risk(doc.get("content", ""), embedding)
        project = db.projects.find_one({"_id": doc.get("project_id")})
        measure = None
        if project and doc.get("wig_id") and doc.get("measure_id"):
            wig = find_wig(project, doc.get("wig_id"))
            measure = find_measure(wig, doc.get("measure_id")) if wig else None
        summary = summarize_document(doc.get("content", ""), risk, measure)
        update_doc = {
            "embedding": embedding,
            "risk_signals": risk["signals"],
            "risk_score": risk["score"],
            "ai_summary": summary,
            "vectorized_at": datetime.utcnow(),
        }
        db.documents.update_one({"_id": doc["_id"]}, {"$set": update_doc})
        count += 1
    refresh_all_project_health()
    entity_count = vectorize_all_entities()
    index = try_create_vector_index()
    return {"documents_vectorized": count, "entities_vectorized": entity_count, "index": index}


@app.get("/api/vector-status")
def vector_status(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return vector_readiness()


@app.get("/api/assignments")
def list_assignments(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return [clean_id(doc) for doc in db.assignments.find().sort("due_date", 1)]


@app.post("/api/assignments")
def create_assignment(payload: AssignmentIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = payload.model_dump()
    doc["project_id"] = project["_id"]
    doc["ministry_id"] = project["ministry_id"]
    doc["status"] = "Open"
    doc["created_by"] = user["phone"]
    doc["created_at"] = datetime.utcnow()
    result = db.assignments.insert_one(doc)
    doc["_id"] = result.inserted_id
    return clean_id(doc)


@app.put("/api/assignments/{assignment_id}/status")
def update_assignment_status(assignment_id: str, status: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    db.assignments.update_one({"_id": oid(assignment_id)}, {"$set": {"status": status, "updated_by": user["phone"], "updated_at": datetime.utcnow()}})
    doc = db.assignments.find_one({"_id": oid(assignment_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return clean_id(doc)


@app.get("/api/decisions")
def list_decisions(user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    return [clean_id(doc) for doc in db.decisions.find().sort("due_date", 1)]


@app.post("/api/decisions")
def create_decision(payload: DecisionIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = payload.model_dump()
    doc["project_id"] = project["_id"]
    doc["ministry_id"] = project["ministry_id"]
    doc["status"] = "Pending"
    doc["created_by"] = user["phone"]
    doc["created_at"] = datetime.utcnow()
    result = db.decisions.insert_one(doc)
    doc["_id"] = result.inserted_id
    return clean_id(doc)


@app.put("/api/decisions/{decision_id}/status")
def update_decision_status(decision_id: str, status: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    db.decisions.update_one({"_id": oid(decision_id)}, {"$set": {"status": status, "updated_by": user["phone"], "updated_at": datetime.utcnow()}})
    doc = db.decisions.find_one({"_id": oid(decision_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Decision not found")
    return clean_id(doc)


@app.put("/api/admin/settings")
def update_settings(payload: SettingsIn, admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_by"] = admin["phone"]
    update["updated_at"] = datetime.utcnow()
    db.settings.update_one({"key": "branding"}, {"$set": update}, upsert=True)
    return public_settings()


@app.post("/api/admin/reseed")
def reseed(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, str]:
    db.settings.update_one({"key": "seed_version"}, {"$set": {"value": "reseed_requested"}})
    seed_database()
    return {"status": "reseeded"}
