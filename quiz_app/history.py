from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


@dataclass
class QuestionAttemptRecord:
    question_id: str
    question_type: str
    user_answer: str
    correct_answer_or_expected: str
    points_awarded: int
    max_points: int
    feedback: str
    ungraded: bool = False


@dataclass
class AttemptRecord:
    timestamp: str
    quiz_path: str
    quiz_title: str
    score: int
    max_score: int
    percent: float
    duration_seconds: float
    model_key: str
    quiz_clock_mode: str = "stopwatch"
    quiz_timer_duration_seconds: int = 0
    questions: list[QuestionAttemptRecord] = field(default_factory=list)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "yes", "y"}


def _normalize_quiz_clock_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized == "timer":
        return "timer"
    if normalized == "off":
        return "off"
    return "stopwatch"


def _coerce_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(0, parsed)


def _question_from_mapping(raw: dict[str, Any]) -> QuestionAttemptRecord:
    return QuestionAttemptRecord(
        question_id=str(raw.get("question_id", "")).strip(),
        question_type=str(raw.get("question_type", "")).strip(),
        user_answer=str(raw.get("user_answer", "")).strip(),
        correct_answer_or_expected=str(raw.get("correct_answer_or_expected", "")).strip(),
        points_awarded=int(raw.get("points_awarded", 0) or 0),
        max_points=int(raw.get("max_points", 0) or 0),
        feedback=str(raw.get("feedback", "")).strip(),
        ungraded=_coerce_bool(raw.get("ungraded", False)),
    )


def _attempt_from_mapping(raw: dict[str, Any]) -> AttemptRecord:
    questions_raw = raw.get("questions")
    questions: list[QuestionAttemptRecord] = []
    if isinstance(questions_raw, list):
        for q in questions_raw:
            if isinstance(q, dict):
                questions.append(_question_from_mapping(q))

    score = int(raw.get("score", 0) or 0)
    max_score = int(raw.get("max_score", 0) or 0)
    percent_raw = raw.get("percent", 0)
    try:
        percent = float(percent_raw)
    except Exception:
        percent = 0.0

    duration_raw = raw.get("duration_seconds", 0)
    try:
        duration = float(duration_raw)
    except Exception:
        duration = 0.0

    return AttemptRecord(
        timestamp=str(raw.get("timestamp", "")).strip(),
        quiz_path=str(raw.get("quiz_path", "")).strip(),
        quiz_title=str(raw.get("quiz_title", "")).strip(),
        score=score,
        max_score=max_score,
        percent=percent,
        duration_seconds=duration,
        model_key=str(raw.get("model_key", "")).strip(),
        quiz_clock_mode=_normalize_quiz_clock_mode(raw.get("quiz_clock_mode", "stopwatch")),
        quiz_timer_duration_seconds=_coerce_non_negative_int(raw.get("quiz_timer_duration_seconds", 0)),
        questions=questions,
    )


def load_history(path: Path) -> list[AttemptRecord]:
    if not path.exists():
        return []

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    out: list[AttemptRecord] = []
    for item in payload:
        if isinstance(item, dict):
            out.append(_attempt_from_mapping(item))
    return out


def save_history(path: Path, attempts: list[AttemptRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(a) for a in attempts]

    with NamedTemporaryFile("w", delete=False, dir=str(path.parent), encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2)
        tmp.write("\n")
        temp_path = Path(tmp.name)

    temp_path.replace(path)


def append_attempt(path: Path, attempt: AttemptRecord) -> None:
    attempts = load_history(path)
    attempts.append(attempt)
    save_history(path, attempts)


def history_for_quiz(attempts: list[AttemptRecord], quiz_path: str | Path | None) -> list[AttemptRecord]:
    if quiz_path is None:
        return list(attempts)

    needle = str(quiz_path)
    if not needle:
        return list(attempts)

    return [attempt for attempt in attempts if attempt.quiz_path == needle]
