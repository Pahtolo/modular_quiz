import json
import sys
from datetime import datetime
from pathlib import Path

from quiz_app.loader import load_quiz
from quiz_app.models import MCQQuestion, Quiz, ShortQuestion
from quiz_app.providers import ProviderClient

from .extractors import extract_all_materials
from .types import GenerationRequest, GenerationResult

_PROMPT_TEMPLATE_HEADER = "Generation template (JSON)"


def _template_path() -> Path:
    packaged_root = getattr(sys, "_MEIPASS", None)
    if packaged_root:
        return Path(packaged_root) / "template_quiz.json"
    return Path(__file__).resolve().parents[2] / "template_quiz.json"


def _validate_request(request: GenerationRequest) -> list[str]:
    errors: list[str] = []
    if request.total <= 0:
        errors.append("Total question count must be greater than zero.")
    if request.mcq_count < 0 or request.short_count < 0:
        errors.append("Question type counts cannot be negative.")
    if request.mcq_count + request.short_count != request.total:
        errors.append("mcq_count + short_count must equal total.")
    if request.mcq_options < 2:
        errors.append("mcq_options must be at least 2.")
    if not request.sources:
        errors.append("At least one source file is required.")
    return errors


def _load_template_text() -> str:
    return _template_path().read_text(encoding="utf-8").strip()


def _validate_template_text(template_text: str) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(template_text)
    except json.JSONDecodeError as exc:
        return [f"template_quiz.json is not valid JSON: {exc}"]

    if not isinstance(payload, dict):
        return ["template_quiz.json must be a JSON object."]

    for field in ("title", "instructions", "questions"):
        if field not in payload:
            errors.append(f"template_quiz.json is missing required top-level field '{field}'.")

    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        errors.append("template_quiz.json must include a non-empty 'questions' array.")
        return errors

    seen_types: set[str] = set()
    for question in questions:
        if not isinstance(question, dict):
            errors.append("template_quiz.json questions must be objects.")
            continue

        qtype = str(question.get("type", "")).strip()
        if qtype == "mcq":
            seen_types.add("mcq")
            for field in ("id", "type", "prompt", "options", "answer", "points"):
                if field not in question:
                    errors.append(f"template_quiz.json mcq example missing '{field}'.")
            options = question.get("options")
            if not isinstance(options, list) or len(options) < 2:
                errors.append("template_quiz.json mcq example must include at least 2 options.")
        elif qtype == "short":
            seen_types.add("short")
            for field in ("id", "type", "prompt", "expected", "points"):
                if field not in question:
                    errors.append(f"template_quiz.json short example missing '{field}'.")

    for required_type in ("mcq", "short"):
        if required_type not in seen_types:
            errors.append(f"template_quiz.json must include a '{required_type}' question example.")
    return errors


def _build_generation_context(materials_text: str, template_text: str) -> str:
    return (
        f"{_PROMPT_TEMPLATE_HEADER}:\n"
        f"{template_text}\n\n"
        "Generation requirements:\n"
        "- Follow the template field names and structure exactly.\n"
        "- Return valid JSON only.\n"
        "- Keep question types limited to mcq and short.\n\n"
        f"Source material:\n{materials_text}"
    )


def _validate_generation_context(context_text: str, template_text: str) -> list[str]:
    errors: list[str] = []
    if _PROMPT_TEMPLATE_HEADER not in context_text:
        errors.append("Prompt context is missing the template header.")
    if template_text not in context_text:
        errors.append("Prompt context does not include template_quiz.json content.")
    if "Source material:" not in context_text:
        errors.append("Prompt context is missing source material.")
    for token in ('"questions"', '"type"', '"prompt"'):
        if token not in context_text:
            errors.append(f"Prompt context is missing required schema token {token}.")
    return errors


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

        result.errors.extend(_validate_request(request))
        if result.errors:
            return result

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
            template_text = _load_template_text()
        except Exception as exc:
            result.errors.append(f"Unable to load template_quiz.json: {exc}")
            return result

        template_errors = _validate_template_text(template_text)
        if template_errors:
            result.errors.extend(template_errors)
            return result

        prompt_context = _build_generation_context(materials_text, template_text)
        prompt_errors = _validate_generation_context(prompt_context, template_text)
        if prompt_errors:
            result.errors.extend(prompt_errors)
            return result

        try:
            quiz = self._client.generate_quiz(
                materials_text=prompt_context,
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
