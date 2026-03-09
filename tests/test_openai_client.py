from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from quiz_app.openai_client import OpenAIAuthState, OpenAIClient, OpenAIRequestError


class OpenAIClientTests(unittest.TestCase):
    def test_request_json_uses_trust_store_urlopen(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test-key"))

        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return json.dumps({"data": []}).encode("utf-8")

        with patch("quiz_app.openai_client.urlopen_with_trust_store", return_value=_Response()) as mocked_open:
            payload = client._request_json("GET", "/models")

        self.assertEqual(payload, {"data": []})
        mocked_open.assert_called_once()

    def test_generate_quiz_normalizes_blank_question_ids(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test-key"))
        generated_payload = {
            "title": "Generated Quiz",
            "instructions": "Answer all questions.",
            "questions": [
                {
                    "id": "   ",
                    "type": "mcq",
                    "prompt": "Pick A",
                    "options": ["A", "B", "C", "D"],
                    "answer": "A",
                    "points": 1,
                },
                {
                    "id": "",
                    "type": "short",
                    "prompt": "Say hi",
                    "expected": "hi",
                    "points": 2,
                },
            ],
        }

        with patch.object(client, "_responses_text", return_value=json.dumps(generated_payload)):
            quiz = client.generate_quiz(
                materials_text="source",
                title_hint="Generated Quiz",
                instructions_hint="Answer all questions.",
                total_questions=2,
                mcq_count=1,
                short_count=1,
                mcq_options=4,
            )

        self.assertEqual(quiz.questions[0].id, "q1")
        self.assertEqual(quiz.questions[1].id, "q2")

    def test_generate_quiz_repairs_invalid_json_response(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test-key"))
        generated_payload = {
            "title": "Generated Quiz",
            "instructions": "Answer all questions.",
            "questions": [
                {
                    "id": "q1",
                    "type": "mcq",
                    "prompt": "Pick A",
                    "options": ["A", "B", "C", "D"],
                    "answer": "A",
                    "points": 1,
                },
            ],
        }

        with patch.object(client, "_responses_text", side_effect=["not-json", json.dumps(generated_payload)]) as mocked_call:
            quiz = client.generate_quiz(
                materials_text="source",
                title_hint="Generated Quiz",
                instructions_hint="Answer all questions.",
                total_questions=1,
                mcq_count=1,
                short_count=0,
                mcq_options=4,
            )

        self.assertEqual(quiz.title, "Generated Quiz")
        self.assertEqual(mocked_call.call_count, 2)

    def test_generate_quiz_retries_with_smaller_prompt_after_retryable_520(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test-key"))
        generated_payload = {
            "title": "Generated Quiz",
            "instructions": "Answer all questions.",
            "questions": [
                {
                    "id": "q1",
                    "type": "mcq",
                    "prompt": "Pick A",
                    "options": ["A", "B", "C", "D"],
                    "answer": "A",
                    "points": 1,
                },
            ],
        }
        long_source = "x" * 150000
        prompts: list[str] = []

        def _fake(prompt: str, model: str | None = None, max_tokens: int = 500) -> str:
            _ = model, max_tokens
            prompts.append(prompt)
            if len(prompts) == 1:
                raise OpenAIRequestError("OpenAI HTTP 520: upstream", status_code=520)
            return json.dumps(generated_payload)

        with patch.object(client, "_responses_text", side_effect=_fake):
            quiz = client.generate_quiz(
                materials_text=long_source,
                title_hint="Generated Quiz",
                instructions_hint="Answer all questions.",
                total_questions=1,
                mcq_count=1,
                short_count=0,
                mcq_options=4,
            )

        self.assertEqual(quiz.title, "Generated Quiz")
        self.assertEqual(len(prompts), 2)
        self.assertGreater(len(prompts[0]), len(prompts[1]))


if __name__ == "__main__":
    unittest.main()
