from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from tempfile import mkstemp
from typing import Any, Mapping


DEFAULT_SETTINGS_PATH = Path("settings") / "settings.json"
FILE_MODE_PRIVATE = 0o600
DEFAULT_CLAUDE_MODELS = [
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
]
DEPRECATED_CLAUDE_MODELS = {
    "claude-3-7-sonnet-latest",
}
DEFAULT_OPENAI_SCOPES = ["model.read", "response.write"]
DEFAULT_OPENAI_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
DEFAULT_OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token"
DEFAULT_GENERATION_DEFAULTS = {
    "total": 20,
    "mcq_count": 15,
    "short_count": 5,
    "mcq_options": 4,
}
ALLOWED_SHORT_GRADERS = {"self", "claude", "openai"}
ALLOWED_FEEDBACK_MODES = {"show_then_next", "auto_advance", "end_only"}
ALLOWED_OPENAI_AUTH_MODES = {"api_key", "oauth"}
ALLOWED_MODEL_ALIAS_MODES = {"friendly_plus_id", "friendly_only", "id_only"}
ALLOWED_QUIZ_CLOCK_MODES = {"stopwatch", "timer"}


@dataclass
class AppSettings:
    quiz_dir: str = "."
    quiz_roots: list[str] = field(default_factory=lambda: ["."])
    preferred_model_key: str = "claude:claude-3-5-haiku-latest"
    performance_history_path: str = "settings/performance_history.json"
    short_grader: str = "claude"
    feedback_mode: str = "show_then_next"
    show_feedback_on_answer: bool = True
    show_feedback_on_completion: bool = True
    auto_inject_context: bool = False
    auto_advance_enabled: bool = False
    auto_advance_ms: int = 600
    quiz_clock_mode: str = "stopwatch"
    quiz_timer_duration_seconds: int = 900
    question_timer_seconds: int = 0
    lock_questions_by_progression: bool = True

    claude_api_key: str = ""
    claude_model: str = "claude-3-5-haiku-latest"
    claude_model_selected: str = "claude-3-5-haiku-latest"
    claude_models: list[str] = field(default_factory=lambda: list(DEFAULT_CLAUDE_MODELS))

    openai_auth_mode: str = "api_key"
    openai_api_key: str = ""
    openai_oauth_authorize_url: str = DEFAULT_OPENAI_OAUTH_AUTHORIZE_URL
    openai_oauth_token_url: str = DEFAULT_OPENAI_OAUTH_TOKEN_URL
    openai_oauth_client_id: str = ""
    openai_oauth_scopes: list[str] = field(default_factory=lambda: list(DEFAULT_OPENAI_SCOPES))
    openai_oauth_redirect_port: int = 8765
    openai_oauth_access_token: str = ""
    openai_oauth_refresh_token: str = ""
    openai_oauth_expires_at: float = 0.0
    openai_model_selected: str = "gpt-5-mini"
    openai_models_cache: list[dict[str, str]] = field(default_factory=list)

    model_alias_mode: str = "friendly_plus_id"
    mcq_explanations_enabled: bool = True

    generation_defaults: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_GENERATION_DEFAULTS))
    generation_output_subdir: str = "Generated"


