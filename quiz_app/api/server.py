from __future__ import annotations

import json
import shutil
import traceback
from dataclasses import asdict, dataclass
from pathlib import Path
from string import ascii_uppercase
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from quiz_app.claude_client import ClaudeClient
from quiz_app.generator.extractors import collect_sources, extract_all_materials
from quiz_app.generator.service import generate_quiz_file
from quiz_app.generator.types import GenerationRequest, GenerationResult, SourceFile
from quiz_app.graders import GradeResult, MCQGrader
from quiz_app.history import AttemptRecord, QuestionAttemptRecord, append_attempt, history_for_quiz, load_history, save_history
from quiz_app.loader import load_quiz
from quiz_app.models import MCQQuestion, Quiz, QuizValidationError, ShortQuestion
from quiz_app.openai_auth import OAuthConfig, OpenAIPKCEAuthenticator, refresh_access_token
from quiz_app.openai_client import OpenAIAuthState, OpenAIClient
from quiz_app.providers import ModelOption
from quiz_app.settings_store import AppSettings, SettingsStore


class APIError(RuntimeError):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


@dataclass
class APIState:
    settings_store: SettingsStore
    api_token: str
    project_root: Path


def _error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        }
    }


def _state(request: Request) -> APIState:
    return request.app.state.api_state


def _settings(state: APIState) -> AppSettings:
    settings = state.settings_store.load()
    _ensure_quizzes_library(state, settings)
    return settings


def _save_settings(state: APIState, settings: AppSettings) -> None:
    state.settings_store.save(settings)


def _resolve_history_path(state: APIState, settings: AppSettings) -> Path:
    raw = (settings.performance_history_path or "settings/performance_history.json").strip()
    path = Path(raw).expanduser()
    if not path.is_absolute():
        project_root = state.settings_store.path.parent.parent
        path = (project_root / path).resolve()
    return path


def _openai_token(state: APIState, settings: AppSettings) -> str:
    if settings.openai_auth_mode == "api_key":
        return (settings.openai_api_key or "").strip()

    access = (settings.openai_oauth_access_token or "").strip()
    expires_at = float(settings.openai_oauth_expires_at or 0)
    if access and expires_at > 0:
        import time

        if expires_at > time.time() + 30:
            return access

    if settings.openai_oauth_refresh_token and settings.openai_oauth_token_url and settings.openai_oauth_client_id:
        cfg = OAuthConfig(
            authorize_url=settings.openai_oauth_authorize_url,
            token_url=settings.openai_oauth_token_url,
            client_id=settings.openai_oauth_client_id,
            scopes=tuple(settings.openai_oauth_scopes),
            redirect_port=int(settings.openai_oauth_redirect_port),
        )
        refreshed = refresh_access_token(cfg, settings.openai_oauth_refresh_token)
        settings.openai_oauth_access_token = refreshed.access_token
        settings.openai_oauth_refresh_token = refreshed.refresh_token
        settings.openai_oauth_expires_at = refreshed.expires_at
        _save_settings(state, settings)
        return refreshed.access_token

    return access


def _preferred_provider_model(settings: AppSettings) -> tuple[str, str]:
    raw = str(settings.preferred_model_key or "").strip()
    if ":" not in raw:
        return "", ""
    provider, model = raw.split(":", 1)
    provider = provider.strip().lower()
    model = model.strip()
    if provider not in {"self", "claude", "openai"}:
        return "", ""
    return provider, model


def _provider_client(state: APIState, provider: str, settings: AppSettings):
    key = (provider or "").strip().lower()
    preferred_provider, preferred_model = _preferred_provider_model(settings)
    if key == "claude":
        default_model = (
            preferred_model
            if preferred_provider == "claude" and preferred_model
            else (settings.claude_model_selected or settings.claude_model)
        )
        return ClaudeClient(
            api_key=settings.claude_api_key,
            default_model=default_model,
            curated_models=settings.claude_models,
        )
    if key == "openai":
        default_model = (
            preferred_model
            if preferred_provider == "openai" and preferred_model
            else (settings.openai_model_selected or "gpt-5-mini")
        )
        return OpenAIClient(
            auth=OpenAIAuthState(api_key=settings.openai_api_key),
            default_model=default_model,
            token_provider=lambda: _openai_token(state, settings),
        )
    return None


def _provider_client_for_preview(provider: str, settings: AppSettings):
    key = (provider or "").strip().lower()
    preferred_provider, preferred_model = _preferred_provider_model(settings)
    if key == "claude":
        default_model = (
            preferred_model
            if preferred_provider == "claude" and preferred_model
            else (settings.claude_model_selected or settings.claude_model)
        )
        return ClaudeClient(
            api_key=settings.claude_api_key,
            default_model=default_model,
            curated_models=settings.claude_models,
        )
    if key == "openai":
        default_model = (
            preferred_model
            if preferred_provider == "openai" and preferred_model
            else (settings.openai_model_selected or "gpt-5-mini")
        )
        return OpenAIClient(
            auth=OpenAIAuthState(
                api_key=settings.openai_api_key,
                access_token=settings.openai_oauth_access_token,
            ),
            default_model=default_model,
        )
    return None


def _preview_settings(state: APIState, preview_payload: Any) -> AppSettings:
    settings = _settings(state)
    if not isinstance(preview_payload, dict):
        return settings

    current = asdict(settings)
    for key, value in preview_payload.items():
        if key in current:
            current[key] = value
    return state.settings_store._coerce_from_mapping(current)


def _list_models_payload(
    state: APIState,
    provider: str,
    settings: AppSettings,
    *,
    preview: bool = False,
) -> dict[str, Any]:
    provider_key = provider.strip().lower()

    if provider_key == "self":
        models = [
            ModelOption(
                id="",
                label="No model",
                provider="self",
                capability_tags=(),
            )
        ]
        return {"models": [_model_payload(m) for m in models]}

    client = _provider_client_for_preview(provider_key, settings) if preview else _provider_client(state, provider_key, settings)
    if client is None:
        raise APIError(status_code=404, code="NOT_FOUND", message=f"Unsupported provider: {provider_key}")

    if provider_key == "openai":
        warnings: list[str] = []
        try:
            if preview:
                models = client.list_models()
            else:
                models = client.list_models_with_fallback(cached=settings.openai_models_cache)
        except Exception as exc:
            warnings.append(str(exc))
            models = []

        if not preview:
            settings.openai_models_cache = OpenAIClient.serialize_model_cache(models)
            _save_settings(state, settings)
        return {
            "models": [_model_payload(m) for m in models],
            "warnings": warnings,
        }

    models = client.list_models()
    return {"models": [_model_payload(m) for m in models]}


