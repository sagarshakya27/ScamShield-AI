import unittest
from unittest.mock import patch

import backend.app as backend_module


class FakeTokenizer:
    def __call__(self, text, **kwargs):
        return {"text": text}

    def decode(self, tokens, **kwargs):
        return f"हिंदी {tokens}"


class FakeModel:
    def generate(self, **kwargs):
        return [kwargs["text"]]


class TranslationTests(unittest.TestCase):
    def test_translate_uses_local_model_without_api_key_and_preserves_sensitive_values(self):
        message = "Claim ₹500 at https://example.com now"
        with patch.object(
            backend_module,
            "_translation_pipeline",
            (FakeTokenizer(), FakeModel()),
        ):
            translated = backend_module._translate(message)

        self.assertIn("₹500", translated)
        self.assertIn("https://example.com", translated)
        self.assertIn("हिंदी Claim", translated)
        self.assertIn("हिंदी now", translated)

    def test_translate_endpoint_succeeds_without_api_key(self):
        with patch.object(
            backend_module,
            "_translation_pipeline",
            (FakeTokenizer(), FakeModel()),
        ):
            response = backend_module.app.test_client().post(
                "/api/translate",
                json={"message": "Hello"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["translation"])


if __name__ == "__main__":
    unittest.main()
