#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DAEMON="${REPO_ROOT}/scripts/chief-engineer/chief-engineer-daemon.sh"
LOG_FILE="/home/spoq/.codex/skills/chief-engineer/cron.log"
CRON_EXPR="*/5 * * * *"
JOB="${CRON_EXPR} cd ${REPO_ROOT} && ${DAEMON} >> ${LOG_FILE} 2>&1"
TMP_FILE="$(mktemp)"

(crontab -l 2>/dev/null || true) | grep -v "chief-engineer-daemon.sh" > "${TMP_FILE}"
printf '%s\n' "${JOB}" >> "${TMP_FILE}"
crontab "${TMP_FILE}"
rm -f "${TMP_FILE}"

printf 'installed chief-engineer cron: %s\n' "${JOB}"
