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
  --arg provider "${AI_VISION_LLM_PROVIDER:-${BROWSER_USE_LLM_PROVIDER:-${STAGEHAND_LLM_PROVIDER:-anthropic}}}" \
  --arg model "${AI_VISION_LLM_MODEL:-${BROWSER_USE_LLM_MODEL:-${STAGEHAND_LLM_MODEL:-claude-sonnet-4-6}}}" \
  --arg modelAnthropic "${AI_VISION_LLM_MODEL_ANTHROPIC:-${BROWSER_USE_LLM_MODEL_ANTHROPIC:-${STAGEHAND_LLM_MODEL_ANTHROPIC:-claude-sonnet-4-6}}}" \
  --arg modelOpenai "${AI_VISION_LLM_MODEL_OPENAI:-${BROWSER_USE_LLM_MODEL_OPENAI:-${STAGEHAND_LLM_MODEL_OPENAI:-gpt-4o}}}" \
  --arg fallback "${AI_VISION_LLM_FALLBACK_PROVIDER:-${BROWSER_USE_LLM_FALLBACK_PROVIDER:-${STAGEHAND_LLM_FALLBACK_PROVIDER:-openai}}}" \
  '{
    data: {
      ANTHROPIC_API_KEY: $anthropic,
      OPENAI_API_KEY: $openai,
      GEMINI_API_KEY: $gemini,
      AI_VISION_LLM_PROVIDER: $provider,
      AI_VISION_LLM_MODEL: $model,
      AI_VISION_LLM_MODEL_ANTHROPIC: $modelAnthropic,
      AI_VISION_LLM_MODEL_OPENAI: $modelOpenai,
      AI_VISION_LLM_FALLBACK_PROVIDER: $fallback
    }
  }')"

curl --fail --silent --show-error \
  --header "X-Vault-Token: ${VAULT_TOKEN}" \
  --request POST \
  --data "${payload}" \
  "${VAULT_ADDR}/v1/secret/data/ai-vision"

echo "Vault secrets seeded at secret/data/ai-vision"
