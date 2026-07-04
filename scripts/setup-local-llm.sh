#!/usr/bin/env bash
# Pull the default local LLM model for 4DX (Ollama).
set -euo pipefail

MODEL="${LOCAL_LLM_MODEL:-llama3.2:1b}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama not found. Install with: brew install ollama"
  echo "Then run: ollama serve"
  exit 1
fi

if ! curl -sf "${OLLAMA_BASE_URL:-http://127.0.0.1:11434}/api/tags" >/dev/null 2>&1; then
  echo "Ollama is not reachable at ${OLLAMA_BASE_URL:-http://127.0.0.1:11434}."
  echo "Start it with: ollama serve"
  exit 1
fi

echo "Pulling ${MODEL}..."
ollama pull "${MODEL}"
echo "Done. Set LOCAL_LLM_ENABLED=true in backend/.env and restart the backend."
