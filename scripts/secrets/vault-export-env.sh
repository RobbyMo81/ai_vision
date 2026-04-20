#!/usr/bin/env bash
set -euo pipefail

VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-root}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed." >&2
  exit 1
fi

resp="$(curl --fail --silent --show-error \
  --header "X-Vault-Token: ${VAULT_TOKEN}" \
  "${VAULT_ADDR}/v1/secret/data/ai-vision")"

data="$(echo "${resp}" | jq -r '.data.data')"
if [[ "${data}" == "null" ]]; then
  echo "No data found at secret/data/ai-vision" >&2
  exit 1
fi

# Prints export statements. Use with:
# eval "$(./scripts/secrets/vault-export-env.sh)"
echo "${data}" | jq -r '
  to_entries[]
  | select(.value != null and .value != "")
  | "export \(.key)=\(.value|@sh)"
'
