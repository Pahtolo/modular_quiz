import json
from dataclasses import dataclass
from typing import Callable
from urllib import error, request

from .claude_models import DEFAULT_CLAUDE_MODEL
from .http_tls import urlopen_with_trust_store
from .models import MCQQuestion, ShortQuestion


@dataclass(frozen=True)
class GradeResult:
    correct: bool
    points_awarded: int
    max_points: int
    feedback: str


class MCQGrader:
    def grade(self, question: MCQQuestion, user_answer: str) -> GradeResult:
        normalized = (user_answer or "").strip().upper()
        if normalized:
            normalized = normalized[0]
        is_correct = normalized == question.answer
        points = question.points if is_correct else 0
        feedback = (
            "You are correct."
            if is_correct
            else f"You are incorrect. The correct answer is {question.answer}."
        )
        return GradeResult(
            correct=is_correct,
            points_awarded=points,
            max_points=question.points,
            feedback=feedback,
        )


class SelfShortGrader:
    def __init__(self, input_fn: Callable[[str], str] = input, output_fn: Callable[[str], None] = print):
        self.input_fn = input_fn
        self.output_fn = output_fn

    def grade(self, question: ShortQuestion, user_answer: str) -> GradeResult:
        _ = user_answer
        self.output_fn("\nExpected answer:")
        self.output_fn(question.expected)

        while True:
            try:
                raw = self.input_fn(f"Self-score (0..{question.points}): ").strip()
            except EOFError:
                raise SystemExit("\nInput ended early. Exiting quiz.")
            if raw.isdigit():
                score = int(raw)
                if 0 <= score <= question.points:
                    break
            self.output_fn(f"Enter an integer from 0 to {question.points}.")

        return GradeResult(
            correct=(score == question.points),
            points_awarded=score,
            max_points=question.points,
            feedback=f"You recorded a self-score of {score}/{question.points}.",
        )


class ClaudeShortGrader:
    def __init__(self, api_key: str, model: str = DEFAULT_CLAUDE_MODEL):
        self.api_key = api_key
        self.model = model

    def _request_verdict(self, question: str, expected: str, user_answer: str) -> str:
        rubric = (
            "You grade short-answer quiz responses."
            "Mark CORRECT only if the user's answer is substantively equivalent to the expected answer."
            "If correct, return exactly one word: CORRECT."
            "If incorrect, return exactly one word: INCORRECT."
        )
        user_prompt = (
            f"Question:\n{question}\n\n"
            f"Expected answer:\n{expected}\n\n"
            f"User answer:\n{user_answer}\n\n"
            "Verdict:"
        )

        payload = {
            "model": self.model,
            "max_tokens": 5,
            "temperature": 0,
            "system": rubric,
            "messages": [{"role": "user", "content": user_prompt}],
        }

        req = request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )

        try:
            with urlopen_with_trust_store(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Claude API HTTP {e.code}: {detail}") from e
        except Exception as e:
            raise RuntimeError(f"Claude API request failed: {e}") from e

        text = ""
        for block in body.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")

        verdict = text.strip()
        return verdict 

    def grade(self, question: ShortQuestion, user_answer: str) -> GradeResult:
        verdict = self._request_verdict(
            question=question.prompt,
            expected=question.expected,
            user_answer=user_answer,
        )
        is_correct = verdict == "CORRECT"
        points = question.points if is_correct else 0
        return GradeResult(
            correct=is_correct,
            points_awarded=points,
            max_points=question.points,
            feedback="You are correct." if is_correct else "You are incorrect.",
        )
