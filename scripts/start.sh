#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  printf 'Run bash scripts/setup.sh first.\n' >&2
  exit 1
fi
.venv/bin/python -m relay.cli seed
exec .venv/bin/python -m relay.cli serve