def _require_auth(request: Request) -> None:
    state = _state(request)
    auth_header = request.headers.get("authorization", "")
    expected = f"Bearer {state.api_token}"
    if auth_header != expected:
        raise APIError(status_code=401, code="UNAUTHORIZED", message="Missing or invalid bearer token.")


def _model_payload(model: ModelOption) -> dict[str, Any]:
    return {
        "id": model.id,
        "label": model.label,
        "provider": model.provider,
        "capability_tags": list(model.capability_tags),
    }


def _quiz_payload(quiz: Quiz) -> dict[str, Any]:
    questions: list[dict[str, Any]] = []
    for q in quiz.questions:
        if isinstance(q, MCQQuestion):
            questions.append(
                {
                    "id": q.id,
                    "type": "mcq",
                    "prompt": q.prompt,
                    "options": list(q.options),
                    "answer": q.answer,
                    "points": q.points,
                }
            )
        else:
            questions.append(
                {
                    "id": q.id,
                    "type": "short",
                    "prompt": q.prompt,
                    "expected": q.expected,
                    "points": q.points,
                }
            )
    return {
        "title": quiz.title,
        "instructions": quiz.instructions,
        "questions": questions,
    }


def _grade_payload(result: GradeResult) -> dict[str, Any]:
    return {
        "correct": result.correct,
        "points_awarded": result.points_awarded,
        "max_points": result.max_points,
        "feedback": result.feedback,
    }


def _source_payload(source: SourceFile) -> dict[str, Any]:
    return {
        "path": str(source.path),
        "source_kind": source.source_kind,
    }


def _generation_result_payload(result: GenerationResult) -> dict[str, Any]:
    return {
        "ok": result.ok,
        "total": result.total,
        "mcq_count": result.mcq_count,
        "short_count": result.short_count,
        "mcq_options": result.mcq_options,
        "output_path": str(result.output_path) if result.output_path else None,
        "quiz_json_text": result.quiz_json_text,
        "warnings": list(result.warnings),
        "errors": list(result.errors),
        "extracted_materials": [
            {
                "path": str(m.path),
                "content": m.content,
                "extracted_by": m.extracted_by,
                "needs_ocr": m.needs_ocr,
                "warnings": list(m.warnings),
                "errors": list(m.errors),
            }
            for m in result.extracted_materials
        ],
    }


def _attempt_payload(record: AttemptRecord) -> dict[str, Any]:
    return asdict(record)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    normalized = str(value or "").strip().lower()
    return normalized in {"1", "true", "yes", "y"}


def _coerce_int(value: Any, field_name: str, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, str) and not value.strip():
        return default
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"Field '{field_name}' must be an integer.",
        ) from exc


def _coerce_float(value: Any, field_name: str, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str) and not value.strip():
        return default
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"Field '{field_name}' must be a number.",
        ) from exc


def _attempt_from_payload(payload: dict[str, Any]) -> AttemptRecord:
    questions_raw = payload.get("questions") if isinstance(payload.get("questions"), list) else []
    questions: list[QuestionAttemptRecord] = []
    for item in questions_raw:
        if not isinstance(item, dict):
            continue
        questions.append(
            QuestionAttemptRecord(
                question_id=str(item.get("question_id", "")).strip(),
                question_type=str(item.get("question_type", "")).strip(),
                user_answer=str(item.get("user_answer", "")),
                correct_answer_or_expected=str(item.get("correct_answer_or_expected", "")),
                points_awarded=_coerce_int(item.get("points_awarded"), "questions[].points_awarded", default=0),
                max_points=_coerce_int(item.get("max_points"), "questions[].max_points", default=0),
                feedback=str(item.get("feedback", "")).strip(),
                ungraded=_coerce_bool(item.get("ungraded", False)),
            )
        )

    quiz_clock_mode = str(payload.get("quiz_clock_mode", "stopwatch")).strip().lower()
    if quiz_clock_mode not in {"off", "timer"}:
        quiz_clock_mode = "stopwatch"
    quiz_timer_duration_seconds = _coerce_int(
        payload.get("quiz_timer_duration_seconds"),
        "quiz_timer_duration_seconds",
        default=0,
    )
    quiz_timer_duration_seconds = max(0, quiz_timer_duration_seconds)
    if quiz_clock_mode != "timer":
        quiz_timer_duration_seconds = 0

    return AttemptRecord(
        timestamp=str(payload.get("timestamp", "")).strip(),
        quiz_path=str(payload.get("quiz_path", "")).strip(),
        quiz_title=str(payload.get("quiz_title", "")).strip(),
        score=_coerce_int(payload.get("score"), "score", default=0),
        max_score=_coerce_int(payload.get("max_score"), "max_score", default=0),
        percent=_coerce_float(payload.get("percent"), "percent", default=0.0),
        duration_seconds=_coerce_float(payload.get("duration_seconds"), "duration_seconds", default=0.0),
        model_key=str(payload.get("model_key", "")).strip(),
        quiz_clock_mode=quiz_clock_mode,
        quiz_timer_duration_seconds=quiz_timer_duration_seconds,
        questions=questions,
    )


def _quiz_file_allowed(path: Path) -> bool:
    if path.suffix.lower() != ".json":
        return False
    if path.name == "settings.json" and path.parent.name == "settings":
        return False
    return True


def _path_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except Exception:
        return False


def _quizzes_library_dir(state: APIState, settings: AppSettings) -> Path:
    # Keep managed quizzes in the runtime settings root so packaged installs are
    # writable and start with an empty library by default.
    _ = settings
    user_data_root = state.settings_store.path.parent.parent.resolve()
    return (user_data_root / "Quizzes").resolve()


