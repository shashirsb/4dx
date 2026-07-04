# Local LLM (Ollama) setup

The backend uses a tiered LLM chain for AI Insight, Meeting to Action, decision briefs, and portfolio Q&A.

## Provider chain

**Default (`USE_LLM=false`):**

**Local Ollama** → heuristic fallback

Cloud APIs (OpenAI, Claude, Google) are **not** called. This avoids quota errors and keeps responses fast when you only run Ollama locally.

**Full chain (`USE_LLM=true`):**

OpenAI → Claude → Google Gemini → **Local Ollama** → heuristic fallback

Set in `.env`:

```env
USE_LLM=false   # default — local Ollama only (alias: useLLM)
USE_LLM=true    # enable cloud providers before local fallback
```

Truthy values: `true`, `1`, `yes` only. Anything else (including unset) is treated as false.

## Quick start (macOS)

```bash
brew install ollama
ollama serve          # keep running in a terminal, or use the Ollama app
ollama pull llama3.2:1b
```

Copy env vars from `.env.example`:

```env
USE_LLM=false
LOCAL_LLM_ENABLED=true
LOCAL_LLM_PROVIDER=ollama
LOCAL_LLM_MODEL=llama3.2:1b
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_TIMEOUT_SECONDS=45
```

Or run the helper script from the repo root:

```bash
./scripts/setup-local-llm.sh
```

Restart the backend after Ollama is running. Successful local responses show `llm_status` like **`Local · llama3.2:1b`**. When cloud is skipped or unavailable, the UI shows **`Local analysis (cloud unavailable)`** or **`Local insight engine (cloud unavailable)`**.

## Notes

- Model weights are **not** committed to git; `ollama pull` downloads them locally.
- If Ollama is stopped or the model is missing, the app skips this tier and uses heuristic fallback.
- Smaller alternatives: `phi3:mini`, `qwen2.5:0.5b` — set `LOCAL_LLM_MODEL` accordingly.
- Admin endpoint `GET /api/admin/llm-status` reports `use_llm`, provider keys, and Ollama reachability.
