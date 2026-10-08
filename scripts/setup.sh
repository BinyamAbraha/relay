#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
RELAY_PYTHON="${RELAY_PYTHON:-python3.11}"
"$RELAY_PYTHON" -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
npm ci --prefix web
npm run --prefix web build
printf '\nRelay is ready. Run: bash scripts/start.sh\n'