def _ensure_quizzes_library(state: APIState, settings: AppSettings) -> Path:
    # On first install/launch, normalize quiz storage into userData so it is writable.
    user_data_root = state.settings_store.path.parent.parent.resolve()
    changed = False
    if str(settings.quiz_dir or "").strip() in {"", "."}:
        settings.quiz_dir = str(user_data_root)
        changed = True

    quizzes_dir = _quizzes_library_dir(state, settings)
    quizzes_dir.mkdir(parents=True, exist_ok=True)
    desired_roots = [str(quizzes_dir)]
    if settings.quiz_roots != desired_roots:
        settings.quiz_roots = desired_roots
        changed = True
    if changed:
        _save_settings(state, settings)
    return quizzes_dir


def _normalize_generation_output_subdir(value: Any, quizzes_dir: Path) -> str:
    raw = str(value or "").strip()
    if raw in {"", "."}:
        return ""

    candidate = Path(raw).expanduser()
    resolved = candidate.resolve() if candidate.is_absolute() else (quizzes_dir / candidate).resolve()
    if not _path_within(resolved, quizzes_dir):
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Generation output folder must remain inside the managed Quizzes directory.",
        )
    if resolved.exists() and not resolved.is_dir():
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Generation output folder must be a directory.",
        )

    relative = resolved.relative_to(quizzes_dir).as_posix()
    return "" if relative in {"", "."} else relative


def _quiz_display_name(path: Path) -> str:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return path.stem

    if isinstance(raw, dict):
        for key in ("title", "name"):
            value = raw.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return path.stem


def _quiz_structure_tree(root_dir: Path) -> list[dict[str, Any]]:
    def _walk(current: Path) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        try:
            entries = sorted(current.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except Exception:
            return []

        for entry in entries:
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                children = _walk(entry)
                nodes.append(
                    {
                        "name": entry.name,
                        "path": str(entry),
                        "kind": "folder",
                        "children": children,
                    }
                )
                continue
            if entry.is_file() and _quiz_file_allowed(entry):
                nodes.append(
                    {
                        "name": _quiz_display_name(entry),
                        "file_name": entry.name,
                        "path": str(entry),
                        "kind": "quiz",
                        "children": [],
                    }
                )
        return nodes

    return _walk(root_dir)


def _quiz_library_path(value: Any, quizzes_dir: Path, *, allow_root: bool = True) -> Path:
    raw = str(value or "").strip()
    candidate = quizzes_dir if not raw else Path(raw).expanduser().resolve()
    if not _path_within(candidate, quizzes_dir):
        raise APIError(
            status_code=403,
            code="FORBIDDEN",
            message="Quiz folder operations must stay inside the managed Quizzes directory.",
        )
    if not allow_root and candidate == quizzes_dir:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="The managed Quizzes directory itself cannot be modified by this action.",
        )
    return candidate


def _quiz_library_folder_name(value: Any) -> str:
    folder_name = str(value or "").strip()
    if not folder_name:
        raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'name' is required.")
    if folder_name in {".", ".."} or Path(folder_name).name != folder_name or "/" in folder_name or "\\" in folder_name:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Folder names must be a single path segment.",
        )
    return folder_name


def _quiz_library_item_name(value: Any, *, field_name: str = "name") -> str:
    item_name = str(value or "").strip()
    if not item_name:
        raise APIError(status_code=422, code="VALIDATION_ERROR", message=f"Field '{field_name}' is required.")
    if item_name in {".", ".."} or Path(item_name).name != item_name or "/" in item_name or "\\" in item_name:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Names must be a single path segment.",
        )
    return item_name


def _unique_destination(path: Path) -> Path:
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    idx = 2
    while True:
        candidate = path.with_name(f"{stem}-{idx}{suffix}")
        if not candidate.exists():
            return candidate
        idx += 1


def _unique_directory(path: Path) -> Path:
    if not path.exists():
        return path
    idx = 2
    while True:
        candidate = path.parent / f"{path.name}-{idx}"
        if not candidate.exists():
            return candidate
        idx += 1


def _import_single_quiz_file(source_file: Path, quizzes_dir: Path) -> tuple[int, list[str], dict[str, Any] | None]:
    if not _quiz_file_allowed(source_file):
        return 0, [f"Skipped unsupported file: {source_file}"], None

    destination = _unique_destination(quizzes_dir / source_file.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_file, destination)
    return 1, [], {"source_path": str(source_file), "target_path": str(destination), "kind": "file", "files": 1}


def _import_quiz_folder(source_dir: Path, quizzes_dir: Path) -> tuple[int, list[str], dict[str, Any] | None]:
    target_root = _unique_directory(quizzes_dir / source_dir.name)
    imported = 0
    warnings: list[str] = []

    for candidate in source_dir.rglob("*.json"):
        if not candidate.is_file() or not _quiz_file_allowed(candidate):
            continue
        try:
            rel_parts = candidate.relative_to(source_dir).parts
        except Exception:
            continue
        if any(part.startswith(".") for part in rel_parts):
            continue
        destination = target_root / Path(*rel_parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate, destination)
        imported += 1

    if imported == 0:
        warnings.append(f"No quiz JSON files found in folder: {source_dir}")
        return 0, warnings, None

    return imported, warnings, {"source_path": str(source_dir), "target_path": str(target_root), "kind": "folder", "files": imported}


