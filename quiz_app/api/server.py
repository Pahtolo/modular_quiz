from __future__ import annotations

import json
import shutil
import traceback
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from quiz_app.claude_client import ClaudeClient
from quiz_app.generator.extractors import collect_sources
from quiz_app.generator.service import generate_quiz_file
from quiz_app.generator.types import GenerationRequest, GenerationResult, SourceFile
from quiz_app.graders import GradeResult, MCQGrader
from quiz_app.history import AttemptRecord, QuestionAttemptRecord, append_attempt, history_for_quiz, load_history
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
    return state.settings_store.load()


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


def _provider_client(state: APIState, provider: str, settings: AppSettings):
    key = (provider or "").strip().lower()
    if key == "claude":
        return ClaudeClient(
            api_key=settings.claude_api_key,
            default_model=settings.claude_model_selected or settings.claude_model,
            curated_models=settings.claude_models,
        )
    if key == "openai":
        return OpenAIClient(
            auth=OpenAIAuthState(api_key=settings.openai_api_key),
            default_model=settings.openai_model_selected or "gpt-5-mini",
            token_provider=lambda: _openai_token(state, settings),
        )
    return None


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
                user_answer=str(item.get("user_answer", "")).strip(),
                correct_answer_or_expected=str(item.get("correct_answer_or_expected", "")).strip(),
                points_awarded=int(item.get("points_awarded", 0) or 0),
                max_points=int(item.get("max_points", 0) or 0),
                feedback=str(item.get("feedback", "")).strip(),
            )
        )

    return AttemptRecord(
        timestamp=str(payload.get("timestamp", "")).strip(),
        quiz_path=str(payload.get("quiz_path", "")).strip(),
        quiz_title=str(payload.get("quiz_title", "")).strip(),
        score=int(payload.get("score", 0) or 0),
        max_score=int(payload.get("max_score", 0) or 0),
        percent=float(payload.get("percent", 0.0) or 0.0),
        duration_seconds=float(payload.get("duration_seconds", 0.0) or 0.0),
        model_key=str(payload.get("model_key", "")).strip(),
        questions=questions,
    )


def _quiz_file_allowed(path: Path) -> bool:
    if path.suffix.lower() != ".json":
        return False
    if path.name == "settings.json" and path.parent.name == "settings":
        return False
    return True


def _quiz_nodes_for_directory(root_path: Path) -> list[dict[str, Any]]:
    candidates: list[Path] = []
    try:
        for candidate in root_path.rglob("*.json"):
            if not candidate.is_file() or not _quiz_file_allowed(candidate):
                continue
            try:
                rel_parts = candidate.relative_to(root_path).parts
            except Exception:
                continue
            if any(part.startswith(".") for part in rel_parts):
                continue
            candidates.append(candidate)
    except Exception:
        return []

    candidates.sort(key=lambda p: str(p.relative_to(root_path)).lower())
    return [
        {
            "name": str(path.relative_to(root_path)),
            "path": str(path),
            "kind": "quiz",
            "children": [],
        }
        for path in candidates
    ]


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
                    "name": root_path.name,
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

    return MCQQuestion(
        id=str(payload.get("id", "q")).strip() or "q",
        prompt=str(payload.get("prompt", "")).strip(),
        points=int(payload.get("points", 1) or 1),
        options=[str(opt) for opt in options_raw],
        answer=str(payload.get("answer", "A")).strip().upper()[:1] or "A",
    )


