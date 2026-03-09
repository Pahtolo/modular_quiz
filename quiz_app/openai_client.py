import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, List, Sequence

from .feedback_voice import to_second_person
from .generator.prompting import build_quiz_generation_prompt
from .graders import GradeResult
from .http_tls import urlopen_with_trust_store
from .models import MCQQuestion, Quiz, ShortQuestion
from .providers import ModelOption, friendly_model_label, recommended_first

MATH_FORMAT_INSTRUCTION = (
    "If you include math, write it in KaTeX-compatible LaTeX. "
    "Use $...$ for inline math and $$...$$ for display math."
)
RETRYABLE_OPENAI_HTTP_CODES = {408, 429, 500, 502, 503, 504, 520}
OPENAI_REQUEST_MAX_ATTEMPTS = 3
OPENAI_REQUEST_BACKOFF_SECONDS = 1.0
OPENAI_GENERATION_SOURCE_CHAR_LIMITS = (120000, 80000, 50000)


@dataclass
class OpenAIAuthState:
    api_key: str = ""
    access_token: str = ""


class OpenAIRequestError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class OpenAIClient:
    provider_name = "openai"

    def __init__(
        self,
        auth: OpenAIAuthState,
        default_model: str = "gpt-5-mini",
        base_url: str = "https://api.openai.com/v1",
        token_provider: Callable[[], str] | None = None,
    ):
        self.auth = auth
        self.default_model = default_model
        self.base_url = base_url.rstrip("/")
        self.token_provider = token_provider

    def _token(self) -> str:
        if self.token_provider:
            token = self.token_provider() or ""
            if token:
                return token
        return self.auth.access_token or self.auth.api_key

    def _request_json(self, method: str, path: str, payload: dict | None = None) -> dict:
        token = self._token().strip()
        if not token:
            raise OpenAIRequestError("OpenAI credentials are missing.")

        body = None
        headers = {"Authorization": f"Bearer {token}"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        for attempt in range(1, OPENAI_REQUEST_MAX_ATTEMPTS + 1):
            try:
                with urlopen_with_trust_store(req, timeout=60) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="ignore")
                error = OpenAIRequestError(f"OpenAI HTTP {exc.code}: {detail}", status_code=exc.code)
                if attempt < OPENAI_REQUEST_MAX_ATTEMPTS and exc.code in RETRYABLE_OPENAI_HTTP_CODES:
                    time.sleep(OPENAI_REQUEST_BACKOFF_SECONDS * attempt)
                    continue
                raise error from exc
            except json.JSONDecodeError as exc:
                raise OpenAIRequestError(f"OpenAI response was not valid JSON: {exc}") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                error = OpenAIRequestError(f"OpenAI request failed: {exc}")
                if attempt < OPENAI_REQUEST_MAX_ATTEMPTS:
                    time.sleep(OPENAI_REQUEST_BACKOFF_SECONDS * attempt)
                    continue
                raise error from exc
            except Exception as exc:
                raise OpenAIRequestError(f"OpenAI request failed: {exc}") from exc

        raise OpenAIRequestError("OpenAI request failed after retries.")

    @staticmethod
    def _try_parse_json_object(text: str) -> dict | None:
        candidate = (text or "").strip()
        if not candidate:
            return None
        decoder = json.JSONDecoder()
        for index, char in enumerate(candidate):
            if char != "{":
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
        raise RuntimeError(f"OpenAI output was not valid JSON. Raw output starts with: {snippet!r}")

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
        output = dict(payload)
        if not str(output.get("title", "")).strip():
            output["title"] = "Generated Quiz"
        if not str(output.get("instructions", "")).strip():
            output["instructions"] = "Answer all questions."

        raw_questions = output.get("questions")
        if not isinstance(raw_questions, list):
            return output

        normalized_questions: list[object] = []
        for idx, question in enumerate(raw_questions, start=1):
            if not isinstance(question, dict):
                normalized_questions.append(question)
                continue
            updated = dict(question)
            updated["id"] = cls._normalized_question_id(updated.get("id"), idx)
            normalized_questions.append(updated)

        output["questions"] = normalized_questions
        return output

    @staticmethod
    def _is_retryable_generation_error(exc: Exception) -> bool:
        return isinstance(exc, OpenAIRequestError) and (
            exc.status_code is None or exc.status_code in RETRYABLE_OPENAI_HTTP_CODES
        )

    def _responses_text(self, prompt: str, model: str | None = None, max_tokens: int = 500) -> str:
        payload = {
            "model": model or self.default_model,
            "input": prompt,
            "max_output_tokens": max_tokens,
            "temperature": 0,
        }
        body = self._request_json("POST", "/responses", payload)

        direct = body.get("output_text")
        if isinstance(direct, str) and direct.strip():
            return direct.strip()

        texts: list[str] = []
        for item in body.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    text = content.get("text")
                    if isinstance(text, str):
                        texts.append(text)
        merged = "\n".join(t for t in texts if t).strip()
        return merged

    def list_models(self) -> List[ModelOption]:
        body = self._request_json("GET", "/models")
        options: list[ModelOption] = []
        for item in body.get("data", []):
            model_id = item.get("id")
            if not isinstance(model_id, str) or not model_id:
                continue
            options.append(
                ModelOption(
                    id=model_id,
                    label=friendly_model_label(model_id),
                    provider=self.provider_name,
                    capability_tags=("generation", "grading", "explain"),
                )
            )
        return recommended_first(options)

    def list_models_with_fallback(self, cached: list[dict] | None = None) -> List[ModelOption]:
        try:
            return self.list_models()
        except Exception:
            if not cached:
                raise
            options: list[ModelOption] = []
            for item in cached:
                model_id = str(item.get("id", "")).strip()
                if not model_id:
                    continue
                options.append(
                    ModelOption(
                        id=model_id,
                        label=str(item.get("label", friendly_model_label(model_id))),
                        provider=self.provider_name,
                        capability_tags=("generation", "grading", "explain"),
                    )
                )
            if not options:
                raise
            return recommended_first(options)

    @staticmethod
    def serialize_model_cache(models: Sequence[ModelOption]) -> list[dict[str, str]]:
        return [{"id": m.id, "label": m.label} for m in models]

    def grade_short(
        self,
        question: ShortQuestion,
        user_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> GradeResult:
        rubric = (
            "You grade short-answer quiz responses. "
            "Return exactly CORRECT or INCORRECT with no other words. "
            "Only return CORRECT if the answer is substantively equivalent to the expected answer."
        )
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"\nAdditional context:\n{extra_context.strip()}\n"
        prompt = (
            f"{rubric}\n\n"
            f"Question:\n{question.prompt}\n\n"
            f"Expected answer:\n{question.expected}\n\n"
            f"{context_block}"
            f"User answer:\n{user_answer}\n"
        )
        verdict = self._responses_text(prompt, model=model, max_tokens=8).strip().upper()
        if "CORRECT" in verdict and "INCORRECT" not in verdict:
            is_correct = True
        elif "INCORRECT" in verdict:
            is_correct = False
        else:
            is_correct = False
            verdict = f"UNPARSEABLE({verdict})"

        points = question.points if is_correct else 0
        if verdict.startswith("UNPARSEABLE("):
            feedback = "Your answer was marked incorrect because the grader response could not be parsed."
        else:
            feedback = "You are correct." if is_correct else "You are incorrect."
        return GradeResult(
            correct=is_correct,
            points_awarded=points,
            max_points=question.points,
            feedback=feedback,
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
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"\nAdditional context:\n{extra_context.strip()}\n\n"
        ask = (
            "Explain the correct answer briefly (max 5 sentences). "
            "Address the learner directly using 'you' and 'your'. "
            "Do not refer to the learner as 'the user' or 'the student'. "
            "Mention why their chosen answer was right or wrong. "
            f"{MATH_FORMAT_INSTRUCTION}\n\n"
            f"{context_block}"
            f"Question:\n{prompt}\n\n"
            f"Options:\n{rendered_options}\n\n"
            f"Your answer: {user_answer}\n"
            f"Correct answer: {correct_answer}\n"
        )
        return to_second_person(self._responses_text(ask, model=model, max_tokens=220).strip())

    def explain_short(
        self,
        prompt: str,
        expected_answer: str,
        user_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> str:
        context_block = ""
        if extra_context and extra_context.strip():
            context_block = f"\nAdditional context:\n{extra_context.strip()}\n\n"
        ask = (
            "Explain the expected short answer briefly (max 5 sentences). "
            "Address the learner directly using 'you' and 'your'. "
            "Do not refer to the learner as 'the user' or 'the student'. "
            "Mention whether their answer was right or wrong and what was missing or strong. "
            f"{MATH_FORMAT_INSTRUCTION}\n\n"
            f"{context_block}"
            f"Question:\n{prompt}\n\n"
            f"Your answer:\n{user_answer}\n\n"
            f"Expected answer:\n{expected_answer}\n"
        )
        return to_second_person(self._responses_text(ask, model=model, max_tokens=220).strip())

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

        ask = (
            "You are a quiz tutor answering follow-up questions about feedback. "
            "Answer clearly, concisely, and in second person ('you'/'your'). "
            "If the learner is confused, restate using simpler language. "
            f"{MATH_FORMAT_INSTRUCTION}\n\n"
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
        return to_second_person(self._responses_text(ask, model=model, max_tokens=380).strip())

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

    def _parse_quiz_payload(self, payload: dict) -> Quiz:
        title = str(payload.get("title", "Generated Quiz")).strip() or "Generated Quiz"
        instructions = str(payload.get("instructions", "Answer all questions.")).strip() or "Answer all questions."

        raw_questions = payload.get("questions")
        if not isinstance(raw_questions, list) or not raw_questions:
            raise RuntimeError("Generated quiz is missing 'questions'.")

        questions = []
        for i, raw in enumerate(raw_questions, start=1):
            if not isinstance(raw, dict):
                raise RuntimeError(f"Question #{i} is not an object.")
            qid = str(raw.get("id", f"Q{i}")).strip() or f"Q{i}"
            qtype = str(raw.get("type", "")).strip().lower()
            prompt = str(raw.get("prompt", "")).strip()
            points = int(raw.get("points", 1) or 1)
            if qtype == "mcq":
                options = raw.get("options")
                if not isinstance(options, list) or len(options) < 2:
                    raise RuntimeError(f"Question {qid} has invalid MCQ options.")
                answer = str(raw.get("answer", "A")).strip().upper()[:1]
                questions.append(
                    MCQQuestion(
                        id=qid,
                        prompt=prompt,
                        points=points,
                        options=[str(opt) for opt in options],
                        answer=answer,
                    )
                )
            elif qtype == "short":
                expected = str(raw.get("expected", "")).strip()
                questions.append(
                    ShortQuestion(
                        id=qid,
                        prompt=prompt,
                        points=points,
                        expected=expected,
                    )
                )
            else:
                raise RuntimeError(f"Unsupported generated type '{qtype}'")
        return Quiz(title=title, instructions=instructions, questions=questions)

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
        last_error: Exception | None = None
        char_limits = list(OPENAI_GENERATION_SOURCE_CHAR_LIMITS)

        for index, source_char_limit in enumerate(char_limits):
            prompt_spec = build_quiz_generation_prompt(
                materials_text=materials_text,
                title_hint=title_hint,
                instructions_hint=instructions_hint,
                total_questions=total_questions,
                mcq_count=mcq_count,
                short_count=short_count,
                mcq_options=mcq_options,
                source_char_limit=source_char_limit,
            )
            prompt = f"{prompt_spec.system}\n\n{prompt_spec.user}"

            try:
                raw = self._responses_text(prompt, model=model, max_tokens=3200)
            except Exception as exc:
                last_error = exc
                if index < len(char_limits) - 1 and self._is_retryable_generation_error(exc):
                    continue
                raise

            try:
                payload = self._parse_generated_json_object(raw)
            except RuntimeError:
                repair_prompt = (
                    f"{prompt}\n\n"
                    "Your previous response was not valid JSON. "
                    "Return only one valid JSON object. "
                    "Do not include markdown, code fences, or commentary."
                )
                try:
                    repaired_raw = self._responses_text(repair_prompt, model=model, max_tokens=3200)
                    payload = self._parse_generated_json_object(repaired_raw)
                except Exception as exc:
                    last_error = exc
                    if index < len(char_limits) - 1 and self._is_retryable_generation_error(exc):
                        continue
                    raise

            payload = self._normalize_generated_payload(payload)
            return self._parse_quiz_payload(payload)

        if last_error:
            raise last_error
        raise RuntimeError("OpenAI quiz generation failed.")
