import base64
import csv
import io
import hashlib
import json
import math
import os
import random
import re
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any

from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from demo_dataset import (
    ALLOWED_COLLECTIONS,
    build_demo_dataset,
    cleanup_orphan_collections,
    list_orphan_collections,
    load_bundled_demo_data,
    load_demo_data,
)
from meeting_to_action import apply_meeting_to_action, apply_ministry_meeting_to_action, build_ministry_catalog, build_project_catalog, parse_meeting_notes
from llm_client import (
    call_llm_json,
    decision_brief_payload_valid,
    format_fallback_status,
    get_llm_provider_status,
    insight_ask_payload_valid,
    insight_payload_valid,
    portfolio_insight_payload_valid,
    sanitize_llm_status,
)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

MONGODB_URI = os.getenv("MONGODB_URI", "")
DB_NAME = os.getenv("DB_NAME", "4dx_dashboard")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "24"))
def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", (phone or "").strip())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits


ADMIN_PHONES = {
    normalize_phone(phone)
    for phone in os.getenv("ADMIN_PHONES", "9999900000").split(",")
    if phone.strip()
}
DEMO_OTP_MODE = os.getenv("DEMO_OTP_MODE", "true").lower() in {"1", "true", "yes"}
HEALTH_REFRESH_MINUTES = int(os.getenv("HEALTH_REFRESH_MINUTES", "5"))
EMBEDDING_DIMS = 128
HF_EMBEDDING_MODEL = os.getenv("HF_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SEED_VERSION = "milestone_leadmeasure_vector_v2"
APP_MODE = os.getenv("APP_MODE", "prod").lower()
DEMO_DATA_PATH = os.path.join(os.path.dirname(__file__), "demo_data.json")
HEALTH_STATES = {"green", "amber", "red", "blocker", "approval", "hold"}
UPDATE_FREQUENCIES = {"daily", "weekly", "bi-weekly", "monthly"}
FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "bi-weekly": 14, "monthly": 30}
_hf_model: Any = None
_hf_model_error: str | None = None
_health_cache_at: datetime | None = None

app = FastAPI(title="4DX Execution Platform API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):517[0-9]$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI environment variable is required. Copy backend/.env.example to backend/.env")

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
    priority: int = Field(default=5, ge=1, le=10)


class ProjectUpdateIn(BaseModel):
    name: str | None = None
    owner: str | None = None
    current_state: str | None = None
    target_state: str | None = None
    due_date: str | None = None
    budget_crore: float | None = Field(default=None, ge=0)
    priority: int | None = Field(default=None, ge=1, le=10)


class WigIn(BaseModel):
    title: str
    current_state: str | None = None
    target_state: str | None = None
    from_value: float = 0
    to_value: float
    unit: str
    deadline: str
    owner: str
    priority: int | None = Field(default=None, ge=1, le=10)
    update_frequency: str = "weekly"
    budget_allocated: float = Field(default=0, ge=0)


class WigUpdateIn(BaseModel):
    title: str | None = None
    current_state: str | None = None
    target_state: str | None = None
    from_value: float | None = None
    to_value: float | None = None
    unit: str | None = None
    deadline: str | None = None
    owner: str | None = None
    priority: int | None = Field(default=None, ge=1, le=10)
    update_frequency: str | None = None
    budget_allocated: float | None = Field(default=None, ge=0)


class LeadMeasureIn(BaseModel):
    title: str
    current_state: str | None = None
    target_state: str | None = None
    from_value: float = 0
    to_value: float
    unit: str
    deadline: str
    assigned_to: list[str]
    priority: int | None = Field(default=None, ge=1, le=10)
    budget_allocated: float = Field(default=0, ge=0)


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
    priority: int | None = Field(default=None, ge=1, le=10)
    budget_allocated: float | None = Field(default=None, ge=0)


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


class AIDecisionIn(BaseModel):
    project_id: str
    question: str | None = None


class AIInsightIn(BaseModel):
    question: str | None = None
    preset: str | None = None
    stale_days: int = Field(default=7, ge=1, le=90)


class ContextualInsightAskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


class MeetingNotesIn(BaseModel):
    notes: str
    ministry_id: str | None = None


class MeetingToActionApplyIn(BaseModel):
    ministry_id: str | None = None
    proposed_wigs: list[dict[str, Any]] = []
    proposed_measures: list[dict[str, Any]] = []
    proposed_actions: list[dict[str, Any]] = []


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
    locale: str | None = None
    region: str | None = None
    currency: str | None = None
    timezone: str | None = None
    org_type: str | None = None


class AppModeIn(BaseModel):
    mode: str
    auto_load_demo: bool = False
    confirm_reseed: bool = False


REGION_CATALOG = [
    {"id": "global", "label": "Global / Multi-region", "currency": "USD", "timezone": "UTC", "org_type": "enterprise"},
    {"id": "sg", "label": "Singapore", "currency": "SGD", "timezone": "Asia/Singapore", "org_type": "public_sector"},
    {"id": "cn", "label": "China", "currency": "CNY", "timezone": "Asia/Shanghai", "org_type": "public_sector"},
    {"id": "in", "label": "India", "currency": "INR", "timezone": "Asia/Kolkata", "org_type": "government"},
    {"id": "eu", "label": "European Union", "currency": "EUR", "timezone": "Europe/Brussels", "org_type": "public_sector"},
    {"id": "uk", "label": "United Kingdom", "currency": "GBP", "timezone": "Europe/London", "org_type": "government"},
    {"id": "de", "label": "Germany", "currency": "EUR", "timezone": "Europe/Berlin", "org_type": "public_sector"},
    {"id": "fr", "label": "France", "currency": "EUR", "timezone": "Europe/Paris", "org_type": "government"},
    {"id": "us", "label": "United States", "currency": "USD", "timezone": "America/New_York", "org_type": "enterprise"},
    {"id": "jp", "label": "Japan", "currency": "JPY", "timezone": "Asia/Tokyo", "org_type": "public_sector"},
    {"id": "au", "label": "Australia", "currency": "AUD", "timezone": "Australia/Sydney", "org_type": "government"},
]


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
    expires_at = datetime.utcnow() + timedelta(hours=SESSION_TTL_HOURS)
    db.sessions.insert_one({
        "token": token,
        "phone": user["phone"],
        "role": user["role"],
        "created_at": datetime.utcnow(),
        "expires_at": expires_at,
    })
    return token


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing session")
    token = authorization.removeprefix("Bearer ").strip()
    session = db.sessions.find_one({"token": token})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at < datetime.utcnow():
        db.sessions.delete_one({"_id": session["_id"]})
        raise HTTPException(status_code=401, detail="Session expired")
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
    if DEMO_OTP_MODE:
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
            if remaining < 0 and not measure_is_complete(measure):
                key = f"overdue:{measure.get('id')}"
                if not db.notifications.find_one({"project_id": project["_id"], "metadata.key": key, "status": "Open"}):
                    create_notification(project, "Overdue lead measure", f"{measure.get('title')} is past deadline.", "critical", deadline)
                    db.notifications.update_one({"project_id": project["_id"], "title": "Overdue lead measure", "message": f"{measure.get('title')} is past deadline."}, {"$set": {"metadata": {"key": key}}})
            elif 0 <= remaining <= 3:
                key = f"due-soon:{measure.get('id')}"
                if not db.notifications.find_one({"project_id": project["_id"], "metadata.key": key, "status": "Open"}):
                    create_notification(project, "Lead measure due soon", f"{measure.get('title')} is due in {remaining} days.", "warning", deadline)
                    db.notifications.update_one({"project_id": project["_id"], "title": "Lead measure due soon", "message": f"{measure.get('title')} is due in {remaining} days."}, {"$set": {"metadata": {"key": key}}})


def deterministic_embedding(text: str, dims: int = EMBEDDING_DIMS) -> list[float]:
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


def projection_embedding(values: list[float], dims: int = EMBEDDING_DIMS) -> list[float]:
    if not values:
        return [0.0] * dims
    if len(values) == dims:
        vector = values
    else:
        vector = [0.0] * dims
        for index, value in enumerate(values):
            vector[index % dims] += float(value)
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [round(v / norm, 6) for v in vector]


def get_hf_embedding_model() -> Any:
    global _hf_model, _hf_model_error
    if _hf_model is not None:
        return _hf_model
    if _hf_model_error:
        return None
    try:
        from sentence_transformers import SentenceTransformer

        _hf_model = SentenceTransformer(HF_EMBEDDING_MODEL)
        return _hf_model
    except Exception as exc:
        _hf_model_error = str(exc)
        return None


def embedding_provider_status() -> dict[str, Any]:
    model = get_hf_embedding_model()
    if model is not None:
        return {
            "provider": "hugging_face",
            "model": HF_EMBEDDING_MODEL,
            "dimensions": EMBEDDING_DIMS,
            "native_dimensions": int(getattr(model, "get_sentence_embedding_dimension", lambda: 0)() or 0),
            "projection": "modulo_pooling_to_existing_vector_index",
        }
    return {
        "provider": "deterministic_fallback",
        "model": "local_hash_embedding",
        "dimensions": EMBEDDING_DIMS,
        "detail": _hf_model_error,
    }


def text_embedding(text: str, dims: int = EMBEDDING_DIMS) -> list[float]:
    model = get_hf_embedding_model()
    if model is None:
        return deterministic_embedding(text, dims)
    try:
        vector = model.encode(text or "", normalize_embeddings=True)
        return projection_embedding([float(value) for value in vector], dims)
    except Exception:
        return deterministic_embedding(text, dims)


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


def get_app_mode() -> str:
    doc = db.settings.find_one({"key": "app_mode"})
    if doc and doc.get("mode") in {"dev", "prod"}:
        return doc["mode"]
    return "dev" if APP_MODE == "dev" else "prod"


def ensure_app_mode() -> None:
    existing = db.settings.find_one({"key": "app_mode"})
    default_mode = "dev" if APP_MODE == "dev" else "prod"
    if not existing:
        db.settings.insert_one({
            "key": "app_mode",
            "mode": default_mode,
            "auto_load_demo": default_mode == "dev",
            "updated_at": datetime.utcnow(),
        })


def set_app_mode(mode: str, auto_load_demo: bool | None = None) -> dict[str, Any]:
    normalized = mode.lower()
    if normalized not in {"dev", "prod"}:
        raise HTTPException(status_code=400, detail="mode must be dev or prod")
    patch: dict[str, Any] = {"mode": normalized, "updated_at": datetime.utcnow()}
    if auto_load_demo is not None:
        patch["auto_load_demo"] = auto_load_demo
    db.settings.update_one({"key": "app_mode"}, {"$set": patch}, upsert=True)
    doc = db.settings.find_one({"key": "app_mode"}, {"_id": 0, "key": 0}) or {}
    return {"app_mode": doc.get("mode", normalized), "auto_load_demo": bool(doc.get("auto_load_demo"))}


def reseed_demo_payload(data: dict[str, Any] | None = None) -> dict[str, Any]:
    if data is None:
        result = load_bundled_demo_data(db, insert_document, vectorize_all_entities, refresh_all_project_health, DEMO_DATA_PATH)
    else:
        result = load_demo_data(db, data, insert_document, vectorize_all_entities, refresh_all_project_health)
    try_create_vector_index()
    return result


def seed_database() -> None:
    db.users.create_index("phone", unique=True)
    db.sessions.create_index("token", unique=True)
    db.sessions.create_index("expires_at", expireAfterSeconds=0)
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
    db.health_snapshots.create_index([("recorded_at", -1)])
    ensure_branding()
    ensure_app_mode()
    meta = db.settings.find_one({"key": "seed_version"})
    if meta and meta.get("value") and db.projects.count_documents({}) > 0:
        refresh_all_project_health(force=True)
        return
    cleanup_orphan_collections(db, dry_run=False)
    if db.projects.count_documents({}) == 0 and get_app_mode() == "dev":
        app_mode_doc = db.settings.find_one({"key": "app_mode"}) or {}
        if app_mode_doc.get("auto_load_demo", True):
            reseed_demo_payload()
            return
    for name in ("ministries", "projects", "documents", "vectors", "assignments", "decisions"):
        db[name].delete_many({})
    ministries = seed_ministries()
    projects = seed_projects(ministries)
    seed_documents(projects)
    seed_assignments_and_decisions(projects)
    refresh_all_project_health(force=True)
    vectorize_all_entities()
    db.settings.update_one({"key": "seed_version"}, {"$set": {"value": SEED_VERSION, "updated_at": datetime.utcnow()}}, upsert=True)
    try_create_vector_index()


def ensure_branding() -> None:
    defaults = {
        "title": "4DX Execution Platform",
        "department": "Strategic Delivery Office",
        "banner": "Focus. Measure. Score. Execute. — The 4 Disciplines of Execution for any organisation.",
        "logo_url": "",
        "locale": "en",
        "region": "global",
        "currency": "USD",
        "timezone": "UTC",
        "org_type": "enterprise",
    }
    existing = db.settings.find_one({"key": "branding"})
    if not existing:
        db.settings.insert_one({"key": "branding", **defaults})
        return
    patch = {k: v for k, v in defaults.items() if not existing.get(k)}
    if patch:
        db.settings.update_one({"key": "branding"}, {"$set": patch})


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
        wigs = build_seed_wigs(name, wig, today, idx, schedule, lead, compliance, cadence, budget)
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