def _short_question_from_payload(payload: dict[str, Any]) -> ShortQuestion:
    return ShortQuestion(
        id=str(payload.get("id", "q")).strip() or "q",
        prompt=str(payload.get("prompt", "")).strip(),
        points=int(payload.get("points", 2) or 2),
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

    app = FastAPI(title="Modular Quiz API", version="0.1.0")
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
        provider_key = provider.strip().lower()

        if provider_key == "self":
            models = [
                ModelOption(
                    id="",
                    label="Self grading",
                    provider="self",
                    capability_tags=(),
                )
            ]
            return {"models": [_model_payload(m) for m in models]}

        client = _provider_client(state, provider_key, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Unsupported provider: {provider_key}")

        if provider_key == "openai":
            warnings: list[str] = []
            try:
                models = client.list_models_with_fallback(cached=settings.openai_models_cache)
            except Exception as exc:
                warnings.append(str(exc))
                models = []

            settings.openai_models_cache = OpenAIClient.serialize_model_cache(models)
            _save_settings(state, settings)
            return {
                "models": [_model_payload(m) for m in models],
                "warnings": warnings,
            }

        models = client.list_models()
        return {"models": [_model_payload(m) for m in models]}

    @app.get("/v1/settings", dependencies=[Depends(_require_auth)])
    def get_settings() -> dict[str, Any]:
        settings = _settings(state)
        return {"settings": asdict(settings)}

    @app.put("/v1/settings", dependencies=[Depends(_require_auth)])
    def update_settings(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)
        current = asdict(settings)

        for key, value in payload.items():
            if key in current:
                current[key] = value

        merged = state.settings_store._coerce_from_mapping(current)
        _save_settings(state, merged)
        return {"settings": asdict(merged)}

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
        roots_raw = payload.get("quiz_roots") if isinstance(payload.get("quiz_roots"), list) else settings.quiz_roots
        roots = [Path(str(item)).expanduser().resolve() for item in roots_raw if str(item).strip()]
        if not roots:
            roots = [Path(settings.quiz_dir).expanduser().resolve()]

        return {"roots": _build_quiz_tree(roots)}

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
        if not isinstance(question_raw, dict):
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'question' must be an object.")
        if provider not in {"self", "claude", "openai"}:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Provider must be self|claude|openai.")

        question = _short_question_from_payload(question_raw)

        if provider == "self":
            if "self_score" not in payload:
                raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'self_score' is required for self grading.")
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
                feedback=f"Recorded self-score: {score}/{question.points}",
            )
            return {"result": _grade_payload(result)}

        settings = _settings(state)
        client = _provider_client(state, provider, settings)
        if client is None:
            raise APIError(status_code=404, code="NOT_FOUND", message=f"Provider '{provider}' unavailable.")

        result = client.grade_short(question=question, user_answer=user_answer, model=model)
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

    @app.post("/v1/generate/collect-sources", dependencies=[Depends(_require_auth)])
    def generate_collect_sources(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        paths = payload.get("paths")
        if not isinstance(paths, list) or not paths:
            raise APIError(status_code=422, code="VALIDATION_ERROR", message="Field 'paths' must be a non-empty list.")

        sources, warnings = collect_sources([str(p) for p in paths])
        return {
            "sources": [_source_payload(source) for source in sources],
            "warnings": warnings,
        }

    @app.post("/v1/generate/run", dependencies=[Depends(_require_auth)])
    def generate_run(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        settings = _settings(state)

        provider = str(payload.get("provider", "")).strip().lower()
        model = str(payload.get("model", "") or "").strip()
        quiz_dir_raw = str(payload.get("quiz_dir", settings.quiz_dir)).strip() or settings.quiz_dir
        sources_raw = payload.get("sources")

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

        req = GenerationRequest(
            quiz_dir=Path(quiz_dir_raw).expanduser().resolve(),
            sources=source_files,
            provider=provider,
            model=model,
            total=int(payload.get("total", 20) or 20),
            mcq_count=int(payload.get("mcq_count", 15) or 15),
            short_count=int(payload.get("short_count", 5) or 5),
            mcq_options=int(payload.get("mcq_options", 4) or 4),
            title_hint=str(payload.get("title_hint", "")),
            instructions_hint=str(payload.get("instructions_hint", "")),
            output_subdir=str(payload.get("output_subdir", settings.generation_output_subdir or "Generated")),
            warnings=[str(x) for x in payload.get("warnings", [])] if isinstance(payload.get("warnings"), list) else [],
            errors=[str(x) for x in payload.get("errors", [])] if isinstance(payload.get("errors"), list) else [],
        )

        result = generate_quiz_file(req, client)
        return _generation_result_payload(result)

    @app.post("/v1/oauth/openai/connect", dependencies=[Depends(_require_auth)])
    def oauth_openai_connect() -> dict[str, Any]:
        settings = _settings(state)
        cfg = OAuthConfig(
            authorize_url=settings.openai_oauth_authorize_url,
            token_url=settings.openai_oauth_token_url,
            client_id=settings.openai_oauth_client_id,
            scopes=tuple(settings.openai_oauth_scopes),
            redirect_port=int(settings.openai_oauth_redirect_port),
        )
        token = OpenAIPKCEAuthenticator(cfg).authorize_in_browser()

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
