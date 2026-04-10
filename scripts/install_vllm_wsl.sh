#!/usr/bin/env bash
# Install vLLM without hitting PEP 668 (externally-managed-environment):
# always use this project's venv Python, never bare `pip` (which may be /usr/bin/pip).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -x .venv/bin/python ]]; then
  echo "Create the venv first: python3 -m venv .venv" >&2
  exit 1
fi
.venv/bin/python -m ensurepip --upgrade 2>/dev/null || true
.venv/bin/python -m pip install -U pip
.venv/bin/python -m pip install vllm
echo "OK. Activate with: source .venv/bin/activate"
echo "Prefer: .venv/bin/python -m vllm ...  (avoids wrong pip on PATH)"
