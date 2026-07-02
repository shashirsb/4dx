# 4DX Government Execution Dashboard

A full-stack 4 Disciplines of Execution web app with:

- React + Vite frontend
- Python FastAPI backend
- MongoDB Atlas persistence
- Mobile OTP login
- Regular and admin roles
- Admin branding controls for title, department, banner, and logo placeholder
- Tesla-dashboard-inspired command center UI
- Five seeded ministries: Public Works, Urban Development, Water Resources, Health, and Education
- Assigned workflow actions, decision queue, project evidence, and automatic health scoring
- MongoDB-stored document embeddings with MongoDB Atlas Vector Search integration and local fallback

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm install --cache .npm-cache
.venv/bin/python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
npm run dev
```

Open `http://127.0.0.1:5173`.

Admin demo login: use any mobile number ending in `0000`.
Regular user demo login: use any other mobile number.

The OTP is returned in the request response for local demo purposes. Replace `/api/auth/request-otp` with an SMS provider integration before production use.

## Decision workflow

The app is now organized around the operating rhythm a government review team needs:

- `Overview`: CM-level portfolio health, immediate attention list, bottlenecks, and evidence-backed insights.
- `Ministries`: portfolio health by ministry.
- `Projects`: create projects under a ministry, add multiple WIGs/milestones, assign lead measures, and add health-state comments.
- `Workflow`: assigned weekly actions with owners, roles, due dates, priorities, and close-out.
- `Evidence AI`: upload or paste documents, vectorize all project entities, search semantically, and automatically recalculate health.
- `Decisions`: pending CM/committee approvals, interventions, funding calls, and defer/approve status.
- `Admin`: branding, logo placeholder, data reset, and vectorization controls.

## Automatic health scoring

Project status is no longer typed in by a user. The backend recalculates `health_score` and `status` from:

- Schedule, budget, quality, citizen impact, compliance, cadence, and lead-measure KPIs.
- WIG/milestone lead-measure comments in the states `green`, `amber`, `red`, `blocker`, `approval`, and `hold`.
- Number and strength of evidence documents.
- Risk signals extracted from uploaded document text.
- Semantic similarity between evidence documents and risk archetypes such as land acquisition, approvals, utility shifting, contractor mobilization, and financial closure.

## 4DX data model

The core hierarchy is:

```text
Ministry
  Project
    WIG / Milestone
      Lead Measure: from X to Y by deadline
        Assigned people
        Comments with state: green, amber, red, blocker, approval, hold
```

Every project, WIG, lead measure, comment, and document is vectorized into the MongoDB `vectors` collection. This enables searches such as:

```text
find top projects which are in blocker state
```

Use `/api/search?q=find+top+projects+which+are+in+blocker+state&state=blocker` for semantic project search across all vectorized entities.

## MongoDB vector search

Documents are stored in MongoDB with an `embedding` field, and all 4DX entities are stored in `vectors` with an `embedding` field. The app attempts to create this Atlas Vector Search index:

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 128, "similarity": "cosine" },
    { "type": "filter", "path": "project_id" },
    { "type": "filter", "path": "ministry_id" }
  ]
}
```

Use index name `document_vector_index` on the `documents` collection and `entity_vector_index` on the `vectors` collection. If the cluster has reached its Atlas Search index limit, `/api/search` falls back to local cosine scoring while keeping all vectors in MongoDB. Remove an unused Atlas Search index or upgrade the cluster, then click `Vectorize Evidence` in Admin to activate native `$vectorSearch`.