def _quiz_nodes_for_directory(root_path: Path) -> list[dict[str, Any]]:
    def _walk(current: Path) -> list[dict[str, Any]]:
        nodes: list[dict[str, Any]] = []
        try:
            entries = sorted(current.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except Exception:
            return []

        for entry in entries:
            if entry.name.startswith("."):
                continue

            if entry.is_dir():
                children = _walk(entry)
                if children:
                    nodes.append(
                        {
                            "name": entry.name,
                            "path": str(entry),
                            "relative_path": str(entry.relative_to(root_path)),
                            "kind": "folder",
                            "children": children,
                        }
                    )
                continue

            if not entry.is_file() or not _quiz_file_allowed(entry):
                continue

            nodes.append(
                {
                    "name": _quiz_display_name(entry),
                    "path": str(entry),
                    "relative_path": str(entry.relative_to(root_path)),
                    "kind": "quiz",
                    "children": [],
                }
            )

        return nodes

    return _walk(root_path)


def _build_quiz_tree(roots: list[Path]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []

    for root in roots:
        root_path = root.expanduser().resolve()
        root_node = {
            # Use full path so similarly named roots from different locations are distinguishable.
            "name": str(root_path),
            "path": str(root_path),
            "kind": "root",
            "children": [],
        }

        if root_path.exists() and root_path.is_dir():
            root_node["children"] = _quiz_nodes_for_directory(root_path)
        elif root_path.exists() and root_path.is_file() and _quiz_file_allowed(root_path):
            root_node["children"].append(
                {
                    "name": _quiz_display_name(root_path),
                    "file_name": root_path.name,
                    "path": str(root_path),
                    "kind": "quiz",
                    "children": [],
                }
            )

        if root_node["children"]:
            output.append(root_node)

    return output


def _mcq_question_from_payload(payload: dict[str, Any]) -> MCQQuestion:
    options_raw = payload.get("options")
    if not isinstance(options_raw, list) or len(options_raw) < 2:
        raise APIError(status_code=422, code="VALIDATION_ERROR", message="MCQ question options must have 2+ items.")

    if any(not isinstance(opt, str) for opt in options_raw):
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="MCQ question options must be strings.",
        )

    options = list(options_raw)
    if any(not option.strip() for option in options):
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="MCQ question options must be non-empty strings.",
        )

    answer = str(payload.get("answer", "A")).strip().upper() or "A"
    if len(answer) != 1:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="MCQ answer must be exactly one letter.",
        )

    valid_answers = ascii_uppercase[: len(options)]
    if answer not in valid_answers:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message=f"MCQ answer must be one of {', '.join(valid_answers)}.",
        )

    try:
        points = int(payload.get("points", 1))
    except (TypeError, ValueError) as exc:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="MCQ question points must be a positive integer.",
        ) from exc
    if points <= 0:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="MCQ question points must be a positive integer.",
        )

    return MCQQuestion(
        id=str(payload.get("id", "q")).strip() or "q",
        prompt=str(payload.get("prompt", "")).strip(),
        points=points,
        options=options,
        answer=answer,
    )


def _short_question_points_from_payload(payload: dict[str, Any]) -> int:
    if "points" not in payload:
        return 2
    raw_points = payload.get("points")
    if isinstance(raw_points, bool):
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Short-answer question points must be a positive integer.",
        )
    if isinstance(raw_points, float):
        if not raw_points.is_integer():
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Short-answer question points must be a positive integer.",
            )
        points = int(raw_points)
    else:
        try:
            points = int(raw_points)
        except (TypeError, ValueError) as exc:
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Short-answer question points must be a positive integer.",
            ) from exc
    if points <= 0:
        raise APIError(
            status_code=422,
            code="VALIDATION_ERROR",
            message="Short-answer question points must be a positive integer.",
        )
    return points


def _short_question_from_payload(payload: dict[str, Any]) -> ShortQuestion:
    return ShortQuestion(
        id=str(payload.get("id", "q")).strip() or "q",
        prompt=str(payload.get("prompt", "")).strip(),
        points=_short_question_points_from_payload(payload),
        expected=str(payload.get("expected", "")).strip(),
    )