def build_seed_wigs(project_name: str, main_wig: str, today: datetime.date, idx: int, schedule: int, lead: int, compliance: int, cadence: int, budget_crore: float = 0) -> list[dict[str, Any]]:
    first_deadline = (today + timedelta(days=55 + idx * 9)).isoformat()
    final_deadline = (today + timedelta(days=110 + idx * 13)).isoformat()
    blocker_state = "blocker" if schedule < 55 else "approval" if compliance < 65 else state_from_score(lead)
    wig_one_budget = round(budget_crore * 0.58, 1) if budget_crore else 0
    wig_two_budget = round(budget_crore * 0.32, 1) if budget_crore else 0
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
            "update_frequency": "weekly",
            "budget_allocated": wig_one_budget,
            "priority": 7 if schedule < 60 else 5,
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
                    "budget_allocated": round(wig_one_budget * 0.45, 1) if wig_one_budget else 0,
                    "priority": 6,
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
                    "budget_allocated": round(wig_one_budget * 0.35, 1) if wig_one_budget else 0,
                    "priority": 5,
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
            "update_frequency": "bi-weekly",
            "budget_allocated": wig_two_budget,
            "priority": 4,
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
                    "budget_allocated": round(wig_two_budget * 0.7, 1) if wig_two_budget else 0,
                    "priority": 4,
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
        if wig.get("archived_at"):
            continue
        if entity_is_overdue(wig, complete_fn=wig_is_complete):
            overdue_days = days_past_deadline(wig.get("deadline")) or 0
            progress = progress_percent(
                wig.get("from_value", 0),
                wig.get("to_value", 0),
                wig.get("current_value", wig.get("from_value", 0)),
            )
            states.append("blocker" if overdue_days > 7 or progress < 30 else "red")
        for measure in wig.get("lead_measures", []):
            if measure.get("archived_at"):
                continue
            state = measure_health_state(measure)
            if state != "archived":
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


def extract_pdf_text(raw: bytes) -> str:
    try:
        import fitz
        with fitz.open(stream=raw, filetype="pdf") as pdf:
            pages = []
            for page in pdf:
                text = page.get_text("text").strip()
                if text:
                    pages.append(text)
                if sum(len(item) for item in pages) > 30000:
                    break
            return "\n\n".join(pages).strip()
    except ImportError:
        return ""
    except Exception:
        return ""


def extract_uploaded_file_text(raw: bytes, filename: str, content_type: str | None) -> tuple[str, dict[str, Any]]:
    lower_name = filename.lower()
    mime = (content_type or "").lower()
    meta = {
        "file_name": filename,
        "content_type": content_type or "application/octet-stream",
        "file_size": len(raw),
        "extraction_status": "extracted",
    }
    if mime == "application/pdf" or lower_name.endswith(".pdf") or raw.startswith(b"%PDF"):
        text = extract_pdf_text(raw)
        meta["file_kind"] = "pdf"
        if text:
            return text, meta
        meta["extraction_status"] = "no_selectable_text"
        return f"Uploaded PDF {filename}. Text extraction did not find selectable text. Review the attached PDF evidence for details.", meta
    if mime.startswith("text/") or lower_name.endswith((".txt", ".csv", ".md", ".log")):
        text = raw.decode("utf-8", errors="replace").strip()
        meta["file_kind"] = "text"
        if text:
            return text, meta
    meta["file_kind"] = "binary"
    meta["extraction_status"] = "unsupported_binary"
    return f"Uploaded file {filename}. This file type is stored as evidence, but readable text extraction is not available.", meta


