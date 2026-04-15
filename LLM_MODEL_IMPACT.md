# LLM Model Configuration — Impact Manifest
# Generated: 2026-03-23
# Purpose: Reference for AI agents verifying correctness of model-switching logic.
#          All files/lines that must stay in sync when LLM provider or model changes.

```yaml
impact_manifest:
  version: "1.0"
  project: "ai-vision"
  env_vars:
    - name: STAGEHAND_LLM_PROVIDER
      values: ["anthropic", "openai"]
      default: "openai"
    - name: STAGEHAND_LLM_MODEL
      values:
        anthropic: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6"]
        openai:    ["gpt-4o-mini", "gpt-4o", "o3"]
      default:
        anthropic: "claude-sonnet-4-6"
        openai:    "gpt-4o"
    - name: ANTHROPIC_API_KEY
      required_when: "STAGEHAND_LLM_PROVIDER == anthropic"
    - name: OPENAI_API_KEY
      required_when: "STAGEHAND_LLM_PROVIDER == openai"

  impacted_files:

    - path: ".env.example"
      lines: [1, 2, 5, 8, 11, 12, 13, 16, 17]
      description: "Human-readable template. Update when adding new providers or models."
      owned_by: "documentation"

    - path: ".env"
      lines: [all]
      description: >
        Runtime config. STAGEHAND_LLM_PROVIDER, STAGEHAND_LLM_MODEL,
        ANTHROPIC_API_KEY, OPENAI_API_KEY must be set here.
        Written by the Rust GUI config tool.
      owned_by: "rust-gui"

    - path: "src/engines/browser-use/server/main.py"
      lines:
        - line: 84
          content: 'provider = os.getenv("STAGEHAND_LLM_PROVIDER", "openai")'
          risk: "default fallback — must match GUI default"
        - line: 85
          content: 'if provider == "anthropic":'
          risk: "branch gating — must enumerate all supported providers"
        - line: 88
          content: 'model=os.getenv("STAGEHAND_LLM_MODEL", "claude-sonnet-4-6")'
          risk: "anthropic default — update when default changes"
        - line: 89
          content: 'api_key=os.getenv("ANTHROPIC_API_KEY")'
          risk: "key selection — tied to provider branch"
        - line: 94
          content: 'model=os.getenv("STAGEHAND_LLM_MODEL", "gpt-4o")'
          risk: "openai default — update when default changes"
        - line: 95
          content: 'api_key=os.getenv("OPENAI_API_KEY")'
          risk: "key selection — tied to provider branch"
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

    - path: "src/engines/stagehand/engine.ts"
      lines:
        - line: 37
          content: "const provider = (process.env.STAGEHAND_LLM_PROVIDER ?? 'openai') as 'openai' | 'anthropic'"
          risk: "default fallback — must match GUI default"
        - line: 38
          content: "const model = (process.env.STAGEHAND_LLM_MODEL ?? 'gpt-4o') as AvailableModel"
          risk: "default fallback — update when default changes"
        - line: 42
          content: "modelName: model"
          risk: "passes resolved model to Stagehand — must be a valid AvailableModel value"
        - line: 44
          content: "apiKey: provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY"
          risk: "key routing — must cover all supported providers"
      owned_by: "stagehand-engine"

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
    - "GUI writes STAGEHAND_LLM_PROVIDER and STAGEHAND_LLM_MODEL atomically to .env"
    - "GUI validates ANTHROPIC_API_KEY present when provider=anthropic"
    - "GUI validates OPENAI_API_KEY present when provider=openai"
    - "Python bridge re-reads .env on each server start (load_dotenv already does this)"
    - "Stagehand engine re-reads process.env — requires server restart after .env change"
    - "CLI command `ai-vision config` launches the GUI"
    - "Default models in Python bridge match defaults in GUI"
    - "Default models in Stagehand engine match defaults in GUI"
```
