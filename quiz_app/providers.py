from dataclasses import dataclass
from typing import Iterable, List, Protocol, Sequence

from .graders import GradeResult
from .models import Quiz, ShortQuestion


@dataclass(frozen=True)
class ModelOption:
    id: str
    label: str
    provider: str
    capability_tags: tuple[str, ...] = ()


class ProviderClient(Protocol):
    provider_name: str

    def list_models(self) -> List[ModelOption]: ...

    def grade_short(
        self,
        question: ShortQuestion,
        user_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> GradeResult: ...

    def explain_mcq(
        self,
        prompt: str,
        options: Sequence[str],
        user_answer: str,
        correct_answer: str,
        model: str | None = None,
        extra_context: str | None = None,
    ) -> str: ...

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
    ) -> str: ...

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
    ) -> Quiz: ...


def _friendly_family(model_id: str) -> str | None:
    key = model_id.lower()
    if "codex" in key:
        if "5.3" in key:
            return "5.3 Codex"
        if "5.2" in key:
            return "5.2 Codex"
        return "Codex"
    if "thinking" in key:
        if "5.2" in key:
            return "5.2 Thinking"
        return "Thinking"
    if "instant" in key:
        if "5.3" in key:
            return "5.3 Instant"
        return "Instant"
    if "gpt-5" in key:
        if "codex" in key:
            return "5.x Codex"
        if "mini" in key:
            return "5.x Mini"
        return "5.x"
    return None


def friendly_model_label(model_id: str) -> str:
    family = _friendly_family(model_id)
    if family:
        return f"{family} - {model_id}"
    return model_id


def recommended_first(models: Iterable[ModelOption]) -> list[ModelOption]:
    preferred = []
    others = []
    for model in models:
        key = model.id.lower()
        if any(token in key for token in ("codex", "thinking", "instant", "gpt-5")):
            preferred.append(model)
        else:
            others.append(model)

    preferred.sort(key=lambda m: m.id)
    others.sort(key=lambda m: m.id)
    return preferred + others
