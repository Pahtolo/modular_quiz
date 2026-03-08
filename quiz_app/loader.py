import json
from pathlib import Path
from string import ascii_uppercase
from typing import Any, Dict, List

from .models import MCQQuestion, Question, Quiz, QuizValidationError, ShortQuestion


def _require_str(value: Any, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise QuizValidationError(f"Field '{field_name}' must be a non-empty string.")
    return value.strip()


def _require_positive_int(value: Any, field_name: str) -> int:
    if not isinstance(value, int) or value <= 0:
        raise QuizValidationError(f"Field '{field_name}' must be a positive integer.")
    return value


def _require_non_empty_string_list(value: Any, field_name: str, *, minimum_length: int) -> List[str]:
    if not isinstance(value, list) or len(value) < minimum_length:
        raise QuizValidationError(
            f"Field '{field_name}' must be a list of {minimum_length}+ non-empty strings."
        )

    normalized: List[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            raise QuizValidationError(
                f"Field '{field_name}' must be a list of {minimum_length}+ non-empty strings."
            )
        normalized.append(item.strip())
    return normalized


def _parse_mcq(raw: Dict[str, Any], index: int) -> MCQQuestion:
    qid = _require_str(raw.get("id", f"q{index}"), "id")
    prompt = _require_str(raw.get("prompt"), "prompt")

    try:
        options = _require_non_empty_string_list(raw.get("options"), "options", minimum_length=2)
    except QuizValidationError as exc:
        raise QuizValidationError(f"Question {qid}: {exc}") from exc
    if len(options) > 4:
        raise QuizValidationError(f"Question {qid}: 'options' must contain at most 4 choices.")

    answer = _require_str(raw.get("answer"), "answer").upper()
    valid_letters = ascii_uppercase[: len(options)]
    if answer not in valid_letters:
        raise QuizValidationError(
            f"Question {qid}: 'answer' must be one of {', '.join(valid_letters)}."
        )

    points = raw.get("points", 1)
    points = _require_positive_int(points, "points")
    return MCQQuestion(id=qid, prompt=prompt, points=points, options=options, answer=answer)


def _parse_short(raw: Dict[str, Any], index: int) -> ShortQuestion:
    qid = _require_str(raw.get("id", f"q{index}"), "id")
    prompt = _require_str(raw.get("prompt"), "prompt")
    expected = _require_str(raw.get("expected"), "expected")
    points = raw.get("points", 2)
    points = _require_positive_int(points, "points")
    return ShortQuestion(id=qid, prompt=prompt, points=points, expected=expected)


def load_quiz(path: Path) -> Quiz:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise QuizValidationError(f"Invalid JSON in {path}: {e}") from e

    if not isinstance(raw, dict):
        raise QuizValidationError("Top-level JSON must be an object.")

    title = _require_str(raw.get("title"), "title")
    instructions = _require_str(raw.get("instructions", "Answer each question."), "instructions")

    raw_questions = raw.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise QuizValidationError("Field 'questions' must be a non-empty list.")

    questions: List[Question] = []
    seen_question_ids: set[str] = set()
    for idx, q in enumerate(raw_questions, start=1):
        if not isinstance(q, dict):
            raise QuizValidationError(f"Question #{idx} must be an object.")
        qtype = _require_str(q.get("type"), "type").lower()
        if qtype == "mcq":
            parsed = _parse_mcq(q, idx)
        elif qtype == "short":
            parsed = _parse_short(q, idx)
        else:
            raise QuizValidationError(
                f"Question #{idx}: unsupported type '{qtype}'. Use 'mcq' or 'short'."
            )
        if parsed.id in seen_question_ids:
            raise QuizValidationError(f"Question IDs must be unique. Duplicate ID found: '{parsed.id}'.")
        seen_question_ids.add(parsed.id)
        questions.append(parsed)

    return Quiz(title=title, instructions=instructions, questions=questions)
