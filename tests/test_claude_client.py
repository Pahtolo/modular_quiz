from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from quiz_app.claude_client import ClaudeClient


class ClaudeClientTests(unittest.TestCase):
    def test_message_text_uses_trust_store_urlopen(self) -> None:
        client = ClaudeClient(api_key="test-key")

        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return json.dumps({"content": [{"type": "text", "text": "hello"}]}).encode("utf-8")

        with patch("quiz_app.claude_client.urlopen_with_trust_store", return_value=_Response()) as mocked_open:
            text = client._message_text(prompt="Prompt", system="System")

        self.assertEqual(text, "hello")
        mocked_open.assert_called_once()

    def test_generate_quiz_normalizes_blank_question_ids(self) -> None:
        client = ClaudeClient(api_key="test-key")
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

        with patch.object(client, "_message_text", return_value=json.dumps(generated_payload)):
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

    def test_generate_quiz_retries_when_first_response_is_not_json(self) -> None:
        client = ClaudeClient(api_key="test-key")
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

        with patch.object(client, "_message_text", side_effect=["not-json", json.dumps(generated_payload)]) as mocked_call:
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

    def test_generate_quiz_backfills_blank_title_and_instructions(self) -> None:
        client = ClaudeClient(api_key="test-key")
        generated_payload = {
            "title": "   ",
            "instructions": "",
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

        with patch.object(client, "_message_text", return_value=json.dumps(generated_payload)):
            quiz = client.generate_quiz(
                materials_text="source",
                title_hint="",
                instructions_hint="",
                total_questions=1,
                mcq_count=1,
                short_count=0,
                mcq_options=4,
            )

        self.assertEqual(quiz.title, "Generated Quiz")
        self.assertEqual(quiz.instructions, "Answer all questions.")


if __name__ == "__main__":
    unittest.main()