class SettingsStore:
    def __init__(self, path: Path | str | None = None):
        resolved = Path(path) if isinstance(path, str) else (path or DEFAULT_SETTINGS_PATH)
        self.path = resolved.expanduser().resolve()
        self._ensure_parent_dir()

    def load(self) -> AppSettings:
        self._ensure_parent_dir()

        parsed: Mapping[str, Any] | None = None
        had_parse_error = False
        if not self.path.exists():
            settings = AppSettings()
            self._attempt_persist(settings)
            return settings

        try:
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                parsed = loaded
            else:
                had_parse_error = True
        except Exception:
            had_parse_error = True

        settings = self._coerce_from_mapping(parsed)

        if had_parse_error or parsed is None or self._needs_rewrite(parsed, settings):
            self._attempt_persist(settings)

        return settings

    def _coerce_from_mapping(self, raw: Mapping[str, Any] | None) -> AppSettings:
        data = raw if isinstance(raw, Mapping) else {}
        defaults = AppSettings()

        quiz_dir = self._coerce_str(data.get("quiz_dir"), defaults.quiz_dir)
        quiz_roots = self._coerce_str_list(data.get("quiz_roots"), fallback=[quiz_dir], split_commas=False)
        quiz_roots = [root for root in dict.fromkeys(quiz_roots) if root]
        if not quiz_roots:
            quiz_roots = [quiz_dir]

        claude_model = self._coerce_str(data.get("claude_model"), defaults.claude_model)
        if claude_model in DEPRECATED_CLAUDE_MODELS:
            claude_model = defaults.claude_model
        claude_models = self._coerce_str_list(data.get("claude_models"), fallback=defaults.claude_models, split_commas=True)
        claude_models = [
            model_id
            for model_id in dict.fromkeys(claude_models)
            if model_id and model_id not in DEPRECATED_CLAUDE_MODELS
        ]
        if not claude_models:
            claude_models = [claude_model]
        claude_model_selected = self._coerce_str(
            data.get("claude_model_selected"),
            self._coerce_str(data.get("claude_model"), defaults.claude_model),
        )
        if claude_model_selected in DEPRECATED_CLAUDE_MODELS:
            claude_model_selected = ""
        if not claude_model_selected or claude_model_selected not in claude_models:
            claude_model_selected = claude_models[0]

        openai_model_selected = self._coerce_str(data.get("openai_model_selected"), defaults.openai_model_selected)
        openai_scopes = self._coerce_str_list(
            data.get("openai_oauth_scopes"),
            fallback=defaults.openai_oauth_scopes,
            split_commas=True,
        )

        generation_defaults = self._coerce_generation_defaults(data.get("generation_defaults"))

        expires_at = self._coerce_float(data.get("openai_oauth_expires_at"), 0.0)
        if expires_at < 0:
            expires_at = 0.0

        short_grader = self._coerce_choice(data.get("short_grader"), ALLOWED_SHORT_GRADERS, defaults.short_grader)
        preferred_model_key = self._coerce_str(data.get("preferred_model_key"), "")
        provider_from_key, model_from_key = self._parse_model_key(preferred_model_key)
        if provider_from_key == "claude" and model_from_key in DEPRECATED_CLAUDE_MODELS:
            preferred_model_key = ""
        if not self._is_valid_model_key(preferred_model_key):
            if short_grader == "openai":
                preferred_model_key = f"openai:{openai_model_selected}"
            elif short_grader == "self":
                preferred_model_key = "self:"
            else:
                preferred_model_key = f"claude:{claude_model_selected or claude_model}"
        provider_from_key, _ = self._parse_model_key(preferred_model_key)
        if provider_from_key in ALLOWED_SHORT_GRADERS:
            short_grader = provider_from_key
        history_path = self._coerce_str(
            data.get("performance_history_path"),
            defaults.performance_history_path,
        )
        feedback_mode = self._coerce_choice(data.get("feedback_mode"), ALLOWED_FEEDBACK_MODES, defaults.feedback_mode)
        show_feedback_on_answer = self._coerce_bool(
            data.get("show_feedback_on_answer"),
            feedback_mode != "end_only",
        )
        show_feedback_on_completion = self._coerce_bool(
            data.get("show_feedback_on_completion"),
            True,
        )
        auto_advance_enabled = self._coerce_bool(
            data.get("auto_advance_enabled"),
            feedback_mode == "auto_advance",
        )
        feedback_mode = self._feedback_mode_from_flags(show_feedback_on_answer, auto_advance_enabled)

        return AppSettings(
            quiz_dir=quiz_dir,
            quiz_roots=quiz_roots,
            preferred_model_key=preferred_model_key,
            performance_history_path=history_path,
            short_grader=short_grader,
            feedback_mode=feedback_mode,
            show_feedback_on_answer=show_feedback_on_answer,
            show_feedback_on_completion=show_feedback_on_completion,
            auto_inject_context=self._coerce_bool(
                data.get("auto_inject_context"),
                defaults.auto_inject_context,
            ),
            auto_advance_enabled=auto_advance_enabled,
            auto_advance_ms=self._coerce_int(data.get("auto_advance_ms"), defaults.auto_advance_ms, minimum=0),
            quiz_clock_mode=self._coerce_choice(
                data.get("quiz_clock_mode"),
                ALLOWED_QUIZ_CLOCK_MODES,
                defaults.quiz_clock_mode,
            ),
            quiz_timer_duration_seconds=self._coerce_int(
                data.get("quiz_timer_duration_seconds"),
                defaults.quiz_timer_duration_seconds,
                minimum=1,
            ),
            question_timer_seconds=self._coerce_int(
                data.get("question_timer_seconds"),
                defaults.question_timer_seconds,
                minimum=0,
            ),
            lock_questions_by_progression=self._coerce_bool(
                data.get("lock_questions_by_progression"),
                defaults.lock_questions_by_progression,
            ),
            claude_api_key=self._coerce_str(data.get("claude_api_key"), defaults.claude_api_key),
            claude_model=claude_model,
            claude_model_selected=claude_model_selected,
            claude_models=claude_models,
            openai_auth_mode=self._coerce_choice(
                data.get("openai_auth_mode"),
                ALLOWED_OPENAI_AUTH_MODES,
                defaults.openai_auth_mode,
            ),
            openai_api_key=self._coerce_str(data.get("openai_api_key"), defaults.openai_api_key),
            openai_oauth_authorize_url=self._coerce_str(
                data.get("openai_oauth_authorize_url"),
                defaults.openai_oauth_authorize_url,
            ),
            openai_oauth_token_url=self._coerce_str(
                data.get("openai_oauth_token_url"),
                defaults.openai_oauth_token_url,
            ),
            openai_oauth_client_id=self._coerce_str(
                data.get("openai_oauth_client_id"),
                defaults.openai_oauth_client_id,
            ),
            openai_oauth_scopes=openai_scopes,
            openai_oauth_redirect_port=self._coerce_int(
                data.get("openai_oauth_redirect_port"),
                defaults.openai_oauth_redirect_port,
                minimum=1024,
                maximum=65535,
            ),
            openai_oauth_access_token=self._coerce_str(
                data.get("openai_oauth_access_token"),
                defaults.openai_oauth_access_token,
            ),
            openai_oauth_refresh_token=self._coerce_str(
                data.get("openai_oauth_refresh_token"),
                defaults.openai_oauth_refresh_token,
            ),
            openai_oauth_expires_at=expires_at,
            openai_model_selected=openai_model_selected,
            openai_models_cache=self._coerce_models_cache(data.get("openai_models_cache")),
            model_alias_mode=self._coerce_choice(
                data.get("model_alias_mode"),
                ALLOWED_MODEL_ALIAS_MODES,
                defaults.model_alias_mode,
            ),
            mcq_explanations_enabled=self._coerce_bool(
                data.get("mcq_explanations_enabled"),
                defaults.mcq_explanations_enabled,
            ),
            generation_defaults=generation_defaults,
            generation_output_subdir=self._coerce_str(
                data.get("generation_output_subdir"),
                defaults.generation_output_subdir,
            ),
        )

    def _feedback_mode_from_flags(self, show_feedback_on_answer: bool, auto_advance_enabled: bool) -> str:
        if not show_feedback_on_answer:
            return "end_only"
        if auto_advance_enabled:
            return "auto_advance"
        return "show_then_next"

    def save(self, settings: AppSettings) -> None:
        self._ensure_parent_dir()
        normalized = self._coerce_from_mapping(self.to_dict(settings))
        self._copy_into(target=settings, source=normalized)
        payload = self.to_dict(normalized)
        self._write_atomic(payload)

    def to_dict(self, settings: AppSettings) -> dict[str, Any]:
        return asdict(settings)

    def _ensure_parent_dir(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _attempt_persist(self, settings: AppSettings) -> None:
        try:
            self.save(settings)
        except Exception:
            # Best effort during recovery: return sanitized settings even if persistence fails.
            pass

    def _needs_rewrite(self, raw: Mapping[str, Any], settings: AppSettings) -> bool:
        expected_keys = {f.name for f in fields(AppSettings)}
        raw_keys = set(raw.keys())
        if raw_keys != expected_keys:
            return True
        payload = self.to_dict(settings)
        for key, value in payload.items():
            if raw.get(key) != value:
                return True
        return False

    def _write_atomic(self, payload: Mapping[str, Any]) -> None:
        self._ensure_parent_dir()
        fd, temp_name = mkstemp(prefix=".settings.", suffix=".json.tmp", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as tmp:
                json.dump(payload, tmp, indent=2)
                tmp.write("\n")
                tmp.flush()
                try:
                    os.fsync(tmp.fileno())
                except Exception:
                    pass
            self._chmod_private(Path(temp_name))
            os.replace(temp_name, self.path)
            self._chmod_private(self.path)
        except Exception:
            try:
                Path(temp_name).unlink(missing_ok=True)
            except Exception:
                pass
            raise

    def _chmod_private(self, path: Path) -> None:
        try:
            os.chmod(path, FILE_MODE_PRIVATE)
        except Exception:
            pass

    def _copy_into(self, target: AppSettings, source: AppSettings) -> None:
        for f in fields(AppSettings):
            setattr(target, f.name, getattr(source, f.name))

    def _coerce_str(self, value: Any, default: str) -> str:
        if value is None:
            return default
        try:
            result = str(value).strip()
        except Exception:
            return default
        return result or default

    def _coerce_choice(self, value: Any, allowed: set[str], default: str) -> str:
        choice = self._coerce_str(value, default)
        if choice in allowed:
            return choice
        return default

    def _coerce_int(
        self,
        value: Any,
        default: int,
        minimum: int | None = None,
        maximum: int | None = None,
    ) -> int:
        try:
            result = int(value)
        except Exception:
            result = default
        if minimum is not None and result < minimum:
            return default
        if maximum is not None and result > maximum:
            return default
        return result

    def _coerce_float(self, value: Any, default: float) -> float:
        try:
            result = float(value)
        except Exception:
            return default
        if not math.isfinite(result):
            return default
        return result

    def _coerce_bool(self, value: Any, default: bool) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
            return default
        if isinstance(value, (int, float)):
            return bool(value)
        return default

    def _coerce_str_list(self, value: Any, fallback: list[str], split_commas: bool = False) -> list[str]:
        items: list[str] = []
        if isinstance(value, str) and split_commas:
            candidates = [part.strip() for part in value.split(",")]
        elif isinstance(value, list):
            candidates = value
        else:
            candidates = fallback

        for item in candidates:
            text = self._coerce_str(item, "")
            if text:
                items.append(text)

        if items:
            return items
        return list(fallback)

    def _coerce_models_cache(self, value: Any) -> list[dict[str, str]]:
        if not isinstance(value, list):
            return []

        out: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in value:
            model_id = ""
            label = ""
            if isinstance(item, str):
                model_id = item.strip()
                label = model_id
            elif isinstance(item, Mapping):
                model_id = self._coerce_str(item.get("id"), "")
                label = self._coerce_str(item.get("label"), model_id)

            if not model_id or model_id in seen:
                continue
            seen.add(model_id)
            out.append({"id": model_id, "label": label or model_id})
        return out

    def _coerce_generation_defaults(self, value: Any) -> dict[str, int]:
        raw = value if isinstance(value, Mapping) else {}
        total = self._coerce_int(raw.get("total"), DEFAULT_GENERATION_DEFAULTS["total"], minimum=1)
        mcq_count = self._coerce_int(raw.get("mcq_count"), DEFAULT_GENERATION_DEFAULTS["mcq_count"], minimum=0)
        short_count = self._coerce_int(raw.get("short_count"), DEFAULT_GENERATION_DEFAULTS["short_count"], minimum=0)
        mcq_options = self._coerce_int(
            raw.get("mcq_options"),
            DEFAULT_GENERATION_DEFAULTS["mcq_options"],
            minimum=2,
            maximum=8,
        )
        return {
            "total": total,
            "mcq_count": mcq_count,
            "short_count": short_count,
            "mcq_options": mcq_options,
        }

    def _parse_model_key(self, value: str) -> tuple[str, str]:
        if ":" not in value:
            return "", ""
        provider, model = value.split(":", 1)
        return provider.strip(), model.strip()

    def _is_valid_model_key(self, value: str) -> bool:
        provider, model = self._parse_model_key(value)
        if provider not in ALLOWED_SHORT_GRADERS:
            return False
        if provider == "self":
            return True
        return bool(model)
