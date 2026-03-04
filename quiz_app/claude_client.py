import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Sequence

from .graders import GradeResult
from .loader import load_quiz
from .models import Quiz, ShortQuestion
from .providers import ModelOption, friendly_model_label


class ClaudeClient:
    provider_name = "claude"

    def __init__(
        self,
        api_key: str,
        default_model: str = "claude-3-5-haiku-latest",
        curated_models: Sequence[str] | None = None,
    ):
        self.api_key = (api_key or "").strip()
        self.default_model = default_model
        self.curated_models = list(curated_models or [
            "claude-3-5-haiku-latest",
            "claude-3-7-sonnet-latest",
            "claude-3-opus-latest",
        ])

    def _message_text(self, prompt: str, system: str, model: str | None = None, max_tokens: int = 500) -> str:
        if not self.api_key:
            raise RuntimeError("Claude API key is missing.")

        payload = {
            "model": model or self.default_model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        req = urllib.request.Request(
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
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Claude HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise RuntimeError(f"Claude request failed: {exc}") from exc

        text = ""
        for block in body.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")
        return text.strip()

    def list_models(self) -> list[ModelOption]:
        return [
            ModelOption(
                id=model_id,
                label=friendly_model_label(model_id),
                provider=self.provider_name,
                capability_tags=("generation", "grading", "explain"),
            )
            for model_id in self.curated_models
        ]

    def grade_short(self, question: ShortQuestion, user_answer: str, model: str | None = None) -> GradeResult:
        system = (
            "You grade short-answer quiz responses. "
            "Return exactly one token: CORRECT or INCORRECT. "
            "Use CORRECT only when user answer is substantively equivalent to expected answer."
        )
        prompt = (
            f"Question:\n{question.prompt}\n\n"
            f"Expected answer:\n{question.expected}\n\n"
            f"User answer:\n{user_answer}\n\n"
            "Verdict:"
        )
        verdict = self._message_text(prompt=prompt, system=system, model=model, max_tokens=8).upper()
        is_correct = "CORRECT" in verdict and "INCORRECT" not in verdict
        points = question.points if is_correct else 0
        return GradeResult(
            correct=is_correct,
            points_awarded=points,
            max_points=question.points,
            feedback=f"Claude verdict: {verdict}",
        )

    def explain_mcq(
        self,
        prompt: str,
        options: Sequence[str],
        user_answer: str,
        correct_answer: str,
        model: str | None = None,
    ) -> str:
        rendered_options = "\n".join(
            f"{chr(ord('A') + i)}. {opt}" for i, opt in enumerate(options)
        )
        system = "You explain quiz answers concisely. Keep explanations under 5 sentences."
        ask = (
            f"Question:\n{prompt}\n\n"
            f"Options:\n{rendered_options}\n\n"
            f"User answer: {user_answer}\n"
            f"Correct answer: {correct_answer}\n\n"
            "Explain why the correct answer is right and whether the user answer is right or wrong."
        )
        return self._message_text(prompt=ask, system=system, model=model, max_tokens=300)

    @staticmethod
    def _extract_json_block(text: str) -> str:
        fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, flags=re.DOTALL)
        if fenced:
            return fenced.group(1)

        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start : end + 1]
        return text

    def generate_quiz(
        self,
        materials_text: str,
        title_hint: str,
        instructions_hint: str,
        total_questions: int,
        mcq_count: int,
        short_count: int,
        mcq_options: int,
        model: str | None = None,
    ) -> Quiz:
        system = (
            "You generate quiz JSON only. No markdown, no prose. "
            "Return one JSON object with keys title, instructions, questions. "
            "Question types allowed: mcq and short only."
        )
        prompt = (
            f"Create a quiz with exactly {total_questions} questions: "
            f"{mcq_count} mcq and {short_count} short.\n"
            f"MCQ option count should be {mcq_options}.\n"
            f"Title hint: {title_hint or 'Generated Quiz'}\n"
            f"Instructions hint: {instructions_hint or 'Answer all questions.'}\n"
            "Schema:\n"
            "- title: string\n"
            "- instructions: string\n"
            "- questions: array\n"
            "mcq question: id,type,prompt,options,answer,points\n"
            "short question: id,type,prompt,expected,points\n\n"
            f"Source material:\n{materials_text[:120000]}"
        )
        raw = self._message_text(prompt=prompt, system=system, model=model, max_tokens=3500)
        json_text = self._extract_json_block(raw)

        try:
            payload = json.loads(json_text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Claude output was not valid JSON: {exc}") from exc

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            path = Path(tmp.name)
            json.dump(payload, tmp, indent=2)

        try:
            return load_quiz(path)
        finally:
            path.unlink(missing_ok=True)