def insert_document(
    project_id: ObjectId,
    ministry_id: ObjectId,
    title: str,
    document_type: str,
    content: str,
    uploaded_by: str,
    wig_id: str | None = None,
    measure_id: str | None = None,
    file_meta: dict[str, Any] | None = None,
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
        "file_meta": file_meta or None,
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
    overdue_count = 0
    for wig in project.get("wigs", []):
        if not wig.get("archived_at") and entity_is_overdue(wig, complete_fn=wig_is_complete):
            overdue_count += 1
        for measure in wig.get("lead_measures", []):
            if not measure.get("archived_at") and entity_is_overdue(measure, complete_fn=measure_is_complete):
                overdue_count += 1
    if overdue_count:
        bottlenecks["Overdue Items"] = bottlenecks.get("Overdue Items", 0) + overdue_count
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


def refresh_project_health(project_id: ObjectId, *, vectorize: bool = True) -> dict[str, Any]:
    project = db.projects.find_one({"_id": project_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    health = calculate_project_health(project)
    db.projects.update_one({"_id": project_id}, {"$set": health})
    refreshed = db.projects.find_one({"_id": project_id})
    refresh_project_sla_notifications(refreshed)
    if vectorize:
        vectorize_project_entities(refreshed)
    return refreshed


def refresh_all_project_health(force: bool = False) -> None:
    global _health_cache_at
    now = datetime.utcnow()
    if not force and _health_cache_at and (now - _health_cache_at).total_seconds() < HEALTH_REFRESH_MINUTES * 60:
        return
    scores: list[int] = []
    for project in db.projects.find({}):
        health = calculate_project_health(project)
        db.projects.update_one({"_id": project["_id"]}, {"$set": health})
        refreshed = db.projects.find_one({"_id": project["_id"]})
        refresh_project_sla_notifications(refreshed)
        scores.append(health["health_score"])
    if scores:
        record_portfolio_health_snapshot(round(sum(scores) / len(scores)))
    _health_cache_at = now


def record_portfolio_health_snapshot(health_score: int) -> None:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    existing = db.health_snapshots.find_one({"date": today})
    if existing:
        db.health_snapshots.update_one({"_id": existing["_id"]}, {"$set": {"health_score": health_score, "recorded_at": datetime.utcnow()}})
    else:
        db.health_snapshots.insert_one({"date": today, "health_score": health_score, "recorded_at": datetime.utcnow()})


def portfolio_health_trend(limit: int = 8) -> list[dict[str, Any]]:
    rows = list(db.health_snapshots.find().sort("recorded_at", -1).limit(limit))
    if len(rows) < 2:
        return []
    rows.reverse()
    return [{"name": row["date"][-5:], "value": row["health_score"]} for row in rows]


def measure_health_state(measure: dict[str, Any]) -> str:
    if measure.get("archived_at"):
        return "archived"
    progress = progress_percent(
        measure.get("from_value", 0),
        measure.get("to_value", 0),
        measure.get("current_value", measure.get("from_value", 0)),
    )
    if entity_is_overdue(measure, complete_fn=measure_is_complete):
        overdue_days = days_past_deadline(measure.get("deadline")) or 0
        if overdue_days > 7 or progress < 30:
            return "blocker"
        return "red"
    comments = measure.get("comments") or []
    if comments:
        return str(comments[-1].get("health_state", "green")).lower()
    deadline = measure.get("deadline")
    if deadline:
        try:
            remaining = (datetime.fromisoformat(deadline).date() - datetime.utcnow().date()).days
            if remaining <= 7 and progress < 70:
                return "amber"
        except ValueError:
            pass
    if progress >= 85:
        return "green"
    if progress >= 50:
        return "amber"
    return "green"


def progress_percent(from_value: float, to_value: float, current_value: float) -> int:
    span = to_value - from_value
    if span == 0:
        return 100 if current_value >= to_value else 0
    return max(0, min(100, round(((current_value - from_value) / span) * 100)))


def build_scoreboard_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for project in db.projects.find().sort("health_score", 1):
        for wig in project.get("wigs", []):
            if wig.get("archived_at"):
                continue
            for measure in wig.get("lead_measures", []):
                if measure.get("archived_at"):
                    continue
                state = measure_health_state(measure)
                progress = progress_percent(
                    measure.get("from_value", 0),
                    measure.get("to_value", 0),
                    measure.get("current_value", measure.get("from_value", 0)),
                )
                rows.append({
                    "project_id": str(project["_id"]),
                    "project_name": project["name"],
                    "ministry": project.get("ministry"),
                    "wig_id": wig.get("id"),
                    "wig_title": wig.get("title"),
                    "measure_id": measure.get("id"),
                    "measure_title": measure.get("title"),
                    "owner": ", ".join(measure.get("assigned_to") or []) or wig.get("owner") or project.get("owner"),
                    "deadline": measure.get("deadline"),
                    "progress": progress,
                    "health_state": state,
                    "status": measure.get("status", "Open"),
                    "is_overdue": entity_is_overdue(measure, complete_fn=measure_is_complete),
                })
    state_order = {"blocker": 0, "red": 1, "approval": 2, "hold": 3, "amber": 4, "green": 5}
    rows.sort(key=lambda row: (state_order.get(row["health_state"], 6), row["progress"]))
    return rows


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
        "embedding_provider": embedding_provider_status(),
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


def compact_project_for_ai(project: dict[str, Any]) -> dict[str, Any]:
    wigs = []
    for wig in project.get("wigs", []):
        measures = []
        for measure in wig.get("lead_measures", []):
            comments = measure.get("comments", [])[-3:]
            measures.append({
                "title": measure.get("title"),
                "current": measure.get("current_state") or measure.get("current_value") or measure.get("from_value"),
                "target": measure.get("target_state") or measure.get("to_value"),
                "deadline": measure.get("deadline"),
                "assigned_to": measure.get("assigned_to", []),
                "latest_states": [comment.get("health_state") for comment in comments],
                "latest_comments": [comment.get("comment") for comment in comments],
            })
        wigs.append({
            "title": wig.get("title"),
            "current": wig.get("current_state") or wig.get("from_value"),
            "target": wig.get("target_state") or wig.get("to_value"),
            "deadline": wig.get("deadline"),
            "owner": wig.get("owner"),
            "lead_measures": measures,
        })
    return {
        "name": project.get("name"),
        "ministry": project.get("ministry"),
        "owner": project.get("owner"),
        "status": project.get("status"),
        "health_score": project.get("health_score"),
        "evidence_risk_score": project.get("evidence_risk_score"),
        "current_state": project.get("current_state"),
        "target_state": project.get("target_state"),
        "deadline": project.get("due_date"),
        "bottlenecks": project.get("bottlenecks", []),
        "recommendations": project.get("recommendations", []),
        "wigs": wigs,
    }


def collect_decision_context(project: dict[str, Any], question: str | None = None) -> dict[str, Any]:
    docs = [clean_id(doc) for doc in db.documents.find({"project_id": project["_id"]}).sort("created_at", -1).limit(8)]
    approvals = [clean_id(doc) for doc in db.approvals.find({"project_id": project["_id"]}).sort("created_at", -1).limit(6)]
    assignments = [clean_id(doc) for doc in db.assignments.find({"project_id": project["_id"], "status": {"$ne": "Done"}}).sort("due_date", 1).limit(6)]
    notifications = [clean_id(doc) for doc in db.notifications.find({"project_id": project["_id"], "status": "Open"}).sort("created_at", -1).limit(6)]
    decisions = [clean_id(doc) for doc in db.decisions.find({"project_id": project["_id"]}).sort("created_at", -1).limit(6)]
    query = question or f"{project.get('name')} blocker approval delay risk intervention decision"
    entity_matches = semantic_search_entities(query, limit=8).get("results", [])
    document_matches = vector_search_documents(query, limit=6, project_id=str(project["_id"])).get("results", [])
    return {
        "project": compact_project_for_ai(project),
        "evidence": [{
            "title": doc.get("title"),
            "type": doc.get("document_type"),
            "risk_score": doc.get("risk_score"),
            "summary": doc.get("ai_summary", {}).get("headline") or doc.get("content", "")[:360],
            "signals": [signal.get("name") for signal in doc.get("risk_signals", [])],
            "lead_measure": doc.get("measure_title"),
        } for doc in docs],
        "approvals": approvals,
        "assignments": assignments,
        "notifications": notifications,
        "decisions": decisions,
        "vector_matches": [{
            "type": item.get("entity_type") or item.get("document_type"),
            "title": item.get("title"),
            "state": item.get("state"),
            "score": item.get("score"),
            "text": item.get("text") or item.get("content", "")[:280],
        } for item in (entity_matches[:5] + document_matches[:5])],
    }


def local_decision_brief(context: dict[str, Any]) -> dict[str, Any]:
    project = context["project"]
    risks = context.get("notifications", []) + context.get("approvals", [])
    evidence = context.get("evidence", [])
    blockers = project.get("bottlenecks", [])[:3]
    next_action = "Run a 48-hour unblock review with the WIG owner, finance/approval owner, and project director."
    if blockers:
        next_action = f"Resolve {blockers[0]} first; assign one named owner and review progress in the next WIG cadence."
    return {
        "mode": "local_decision_engine",
        "executive_position": f"{project.get('name')} needs targeted intervention because health is {project.get('health_score')}% and status is {project.get('status')}.",
        "recommended_decision": "Intervene" if project.get("status") != "On Track" else "Monitor",
        "decision_type": "Intervention" if project.get("status") != "On Track" else "Cadence",
        "confidence": 0.72,
        "why_now": [
            f"Current bottlenecks: {', '.join(blockers) or 'No major bottleneck recorded'}.",
            f"{len(evidence)} recent evidence documents are mapped to execution health.",
            f"{len(risks)} open approvals, alerts, or escalations are active.",
        ],
        "risk_register": [
            {"risk": item, "severity": "High" if project.get("status") == "Off Track" else "Medium", "mitigation": "Assign named owner and deadline."}
            for item in (blockers or ["Cadence slippage"])
        ],
        "actions": [
            {"owner": project.get("owner") or "Project Director", "action": next_action, "deadline": "Next 48 hours"},
            {"owner": "PMU Lead", "action": "Update evidence-backed scoreboard after intervention review.", "deadline": "Next weekly meeting"},
        ],
        "questions_for_cm": [
            "Which owner is accountable for closing the top blocker?",
            "Is an approval or budget decision required this week?",
            "What outcome will change by the next cadence review?",
        ],
        "source_evidence": [doc.get("title") for doc in evidence[:4]],
    }


def normalize_decision_brief(brief: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(brief or {})
    confidence = normalized.get("confidence", 0.0)
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0
    if confidence > 1:
        confidence = confidence / 100
    normalized["confidence"] = max(0.0, min(confidence, 1.0))
    for key in ("why_now", "risk_register", "actions", "questions_for_cm", "source_evidence"):
        value = normalized.get(key)
        if value is None:
            normalized[key] = []
        elif not isinstance(value, list):
            normalized[key] = [value]
    normalized.setdefault("recommended_decision", "Review")
    normalized.setdefault("decision_type", "Intervention")
    normalized.setdefault("executive_position", "AI brief generated from project execution data.")
    return normalized


def openai_decision_brief(context: dict[str, Any], question: str | None = None) -> dict[str, Any]:
    system = (
        "You are a senior government 4DX execution advisor. "
        "Turn project health, WIGs, lead measures, evidence, approvals, alerts, and vector matches into a concise executive decision brief. "
        "Be specific, decision-oriented, and avoid generic project-management advice. Return only valid JSON."
    )
    schema_hint = {
        "executive_position": "one sentence",
        "recommended_decision": "Intervene | Monitor | Approve | Defer | Escalate",
        "decision_type": "Intervention | Approval | Funding | Policy | Cadence",
        "confidence": 0.0,
        "why_now": ["3 concise evidence-backed reasons"],
        "risk_register": [{"risk": "risk", "severity": "Low|Medium|High|Critical", "mitigation": "specific mitigation"}],
        "actions": [{"owner": "role or person", "action": "specific action", "deadline": "date or timeframe"}],
        "questions_for_cm": ["3 questions"],
        "source_evidence": ["document or signal names"],
    }
    prompt = {
        "question": question or "What decision should leadership take now?",
        "required_json_shape": schema_hint,
        "context": context,
    }
    llm = call_llm_json(system, json.dumps(prompt, default=str), validate=decision_brief_payload_valid)
    if llm["data"]:
        data = llm["data"]
        data["mode"] = f"{llm['provider']}_llm"
        data["model"] = llm["model"]
        data["llm_status"] = sanitize_llm_status(llm["llm_status"])
        return normalize_decision_brief(data)
    brief = local_decision_brief(context)
    brief["llm_status"] = sanitize_llm_status(llm.get("llm_status"))
    return normalize_decision_brief(brief)


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None
    return None


def active_wigs(project: dict[str, Any]) -> list[dict[str, Any]]:
    return [wig for wig in project.get("wigs", []) if not wig.get("archived_at")]


def active_measures(wig: dict[str, Any]) -> list[dict[str, Any]]:
    return [measure for measure in wig.get("lead_measures", []) if not measure.get("archived_at")]


def normalize_update_frequency(value: str | None) -> str:
    freq = (value or "weekly").strip().lower()
    if freq not in UPDATE_FREQUENCIES:
        raise HTTPException(status_code=400, detail=f"update_frequency must be one of {sorted(UPDATE_FREQUENCIES)}")
    return freq


def frequency_stale_days(frequency: str | None) -> int:
    return FREQUENCY_DAYS.get((frequency or "weekly").strip().lower(), 7)


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        return None


def measure_is_complete(measure: dict[str, Any]) -> bool:
    if measure.get("archived_at"):
        return True
    status = str(measure.get("status", "")).lower()
    if status in {"done", "closed", "complete", "completed"}:
        return True
    progress = progress_percent(
        measure.get("from_value", 0),
        measure.get("to_value", 0),
        measure.get("current_value", measure.get("from_value", 0)),
    )
    return progress >= 100


def wig_is_complete(wig: dict[str, Any]) -> bool:
    if wig.get("archived_at"):
        return True
    progress = progress_percent(
        wig.get("from_value", 0),
        wig.get("to_value", 0),
        wig.get("current_value", wig.get("from_value", 0)),
    )
    return progress >= 100


def is_past_deadline(deadline: str | None) -> bool:
    due = parse_iso_date(deadline)
    if not due:
        return False
    return datetime.utcnow().date() > due


def days_past_deadline(deadline: str | None) -> int | None:
    due = parse_iso_date(deadline)
    if not due:
        return None
    return (datetime.utcnow().date() - due).days


def entity_is_overdue(entity: dict[str, Any], *, complete_fn) -> bool:
    if complete_fn(entity):
        return False
    return is_past_deadline(entity.get("deadline"))


def validate_wig_deadline(project: dict[str, Any], deadline: str | None) -> None:
    project_due = parse_iso_date(project.get("due_date"))
    wig_due = parse_iso_date(deadline)
    if project_due and wig_due and wig_due > project_due:
        raise HTTPException(
            status_code=400,
            detail=f"WIG deadline cannot exceed project deadline ({project.get('due_date')})",
        )


def measure_deadline_cap(project: dict[str, Any], wig: dict[str, Any]) -> tuple[date | None, str | None]:
    caps: list[tuple[date, str, str]] = []
    project_due = parse_iso_date(project.get("due_date"))
    wig_due = parse_iso_date(wig.get("deadline"))
    if project_due:
        caps.append((project_due, "project deadline", project.get("due_date") or ""))
    if wig_due:
        caps.append((wig_due, "WIG deadline", wig.get("deadline") or ""))
    if not caps:
        return None, None
    cap_date, cap_label, cap_value = min(caps, key=lambda item: item[0])
    return cap_date, f"{cap_label} ({cap_value})"


def validate_measure_deadline(project: dict[str, Any], wig: dict[str, Any], deadline: str | None) -> None:
    measure_due = parse_iso_date(deadline)
    if not measure_due:
        return
    cap_date, cap_label = measure_deadline_cap(project, wig)
    if cap_date and measure_due > cap_date:
        raise HTTPException(
            status_code=400,
            detail=f"Lead measure deadline cannot exceed {cap_label}",
        )


def sum_wig_budgets(project: dict[str, Any], exclude_wig_id: str | None = None) -> float:
    total = 0.0
    for wig in active_wigs(project):
        if exclude_wig_id and wig.get("id") == exclude_wig_id:
            continue
        total += float(wig.get("budget_allocated") or 0)
    return round(total, 4)


def sum_measure_budgets(wig: dict[str, Any], exclude_measure_id: str | None = None) -> float:
    total = 0.0
    for measure in active_measures(wig):
        if exclude_measure_id and measure.get("id") == exclude_measure_id:
            continue
        total += float(measure.get("budget_allocated") or 0)
    return round(total, 4)


def validate_project_wig_budget(project: dict[str, Any], additional: float = 0.0, exclude_wig_id: str | None = None) -> None:
    project_budget = float(project.get("budget_crore") or 0)
    if project_budget <= 0:
        return
    allocated = sum_wig_budgets(project, exclude_wig_id=exclude_wig_id) + float(additional or 0)
    if allocated > project_budget + 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"Total WIG budget ({allocated:.1f} Cr) exceeds project budget ({project_budget:.1f} Cr)",
        )


def validate_wig_measure_budget(wig: dict[str, Any], additional: float = 0.0, exclude_measure_id: str | None = None) -> None:
    wig_budget = float(wig.get("budget_allocated") or 0)
    if wig_budget <= 0:
        return
    allocated = sum_measure_budgets(wig, exclude_measure_id=exclude_measure_id) + float(additional or 0)
    if allocated > wig_budget + 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"Total lead measure budget ({allocated:.1f} Cr) exceeds WIG budget ({wig_budget:.1f} Cr)",
        )


def collect_budget_context(projects: list[dict[str, Any]]) -> dict[str, Any]:
    portfolio_total = 0.0
    portfolio_spent = 0.0
    portfolio_wig_allocated = 0.0
    over_allocated_projects: list[dict[str, Any]] = []
    over_spent_projects: list[dict[str, Any]] = []
    wig_budget_issues: list[dict[str, Any]] = []
    measure_budget_issues: list[dict[str, Any]] = []

    for project in projects:
        project_budget = float(project.get("budget_crore") or 0)
        spent = float(project.get("spent_crore") or 0)
        wigs = active_wigs(project)
        wig_allocated = sum(float(w.get("budget_allocated") or 0) for w in wigs)
        portfolio_total += project_budget
        portfolio_spent += spent
        portfolio_wig_allocated += wig_allocated

        if project_budget > 0 and spent > project_budget:
            over_spent_projects.append({
                "project": project.get("name"),
                "budget_crore": project_budget,
                "spent_crore": spent,
                "variance_crore": round(spent - project_budget, 1),
            })
        if project_budget > 0 and wig_allocated > project_budget:
            over_allocated_projects.append({
                "project": project.get("name"),
                "budget_crore": project_budget,
                "wig_allocated_crore": round(wig_allocated, 1),
                "variance_crore": round(wig_allocated - project_budget, 1),
            })

        for wig in wigs:
            wig_budget = float(wig.get("budget_allocated") or 0)
            measures = active_measures(wig)
            measure_allocated = sum(float(m.get("budget_allocated") or 0) for m in measures)
            if wig_budget > 0 and measure_allocated > wig_budget:
                wig_budget_issues.append({
                    "project": project.get("name"),
                    "wig": wig.get("title"),
                    "wig_budget_crore": wig_budget,
                    "measure_allocated_crore": round(measure_allocated, 1),
                    "variance_crore": round(measure_allocated - wig_budget, 1),
                })
            for measure in measures:
                measure_budget = float(measure.get("budget_allocated") or 0)
                if measure_budget <= 0:
                    continue
                if wig_budget > 0 and measure_budget > wig_budget:
                    measure_budget_issues.append({
                        "project": project.get("name"),
                        "wig": wig.get("title"),
                        "measure": measure.get("title"),
                        "measure_budget_crore": measure_budget,
                        "wig_budget_crore": wig_budget,
                    })

    return {
        "portfolio_budget_crore": round(portfolio_total, 1),
        "portfolio_spent_crore": round(portfolio_spent, 1),
        "portfolio_wig_allocated_crore": round(portfolio_wig_allocated, 1),
        "over_spent_projects": over_spent_projects[:8],
        "over_allocated_projects": over_allocated_projects[:8],
        "wig_measure_overruns": wig_budget_issues[:10],
        "measure_budget_warnings": measure_budget_issues[:10],
    }


def measure_last_activity(measure: dict[str, Any]) -> datetime | None:
    stamps = []
    for entry in measure.get("progress_history", []) + measure.get("comments", []):
        stamp = _to_datetime(entry.get("created_at"))
        if stamp:
            stamps.append(stamp)
    return max(stamps) if stamps else None


def collect_insight_context(question: str, stale_days: int = 7) -> dict[str, Any]:
    refresh_all_project_health()
    now = datetime.utcnow()
    projects = [clean_id(doc) for doc in db.projects.find().sort("health_score", 1)]

    at_risk = []
    stale_items = []
    overdue_items = []
    owner_gaps: dict[str, dict[str, Any]] = {}
    bottleneck_counts: dict[str, int] = {}

    for project in projects:
        if project.get("status") in {"At Risk", "Off Track"}:
            at_risk.append({
                "name": project.get("name"),
                "ministry": project.get("ministry"),
                "owner": project.get("owner"),
                "status": project.get("status"),
                "health_score": project.get("health_score"),
                "priority": project.get("priority", 5),
                "top_bottleneck": (project.get("bottlenecks") or [None])[0],
                "due_date": project.get("due_date"),
                "budget_crore": project.get("budget_crore"),
                "spent_crore": project.get("spent_crore"),
            })
        for name in project.get("bottlenecks", []):
            bottleneck_counts[name] = bottleneck_counts.get(name, 0) + 1
        for wig in project.get("wigs", []):
            if wig.get("archived_at"):
                continue
            if entity_is_overdue(wig, complete_fn=wig_is_complete):
                overdue_items.append({
                    "type": "wig",
                    "title": wig.get("title"),
                    "project": project.get("name"),
                    "ministry": project.get("ministry"),
                    "owner": wig.get("owner") or project.get("owner"),
                    "deadline": wig.get("deadline"),
                    "days_overdue": days_past_deadline(wig.get("deadline")),
                })
            threshold = frequency_stale_days(wig.get("update_frequency", "weekly"))
            for measure in wig.get("lead_measures", []):
                if measure.get("archived_at"):
                    continue
                if entity_is_overdue(measure, complete_fn=measure_is_complete):
                    overdue_items.append({
                        "type": "lead_measure",
                        "title": measure.get("title"),
                        "wig": wig.get("title"),
                        "project": project.get("name"),
                        "ministry": project.get("ministry"),
                        "owners": measure.get("assigned_to") or [wig.get("owner") or project.get("owner") or "Unassigned"],
                        "deadline": measure.get("deadline"),
                        "days_overdue": days_past_deadline(measure.get("deadline")),
                        "health_state": measure_health_state(measure),
                    })
                last = measure_last_activity(measure)
                days_stale = (now - last).days if last else None
                if last is None or (days_stale is not None and days_stale >= threshold):
                    owners = measure.get("assigned_to") or [wig.get("owner") or project.get("owner") or "Unassigned"]
                    item = {
                        "measure": measure.get("title"),
                        "wig": wig.get("title"),
                        "project": project.get("name"),
                        "ministry": project.get("ministry"),
                        "owners": owners,
                        "days_stale": days_stale,
                        "stale_threshold_days": threshold,
                        "update_frequency": wig.get("update_frequency", "weekly"),
                        "deadline": measure.get("deadline"),
                        "priority": measure.get("priority", 5),
                    }
                    stale_items.append(item)
                    for owner in owners:
                        gap = owner_gaps.setdefault(owner, {"owner": owner, "count": 0, "items": [], "ministries": set()})
                        gap["count"] += 1
                        if len(gap["items"]) < 5:
                            gap["items"].append({
                                "measure": measure.get("title"),
                                "project": project.get("name"),
                                "days_stale": days_stale,
                                "update_frequency": wig.get("update_frequency", "weekly"),
                            })
                        gap["ministries"].add(project.get("ministry") or "")

    stale_owners = sorted(owner_gaps.values(), key=lambda gap: -gap["count"])
    for gap in stale_owners:
        gap["ministries"] = sorted(m for m in gap["ministries"] if m)

    pending_approvals = db.approvals.count_documents({"status": "Pending"})
    open_alerts = db.notifications.count_documents({"status": "Open"})
    entity_matches = semantic_search_entities(question, limit=8).get("results", [])
    document_matches = vector_search_documents(question, limit=6).get("results", [])
    budget_context = collect_budget_context(projects)

    return {
        "generated_at": now.isoformat(),
        "stale_days": stale_days,
        "portfolio": {
            "projects_total": len(projects),
            "at_risk_count": len(at_risk),
            "pending_approvals": pending_approvals,
            "open_alerts": open_alerts,
            "average_health": round(sum(p.get("health_score", 0) for p in projects) / len(projects)) if projects else 0,
        },
        "budget": budget_context,
        "at_risk_projects": sorted(at_risk, key=lambda p: (p.get("health_score", 0), -(p.get("priority") or 5)))[:10],
        "stale_measures": sorted(stale_items, key=lambda i: -(i["days_stale"] if i["days_stale"] is not None else 9999))[:25],
        "overdue_items": sorted(overdue_items, key=lambda i: -(i.get("days_overdue") or 0))[:25],
        "stale_owners": stale_owners[:12],
        "top_bottlenecks": sorted(bottleneck_counts.items(), key=lambda kv: -kv[1])[:6],
        "vector_matches": [{
            "type": item.get("entity_type") or item.get("document_type"),
            "title": item.get("title"),
            "project_name": item.get("project_name"),
            "state": item.get("state"),
            "score": item.get("score"),
            "text": (item.get("text") or item.get("content", ""))[:240],
        } for item in (entity_matches[:5] + document_matches[:4])],
    }


def local_portfolio_insight(context: dict[str, Any], question: str) -> dict[str, Any]:
    portfolio = context["portfolio"]
    budget = context.get("budget", {})
    at_risk = context["at_risk_projects"]
    stale_owners = context["stale_owners"]
    bottlenecks = context["top_bottlenecks"]
    findings = []
    if at_risk:
        worst = at_risk[0]
        findings.append({
            "title": f"{len(at_risk)} of {portfolio['projects_total']} projects are at risk or off track",
            "detail": f"Weakest is {worst['name']} ({worst['ministry']}) at {worst['health_score']}% health; top bottleneck: {worst.get('top_bottleneck') or 'not recorded'}.",
            "severity": "High",
            "projects": [p["name"] for p in at_risk[:5]],
        })
    if stale_owners:
        top = stale_owners[0]
        sample = top["items"][0] if top.get("items") else {}
        freq = sample.get("update_frequency", "weekly")
        findings.append({
            "title": f"{len(context['stale_measures'])} lead measures missed their WIG update cadence",
            "detail": f"Largest gap: {top['owner']} with {top['count']} silent measures ({', '.join(item['project'] for item in top['items'][:3])}). Cadence example: {freq}.",
            "severity": "High",
            "projects": sorted({item["project"] for item in context["stale_measures"][:8]}),
        })
    overdue_items = context.get("overdue_items", [])
    if overdue_items:
        top = overdue_items[0]
        findings.append({
            "title": f"{len(overdue_items)} WIGs or lead measures are past deadline",
            "detail": f"Most urgent: {top.get('title')} in {top.get('project')} ({top.get('days_overdue')} days overdue, {top.get('type', 'item').replace('_', ' ')}).",
            "severity": "Critical",
            "projects": sorted({item["project"] for item in overdue_items[:8]}),
        })
    if budget.get("over_spent_projects"):
        top = budget["over_spent_projects"][0]
        findings.append({
            "title": f"{len(budget['over_spent_projects'])} projects are over spent vs budget",
            "detail": f"{top['project']} spent ₹{top['spent_crore']} Cr against ₹{top['budget_crore']} Cr (+₹{top['variance_crore']} Cr).",
            "severity": "Critical",
            "projects": [item["project"] for item in budget["over_spent_projects"][:5]],
        })
    if budget.get("over_allocated_projects"):
        top = budget["over_allocated_projects"][0]
        findings.append({
            "title": f"{len(budget['over_allocated_projects'])} projects have WIG budgets exceeding project total",
            "detail": f"{top['project']} allocated ₹{top['wig_allocated_crore']} Cr across WIGs vs ₹{top['budget_crore']} Cr project budget (+₹{top['variance_crore']} Cr).",
            "severity": "High",
            "projects": [item["project"] for item in budget["over_allocated_projects"][:5]],
        })
    if budget.get("wig_measure_overruns"):
        top = budget["wig_measure_overruns"][0]
        findings.append({
            "title": "Lead measure budgets exceed their WIG allocations",
            "detail": f"{top['project']} / {top['wig']}: measures total ₹{top['measure_allocated_crore']} Cr vs WIG ₹{top['wig_budget_crore']} Cr.",
            "severity": "Medium",
            "projects": sorted({item["project"] for item in budget["wig_measure_overruns"][:5]}),
        })
    if bottlenecks:
        findings.append({
            "title": "Recurring bottlenecks across the portfolio",
            "detail": "; ".join(f"{name} ({count} projects)" for name, count in bottlenecks[:3]),
            "severity": "Medium",
            "projects": [],
        })
    if portfolio["pending_approvals"]:
        findings.append({
            "title": f"{portfolio['pending_approvals']} approvals are pending",
            "detail": "Unblocked approvals are the fastest lever to restore delivery velocity.",
            "severity": "Medium",
            "projects": [],
        })
    actions = []
    if at_risk:
        actions.append({"owner": at_risk[0].get("owner") or "Project Director", "action": f"Run a 48-hour recovery review on {at_risk[0]['name']}.", "deadline": "Next 48 hours"})
    if stale_owners:
        actions.append({"owner": stale_owners[0]["owner"], "action": "Post progress updates on all silent lead measures before the next WIG session.", "deadline": "This week"})
    actions.append({"owner": "PMU Lead", "action": "Review pending approvals and recurring bottlenecks in the weekly cadence.", "deadline": "Next WIG session"})
    return {
        "mode": "local_insight_engine",
        "headline": f"Portfolio health {portfolio['average_health']}% — {len(at_risk)} projects need executive attention",
        "summary": (
            f"Across {portfolio['projects_total']} projects, average health is {portfolio['average_health']}%. "
            f"{len(at_risk)} are at risk or off track, {len(context['stale_measures'])} lead measures missed their WIG cadence, "
            f"{portfolio['pending_approvals']} approvals are pending, and portfolio spend is ₹{budget.get('portfolio_spent_crore', 0)} Cr "
            f"against ₹{budget.get('portfolio_budget_crore', 0)} Cr budget."
        ),
        "findings": findings,
        "actions": actions,
        "citations": [p["name"] for p in at_risk[:5]] or sorted({item["project"] for item in context["stale_measures"][:5]}),
    }


def openai_portfolio_insight(context: dict[str, Any], question: str) -> dict[str, Any]:
    system = (
        "You are the chief delivery advisor to a head of government reviewing a 4DX execution portfolio. "
        "Answer the executive's question directly using the supplied portfolio data: project health, at-risk projects, "
        "stale lead measures grouped by owner (respecting each WIG's update_frequency cadence), overdue WIGs and lead measures past deadline, budget allocation vs spend, "
        "over-allocated WIGs/measures, bottlenecks, approvals, and vector-search matches. "
        "Name specific projects, owners, and numbers. No generic advice. Return only valid JSON."
    )
    schema_hint = {
        "headline": "one direct sentence answering the question",
        "summary": "3-4 sentence executive answer with concrete numbers and names",
        "findings": [{"title": "finding", "detail": "specifics with names/numbers", "severity": "Low|Medium|High|Critical", "projects": ["project names"]}],
        "actions": [{"owner": "person or role", "action": "specific action", "deadline": "timeframe"}],
        "citations": ["project names referenced"],
    }
    prompt = {"question": question, "required_json_shape": schema_hint, "portfolio_context": context}
    llm = call_llm_json(system, json.dumps(prompt, default=str), validate=portfolio_insight_payload_valid)
    if llm["data"]:
        data = llm["data"]
        data["mode"] = f"{llm['provider']}_llm"
        data["model"] = llm["model"]
        data["llm_status"] = sanitize_llm_status(llm["llm_status"])
        for key in ("findings", "actions", "citations"):
            if not isinstance(data.get(key), list):
                data[key] = []
        data.setdefault("headline", "Portfolio insight generated.")
        data.setdefault("summary", "")
        return data
    insight = local_portfolio_insight(context, question)
    insight["llm_status"] = sanitize_llm_status(llm.get("llm_status"))
    return insight


def _normalize_risk_severity(value: str | None) -> str:
    normalized = (value or "medium").strip().lower()
    if normalized in {"critical", "high"}:
        return "high"
    if normalized == "low":
        return "low"
    return "medium"


def _insight_query_for_scope(project: dict[str, Any], wig: dict[str, Any] | None = None, measure: dict[str, Any] | None = None) -> str:
    parts = [project.get("name", "")]
    if measure and wig:
        parts.extend([wig.get("title", ""), measure.get("title", "")])
    elif wig:
        parts.append(wig.get("title", ""))
    return " ".join(part for part in parts if part).strip() or "execution risks and blockers"


def _project_budget_slice(project: dict[str, Any], wigs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    active = wigs if wigs is not None else active_wigs(project)
    wig_allocated = sum(float(w.get("budget_allocated") or 0) for w in active)
    project_budget = float(project.get("budget_crore") or 0)
    spent = float(project.get("spent_crore") or 0)
    return {
        "budget_crore": project_budget,
        "spent_crore": spent,
        "wig_allocated_crore": round(wig_allocated, 1),
        "over_spent": project_budget > 0 and spent > project_budget,
        "over_allocated": project_budget > 0 and wig_allocated > project_budget,
        "variance_spent_crore": round(spent - project_budget, 1) if project_budget else None,
        "variance_allocated_crore": round(wig_allocated - project_budget, 1) if project_budget else None,
    }


def _measure_timeline_events(measure: dict[str, Any], wig_title: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for comment in measure.get("comments", []):
        events.append({
            "type": "comment",
            "entity_id": comment.get("id"),
            "measure_id": measure.get("id"),
            "measure": measure.get("title"),
            "wig": wig_title,
            "text": (comment.get("comment") or "")[:500],
            "health_state": comment.get("health_state"),
            "author": comment.get("author"),
            "created_at": comment.get("created_at"),
        })
    for entry in measure.get("progress_history", []):
        events.append({
            "type": "progress",
            "entity_id": entry.get("id"),
            "measure_id": measure.get("id"),
            "measure": measure.get("title"),
            "wig": wig_title,
            "current_value": entry.get("current_value"),
            "note": (entry.get("note") or "")[:500],
            "health_state": entry.get("health_state"),
            "author": entry.get("author"),
            "created_at": entry.get("created_at"),
        })
    events.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return events[:20]


def _scan_scope_execution_signals(
    project: dict[str, Any],
    *,
    wig_filter: str | None = None,
    measure_filter: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    now = datetime.utcnow()
    overdue_items: list[dict[str, Any]] = []
    stale_items: list[dict[str, Any]] = []
    timeline: list[dict[str, Any]] = []

    for wig in active_wigs(project):
        if wig_filter and wig.get("id") != wig_filter:
            continue
        if not measure_filter and entity_is_overdue(wig, complete_fn=wig_is_complete):
            overdue_items.append({
                "type": "wig",
                "wig_id": wig.get("id"),
                "title": wig.get("title"),
                "owner": wig.get("owner") or project.get("owner"),
                "deadline": wig.get("deadline"),
                "days_overdue": days_past_deadline(wig.get("deadline")),
                "update_frequency": wig.get("update_frequency", "weekly"),
            })
        threshold = frequency_stale_days(wig.get("update_frequency", "weekly"))
        for measure in active_measures(wig):
            if measure_filter and measure.get("id") != measure_filter:
                continue
            timeline.extend(_measure_timeline_events(measure, wig.get("title", "")))
            if entity_is_overdue(measure, complete_fn=measure_is_complete):
                overdue_items.append({
                    "type": "lead_measure",
                    "wig_id": wig.get("id"),
                    "measure_id": measure.get("id"),
                    "title": measure.get("title"),
                    "wig": wig.get("title"),
                    "owners": measure.get("assigned_to") or [wig.get("owner") or project.get("owner") or "Unassigned"],
                    "deadline": measure.get("deadline"),
                    "days_overdue": days_past_deadline(measure.get("deadline")),
                    "health_state": measure_health_state(measure),
                    "priority": measure.get("priority", 5),
                })
            last = measure_last_activity(measure)
            days_stale = (now - last).days if last else None
            if last is None or (days_stale is not None and days_stale >= threshold):
                stale_items.append({
                    "wig_id": wig.get("id"),
                    "measure_id": measure.get("id"),
                    "measure": measure.get("title"),
                    "wig": wig.get("title"),
                    "owners": measure.get("assigned_to") or [wig.get("owner") or project.get("owner") or "Unassigned"],
                    "days_stale": days_stale,
                    "stale_threshold_days": threshold,
                    "update_frequency": wig.get("update_frequency", "weekly"),
                    "deadline": measure.get("deadline"),
                    "priority": measure.get("priority", 5),
                })

    timeline.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return (
        sorted(overdue_items, key=lambda item: -(item.get("days_overdue") or 0)),
        sorted(stale_items, key=lambda item: -(item["days_stale"] if item["days_stale"] is not None else 9999)),
        timeline[:30],
    )


def _wig_measure_summaries(wigs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for wig in wigs:
        measures = active_measures(wig)
        rows.append({
            "id": wig.get("id"),
            "title": wig.get("title"),
            "owner": wig.get("owner"),
            "priority": wig.get("priority", 5),
            "update_frequency": wig.get("update_frequency", "weekly"),
            "deadline": wig.get("deadline"),
            "budget_allocated": wig.get("budget_allocated"),
            "progress_percent": progress_percent(
                float(wig.get("from_value") or 0),
                float(wig.get("to_value") or 0),
                float(wig.get("current_value") if wig.get("current_value") is not None else wig.get("from_value") or 0),
            ),
            "overdue": entity_is_overdue(wig, complete_fn=wig_is_complete),
            "measure_count": len(measures),
            "measures": [{
                "id": measure.get("id"),
                "title": measure.get("title"),
                "assigned_to": measure.get("assigned_to"),
                "priority": measure.get("priority", 5),
                "deadline": measure.get("deadline"),
                "budget_allocated": measure.get("budget_allocated"),
                "current_value": measure.get("current_value"),
                "to_value": measure.get("to_value"),
                "unit": measure.get("unit"),
                "health_state": measure_health_state(measure),
                "overdue": entity_is_overdue(measure, complete_fn=measure_is_complete),
            } for measure in measures[:12]],
        })
    return rows


def _filter_collection(items: list[dict[str, Any]], wig_id: str | None, measure_id: str | None) -> list[dict[str, Any]]:
    if measure_id:
        return [item for item in items if item.get("measure_id") == measure_id]
    if wig_id:
        return [item for item in items if item.get("wig_id") == wig_id or (not item.get("wig_id") and not item.get("measure_id"))]
    return items


def collect_contextual_insight_context(
    project_id: str,
    wig_id: str | None = None,
    measure_id: str | None = None,
) -> dict[str, Any]:
    project_oid = oid(project_id)
    project = refresh_project_health(project_oid)
    wig = find_wig(project, wig_id) if wig_id else None
    if wig_id and not wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = find_measure(wig, measure_id) if wig and measure_id else None
    if measure_id and not measure:
        raise HTTPException(status_code=404, detail="Lead measure not found")

    scope = "measure" if measure else "wig" if wig else "project"
    ministry = db.ministries.find_one({"_id": project.get("ministry_id")}) or {}
    scope_wigs = [wig] if wig else active_wigs(project)
    overdue_items, stale_items, timeline = _scan_scope_execution_signals(
        project,
        wig_filter=wig.get("id") if wig else None,
        measure_filter=measure.get("id") if measure else None,
    )

    pid = project["_id"]
    documents = [clean_id(doc) for doc in db.documents.find({"project_id": pid}).sort("created_at", -1).limit(20)]
    assignments = [clean_id(doc) for doc in db.assignments.find({"project_id": pid}).sort("due_date", 1).limit(15)]
    decisions = [clean_id(doc) for doc in db.decisions.find({"project_id": pid}).sort("due_date", 1).limit(15)]
    approvals = [clean_id(doc) for doc in db.approvals.find({"project_id": pid}).sort("created_at", -1).limit(15)]
    notifications = [clean_id(doc) for doc in db.notifications.find({"project_id": pid, "status": "Open"}).sort("created_at", -1).limit(12)]
    meetings = [clean_id(doc) for doc in db.weekly_meetings.find({"project_id": pid}).sort("meeting_date", -1).limit(8)]
    audit_events = [clean_id(doc) for doc in db.audit_events.find({"project_id": pid}).sort("created_at", -1).limit(15)]
    health_snapshots = [clean_id(doc) for doc in db.health_snapshots.find().sort("recorded_at", -1).limit(6)]

    if wig_id:
        documents = _filter_collection(documents, wig_id, measure_id)
        approvals = _filter_collection(approvals, wig_id, measure_id)

    search_query = _insight_query_for_scope(project, wig, measure)
    entity_matches = semantic_search_entities(search_query, limit=10).get("results", [])
    entity_matches = [item for item in entity_matches if str(item.get("project_id")) == str(project["_id"])][:6]
    document_matches = vector_search_documents(search_query, limit=6, project_id=str(project["_id"])).get("results", [])
    if wig_id:
        document_matches = [doc for doc in document_matches if not doc.get("wig_id") or doc.get("wig_id") == wig_id]
    if measure_id:
        document_matches = [doc for doc in document_matches if doc.get("measure_id") == measure_id]

    budget = _project_budget_slice(project, scope_wigs)
    if wig:
        wig_budget = float(wig.get("budget_allocated") or 0)
        measure_allocated = sum(float(m.get("budget_allocated") or 0) for m in active_measures(wig))
        budget["wig_budget_crore"] = wig_budget
        budget["measure_allocated_crore"] = round(measure_allocated, 1)
        budget["wig_over_allocated"] = wig_budget > 0 and measure_allocated > wig_budget
    if measure:
        budget["measure_budget_crore"] = float(measure.get("budget_allocated") or 0)

    entity_label = measure.get("title") if measure else wig.get("title") if wig else project.get("name")
    return {
        "scope": scope,
        "generated_at": datetime.utcnow().isoformat(),
        "entity": {
            "type": scope,
            "title": entity_label,
            "project_id": str(project["_id"]),
            "project_name": project.get("name"),
            "wig_id": wig.get("id") if wig else None,
            "wig_title": wig.get("title") if wig else None,
            "measure_id": measure.get("id") if measure else None,
            "measure_title": measure.get("title") if measure else None,
        },
        "project": {
            "name": project.get("name"),
            "ministry": project.get("ministry") or ministry.get("name"),
            "owner": project.get("owner"),
            "status": project.get("status"),
            "health_score": project.get("health_score"),
            "health_state": project.get("health_state"),
            "priority": project.get("priority", 5),
            "phase": project.get("phase"),
            "due_date": project.get("due_date"),
            "current_state": project.get("current_state"),
            "target_state": project.get("target_state"),
            "kpis": project.get("kpis"),
            "bottlenecks": project.get("bottlenecks", [])[:6],
        },
        "ministry": clean_id(ministry) if ministry else {},
        "focus": clean_id(measure or wig or {
            "title": project.get("name"),
            "owner": project.get("owner"),
            "due_date": project.get("due_date"),
            "priority": project.get("priority", 5),
        }),
        "wigs": _wig_measure_summaries(scope_wigs if scope != "project" else active_wigs(project)),
        "budget": budget,
        "overdue_items": overdue_items[:12],
        "stale_measures": stale_items[:12],
        "timeline": timeline,
        "documents": [{
            "_id": str(doc.get("_id")) if doc.get("_id") else None,
            "title": doc.get("title"),
            "document_type": doc.get("document_type"),
            "risk_score": doc.get("risk_score"),
            "risk_signals": doc.get("risk_signals"),
            "ai_summary": doc.get("ai_summary"),
            "content": (doc.get("content") or "")[:400],
            "wig_id": doc.get("wig_id"),
            "measure_id": doc.get("measure_id"),
        } for doc in documents[:10]],
        "assignments": assignments[:10],
        "decisions": [item for item in decisions if item.get("status") == "Pending"][:8] or decisions[:8],
        "approvals": [item for item in approvals if item.get("status") == "Pending"][:8] or approvals[:8],
        "notifications": notifications[:8],
        "meetings": meetings[:6],
        "audit_events": audit_events[:8],
        "health_snapshots": health_snapshots,
        "vector_matches": [{
            "type": item.get("entity_type") or item.get("document_type"),
            "title": item.get("title"),
            "state": item.get("state"),
            "score": item.get("score"),
            "text": (item.get("text") or item.get("content") or "")[:240],
        } for item in (entity_matches + document_matches)[:8]],
        "counts": {
            "pending_approvals": len([item for item in approvals if item.get("status") == "Pending"]),
            "open_notifications": len(notifications),
            "open_assignments": len([item for item in assignments if item.get("status") not in {"Done", "Completed"}]),
            "pending_decisions": len([item for item in decisions if item.get("status") == "Pending"]),
        },
    }


def _insight_source(
    source_type: str,
    *,
    project_id: str,
    label: str,
    wig_id: str | None = None,
    measure_id: str | None = None,
    entity_id: str | None = None,
    tab: str | None = None,
) -> dict[str, Any]:
    path = f"/projects/{project_id}"
    if wig_id:
        path += f"/wigs/{wig_id}"
    if measure_id:
        path += f"/measures/{measure_id}"
    if tab:
        path += ("&" if "?" in path else "?") + f"tab={tab}"
    return {
        "type": source_type,
        "project_id": project_id,
        "wig_id": wig_id,
        "measure_id": measure_id,
        "entity_id": entity_id,
        "label": label,
        "url_path": path,
        "tab": tab,
    }


def _lookup_wig_measure_ids(
    context: dict[str, Any],
    *,
    wig_title: str | None = None,
    measure_title: str | None = None,
) -> tuple[str | None, str | None]:
    for wig in context.get("wigs") or []:
        if wig_title and (wig.get("title") or "").strip() != (wig_title or "").strip():
            continue
        if measure_title:
            for measure in wig.get("measures") or []:
                if (measure.get("title") or "").strip() == (measure_title or "").strip():
                    return wig.get("id"), measure.get("id")
            continue
        return wig.get("id"), None
    entity = context.get("entity") or {}
    if not wig_title and not measure_title:
        return entity.get("wig_id"), entity.get("measure_id")
    return None, None


def _normalize_risk_source(risk: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Ensure each risk has a navigable source object."""
    project_id = str((context.get("entity") or {}).get("project_id") or "")
    entity = context.get("entity") or {}
    raw = risk.get("source")
    if isinstance(raw, dict) and raw.get("type") and raw.get("project_id"):
        label = raw.get("label") or raw.get("type")
        return _insight_source(
            raw["type"],
            project_id=str(raw.get("project_id") or project_id),
            label=label,
            wig_id=raw.get("wig_id"),
            measure_id=raw.get("measure_id"),
            entity_id=raw.get("entity_id"),
            tab=raw.get("tab"),
        )

    label = raw if isinstance(raw, str) else "Analysis"
    title = (risk.get("title") or "").lower()
    reason = (risk.get("reason") or "").lower()

    if entity.get("measure_id") and (
        "lead measure" in title
        or "timeline" in title
        or "activity" in title
        or "cadence" in label.lower()
        or context.get("scope") == "measure"
    ):
        if "timeline" in title or "activity" in title or "cadence" in label.lower():
            return _insight_source(
                "timeline",
                project_id=project_id,
                wig_id=entity.get("wig_id"),
                measure_id=entity.get("measure_id"),
                label=entity.get("measure_title") or "Lead measure activity",
                tab="activity",
            )
        return _insight_source(
            "measure",
            project_id=project_id,
            wig_id=entity.get("wig_id"),
            measure_id=entity.get("measure_id"),
            label=entity.get("measure_title") or "Lead measure",
            tab="activity",
        )

    if entity.get("wig_id") and context.get("scope") == "wig":
        return _insight_source(
            "wig",
            project_id=project_id,
            wig_id=entity.get("wig_id"),
            label=entity.get("wig_title") or "WIG",
        )

    for item in context.get("overdue_items") or []:
        if item.get("measure_id") and (item.get("title") or "").lower() in title + reason:
            return _insight_source(
                "measure",
                project_id=project_id,
                wig_id=item.get("wig_id"),
                measure_id=item.get("measure_id"),
                label=item.get("title") or "Overdue measure",
                tab="activity",
            )
        if item.get("wig_id") and not item.get("measure_id"):
            if (item.get("title") or "").lower() in title + reason or "deadline" in title:
                return _insight_source(
                    "wig",
                    project_id=project_id,
                    wig_id=item.get("wig_id"),
                    label=item.get("title") or "Overdue WIG",
                )

    if context.get("overdue_items"):
        top = context["overdue_items"][0]
        if top.get("measure_id"):
            return _insight_source(
                "measure",
                project_id=project_id,
                wig_id=top.get("wig_id"),
                measure_id=top.get("measure_id"),
                label=top.get("title") or "Overdue item",
                tab="activity",
            )
        if top.get("wig_id"):
            return _insight_source(
                "wig",
                project_id=project_id,
                wig_id=top.get("wig_id"),
                label=top.get("title") or "Overdue WIG",
            )

    for item in context.get("stale_measures") or []:
        if item.get("measure_id"):
            return _insight_source(
                "measure",
                project_id=project_id,
                wig_id=item.get("wig_id"),
                measure_id=item.get("measure_id"),
                label=item.get("measure") or "Stale lead measure",
                tab="activity",
            )

    pending_approvals = [a for a in context.get("approvals") or [] if a.get("status") == "Pending"]
    if pending_approvals and ("approval" in title or "approval" in label.lower()):
        item = pending_approvals[0]
        return _insight_source(
            "approval",
            project_id=project_id,
            wig_id=item.get("wig_id"),
            measure_id=item.get("measure_id"),
            entity_id=str(item.get("_id") or item.get("id") or ""),
            label=item.get("title") or "Pending approval",
            tab="approvals" if item.get("measure_id") else None,
        )

    pending_decisions = [d for d in context.get("decisions") or [] if d.get("status") == "Pending"]
    if pending_decisions and ("decision" in title or "decision" in label.lower()):
        item = pending_decisions[0]
        return _insight_source(
            "decision",
            project_id=project_id,
            entity_id=str(item.get("_id") or item.get("id") or ""),
            label=item.get("title") or "Pending decision",
        )

    high_risk_docs = [doc for doc in context.get("documents") or [] if (doc.get("risk_score") or 0) >= 0.55]
    if high_risk_docs and ("evidence" in title or "document" in label.lower()):
        doc = high_risk_docs[0]
        return _insight_source(
            "document",
            project_id=project_id,
            wig_id=doc.get("wig_id"),
            measure_id=doc.get("measure_id"),
            entity_id=doc.get("_id"),
            label=doc.get("title") or "Evidence document",
            tab="evidence" if doc.get("measure_id") else None,
        )

    open_assignments = [a for a in context.get("assignments") or [] if a.get("status") not in {"Done", "Completed"}]
    if open_assignments and "assignment" in label.lower():
        item = open_assignments[0]
        return _insight_source(
            "assignment",
            project_id=project_id,
            entity_id=str(item.get("_id") or item.get("id") or ""),
            label=item.get("title") or "Open assignment",
        )

    bottlenecks = (context.get("project") or {}).get("bottlenecks") or []
    if bottlenecks and ("bottleneck" in title or "at risk" in title or "off track" in title):
        wig_id, measure_id = _lookup_wig_measure_ids(context)
        return _insight_source(
            "bottleneck",
            project_id=project_id,
            wig_id=wig_id,
            measure_id=measure_id,
            label=bottlenecks[0],
        )

    wig_id, measure_id = _lookup_wig_measure_ids(context)
    return _insight_source(
        "bottleneck" if bottlenecks else "timeline",
        project_id=project_id,
        wig_id=wig_id or entity.get("wig_id"),
        measure_id=measure_id or entity.get("measure_id"),
        label=label if isinstance(label, str) else "Project overview",
        tab="activity" if measure_id else None,
    )


def local_contextual_insight(context: dict[str, Any]) -> dict[str, Any]:
    scope = context["scope"]
    entity = context["entity"]
    project = context["project"]
    budget = context.get("budget", {})
    risks: list[dict[str, Any]] = []
    highlights: list[dict[str, Any]] = []
    project_id = str(entity.get("project_id") or "")

    label = entity.get("title") or project.get("name")
    focus = context.get("focus") or {}

    if scope in {"wig", "measure"} and focus:
        progress = progress_percent(
            float(focus.get("from_value") or 0),
            float(focus.get("to_value") or 0),
            float(focus.get("current_value") if focus.get("current_value") is not None else focus.get("from_value") or 0),
        )
        unit = focus.get("unit") or ""
        if scope == "measure":
            owners = ", ".join(focus.get("assigned_to") or []) or "Unassigned"
            if entity_is_overdue(focus, complete_fn=measure_is_complete):
                risks.append({
                    "title": "Lead measure past deadline",
                    "severity": "high",
                    "reason": f"{label} is overdue (due {focus.get('deadline')}). Assigned to {owners}. Progress {progress}%{f' {unit}' if unit else ''}.",
                    "source": _insight_source(
                        "measure",
                        project_id=project_id,
                        wig_id=entity.get("wig_id"),
                        measure_id=entity.get("measure_id"),
                        label=label,
                        tab="activity",
                    ),
                })
            elif progress < 40 and project.get("status") in {"At Risk", "Off Track"}:
                risks.append({
                    "title": "Lead measure lagging on at-risk project",
                    "severity": "high",
                    "reason": f"{label} at {progress}% while project is {project.get('status')} (health {project.get('health_score')}%).",
                    "source": _insight_source(
                        "measure",
                        project_id=project_id,
                        wig_id=entity.get("wig_id"),
                        measure_id=entity.get("measure_id"),
                        label=label,
                        tab="activity",
                    ),
                })
            if not context.get("timeline"):
                risks.append({
                    "title": "No recent timeline activity",
                    "severity": "medium",
                    "reason": f"No progress updates or comments recorded recently for {label}.",
                    "source": _insight_source(
                        "timeline",
                        project_id=project_id,
                        wig_id=entity.get("wig_id"),
                        measure_id=entity.get("measure_id"),
                        label=f"{label} activity",
                        tab="activity",
                    ),
                })
        if scope == "wig":
            if entity_is_overdue(focus, complete_fn=wig_is_complete):
                risks.append({
                    "title": "WIG past deadline",
                    "severity": "high",
                    "reason": f"{label} is overdue (due {focus.get('deadline')}). Progress {progress}%.",
                    "source": _insight_source(
                        "wig",
                        project_id=project_id,
                        wig_id=entity.get("wig_id"),
                        label=label,
                    ),
                })
            elif progress < 50:
                risks.append({
                    "title": "WIG progress behind pace",
                    "severity": "medium",
                    "reason": f"{label} at {progress}% with owner {focus.get('owner') or 'Unassigned'}.",
                    "source": _insight_source(
                        "wig",
                        project_id=project_id,
                        wig_id=entity.get("wig_id"),
                        label=label,
                    ),
                })

    if project.get("status") in {"At Risk", "Off Track"} and scope == "project":
        bottleneck = (project.get("bottlenecks") or ["Project health"])[0]
        wig_id, measure_id = _lookup_wig_measure_ids(context)
        risks.append({
            "title": f"{project['name']} is {project['status'].lower()}",
            "severity": "high",
            "reason": f"Health score {project.get('health_score')}% with bottlenecks: {', '.join(project.get('bottlenecks') or []) or 'not recorded'}.",
            "source": _insight_source(
                "bottleneck",
                project_id=project_id,
                wig_id=wig_id,
                measure_id=measure_id,
                label=bottleneck,
            ),
        })
    if context.get("overdue_items"):
        top = context["overdue_items"][0]
        src_type = "measure" if top.get("measure_id") else "wig"
        risks.append({
            "title": f"{len(context['overdue_items'])} items past deadline",
            "severity": "high",
            "reason": f"Most urgent: {top.get('title')} ({top.get('days_overdue')} days overdue).",
            "source": _insight_source(
                src_type,
                project_id=project_id,
                wig_id=top.get("wig_id"),
                measure_id=top.get("measure_id"),
                label=top.get("title") or "Overdue item",
                tab="activity" if top.get("measure_id") else None,
            ),
        })
    if context.get("stale_measures"):
        top = context["stale_measures"][0]
        owners = ", ".join(top.get("owners") or [])
        risks.append({
            "title": f"{len(context['stale_measures'])} lead measures missed update cadence",
            "severity": "high",
            "reason": f"{top.get('measure')} on {top.get('wig')} — owners {owners} silent for {top.get('days_stale') or 'unknown'} days (cadence: {top.get('update_frequency')}).",
            "source": _insight_source(
                "measure",
                project_id=project_id,
                wig_id=top.get("wig_id"),
                measure_id=top.get("measure_id"),
                label=top.get("measure") or "Stale lead measure",
                tab="activity",
            ),
        })
    if budget.get("over_spent"):
        risks.append({
            "title": "Spending exceeds project budget",
            "severity": "high",
            "reason": f"Spent ₹{budget.get('spent_crore')} Cr vs ₹{budget.get('budget_crore')} Cr budget.",
            "source": _insight_source("bottleneck", project_id=project_id, label="Budget"),
        })
    if budget.get("over_allocated") or budget.get("wig_over_allocated"):
        wig_id, _ = _lookup_wig_measure_ids(context)
        risks.append({
            "title": "Budget over-allocated to WIGs or measures",
            "severity": "medium",
            "reason": "Allocated sub-budgets exceed their parent envelope.",
            "source": _insight_source("bottleneck", project_id=project_id, wig_id=wig_id, label="Budget allocation"),
        })
    pending = context.get("counts", {})
    pending_approvals = [a for a in context.get("approvals") or [] if a.get("status") == "Pending"]
    if pending.get("pending_approvals") and pending_approvals:
        item = pending_approvals[0]
        risks.append({
            "title": f"{pending['pending_approvals']} approvals pending",
            "severity": "medium",
            "reason": "Unblocked approvals may be delaying execution.",
            "source": _insight_source(
                "approval",
                project_id=project_id,
                wig_id=item.get("wig_id"),
                measure_id=item.get("measure_id"),
                entity_id=str(item.get("_id") or ""),
                label=item.get("title") or "Pending approval",
                tab="approvals" if item.get("measure_id") else None,
            ),
        })
    pending_decisions = [d for d in context.get("decisions") or [] if d.get("status") == "Pending"]
    if pending.get("pending_decisions") and pending_decisions:
        item = pending_decisions[0]
        risks.append({
            "title": f"{pending['pending_decisions']} decisions awaiting resolution",
            "severity": "medium",
            "reason": "Executive decisions are queued and may block progress.",
            "source": _insight_source(
                "decision",
                project_id=project_id,
                entity_id=str(item.get("_id") or ""),
                label=item.get("title") or "Pending decision",
            ),
        })
    high_risk_docs = [doc for doc in context.get("documents", []) if (doc.get("risk_score") or 0) >= 0.55]
    if high_risk_docs:
        doc = high_risk_docs[0]
        risks.append({
            "title": "Evidence signals elevated risk",
            "severity": "medium",
            "reason": f"{doc.get('title')}: {(doc.get('ai_summary') or {}).get('headline') or doc.get('content', '')[:120]}",
            "source": _insight_source(
                "document",
                project_id=project_id,
                wig_id=doc.get("wig_id"),
                measure_id=doc.get("measure_id"),
                entity_id=doc.get("_id"),
                label=doc.get("title") or "Evidence document",
                tab="evidence" if doc.get("measure_id") else None,
            ),
        })

    if project.get("health_score", 0) >= 75 and scope == "project":
        highlights.append({"title": "Healthy execution posture", "detail": f"Portfolio health for this project is {project.get('health_score')}%."})
    if not context.get("stale_measures") and context.get("wigs"):
        highlights.append({"title": "Cadence discipline maintained", "detail": "All in-scope lead measures have recent updates."})
    if context.get("meetings"):
        highlights.append({"title": "WIG sessions logged", "detail": f"Latest session on {context['meetings'][0].get('meeting_date')}."})

    summary_parts = [
        f"{label} ({scope}) review at {context.get('generated_at', '')[:10]}.",
        f"Project health {project.get('health_score')}% — status {project.get('status')}.",
    ]
    if scope != "project":
        summary_parts.append(f"Scope limited to {'lead measure' if scope == 'measure' else 'WIG'} data across linked collections.")
    if risks:
        summary_parts.append(f"{len(risks)} risk signals identified from deadlines, cadence, budget, and workflow data.")
    else:
        summary_parts.append("No critical risk signals detected in the current data snapshot.")

    return {
        "summary": " ".join(summary_parts),
        "risks": risks[:8],
        "highlights": highlights[:5],
        "llm_status": format_fallback_status(),
    }


def _compact_insight_context(context: dict[str, Any]) -> dict[str, Any]:
    project = context.get("project") or {}
    return {
        "scope": context.get("scope"),
        "entity": context.get("entity"),
        "project": {k: project.get(k) for k in (
            "name", "status", "health_score", "owner", "due_date", "bottlenecks", "phase", "priority",
        )},
        "focus": context.get("focus"),
        "budget": context.get("budget"),
        "overdue_items": (context.get("overdue_items") or [])[:8],
        "stale_measures": (context.get("stale_measures") or [])[:8],
        "timeline": (context.get("timeline") or [])[:10],
        "counts": context.get("counts"),
        "wigs": (context.get("wigs") or [])[:4],
    }


def _clean_risk_items(risks: list[Any], context: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for risk in risks or []:
        if not isinstance(risk, dict):
            continue
        title = (risk.get("title") or "").strip()
        reason = (risk.get("reason") or "").strip()
        if not title and not reason:
            continue
        item = {
            "title": title or "Risk signal",
            "severity": _normalize_risk_severity(risk.get("severity")),
            "reason": reason or title,
        }
        if context:
            item["source"] = _normalize_risk_source({**item, "source": risk.get("source")}, context)
        elif isinstance(risk.get("source"), dict):
            item["source"] = risk.get("source")
        else:
            item["source"] = risk.get("source") or "Analysis"
        cleaned.append(item)
    return cleaned


def ensure_insight_payload(
    insight: dict[str, Any],
    context: dict[str, Any],
    *,
    llm_status: str | None = None,
) -> dict[str, Any]:
    """Guarantee non-empty summary and risks using deterministic context builder."""
    fallback = local_contextual_insight(context)
    summary = (insight.get("summary") or "").strip()
    risks = _clean_risk_items(insight.get("risks") or [], context)
    highlights = [
        item for item in (insight.get("highlights") or [])
        if isinstance(item, dict) and (item.get("title") or "").strip()
    ]

    status = llm_status or insight.get("llm_status") or fallback["llm_status"]
    enriched = False

    if not summary:
        summary = fallback["summary"]
        enriched = True
    if not risks:
        risks = fallback["risks"]
        enriched = True
    if not highlights and fallback.get("highlights"):
        highlights = fallback["highlights"]

    if not risks and context.get("project"):
        project = context["project"]
        label = (context.get("entity") or {}).get("title") or project.get("name") or "Entity"
        risks = _clean_risk_items([{
            "title": f"{label} requires monitoring",
            "severity": "medium",
            "reason": (
                f"Project health {project.get('health_score')}% with status {project.get('status')}. "
                f"{len(context.get('timeline') or [])} timeline events in scope."
            ),
            "source": "Context",
        }], context)
        if not summary:
            summary = fallback["summary"]
        enriched = True

    if enriched and status and not status.startswith("Local"):
        status = sanitize_llm_status(status)

    return {
        "summary": summary,
        "risks": _clean_risk_items(risks, context)[:8],
        "highlights": highlights[:5],
        "llm_status": sanitize_llm_status(status),
    }


def openai_contextual_insight(context: dict[str, Any]) -> dict[str, Any]:
    scope = context["scope"]
    entity = context["entity"]
    focus_label = entity.get("title") or context["project"].get("name")
    question = (
        f"Summarize execution status for this {scope} and identify all material risks. "
        f"Focus: {focus_label}. Use only supplied data."
    )
    system = (
        "You are a 4DX delivery advisor reviewing a single project, WIG, or lead measure. "
        "Use the supplied context only — project/WIG/measure fields, budget, overdue items, stale cadence updates, "
        "comments/timeline, documents, approvals, decisions, assignments, notifications, meetings, audit events, and vector matches. "
        "Return only valid JSON with summary, risks (title, severity as high|medium|low, reason, source), and highlights (title, detail)."
    )
    schema_hint = {
        "summary": "3-5 sentence executive summary with concrete numbers and names",
        "risks": [{"title": "risk", "severity": "high|medium|low", "reason": "specific evidence", "source": {"type": "measure|wig|approval|document|timeline|bottleneck", "label": "human label"}}],
        "highlights": [{"title": "positive signal", "detail": "specific evidence"}],
    }
    compact = _compact_insight_context(context)
    prompt = {"question": question, "required_json_shape": schema_hint, "context": compact}
    llm = call_llm_json(system, json.dumps(prompt, default=str), validate=insight_payload_valid, feature="insight")

    if llm.get("data"):
        data = llm["data"]
        draft = {
            "summary": data.get("summary") or "",
            "risks": data.get("risks") or [],
            "highlights": data.get("highlights") or [],
            "llm_status": llm["llm_status"],
        }
        return ensure_insight_payload(draft, context, llm_status=llm["llm_status"])

    fallback = local_contextual_insight(context)
    fallback["llm_status"] = sanitize_llm_status(llm.get("llm_status"))
    return ensure_insight_payload(fallback, context, llm_status=fallback["llm_status"])


def generate_contextual_insight(project_id: str, wig_id: str | None = None, measure_id: str | None = None) -> dict[str, Any]:
    context = collect_contextual_insight_context(project_id, wig_id, measure_id)
    insight = openai_contextual_insight(context)
    return {
        **insight,
        "scope": context["scope"],
        "entity": context["entity"],
    }


def local_contextual_insight_ask(question: str, context: dict[str, Any]) -> dict[str, Any]:
    q = question.lower()
    scope = context["scope"]
    entity = context["entity"]
    project = context["project"]
    label = entity.get("title") or project.get("name")
    parts: list[str] = []
    insight = local_contextual_insight(context)
    focus = context.get("focus") or {}

    if any(word in q for word in ("health", "status", "track", "progress", "pace")):
        parts.append(f"{label} sits on project {project.get('name')} with health {project.get('health_score')}% ({project.get('status')}).")
        if scope in {"wig", "measure"} and focus:
            progress = progress_percent(
                float(focus.get("from_value") or 0),
                float(focus.get("to_value") or 0),
                float(focus.get("current_value") if focus.get("current_value") is not None else focus.get("from_value") or 0),
            )
            parts.append(f"In-scope progress is {progress}% toward {focus.get('target_state') or 'target'}.")

    if any(word in q for word in ("risk", "overdue", "stale", "budget", "block", "concern", "issue")):
        risks = insight.get("risks") or []
        if risks:
            for risk in risks[:3]:
                parts.append(f"{risk.get('title')}: {risk.get('reason')}")
        else:
            parts.append("No critical risk signals are present in the current snapshot.")

    if any(word in q for word in ("highlight", "positive", "working", "well", "win")):
        for item in (insight.get("highlights") or [])[:3]:
            detail = item.get("detail") or ""
            parts.append(f"{item.get('title')}{(': ' + detail) if detail else ''}")

    if any(word in q for word in ("owner", "assign", "who")):
        if scope == "measure":
            owners = ", ".join(focus.get("assigned_to") or []) or "Unassigned"
            parts.append(f"{label} is assigned to {owners}.")
        elif scope == "wig":
            parts.append(f"{label} owner: {focus.get('owner') or 'Unassigned'}.")
        else:
            parts.append(f"Project owner: {project.get('owner') or 'Unassigned'}.")

    if any(word in q for word in ("deadline", "due", "date", "when")):
        due = focus.get("deadline") or project.get("due_date")
        if due:
            parts.append(f"Due date in scope: {due}.")
        overdue = context.get("overdue_items") or []
        if overdue:
            top = overdue[0]
            parts.append(f"Most urgent overdue item: {top.get('title')} ({top.get('days_overdue')} days).")

    if not parts:
        parts.append(insight.get("summary") or f"Insufficient data to answer '{question}' about {label}. Review the summary and risks above.")

    return {
        "answer": " ".join(parts)[:1200],
        "llm_status": format_fallback_status(),
        "scope": scope,
        "entity": entity,
    }


def openai_contextual_insight_ask(question: str, context: dict[str, Any]) -> dict[str, Any]:
    scope = context["scope"]
    entity = context["entity"]
    focus_label = entity.get("title") or context["project"].get("name")
    system = (
        "You are a 4DX delivery advisor answering follow-up questions about a single project, WIG, or lead measure. "
        "Use only the supplied context — project/WIG/measure fields, budget, overdue items, stale cadence updates, "
        "comments/timeline, documents, approvals, decisions, assignments, notifications, meetings, audit events, and vector matches. "
        "Return only valid JSON with a concise answer (2-5 sentences) grounded in that data. "
        "If the context cannot support an answer, say so briefly."
    )
    schema_hint = {"answer": "concise answer grounded in context"}
    compact = _compact_insight_context(context)
    prompt = {
        "user_question": question,
        "scope": scope,
        "focus": focus_label,
        "required_json_shape": schema_hint,
        "context": compact,
    }
    llm = call_llm_json(
        system,
        json.dumps(prompt, default=str),
        validate=insight_ask_payload_valid,
        feature="insight",
    )

    if llm.get("data"):
        answer = (llm["data"].get("answer") or "").strip()
        if answer:
            return {
                "answer": answer,
                "llm_status": sanitize_llm_status(llm["llm_status"]),
                "scope": scope,
                "entity": entity,
            }

    fallback = local_contextual_insight_ask(question, context)
    fallback["llm_status"] = sanitize_llm_status(llm.get("llm_status"))
    return fallback


def generate_contextual_insight_ask(
    project_id: str,
    question: str,
    wig_id: str | None = None,
    measure_id: str | None = None,
) -> dict[str, Any]:
    cleaned = (question or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Question is required")
    context = collect_contextual_insight_context(project_id, wig_id, measure_id)
    return openai_contextual_insight_ask(cleaned, context)


INSIGHT_PRESETS = {
    "not_working": "What is not working across the portfolio right now? Identify the weakest projects, stalled WIGs, and recurring bottlenecks.",
    "not_updating": "Who is not updating their work? List the owners with lead measures that have no recent progress updates or comments, and what they own.",
    "at_risk": "Which projects are at risk and why? Rank them, explain the drivers, and state what would recover each one.",
    "budget": "Which projects, WIGs, or lead measures are over or under budget? Highlight overspend, over-allocation, and where funds remain unassigned.",
}


@app.post("/api/ai/insight")
def create_ai_insight(payload: AIInsightIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    question = (payload.question or "").strip() or INSIGHT_PRESETS.get(payload.preset or "", "")
    if not question:
        question = "Give me an executive summary of portfolio execution: what is working, what is not, and who needs to act."
    context = collect_insight_context(question, payload.stale_days)
    insight = openai_portfolio_insight(context, question)
    record = {
        "question": question,
        "preset": payload.preset,
        "insight": insight,
        "portfolio_snapshot": context["portfolio"],
        "created_by": user["phone"],
        "created_at": datetime.utcnow(),
    }
    db.ai_insights.insert_one(record)
    return {
        "question": question,
        "insight": insight,
        "data": {
            "portfolio": context["portfolio"],
            "at_risk_projects": context["at_risk_projects"],
            "stale_owners": context["stale_owners"],
            "stale_measures": context["stale_measures"][:12],
            "top_bottlenecks": context["top_bottlenecks"],
            "stale_days": context["stale_days"],
            "budget": context.get("budget", {}),
        },
    }


@app.post("/api/ai/insight/project/{project_id}")
def ai_insight_project(project_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return generate_contextual_insight(project_id)


@app.post("/api/ai/insight/wig/{project_id}/{wig_id}")
def ai_insight_wig(project_id: str, wig_id: str, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return generate_contextual_insight(project_id, wig_id=wig_id)


@app.post("/api/ai/insight/measure/{project_id}/{wig_id}/{measure_id}")
def ai_insight_measure(
    project_id: str,
    wig_id: str,
    measure_id: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return generate_contextual_insight(project_id, wig_id=wig_id, measure_id=measure_id)


@app.post("/api/ai/insight/project/{project_id}/ask")
def ai_insight_project_ask(
    project_id: str,
    payload: ContextualInsightAskIn,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return generate_contextual_insight_ask(project_id, payload.question)


@app.post("/api/ai/insight/wig/{project_id}/{wig_id}/ask")
def ai_insight_wig_ask(
    project_id: str,
    wig_id: str,
    payload: ContextualInsightAskIn,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return generate_contextual_insight_ask(project_id, payload.question, wig_id=wig_id)


@app.post("/api/ai/insight/measure/{project_id}/{wig_id}/{measure_id}/ask")
def ai_insight_measure_ask(
    project_id: str,
    wig_id: str,
    measure_id: str,
    payload: ContextualInsightAskIn,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    return generate_contextual_insight_ask(
        project_id,
        payload.question,
        wig_id=wig_id,
        measure_id=measure_id,
    )


@app.get("/api/health")
def health() -> dict[str, str]:
    client.admin.command("ping")
    return {"status": "ok", "database": DB_NAME}


@app.get("/api/public/settings")
def public_settings() -> dict[str, Any]:
    settings = db.settings.find_one({"key": "branding"}, {"_id": 0})
    app_mode_doc = db.settings.find_one({"key": "app_mode"}, {"_id": 0, "key": 0}) or {}
    if not settings:
        payload = {
            "title": "4DX Execution Platform",
            "department": "Strategic Delivery Office",
            "banner": "Focus. Measure. Score. Execute.",
            "logo_url": "",
            "locale": "en",
            "region": "global",
            "currency": "USD",
            "timezone": "UTC",
            "org_type": "enterprise",
        }
    else:
        payload = dict(settings)
        payload.pop("key", None)
    payload["app_mode"] = app_mode_doc.get("mode", get_app_mode())
    payload["auto_load_demo"] = bool(app_mode_doc.get("auto_load_demo"))
    if DEMO_OTP_MODE:
        payload["demo_admin_phones"] = sorted(ADMIN_PHONES)
    return payload


@app.get("/api/public/regions")
def public_regions() -> list[dict[str, Any]]:
    return REGION_CATALOG


@app.get("/api/portfolio/export")
def export_portfolio(user: dict[str, Any] = Depends(current_user)) -> StreamingResponse:
    refresh_all_project_health()
    ministries = {str(doc["_id"]): doc.get("name", "") for doc in db.ministries.find()}
    projects = [clean_id(doc) for doc in db.projects.find().sort("name", 1)]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "Project",
        "Department",
        "Owner",
        "Status",
        "Health Score",
        "Health State",
        "Phase",
        "Due Date",
        "Budget",
        "Spent",
        "WIGs",
        "Lead Measures",
        "Schedule KPI",
        "Lead KPI",
        "Cadence KPI",
    ])
    for project in projects:
        wigs = [wig for wig in project.get("wigs", []) if not wig.get("archived_at")]
        measure_count = sum(
            len([measure for measure in wig.get("lead_measures", []) if not measure.get("archived_at")])
            for wig in wigs
        )
        kpis = project.get("kpis") or {}
        writer.writerow([
            project.get("name", ""),
            project.get("ministry") or ministries.get(str(project.get("ministry_id", "")), ""),
            project.get("owner", ""),
            project.get("status", ""),
            project.get("health_score", ""),
            project.get("health_state", ""),
            project.get("phase", ""),
            project.get("due_date", ""),
            project.get("budget_crore", ""),
            project.get("spent_crore", ""),
            len(wigs),
            measure_count,
            kpis.get("schedule", ""),
            kpis.get("lead_measures", ""),
            kpis.get("cadence", ""),
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="4dx-portfolio.csv"'},
    )


@app.post("/api/auth/request-otp")
def request_otp(payload: PhoneRequest) -> dict[str, str]:
    phone = normalize_phone(payload.phone)
    if len(phone) < 6:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    otp = f"{random.randint(100000, 999999)}"
    db.otp_requests.update_one(
        {"phone": phone},
        {"$set": {"otp": otp, "created_at": datetime.utcnow(), "used": False}},
        upsert=True,
    )
    response: dict[str, str] = {"message": "OTP sent"}
    if DEMO_OTP_MODE:
        response["demo_otp"] = otp
    return response


@app.post("/api/auth/verify-otp")
def verify_otp(payload: VerifyRequest) -> dict[str, Any]:
    phone = normalize_phone(payload.phone)
    record = db.otp_requests.find_one({"phone": phone, "otp": payload.otp, "used": False})
    if not record:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    created_at = record.get("created_at")
    if created_at and created_at < datetime.utcnow() - timedelta(minutes=10):
        raise HTTPException(status_code=400, detail="OTP expired")
    role = "admin" if phone in ADMIN_PHONES else "user"
    db.users.update_one(
        {"phone": phone},
        {"$set": {"phone": phone, "role": role, "updated_at": datetime.utcnow()}, "$setOnInsert": {"created_at": datetime.utcnow()}},
        upsert=True,
    )
    db.otp_requests.update_one({"_id": record["_id"]}, {"$set": {"used": True}})
    user = db.users.find_one({"phone": phone})
    token = token_for(user)
    return {"token": token, "user": clean_id(user)}


@app.get("/api/auth/me")
def auth_me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    role = "admin" if user.get("phone") in ADMIN_PHONES else "user"
    if user.get("role") != role:
        db.users.update_one({"_id": user["_id"]}, {"$set": {"role": role, "updated_at": datetime.utcnow()}})
        user = db.users.find_one({"_id": user["_id"]})
    return {"user": clean_id(user)}


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
        "health_trend": portfolio_health_trend(),
        "pending_approvals": db.approvals.count_documents({"status": "Pending"}),
    }


@app.get("/api/scoreboard")
def scoreboard(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    rows = build_scoreboard_rows()
    counts: dict[str, int] = {}
    for row in rows:
        state = row["health_state"]
        counts[state] = counts.get(state, 0) + 1
    return {"rows": rows, "counts": counts, "total": len(rows)}


@app.get("/api/approvals")
def list_approvals(status: str | None = None, user: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if status:
        query["status"] = status
    rows = [clean_id(doc) for doc in db.approvals.find(query).sort("created_at", -1).limit(50)]
    project_names = {str(p["_id"]): p["name"] for p in db.projects.find({}, {"name": 1})}
    for row in rows:
        row["project_name"] = project_names.get(str(row.get("project_id")), "Project")
    return rows


@app.get("/api/cadence")
def cadence_summary(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    meetings = [clean_id(doc) for doc in db.weekly_meetings.find().sort("meeting_date", -1).limit(20)]
    project_names = {str(p["_id"]): p["name"] for p in db.projects.find({}, {"name": 1})}
    for meeting in meetings:
        meeting["project_name"] = project_names.get(str(meeting.get("project_id")), "Project")
    open_assignments = [clean_id(doc) for doc in db.assignments.find({"status": {"$ne": "Done"}}).sort("due_date", 1).limit(12)]
    return {
        "meetings": meetings,
        "assignments": open_assignments,
        "scoreboard_summary": build_scoreboard_rows()[:8],
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
        "priority": payload.priority,
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


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdateIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    before = dict(project)
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return clean_id(project)
    updates["updated_by"] = user["phone"]
    updates["updated_at"] = datetime.utcnow()
    db.projects.update_one({"_id": project["_id"]}, {"$set": updates})
    refreshed = refresh_project_health(project["_id"])
    log_audit("update", "project", project, user, before=before, after=updates)
    return clean_id(refreshed)


@app.post("/api/projects/{project_id}/wigs")
def add_wig(project_id: str, payload: WigIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    wig = payload.model_dump()
    wig["update_frequency"] = normalize_update_frequency(wig.get("update_frequency"))
    if wig.get("priority") is None:
        wig["priority"] = project.get("priority", 5)
    validate_project_wig_budget(project, additional=float(wig.get("budget_allocated") or 0))
    validate_wig_deadline(project, wig.get("deadline"))
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
    updates = payload.model_dump(exclude_none=True)
    if "update_frequency" in updates:
        updates["update_frequency"] = normalize_update_frequency(updates["update_frequency"])
    for key, value in updates.items():
        wig[key] = value
    validate_project_wig_budget(project, additional=float(wig.get("budget_allocated") or 0), exclude_wig_id=wig_id)
    validate_wig_deadline(project, wig.get("deadline"))
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
    parent_wig = find_wig(project, wig_id)
    if not parent_wig:
        raise HTTPException(status_code=404, detail="WIG not found")
    measure = payload.model_dump()
    if measure.get("priority") is None:
        measure["priority"] = parent_wig.get("priority", project.get("priority", 5))
    validate_wig_measure_budget(parent_wig, additional=float(measure.get("budget_allocated") or 0))
    validate_measure_deadline(project, parent_wig, measure.get("deadline"))
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
    validate_wig_measure_budget(wig, additional=float(measure.get("budget_allocated") or 0), exclude_measure_id=measure_id)
    validate_measure_deadline(project, wig, measure.get("deadline"))
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


@app.post("/api/projects/{project_id}/meeting-to-action/parse")
def meeting_to_action_parse(project_id: str, payload: MeetingNotesIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    notes = (payload.notes or "").strip()
    if not notes:
        raise HTTPException(status_code=400, detail="Meeting notes are required")
    ministry_id = (payload.ministry_id or "").strip() or str(project.get("ministry_id") or "")
    if not ministry_id:
        raise HTTPException(status_code=400, detail="Ministry is required")
    if str(project.get("ministry_id")) != ministry_id:
        raise HTTPException(status_code=400, detail="Project does not belong to selected ministry")
    ministry_projects = list(db.projects.find({"ministry_id": oid(ministry_id)}))
    project = refresh_project_health(project["_id"])
    preview = parse_meeting_notes(notes, project, ministry_projects=ministry_projects)
    preview["catalog"] = build_ministry_catalog(ministry_projects)
    preview["ministry_id"] = ministry_id
    return preview


@app.post("/api/ministries/{ministry_id}/meeting-to-action/parse")
def ministry_meeting_to_action_parse(ministry_id: str, payload: MeetingNotesIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    notes = (payload.notes or "").strip()
    if not notes:
        raise HTTPException(status_code=400, detail="Meeting notes are required")
    ministry_projects = list(db.projects.find({"ministry_id": oid(ministry_id)}))
    if not ministry_projects:
        raise HTTPException(status_code=404, detail="No projects found for this ministry")
    for proj in ministry_projects:
        require_project_editor(proj, user)
    anchor = refresh_project_health(ministry_projects[0]["_id"])
    preview = parse_meeting_notes(notes, anchor, ministry_projects=ministry_projects)
    preview["catalog"] = build_ministry_catalog(ministry_projects)
    preview["ministry_id"] = ministry_id
    return preview


@app.post("/api/projects/{project_id}/meeting-to-action/apply")
def meeting_to_action_apply(project_id: str, payload: MeetingToActionApplyIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    require_project_editor(project, user)
    ministry_id = (payload.ministry_id or "").strip() or str(project.get("ministry_id") or "")
    if not ministry_id:
        raise HTTPException(status_code=400, detail="Ministry is required")
    if str(project.get("ministry_id")) != ministry_id:
        raise HTTPException(status_code=400, detail="Project does not belong to selected ministry")
    project = refresh_project_health(project["_id"], vectorize=False)
    payload_data = payload.model_dump()
    for key in ("proposed_wigs", "proposed_measures", "proposed_actions"):
        for item in payload_data.get(key) or []:
            if item.get("project_id"):
                continue
            item["project_id"] = project_id
    try:
        result = apply_meeting_to_action(
            project,
            payload_data,
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
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to apply meeting actions") from exc
    return {
        "status": "applied",
        "created_wigs": result["created_wigs"],
        "created_measures": result["created_measures"],
        "comments_posted": result["comments_posted"],
        "assignments_created": result["assignments_created"],
        "project": clean_id(result["project"]),
    }


@app.post("/api/ministries/{ministry_id}/meeting-to-action/apply")
def ministry_meeting_to_action_apply(ministry_id: str, payload: MeetingToActionApplyIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    payload_data = payload.model_dump()
    try:
        result = apply_ministry_meeting_to_action(
            ministry_id,
            payload_data,
            user,
            db=db,
            find_project=lambda project_id: db.projects.find_one({"_id": oid(project_id)}),
            normalize_update_frequency=normalize_update_frequency,
            validate_project_wig_budget=validate_project_wig_budget,
            validate_wig_deadline=validate_wig_deadline,
            validate_wig_measure_budget=validate_wig_measure_budget,
            validate_measure_deadline=validate_measure_deadline,
            refresh_project_health=refresh_project_health,
            log_audit=log_audit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to apply meeting actions") from exc
    return {
        "status": "applied",
        "created_wigs": result["created_wigs"],
        "created_measures": result["created_measures"],
        "comments_posted": result["comments_posted"],
        "assignments_created": result["assignments_created"],
        "projects_updated": result["projects_updated"],
        "project": clean_id(result["project"]) if result.get("project") else None,
    }


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
    filename = file.filename or "Uploaded Document"
    content, file_meta = extract_uploaded_file_text(raw, filename, file.content_type)
    doc = insert_document(project["_id"], project["ministry_id"], filename, document_type, content[:20000], user["phone"], wig_id, measure_id, file_meta)
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


@app.post("/api/ai/decision-brief")
def create_ai_decision_brief(payload: AIDecisionIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    project = db.projects.find_one({"_id": oid(payload.project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project = refresh_project_health(project["_id"])
    context = collect_decision_context(project, payload.question)
    brief = openai_decision_brief(context, payload.question)
    now = datetime.utcnow()
    record = {
        "project_id": project["_id"],
        "ministry_id": project["ministry_id"],
        "question": payload.question or "What decision should leadership take now?",
        "brief": brief,
        "context_snapshot": context,
        "embedding_provider": embedding_provider_status(),
        "created_by": user["phone"],
        "created_at": now,
    }
    result = db.ai_decision_briefs.insert_one(record)
    return {
        "brief_id": str(result.inserted_id),
        "generated_at": now.isoformat(),
        "brief": brief,
        "project": clean_id(project),
        "evidence_count": len(context.get("evidence", [])),
        "vector_match_count": len(context.get("vector_matches", [])),
        "embedding_provider": record["embedding_provider"],
    }


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


@app.get("/api/admin/llm-status")
def admin_llm_status(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return get_llm_provider_status()


@app.put("/api/admin/settings")
def update_settings(payload: SettingsIn, admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    update["updated_by"] = admin["phone"]
    update["updated_at"] = datetime.utcnow()
    db.settings.update_one({"key": "branding"}, {"$set": update}, upsert=True)
    return public_settings()


@app.post("/api/admin/reseed")
def reseed(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    result = reseed_demo_payload()
    return {"status": "reseeded", **result}


@app.put("/api/admin/app-mode")
def update_app_mode(payload: AppModeIn, admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    result = set_app_mode(payload.mode, payload.auto_load_demo)
    if payload.mode == "dev" and payload.auto_load_demo:
        reseed_demo_payload()
        result["reseeded"] = True
    result["settings"] = public_settings()
    return result


@app.get("/api/admin/cleanup-db")
def preview_cleanup_db(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    orphans = list_orphan_collections(db)
    droppable = [item for item in orphans if item["safe_to_drop"]]
    return {
        "allowed_collections": sorted(ALLOWED_COLLECTIONS),
        "orphans": orphans,
        "will_drop": [item["name"] for item in droppable],
    }


@app.post("/api/admin/cleanup-db")
def cleanup_db(admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    return cleanup_orphan_collections(db, dry_run=False)


@app.post("/api/admin/reseed-demo")
async def reseed_demo(
    confirm: bool = Form(default=False),
    file: UploadFile | None = File(default=None),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    mode = get_app_mode()
    if mode == "prod" and not confirm:
        raise HTTPException(status_code=400, detail="Production reseed requires confirm=true")
    data: dict[str, Any] | None = None
    if file and file.filename:
        raw = await file.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON upload: {exc}") from exc
    result = reseed_demo_payload(data)
    return {"status": "reseeded", **result}
