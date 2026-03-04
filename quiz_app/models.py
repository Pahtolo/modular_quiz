from dataclasses import dataclass
from typing import List, Union


class QuizValidationError(ValueError):
    """Raised when a quiz JSON file is invalid."""


@dataclass(frozen=True)
class BaseQuestion:
    id: str
    prompt: str
    points: int


@dataclass(frozen=True)
class MCQQuestion(BaseQuestion):
    options: List[str]
    answer: str  # Letter: A, B, C, ...


@dataclass(frozen=True)
class ShortQuestion(BaseQuestion):
    expected: str


Question = Union[MCQQuestion, ShortQuestion]


@dataclass(frozen=True)
class Quiz:
    title: str
    instructions: str
    questions: List[Question]