def create_app(
    settings_path: Path,
    api_token: str,
    project_root: Path | None = None,
) -> FastAPI:
    state = APIState(
        settings_store=SettingsStore(path=settings_path),
        api_token=api_token,
        project_root=(project_root or settings_path.parent.parent).resolve(),
    )

    app = FastAPI(title="Modular Quiz API", version="0.2.5")
    app.state.api_state = state

    @app.exception_handler(APIError)
    async def _api_error_handler(_request: Request, exc: APIError):
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_error_payload("VALIDATION_ERROR", "Invalid request.", {"errors": exc.errors()}),
        )

    @app.exception_handler(HTTPException)
    async def _http_handler(_request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict) and "error" in exc.detail:
            payload = exc.detail
        else:
            payload = _error_payload("HTTP_ERROR", str(exc.detail), {})
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(Exception)
    async def _unhandled_handler(_request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                "RUNTIME_ERROR",
                str(exc),
                {"trace": traceback.format_exc()},
            ),
        )

    @app.get("/v1/health", dependencies=[Depends(_require_auth)])
    def health() -> dict[str, Any]:
        return {"ok": True, "version": app.version}

    @app.get("/v1/models", dependencies=[Depends(_require_auth)])
    def list_models(provider: str = Query(..., pattern="^(self|claude|openai)$")) -> dict[str, Any]:
        settings = _settings(state)
        return _list_models_payload(state, provider, settings)

    @app.post("/v1/models/preview", dependencies=[Depends(_require_auth)])
    def preview_models(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        provider = str(payload.get("provider", "")).strip().lower()
        if provider not in {"self", "claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'provider' is invalid.")
        settings = _preview_settings(state, payload.get("settings"))
        return _list_models_payload(state, provider, settings, preview=True)

    @app.get("/v1/settings", dependencies=[Depends(_require_auth)])
    def get_settings() -> dict[str, Any]:
        settings = _settings(state)
        return {"settings": asdict(settings)}

    @app.put("/v1/settings", dependencies=[Depends(_require_auth)])
    def update_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        current = asdict(settings)

        if (
            "feedback_mode" in payload
            and "show_feedback_on_answer" not in payload
            and "auto_advance_enabled" not in payload
        ):
            mode = str(payload.get("feedback_mode", "")).strip()
            payload["show_feedback_on_answer"] = mode != "end_only"
            payload["auto_advance_enabled"] = mode == "auto_advance"
            if "show_feedback_on_completion" not in payload:
                payload["show_feedback_on_completion"] = True

        for key, value in payload.items():
            if key in current:
                current[key] = value

        merged = state.settings_store._coerce_from_mapping(current)
        _save_settings(state, merged)
        normalized = _settings(state)
        return {"settings": asdict(normalized)}

    @app.post("/v1/settings/import-legacy", dependencies=[Depends(_require_auth)])
    def import_legacy_settings(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
        legacy_project_root = payload.get("legacy_project_root")
        explicit_settings = payload.get("legacy_settings_path")
        explicit_history = payload.get("legacy_history_path")
        overwrite_existing = bool(payload.get("overwrite_existing", False))

        if explicit_settings:
            legacy_settings_path = Path(str(explicit_settings)).expanduser().resolve()
        else:
            root = Path(str(legacy_project_root)).expanduser().resolve() if legacy_project_root else state.project_root
            legacy_settings_path = (root / "settings" / "settings.json").resolve()

        if explicit_history:
            legacy_history_path = Path(str(explicit_history)).expanduser().resolve()
        else:
            root = Path(str(legacy_project_root)).expanduser().resolve() if legacy_project_root else state.project_root
            legacy_history_path = (root / "settings" / "performance_history.json").resolve()

        target_settings_path = state.settings_store.path
        imported_settings = False
        imported_history = False

        if legacy_settings_path.exists() and (
            overwrite_existing or not target_settings_path.exists() or target_settings_path.stat().st_size == 0
        ):
            target_settings_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy_settings_path, target_settings_path)
            imported_settings = True

        settings = _settings(state)
        if imported_settings:
            # normalize imported file using current schema coercion
            _save_settings(state, settings)
            settings = _settings(state)

        target_history_path = _resolve_history_path(state, settings)
        if legacy_history_path.exists() and (
            overwrite_existing or not target_history_path.exists() or target_history_path.stat().st_size == 0
        ):
            target_history_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy_history_path, target_history_path)
            imported_history = True

        return {
            "imported_settings": imported_settings,
            "imported_history": imported_history,
            "legacy_settings_path": str(legacy_settings_path),
            "legacy_history_path": str(legacy_history_path),
            "target_settings_path": str(target_settings_path),
            "target_history_path": str(target_history_path),
            "settings": asdict(_settings(state)),
        }

    @app.post("/v1/quizzes/tree", dependencies=[Depends(_require_auth)])
    def quizzes_tree(payload: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
        settings = _settings(state)
        roots_payload = payload.get("quiz_roots")
        if isinstance(roots_payload, list):
            roots_raw = roots_payload
        else:
            roots_raw = [str(_ensure_quizzes_library(state, settings))]
        roots = [Path(str(item)).expanduser().resolve() for item in roots_raw if str(item).strip()]
        if not roots:
            roots = [Path(_ensure_quizzes_library(state, settings))]

        return {"roots": _build_quiz_tree(roots)}

    @app.get("/v1/quizzes/library", dependencies=[Depends(_require_auth)])
    def quizzes_library() -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        current = _settings(state)
        return {
            "quizzes_dir": str(quizzes_dir),
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/import", dependencies=[Depends(_require_auth)])
    def quizzes_library_import(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        paths_raw = payload.get("source_paths")
        if isinstance(paths_raw, str):
            source_values = [paths_raw]
        elif isinstance(paths_raw, list):
            source_values = [str(item) for item in paths_raw]
        else:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'source_paths' must be a string or list.")

        source_paths = [Path(value).expanduser().resolve() for value in source_values if str(value).strip()]
        if not source_paths:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="At least one source path is required.")

        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)

        imported_total = 0
        warnings: list[str] = []
        imported_items: list[dict[str, Any]] = []

        for source_path in source_paths:
            if not source_path.exists():
                warnings.append(f"Source not found: {source_path}")
                continue
            if source_path.is_file():
                imported, item_warnings, item = _import_single_quiz_file(source_path, quizzes_dir)
                imported_total += imported
                warnings.extend(item_warnings)
                if item:
                    imported_items.append(item)
                continue
            if source_path.is_dir():
                imported, item_warnings, item = _import_quiz_folder(source_path, quizzes_dir)
                imported_total += imported
                warnings.extend(item_warnings)
                if item:
                    imported_items.append(item)
                continue

            warnings.append(f"Skipped unsupported source: {source_path}")

        current = _settings(state)
        return {
            "quizzes_dir": str(quizzes_dir),
            "imported_files": imported_total,
            "imports": imported_items,
            "warnings": warnings,
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/rename", dependencies=[Depends(_require_auth)])
    def quizzes_library_rename(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        path_value = str(payload.get("path", "")).strip()
        new_title = str(payload.get("title", "")).strip()
        if not path_value:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'path' is required.")
        if not new_title:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'title' is required.")

        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        quiz_path = Path(path_value).expanduser().resolve()

        if not quiz_path.exists() or not quiz_path.is_file():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Quiz not found: {quiz_path}")
        if not _quiz_file_allowed(quiz_path):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message=f"Unsupported quiz file: {quiz_path}")
        if not _path_within(quiz_path, quizzes_dir):
            raise APIError(
                status_code=403,
                code="FORBIDDEN",
                message="Can only rename quizzes inside the managed Quizzes directory.",
            )

        try:
            raw = json.loads(quiz_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message=f"Invalid JSON in {quiz_path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Quiz JSON must be an object.")

        raw["title"] = new_title
        try:
            quiz_path.write_text(f"{json.dumps(raw, indent=2, ensure_ascii=False)}\n", encoding="utf-8")
        except Exception as exc:
            raise APIError(status_code=500, code="INTERNAL_ERROR", message=f"Failed to update quiz title: {exc}") from exc

        current = _settings(state)
        return {
            "path": str(quiz_path),
            "title": new_title,
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/folder", dependencies=[Depends(_require_auth)])
    def quizzes_library_create_folder(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        folder_name = _quiz_library_folder_name(payload.get("name"))
        parent_path = _quiz_library_path(payload.get("parent_path"), quizzes_dir)

        if not parent_path.exists():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Parent folder not found: {parent_path}")
        if parent_path.is_file():
            parent_path = parent_path.parent
        if not parent_path.is_dir():
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Parent path must be a folder.")

        target_path = (parent_path / folder_name).resolve()
        if not _path_within(target_path, quizzes_dir):
            raise APIError(
                status_code=403,
                code="FORBIDDEN",
                message="Created folders must stay inside the managed Quizzes directory.",
            )
        if target_path.exists():
            raise APIError(status_code=409, code="CONFLICT", message=f"Folder already exists: {target_path}")

        target_path.mkdir(parents=False, exist_ok=False)

        current = _settings(state)
        return {
            "path": str(target_path),
            "kind": "folder",
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/folder/rename", dependencies=[Depends(_require_auth)])
    def quizzes_library_rename_folder(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        source_path = _quiz_library_path(payload.get("path"), quizzes_dir, allow_root=False)
        next_name = _quiz_library_item_name(payload.get("name"))

        if not source_path.exists() or not source_path.is_dir():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Folder not found: {source_path}")

        target_path = (source_path.parent / next_name).resolve()
        if not _path_within(target_path, quizzes_dir):
            raise APIError(
                status_code=403,
                code="FORBIDDEN",
                message="Renamed folders must stay inside the managed Quizzes directory.",
            )
        if target_path == source_path:
            current = _settings(state)
            return {
                "path": str(source_path),
                "kind": "folder",
                "tree": _quiz_structure_tree(quizzes_dir),
                "settings": asdict(current),
            }
        if target_path.exists():
            raise APIError(status_code=409, code="CONFLICT", message=f"Target already exists: {target_path}")

        source_path.rename(target_path)

        current = _settings(state)
        return {
            "source_path": str(source_path),
            "path": str(target_path),
            "kind": "folder",
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/move", dependencies=[Depends(_require_auth)])
    def quizzes_library_move(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        source_path = _quiz_library_path(payload.get("path"), quizzes_dir, allow_root=False)
        destination_parent = _quiz_library_path(payload.get("destination_parent_path"), quizzes_dir)

        if not source_path.exists():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Quiz library item not found: {source_path}")
        if destination_parent.is_file():
            destination_parent = destination_parent.parent
        if not destination_parent.exists() or not destination_parent.is_dir():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Destination folder not found: {destination_parent}")

        if source_path.is_dir() and _path_within(destination_parent, source_path):
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Cannot move a folder into itself or one of its descendants.",
            )

        target_path = (destination_parent / source_path.name).resolve()
        if target_path == source_path:
            current = _settings(state)
            return {
                "source_path": str(source_path),
                "path": str(target_path),
                "kind": "folder" if source_path.is_dir() else "quiz",
                "tree": _quiz_structure_tree(quizzes_dir),
                "settings": asdict(current),
            }
        if target_path.exists():
            raise APIError(status_code=409, code="CONFLICT", message=f"Target already exists: {target_path}")
        if not _path_within(target_path, quizzes_dir):
            raise APIError(
                status_code=403,
                code="FORBIDDEN",
                message="Moved items must stay inside the managed Quizzes directory.",
            )
        if source_path.is_file() and not _quiz_file_allowed(source_path):
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message=f"Unsupported quiz file: {source_path}",
            )

        shutil.move(str(source_path), str(target_path))

        current = _settings(state)
        return {
            "source_path": str(source_path),
            "path": str(target_path),
            "kind": "folder" if target_path.is_dir() else "quiz",
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/library/delete", dependencies=[Depends(_require_auth)])
    def quizzes_library_delete(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)
        target_path = _quiz_library_path(payload.get("path"), quizzes_dir, allow_root=False)

        if not target_path.exists():
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Quiz library item not found: {target_path}")

        if target_path.is_dir():
            shutil.rmtree(target_path)
            deleted_kind = "folder"
        elif target_path.is_file():
            if not _quiz_file_allowed(target_path):
                raise APIError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=f"Unsupported quiz file: {target_path}",
                )
            target_path.unlink()
            deleted_kind = "quiz"
        else:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Unsupported quiz library item.")

        current = _settings(state)
        return {
            "deleted_path": str(target_path),
            "deleted_kind": deleted_kind,
            "tree": _quiz_structure_tree(quizzes_dir),
            "settings": asdict(current),
        }

    @app.post("/v1/quizzes/load", dependencies=[Depends(_require_auth)])
    def load_quiz_endpoint(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        path_value = str(payload.get("path", "")).strip()
        if not path_value:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'path' is required.")

        path = Path(path_value).expanduser().resolve()
        try:
            quiz = load_quiz(path)
        except QuizValidationError as exc:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message=str(exc)) from exc
        except Exception as exc:
            raise APIError(status_code=404, code="NOT_FOUND", message=str(exc)) from exc

        return {
            "path": str(path),
            "quiz": _quiz_payload(quiz),
        }

    @app.post("/v1/grade/mcq", dependencies=[Depends(_require_auth)])
    def grade_mcq(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        question_raw = payload.get("question")
        if not isinstance(question_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'question' must be an object.")

        question = _mcq_question_from_payload(question_raw)
        user_answer = str(payload.get("user_answer", "")).strip()
        result = MCQGrader().grade(question, user_answer)
        return {"result": _grade_payload(result)}

    @app.post("/v1/grade/short", dependencies=[Depends(_require_auth)])
    def grade_short(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        provider = str(payload.get("provider", "")).strip().lower()
        question_raw = payload.get("question")
        user_answer = str(payload.get("user_answer", ""))
        model = str(payload.get("model", "") or "").strip() or None
        extra_context = str(payload.get("extra_context", "") or "").strip() or None
        if not isinstance(question_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'question' must be an object.")
        if provider not in {"self", "claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Provider must be self|claude|openai.")

        question = _short_question_from_payload(question_raw)

        if provider == "self":
            if "self_score" not in payload:
                raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'self_score' is required for no-model scoring.")
            try:
                score = int(payload.get("self_score", 0))
            except Exception as exc:
                raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'self_score' must be an integer.") from exc
            if score < 0 or score > question.points:
                raise APIError(
                    status_code=422,
                    code="VALIDATION_ERROR",
                    message=f"self_score must be between 0 and {question.points}.",
                )
            result = GradeResult(
                correct=(score == question.points),
                points_awarded=score,
                max_points=question.points,
                feedback=f"You recorded a self-score of {score}/{question.points}.",
            )
            return {"result": _grade_payload(result)}

        settings = _settings(state)
        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        result = client.grade_short(question=question, user_answer=user_answer, model=model, extra_context=extra_context)
        return {"result": _grade_payload(result)}

    @app.post("/v1/explain/mcq", dependencies=[Depends(_require_auth)])
    def explain_mcq(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        provider = str(payload.get("provider", "")).strip().lower()
        if provider not in {"claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Explanation provider must be claude|openai.")

        prompt = str(payload.get("prompt", ""))
        options_raw = payload.get("options")
        user_answer = str(payload.get("user_answer", "")).strip()
        correct_answer = str(payload.get("correct_answer", "")).strip()
        model = str(payload.get("model", "") or "").strip() or None
        extra_context = str(payload.get("extra_context", "") or "").strip() or None

        if not isinstance(options_raw, list) or len(options_raw) < 2:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'options' must be a list with 2+ items.")

        settings = _settings(state)
        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        text = client.explain_mcq(
            prompt=prompt,
            options=[str(x) for x in options_raw],
            user_answer=user_answer,
            correct_answer=correct_answer,
            model=model,
            extra_context=extra_context,
        )
        return {"text": text}

    @app.post("/v1/explain/short", dependencies=[Depends(_require_auth)])
    def explain_short(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        provider = str(payload.get("provider", "")).strip().lower()
        if provider not in {"claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Explanation provider must be claude|openai.")

        question_raw = payload.get("question")
        if not isinstance(question_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'question' must be an object.")
        question = _short_question_from_payload(question_raw)

        user_answer = str(payload.get("user_answer", ""))
        model = str(payload.get("model", "") or "").strip() or None
        extra_context = str(payload.get("extra_context", "") or "").strip() or None

        settings = _settings(state)
        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        text = client.explain_short(
            prompt=question.prompt,
            expected_answer=question.expected,
            user_answer=user_answer,
            model=model,
            extra_context=extra_context,
        )
        return {"text": text}

    @app.post("/v1/feedback/chat", dependencies=[Depends(_require_auth)])
    def feedback_chat(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        provider = str(payload.get("provider", "")).strip().lower()
        if provider not in {"claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Feedback chat provider must be claude|openai.")

        model = str(payload.get("model", "") or "").strip() or None
        user_message = str(payload.get("user_message", "")).strip()
        feedback = str(payload.get("feedback", "")).strip()
        extra_context = str(payload.get("extra_context", "") or "").strip() or None
        if not user_message:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'user_message' is required.")

        question_raw = payload.get("question")
        if not isinstance(question_raw, dict):
            question_raw = {}
        question_prompt = str(question_raw.get("prompt", "")).strip()
        question_type = str(question_raw.get("type", "")).strip()
        options_raw = question_raw.get("options")
        options = [str(item) for item in options_raw] if isinstance(options_raw, list) else []

        user_answer = str(payload.get("user_answer", question_raw.get("user_answer", "")))
        expected_answer = str(payload.get("expected_answer", question_raw.get("expected", "")))

        history_raw = payload.get("chat_history")
        history_entries: list[dict[str, str]] = []
        if isinstance(history_raw, list):
            for item in history_raw:
                if not isinstance(item, dict):
                    continue
                role = str(item.get("role", "")).strip().lower()
                text = str(item.get("text", "")).strip()
                if role not in {"assistant", "user"} or not text:
                    continue
                history_entries.append({"role": role, "text": text})

        settings = _settings(state)
        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        text = client.feedback_chat(
            question_prompt=question_prompt,
            question_type=question_type,
            options=options,
            user_answer=user_answer,
            expected_answer=expected_answer,
            feedback=feedback,
            chat_history=history_entries,
            user_message=user_message,
            model=model,
            extra_context=extra_context,
        )
        return {"text": text}

    @app.get("/v1/history", dependencies=[Depends(_require_auth)])
    def get_history(quiz_path: str | None = None) -> dict[str, Any]:
        settings = _settings(state)
        records = load_history(_resolve_history_path(state, settings))
        if quiz_path:
            records = history_for_quiz(records, quiz_path)
        return {"records": [_attempt_payload(record) for record in records]}

    @app.post("/v1/history/append", dependencies=[Depends(_require_auth)])
    def append_history(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        path = _resolve_history_path(state, settings)
        record = _attempt_from_payload(payload)
        append_attempt(path, record)
        return {"ok": True}

    @app.post("/v1/history/update", dependencies=[Depends(_require_auth)])
    def update_history(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        match_raw = payload.get("match")
        record_raw = payload.get("record")
        if not isinstance(match_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'match' must be an object.")
        if not isinstance(record_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'record' must be an object.")

        match_timestamp = str(match_raw.get("timestamp", "")).strip()
        match_quiz_path = str(match_raw.get("quiz_path", "")).strip()
        if not match_timestamp or not match_quiz_path:
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Fields 'match.timestamp' and 'match.quiz_path' are required.",
            )
        match_model_key = str(match_raw.get("model_key", "")).strip()
        match_score = _coerce_int(match_raw.get("score"), "match.score", default=0)
        match_max_score = _coerce_int(match_raw.get("max_score"), "match.max_score", default=0)
        match_duration_seconds = _coerce_float(match_raw.get("duration_seconds"), "match.duration_seconds", default=0.0)

        settings = _settings(state)
        path = _resolve_history_path(state, settings)
        attempts = load_history(path)
        match_index = -1
        for index, attempt in enumerate(attempts):
            if attempt.timestamp != match_timestamp:
                continue
            if attempt.quiz_path != match_quiz_path:
                continue
            if attempt.model_key != match_model_key:
                continue
            if attempt.score != match_score or attempt.max_score != match_max_score:
                continue
            if abs(float(attempt.duration_seconds) - match_duration_seconds) > 1e-9:
                continue
            match_index = index
            break

        if match_index < 0:
            raise APIError(status_code=404, code="NOT_FOUND", message="History attempt to update was not found.")

        updated_record = _attempt_from_payload(record_raw)
        attempts[match_index] = updated_record
        save_history(path, attempts)
        return {"ok": True, "record": _attempt_payload(updated_record)}

    @app.post("/v1/generate/collect-sources", dependencies=[Depends(_require_auth)])
    def generate_collect_sources(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        paths = payload.get("paths")
        include_content = bool(payload.get("include_content"))
        if not isinstance(paths, list) or not paths:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'paths' must be a non-empty list.")

        sources, warnings = collect_sources([str(p) for p in paths])
        response: dict[str, Any] = {
            "sources": [_source_payload(source) for source in sources],
            "warnings": warnings,
        }
        if include_content:
            extracted_materials = extract_all_materials(sources)
            response["extracted_materials"] = [
                {
                    "path": str(material.path),
                    "content": material.content,
                    "extracted_by": material.extracted_by,
                    "needs_ocr": material.needs_ocr,
                    "warnings": list(material.warnings),
                    "errors": list(material.errors),
                }
                for material in extracted_materials
            ]
        return response

    @app.post("/v1/generate/run", dependencies=[Depends(_require_auth)])
    def generate_run(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        quizzes_dir = _ensure_quizzes_library(state, settings)

        provider = str(payload.get("provider", "")).strip().lower()
        model = str(payload.get("model", "") or "").strip()
        sources_raw = payload.get("sources")
        output_subdir_payload = payload.get("output_subdir")

        if provider not in {"claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Generation provider must be claude|openai.")
        if not isinstance(sources_raw, list) or not sources_raw:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'sources' must be a non-empty list.")

        source_files: list[SourceFile] = []
        for item in sources_raw:
            if isinstance(item, str):
                source_files.append(SourceFile(path=Path(item).expanduser().resolve(), source_kind="file"))
            elif isinstance(item, dict):
                path = str(item.get("path", "")).strip()
                if not path:
                    continue
                source_files.append(
                    SourceFile(
                        path=Path(path).expanduser().resolve(),
                        source_kind=str(item.get("source_kind", "file") or "file"),
                    )
                )

        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        request_warnings = [str(x) for x in payload.get("warnings", [])] if isinstance(payload.get("warnings"), list) else []
        request_errors = [str(x) for x in payload.get("errors", [])] if isinstance(payload.get("errors"), list) else []
        try:
            mcq_count = int(payload.get("mcq_count", 15))
            short_count = int(payload.get("short_count", 5))
            mcq_options = int(payload.get("mcq_options", 4))
        except Exception as exc:
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="Generation count fields must be integers.",
            ) from exc
        requested_total_raw = payload.get("total")
        try:
            requested_total = int(requested_total_raw) if requested_total_raw is not None else None
        except Exception:
            requested_total = None
        normalized_total = mcq_count + short_count
        if requested_total is not None and requested_total != normalized_total:
            request_warnings.append(
                "Requested total did not match mcq_count + short_count; using normalized total."
            )
        if provider == "claude":
            try:
                available_models = client.list_models()
            except Exception:
                available_models = []
            available_ids = [str(m.id).strip() for m in available_models if str(m.id).strip()]
            if available_ids:
                available_set = set(available_ids)
                preferred_provider, preferred_model = _preferred_provider_model(settings)
                preferred = (
                    preferred_model
                    if preferred_provider == "claude" and preferred_model in available_set
                    else available_ids[0]
                )
                if not model:
                    model = preferred
                elif model not in available_set:
                    request_warnings.append(
                        f"Requested Claude model '{model}' is unavailable. Falling back to '{preferred}'."
                    )
                    model = preferred
        elif provider == "openai" and not model:
            preferred_provider, preferred_model = _preferred_provider_model(settings)
            if preferred_provider == "openai" and preferred_model:
                model = preferred_model

        if output_subdir_payload is None:
            default_subdir = settings.generation_output_subdir or "Generated"
            try:
                output_subdir = _normalize_generation_output_subdir(default_subdir, quizzes_dir)
            except APIError:
                output_subdir = _normalize_generation_output_subdir("Generated", quizzes_dir)
        else:
            output_subdir = _normalize_generation_output_subdir(output_subdir_payload, quizzes_dir)

        req = GenerationRequest(
            quiz_dir=quizzes_dir,
            sources=source_files,
            provider=provider,
            model=model,
            total=normalized_total,
            mcq_count=mcq_count,
            short_count=short_count,
            mcq_options=mcq_options,
            title_hint=str(payload.get("title_hint", "")),
            instructions_hint=str(payload.get("instructions_hint", "")),
            output_subdir=output_subdir,
            warnings=request_warnings,
            errors=request_errors,
        )

        result = generate_quiz_file(req, client)
        return _generation_result_payload(result)

    @app.post("/v1/oauth/openai/connect", dependencies=[Depends(_require_auth)])
    def oauth_openai_connect() -> dict[str, Any]:
        settings = _settings(state)
        if not (settings.openai_oauth_client_id or "").strip():
            raise APIError(
                status_code=422,
                code="VALIDATION_ERROR",
                message="OpenAI OAuth client ID is required. Add it in Settings, then try signing in again.",
            )
        cfg = OAuthConfig(
            authorize_url=settings.openai_oauth_authorize_url,
            token_url=settings.openai_oauth_token_url,
            client_id=settings.openai_oauth_client_id,
            scopes=tuple(settings.openai_oauth_scopes),
            redirect_port=int(settings.openai_oauth_redirect_port),
        )
        token = OpenAIPKCEAuthenticator(cfg).authorize_in_browser()

        settings.openai_auth_mode = "oauth"
        settings.openai_oauth_access_token = token.access_token
        settings.openai_oauth_refresh_token = token.refresh_token
        settings.openai_oauth_expires_at = token.expires_at
        _save_settings(state, settings)

        return {
            "ok": True,
            "token_type": token.token_type,
            "expires_at": token.expires_at,
            "refresh_token_present": bool(token.refresh_token),
        }

    return app
