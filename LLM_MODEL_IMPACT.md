# LLM Model Configuration — Impact Manifest
# Generated: 2026-03-23
# Purpose: Reference for AI agents verifying correctness of model-switching logic.
#          All files/lines that must stay in sync when LLM provider or model changes.

```yaml
impact_manifest:
  version: "1.0"
  project: "ai-vision"
  env_vars:
    - name: AI_VISION_LLM_PROVIDER
      values: ["anthropic", "openai"]
      default: "anthropic"
    - name: AI_VISION_LLM_MODEL
      values:
        anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
        openai:    ["gpt-4o-mini", "gpt-4o", "o3"]
      default:
        anthropic: "claude-sonnet-4-6"
        openai:    "gpt-4o"
    - name: ANTHROPIC_API_KEY
      required_when: "AI_VISION_LLM_PROVIDER == anthropic"
    - name: OPENAI_API_KEY
      required_when: "AI_VISION_LLM_PROVIDER == openai"
    - name: BROWSER_USE_LLM_* / STAGEHAND_LLM_*
      required_when: "legacy transition fallback only"

  impacted_files:

    - path: ".env.example"
      lines: [1, 2, 5, 8, 11, 12, 13, 16, 17]
      description: "Human-readable template. Update when adding new providers or models."
      owned_by: "documentation"

    - path: ".env"
      lines: [all]
      description: >
        Runtime config. AI_VISION_LLM_PROVIDER, AI_VISION_LLM_MODEL,
        ANTHROPIC_API_KEY, OPENAI_API_KEY must be set here.
        Legacy BROWSER_USE_LLM_* and STAGEHAND_LLM_* names are fallback-only.
        Written by the Rust GUI config tool.
      owned_by: "rust-gui"

    - path: "src/engines/browser-use/server/main.py"
      lines:
        - line: 92
          content: 'primary = _normalize_provider(primary_override or _first_env("AI_VISION_LLM_PROVIDER", "BROWSER_USE_LLM_PROVIDER", "STAGEHAND_LLM_PROVIDER") or "anthropic")'
          risk: "neutral env must stay primary; legacy names are fallback only"
        - line: 112
          content: '_first_env("AI_VISION_LLM_MODEL_ANTHROPIC", "BROWSER_USE_LLM_MODEL_ANTHROPIC", "STAGEHAND_LLM_MODEL_ANTHROPIC")'
          risk: "branch gating — must enumerate all supported providers"
        - line: 117
          content: '_first_env("AI_VISION_LLM_MODEL_OPENAI", "BROWSER_USE_LLM_MODEL_OPENAI", "STAGEHAND_LLM_MODEL_OPENAI")'
          risk: "openai default — update when default changes"
      owned_by: "python-bridge"

    - path: "src/engines/skyvern/server/main.py"
      lines:
        - line: 82
          content: 'openai_api_key=os.getenv("OPENAI_API_KEY")'
          risk: "always passes both keys; model selected internally by Skyvern"
        - line: 83
          content: 'anthropic_api_key=os.getenv("ANTHROPIC_API_KEY")'
          risk: "always passes both keys; model selected internally by Skyvern"
      owned_by: "python-bridge"

    - path: "src/engines/browser-use/server/requirements.txt"
      lines:
        - line: 4
          content: "langchain-openai>=0.1.0"
          risk: "must be installed for openai provider to work"
        - line: 5
          content: "langchain-anthropic>=0.1.0"
          risk: "must be installed for anthropic provider to work"
      owned_by: "python-deps"

  new_files_to_create:
    - path: "tools/config-gui/"
      description: "Rust TUI config tool — reads/writes .env, exposes model picker"
      owned_by: "rust-gui"
    - path: "tools/config-gui/src/main.rs"
      description: "Rust TUI entry point"
    - path: "tools/config-gui/Cargo.toml"
      description: "Rust crate manifest"

  verification_checklist:
    - "GUI writes AI_VISION_LLM_PROVIDER and AI_VISION_LLM_MODEL atomically to .env"
    - "GUI validates ANTHROPIC_API_KEY present when provider=anthropic"
    - "GUI validates OPENAI_API_KEY present when provider=openai"
    - "Python bridge re-reads .env on each server start (load_dotenv already does this)"
    - "Legacy BROWSER_USE_LLM_* and STAGEHAND_LLM_* names remain fallback-only during the transition window"
    - "CLI command `ai-vision config` launches the GUI"
    - "Default models in Python bridge match defaults in GUI"
    - "Release docs and templates use AI_VISION_LLM_* as the primary naming surface"
```
