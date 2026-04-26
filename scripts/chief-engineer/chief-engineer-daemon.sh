#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FORGE_DB="${REPO_ROOT}/forge-memory.db"
OBSERVER="/home/spoq/.codex/skills/chief-engineer/scripts/hitl_observer.py"
FORGE_DB_PROBE="/home/spoq/.codex/skills/chief-engineer/scripts/forge_db_probe.py"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cd "${REPO_ROOT}"

echo "[${TS}] chief-engineer wake-up"

if [[ -f "${FORGE_DB}" ]]; then
  ACTIVE_STORY="$(python3 "${FORGE_DB_PROBE}" --db "${FORGE_DB}" active-story || true)"
  if [[ -n "${ACTIVE_STORY}" ]]; then
    echo "[${TS}] active forge storyline: ${ACTIVE_STORY}"
  else
    echo "[${TS}] active forge storyline: none"
  fi
else
  echo "[${TS}] forge-memory.db missing"
fi

python3 "${OBSERVER}" --once
