from dataclasses import dataclass
from string import ascii_uppercase
from typing import Callable, Protocol

from .graders import GradeResult, MCQGrader
from .models import MCQQuestion, Quiz, ShortQuestion


class ShortGrader(Protocol):
    def grade(self, question: ShortQuestion, user_answer: str) -> GradeResult: ...


@dataclass(frozen=True)
class QuizResult:
    total_score: int
    max_score: int
    percent: float


class QuizRunner:
    def __init__(self, input_fn: Callable[[str], str] = input, output_fn: Callable[[str], None] = print):
        self.input_fn = input_fn
        self.output_fn = output_fn
        self.mcq_grader = MCQGrader()

    def _ask_mcq(self, q: MCQQuestion, number: int) -> str:
        self.output_fn(f"\nQ{number}. {q.prompt}")
        for idx, option in enumerate(q.options):
            letter = ascii_uppercase[idx]
            self.output_fn(f"{letter}. {option}")

        valid = set(ascii_uppercase[: len(q.options)])
        while True:
            try:
                answer = self.input_fn("Your answer: ").strip().upper()
            except EOFError:
                raise SystemExit("\nInput ended early. Exiting quiz.")
            if answer and answer[0] in valid:
                return answer[0]
            self.output_fn(f"Enter one of: {', '.join(sorted(valid))}")

    def _ask_short(self, q: ShortQuestion, number: int) -> str:
        self.output_fn(f"\nQ{number}. {q.prompt}")
        self.output_fn("Your answer (finish with an empty line):")

        lines = []
        while True:
            try:
                line = self.input_fn("")
            except EOFError:
                raise SystemExit("\nInput ended early. Exiting quiz.")
            if line == "":
                break
            lines.append(line)

        return "\n".join(lines).strip()

    def run(self, quiz: Quiz, short_grader: ShortGrader) -> QuizResult:
        max_score = sum(q.points for q in quiz.questions)
        total_score = 0

        self.output_fn(f"\nRunning: {quiz.title}")
        self.output_fn(quiz.instructions)
        self.output_fn(f"Questions: {len(quiz.questions)}")
        self.output_fn(f"Total points: {max_score}\n")

        for i, q in enumerate(quiz.questions, start=1):
            if isinstance(q, MCQQuestion):
                user_answer = self._ask_mcq(q, i)
                result = self.mcq_grader.grade(q, user_answer)
            else:
                user_answer = self._ask_short(q, i)
                result = short_grader.grade(q, user_answer)

            total_score += result.points_awarded
            self.output_fn(result.feedback)

        percent = (total_score / max_score * 100.0) if max_score else 0.0
        self.output_fn("\nResults")
        self.output_fn(f"Score: {total_score}/{max_score} ({percent:.1f}%)")

        return QuizResult(total_score=total_score, max_score=max_score, percent=percent)
