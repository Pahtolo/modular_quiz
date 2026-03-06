import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Sequence

from .feedback_voice import to_second_person
from .generator.prompting import build_quiz_generation_prompt
from .graders import GradeResult
from .loader import load_quiz
from .models import Quiz, ShortQuestion
from .providers import ModelOption, friendly_model_label

DEPRECATED_CLAUDE_MODELS = {
    "claude-3-7-sonnet-latest",
}
MATH_FORMAT_INSTRUCTION = (
    "If you include math, write it in KaTeX-compatible LaTeX. "
    "Use $...$ for inline math and $$...$$ for display math."
)


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
        raw_models = curated_models or [
            "claude-3-5-haiku-latest",
            "claude-3-opus-latest",
        ]
        seen: set[str] = set()
        self.curated_models: list[str] = []
        for model_id in raw_models:
            value = str(model_id or "").strip()
            if not value or value in seen or value in DEPRECATED_CLAUDE_MODELS:
                continue
            seen.add(value)
            self.curated_models.append(value)

    def _model_options(self, model_ids: Sequence[str]) -> list[ModelOption]:
        return [
            ModelOption(
                id=model_id,
                label=friendly_model_label(model_id),
                provider=self.provider_name,
                capability_tags=("generation", "grading", "explain"),
            )
            for model_id in model_ids
        ]

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
        if not self.api_key:
            return self._model_options(self.curated_models)

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            rows = body.get("data") if isinstance(body, dict) else []
            model_ids: list[str] = []
            seen: set[str] = set()
            if isinstance(rows, list):
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    model_id = str(row.get("id", "")).strip()
                    if not model_id or model_id in seen or model_id in DEPRECATED_CLAUDE_MODELS:
                        continue
                    seen.add(model_id)
                    model_ids.append(model_id)
            if model_ids:
                return self._model_options(model_ids)
        except Exception:
            pass
        return self._model_options(self.curated_models)

    def grade_short(
        self,
        question: ShortQuestion,
        user_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> GradeResult:
        system = (
            "You grade short-answer quiz responses. "
            "Return exactly one token: CORRECT or INCORRECT. "
            "Use CORRECT only when user answer is substantively equivalent to expected answer."
        )
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"\nAdditional context:\n{extra_context.strip()}\n\n"
        prompt = (
            f"Question:\n{question.prompt}\n\n"
            f"Expected answer:\n{question.expected}\n\n"
            f"{context_block}"
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
            feedback="You are correct." if is_correct else "You are incorrect.",
        )

    def explain_mcq(
        self,
        prompt: str,
        options: Sequence[str],
        user_answer: str,
        correct_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> str:
        rendered_options = "\n".join(
            f"{chr(ord('A') + i)}. {opt}" for i, opt in enumerate(options)
        )
        system = (
            "You explain quiz answers concisely in second person. "
            "Address the learner as 'you'/'your'. "
            "Never refer to the learner as 'the user' or 'the student'. "
            "Keep explanations under 5 sentences. "
            f"{MATH_FORMAT_INSTRUCTION}"
        )
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"Additional context:\n{extra_context.strip()}\n\n"
        ask = (
            f"{context_block}"
            f"Question:\n{prompt}\n\n"
            f"Options:\n{rendered_options}\n\n"
            f"Your answer: {user_answer}\n"
            f"Correct answer: {correct_answer}\n\n"
            "Explain why the correct answer is right and whether your answer was right or wrong."
        )
        return to_second_person(self._message_text(prompt=ask, system=system, model=model, max_tokens=300))

    def feedback_chat(
        self,
        question_prompt: str,
        question_type: str,
        options: Sequence[str],
        user_answer: str,
        expected_answer: str,
        feedback: str,
        chat_history: Sequence[dict[str, str]],
        user_message: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> str:
        rendered_options = "\n".join(
            f"{chr(ord('A') + i)}. {opt}" for i, opt in enumerate(options)
        )
        normalized_history: list[str] = []
        for item in chat_history:
            role = str(item.get("role", "")).strip().lower()
            text = str(item.get("text", "")).strip()
            if not text:
                continue
            if role == "assistant":
                normalized_history.append(f"Assistant: {text}")
            else:
                normalized_history.append(f"You: {text}")
        history_block = "\n".join(normalized_history)
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"\nAdditional context:\n{extra_context.strip()}\n"
        system = (
            "You are a quiz tutor helping with follow-up questions about feedback. "
            "Address the learner directly as 'you'/'your'. "
            "Be concise, clear, and accurate. "
            f"{MATH_FORMAT_INSTRUCTION}"
        )
        prompt = (
            f"Question type: {question_type}\n"
            f"Question:\n{question_prompt}\n\n"
            f"Options:\n{rendered_options or '(none)'}\n\n"
            f"Your answer: {user_answer}\n"
            f"Expected answer: {expected_answer}\n"
            f"Original feedback:\n{feedback}\n"
            f"{context_block}\n"
            f"Chat so far:\n{history_block or '(none)'}\n\n"
            f"New follow-up from learner:\n{user_message}\n"
        )
        return to_second_person(self._message_text(prompt=prompt, system=system, model=model, max_tokens=420))

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

    @staticmethod
    def _try_parse_json_object(text: str) -> dict | None:
        candidate = (text or "").strip()
        if not candidate:
            return None

        try:
            payload = json.loads(candidate)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError:
            pass

        cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
        if cleaned != candidate:
            try:
                payload = json.loads(cleaned)
                if isinstance(payload, dict):
                    return payload
            except json.JSONDecodeError:
                pass

        decoder = json.JSONDecoder()
        for index, ch in enumerate(candidate):
            if ch != "{":
                continue
            try:
                payload, _ = decoder.raw_decode(candidate[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        return None

    @classmethod
    def _parse_generated_json_object(cls, raw_text: str) -> dict:
        candidates: list[str] = []
        extracted = cls._extract_json_block(raw_text).strip()
        if extracted:
            candidates.append(extracted)
        raw = (raw_text or "").strip()
        if raw and raw not in candidates:
            candidates.append(raw)

        for candidate in candidates:
            parsed = cls._try_parse_json_object(candidate)
            if parsed is not None:
                return parsed

        snippet = raw[:200].replace("\n", " ")
        raise RuntimeError(f"Claude output was not valid JSON. Raw output starts with: {snippet!r}")

    @staticmethod
    def _normalized_question_id(value: object, index: int) -> str:
        if isinstance(value, str):
            text = value.strip()
            return text or f"q{index}"
        if value is None:
            return f"q{index}"
        text = str(value).strip()
        return text or f"q{index}"

    @classmethod
    def _normalize_generated_payload(cls, payload: dict) -> dict:
        raw_questions = payload.get("questions")
        if not isinstance(raw_questions, list):
            return payload

        normalized_questions: list[object] = []
        for idx, question in enumerate(raw_questions, start=1):
            if not isinstance(question, dict):
                normalized_questions.append(question)
                continue
            updated = dict(question)
            updated["id"] = cls._normalized_question_id(updated.get("id"), idx)
            normalized_questions.append(updated)

        output = dict(payload)
        output["questions"] = normalized_questions
        return output

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
        prompt_spec = build_quiz_generation_prompt(
            materials_text=materials_text,
            title_hint=title_hint,
            instructions_hint=instructions_hint,
            total_questions=total_questions,
            mcq_count=mcq_count,
            short_count=short_count,
            mcq_options=mcq_options,
        )
        raw = self._message_text(prompt=prompt_spec.user, system=prompt_spec.system, model=model, max_tokens=3500)
        try:
            payload = self._parse_generated_json_object(raw)
        except RuntimeError:
            repair_prompt = (
                f"{prompt_spec.user}\n\n"
                "Your previous response was not valid JSON. "
                "Return only one valid JSON object. "
                "Do not include markdown, code fences, or commentary."
            )
            repaired_raw = self._message_text(prompt=repair_prompt, system=prompt_spec.system, model=model, max_tokens=3500)
            payload = self._parse_generated_json_object(repaired_raw)

        payload = self._normalize_generated_payload(payload)

        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            path = Path(tmp.name)
            json.dump(payload, tmp, indent=2)

        try:
            return load_quiz(path)
        finally:
            path.unlink(missing_ok=True)
