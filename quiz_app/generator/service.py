import json
from datetime import datetime
from pathlib import Path

from quiz_app.loader import load_quiz
from quiz_app.models import MCQQuestion, Quiz, ShortQuestion
from quiz_app.providers import ProviderClient

from .extractors import extract_all_materials
from .types import GenerationRequest, GenerationResult


def _quiz_to_payload(quiz: Quiz) -> dict:
    questions: list[dict] = []
    for question in quiz.questions:
        if isinstance(question, MCQQuestion):
            questions.append(
                {
                    "type": "mcq",
                    "prompt": question.prompt,
                    "options": question.options,
                    "answer": question.answer,
                    "points": question.points,
                }
            )
        elif isinstance(question, ShortQuestion):
            questions.append(
                {
                    "type": "short",
                    "prompt": question.prompt,
                    "expected": question.expected,
                    "points": question.points,
                }
            )

    return {
        "name": quiz.title,
        "title": quiz.title,
        "instructions": quiz.instructions,
        "questions": questions,
    }


def _slugify(value: str) -> str:
    chars = []
    for ch in value.strip().lower():
        chars.append(ch if ch.isalnum() else "_")
    slug = "".join(chars).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "generated_quiz"


def _unique_path(base: Path) -> Path:
    if not base.exists():
        return base
    stem = base.stem
    suffix = base.suffix
    parent = base.parent
    counter = 1
    while True:
        candidate = parent / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


class GenerationService:
    def __init__(self, client: ProviderClient):
        self._client = client

    def generate(self, request: GenerationRequest) -> GenerationResult:
        result = GenerationResult(
            total=request.total,
            mcq_count=request.mcq_count,
            short_count=request.short_count,
            mcq_options=request.mcq_options,
        )
        result.warnings.extend(request.warnings)
        result.errors.extend(request.errors)

        materials = extract_all_materials(request.sources)
        result.extracted_materials = materials
        for material in materials:
            result.warnings.extend(material.warnings)
            result.errors.extend(material.errors)

        if result.errors:
            return result

        materials_text = "\n\n".join(m.content for m in materials if m.content).strip()
        if not materials_text:
            result.errors.append("No extractable source content found.")
            return result

        try:
            quiz = self._client.generate_quiz(
                materials_text=materials_text,
                title_hint=request.title_hint or "Generated Quiz",
                instructions_hint=request.instructions_hint or "Answer all questions.",
                total_questions=request.total,
                mcq_count=request.mcq_count,
                short_count=request.short_count,
                mcq_options=request.mcq_options,
                model=request.model,
            )
        except Exception as exc:
            result.errors.append(f"Quiz generation failed: {exc}")
            return result

        result.quiz_json_text = json.dumps(_quiz_to_payload(quiz), indent=2)
        output_dir = Path(request.quiz_dir).expanduser().resolve() / request.output_subdir
        output_dir.mkdir(parents=True, exist_ok=True)

        stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        title_seed = request.title_hint or quiz.title or "generated_quiz"
        output_path = _unique_path(output_dir / f"{_slugify(title_seed)}_{stamp}.json")

        try:
            output_path.write_text(result.quiz_json_text + "\n", encoding="utf-8")
            _ = load_quiz(output_path)
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            result.errors.append(f"Generated quiz failed validation: {exc}")
            return result

        result.output_path = output_path
        return result


def generate_quiz_file(request: GenerationRequest, client: ProviderClient) -> GenerationResult:
    return GenerationService(client).generate(request)
