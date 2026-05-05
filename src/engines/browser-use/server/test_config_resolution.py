import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("main.py")
MODULE_SPEC = importlib.util.spec_from_file_location("browser_use_main", MODULE_PATH)
assert MODULE_SPEC is not None and MODULE_SPEC.loader is not None
main = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(main)


class BrowserUseConfigResolutionTests(unittest.TestCase):
    def test_prefers_neutral_env_names(self) -> None:
        with patch.dict(
            os.environ,
            {
                "AI_VISION_LLM_PROVIDER": "openai",
                "AI_VISION_LLM_MODEL": "gpt-4o-mini",
                "AI_VISION_LLM_MODEL_OPENAI": "o3",
                "AI_VISION_LLM_FALLBACK_PROVIDER": "anthropic",
                "OPENAI_API_KEY": "openai-key",
                "ANTHROPIC_API_KEY": "anthropic-key",
                "BROWSER_USE_LLM_PROVIDER": "anthropic",
                "BROWSER_USE_LLM_MODEL": "claude-opus-4-6",
                "STAGEHAND_LLM_PROVIDER": "anthropic",
                "STAGEHAND_LLM_MODEL": "claude-haiku-4-5-20251001",
            },
            clear=True,
        ):
            self.assertEqual(main._provider_candidates(), ["openai", "anthropic"])
            self.assertEqual(main._resolve_model("openai"), "o3")

    def test_legacy_stagehand_names_remain_supported(self) -> None:
        with patch.dict(
            os.environ,
            {
                "STAGEHAND_LLM_PROVIDER": "anthropic",
                "STAGEHAND_LLM_MODEL": "claude-haiku-4-5-20251001",
                "ANTHROPIC_API_KEY": "anthropic-key",
            },
            clear=True,
        ):
            self.assertEqual(main._provider_candidates(), ["anthropic"])
            self.assertEqual(main._resolve_model("anthropic"), "claude-haiku-4-5-20251001")


if __name__ == "__main__":
    unittest.main()