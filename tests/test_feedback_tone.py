from __future__ import annotations

import unittest
from unittest.mock import patch

from quiz_app.claude_client import ClaudeClient
from quiz_app.graders import MCQGrader
from quiz_app.models import MCQQuestion, ShortQuestion
from quiz_app.openai_client import OpenAIAuthState, OpenAIClient


class FeedbackToneTests(unittest.TestCase):
    def test_mcq_grader_feedback_addresses_user(self) -> None:
        grader = MCQGrader()
        question = MCQQuestion(
            id="q1",
            prompt="Pick A",
            points=1,
            options=["A", "B", "C", "D"],
            answer="A",
        )
        result = grader.grade(question, "B")
        self.assertEqual(result.feedback, "You are incorrect. The correct answer is A.")

    def test_openai_short_feedback_addresses_user(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test"))
        question = ShortQuestion(id="q1", prompt="Say hi", points=1, expected="hi")
        with patch.object(client, "_responses_text", return_value="CORRECT"):
            result = client.grade_short(question=question, user_answer="hi")
        self.assertEqual(result.feedback, "You are correct.")

    def test_claude_short_feedback_addresses_user(self) -> None:
        client = ClaudeClient(api_key="test")
        question = ShortQuestion(id="q1", prompt="Say hi", points=1, expected="hi")
        with patch.object(client, "_message_text", return_value="INCORRECT"):
            result = client.grade_short(question=question, user_answer="hello")
        self.assertEqual(result.feedback, "You are incorrect.")

    def test_openai_explain_prompt_requires_second_person(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test"))
        captured: dict[str, str] = {}

        def _fake(prompt: str, model: str | None = None, max_tokens: int = 500) -> str:
            _ = model, max_tokens
            captured["prompt"] = prompt
            return "You are incorrect. The correct answer is A."

        with patch.object(client, "_responses_text", side_effect=_fake):
            _ = client.explain_mcq(
                prompt="2+2?",
                options=["3", "4"],
                user_answer="A",
                correct_answer="B",
            )

        prompt_text = captured["prompt"]
        self.assertIn("Address the learner directly", prompt_text)
        self.assertIn("KaTeX-compatible LaTeX", prompt_text)
        self.assertIn("Your answer:", prompt_text)
        self.assertNotIn("User answer:", prompt_text)

    def test_openai_explain_output_is_normalized_to_second_person(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test"))
        with patch.object(
            client,
            "_responses_text",
            return_value="The user chose A. The user's answer missed a detail.",
        ):
            text = client.explain_mcq(
                prompt="2+2?",
                options=["3", "4"],
                user_answer="A",
                correct_answer="B",
            )

        self.assertIn("you chose a.", text.lower())
        self.assertIn("your answer", text.lower())
        self.assertNotIn("the user", text.lower())

    def test_claude_explain_prompt_requires_second_person(self) -> None:
        client = ClaudeClient(api_key="test")
        captured: dict[str, str] = {}

        def _fake(
            prompt: str,
            system: str,
            model: str | None = None,
            max_tokens: int = 500,
        ) -> str:
            _ = model, max_tokens
            captured["prompt"] = prompt
            captured["system"] = system
            return "You are incorrect. The correct answer is A."

        with patch.object(client, "_message_text", side_effect=_fake):
            _ = client.explain_mcq(
                prompt="2+2?",
                options=["3", "4"],
                user_answer="A",
                correct_answer="B",
            )

        self.assertIn("second person", captured["system"])
        self.assertIn("KaTeX-compatible LaTeX", captured["system"])
        self.assertIn("Your answer:", captured["prompt"])
        self.assertNotIn("User answer:", captured["prompt"])

    def test_openai_feedback_chat_prompt_requires_katex_for_math(self) -> None:
        client = OpenAIClient(auth=OpenAIAuthState(api_key="test"))
        captured: dict[str, str] = {}

        def _fake(prompt: str, model: str | None = None, max_tokens: int = 500) -> str:
            _ = model, max_tokens
            captured["prompt"] = prompt
            return "Use $x^2$ here."

        with patch.object(client, "_responses_text", side_effect=_fake):
            _ = client.feedback_chat(
                question_prompt="What is x^2 when x=3?",
                question_type="short",
                options=[],
                user_answer="6",
                expected_answer="9",
                feedback="You are incorrect.",
                chat_history=[{"role": "assistant", "text": "You are incorrect."}],
                user_message="Can you show the algebra?",
            )

        self.assertIn("KaTeX-compatible LaTeX", captured["prompt"])
        self.assertIn("Use $...$ for inline math", captured["prompt"])

    def test_claude_feedback_chat_prompt_requires_katex_for_math(self) -> None:
        client = ClaudeClient(api_key="test")
        captured: dict[str, str] = {}

        def _fake(
            prompt: str,
            system: str,
            model: str | None = None,
            max_tokens: int = 500,
        ) -> str:
            _ = model, max_tokens
            captured["prompt"] = prompt
            captured["system"] = system
            return "Use $x^2$ here."

        with patch.object(client, "_message_text", side_effect=_fake):
            _ = client.feedback_chat(
                question_prompt="What is x^2 when x=3?",
                question_type="short",
                options=[],
                user_answer="6",
                expected_answer="9",
                feedback="You are incorrect.",
                chat_history=[{"role": "assistant", "text": "You are incorrect."}],
                user_message="Can you show the algebra?",
            )

        self.assertIn("KaTeX-compatible LaTeX", captured["system"])
        self.assertIn("Use $...$ for inline math", captured["system"])

    def test_claude_explain_output_is_normalized_to_second_person(self) -> None:
        client = ClaudeClient(api_key="test")
        with patch.object(
            client,
            "_message_text",
            return_value="The student chose A, so the user's answer is incorrect.",
        ):
            text = client.explain_mcq(
                prompt="2+2?",
                options=["3", "4"],
                user_answer="A",
                correct_answer="B",
            )

        self.assertIn("you chose A".lower(), text.lower())
        self.assertIn("your answer", text.lower())
        self.assertNotIn("the student", text.lower())
        self.assertNotIn("the user", text.lower())


if __name__ == "__main__":
    unittest.main()
