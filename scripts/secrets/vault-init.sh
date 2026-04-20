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

payload="$(jq -n \
  --arg anthropic "${ANTHROPIC_API_KEY:-}" \
  --arg openai "${OPENAI_API_KEY:-}" \
  --arg gemini "${GEMINI_API_KEY:-}" \
  --arg provider "${STAGEHAND_LLM_PROVIDER:-openai}" \
  --arg model "${STAGEHAND_LLM_MODEL:-gpt-4o}" \
  --arg modelAnthropic "${STAGEHAND_LLM_MODEL_ANTHROPIC:-claude-sonnet-4-6}" \
  --arg modelOpenai "${STAGEHAND_LLM_MODEL_OPENAI:-gpt-4o}" \
  --arg fallback "${STAGEHAND_LLM_FALLBACK_PROVIDER:-anthropic}" \
  '{
    data: {
      ANTHROPIC_API_KEY: $anthropic,
      OPENAI_API_KEY: $openai,
      GEMINI_API_KEY: $gemini,
      STAGEHAND_LLM_PROVIDER: $provider,
      STAGEHAND_LLM_MODEL: $model,
      STAGEHAND_LLM_MODEL_ANTHROPIC: $modelAnthropic,
      STAGEHAND_LLM_MODEL_OPENAI: $modelOpenai,
      STAGEHAND_LLM_FALLBACK_PROVIDER: $fallback
    }
  }')"

curl --fail --silent --show-error \
  --header "X-Vault-Token: ${VAULT_TOKEN}" \
  --request POST \
  --data "${payload}" \
  "${VAULT_ADDR}/v1/secret/data/ai-vision"

echo "Vault secrets seeded at secret/data/ai-vision"
