from __future__ import annotations

import json
import re
import unittest
from dataclasses import asdict
from pathlib import Path
from typing import Any

from quiz_app.settings_store import AppSettings


REPO_ROOT = Path(__file__).resolve().parents[1]
TRACKED_SETTINGS_PATH = REPO_ROOT / "settings" / "settings.json"
TRACKED_HISTORY_PATH = REPO_ROOT / "settings" / "performance_history.json"
SIDECAR_BUILD_SCRIPT = REPO_ROOT / "electron" / "scripts" / "build_sidecar.cjs"
SIDECAR_BUILD_SHELL_SCRIPT = REPO_ROOT / "electron" / "scripts" / "build_sidecar.sh"
SECRET_FIELDS = {
    "claude_api_key",
    "openai_api_key",
    "openai_oauth_client_id",
    "openai_oauth_access_token",
    "openai_oauth_refresh_token",
}
HOME_PATH_PATTERNS = (
    re.compile(r"^/Users/[^/]+"),
    re.compile(r"^/home/[^/]+"),
    re.compile(r"^[A-Za-z]:\\Users\\[^\\]+"),
    re.compile(r"^~(?:/|\\)"),
)


def _walk_strings(value: Any, location: str = "root") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            found.extend(_walk_strings(nested, f"{location}.{key}"))
        return found
    if isinstance(value, list):
        for index, nested in enumerate(value):
            found.extend(_walk_strings(nested, f"{location}[{index}]"))
        return found
    if isinstance(value, str):
        found.append((location, value))
    return found


class RepoHygieneTests(unittest.TestCase):
    def test_tracked_settings_matches_defaults(self) -> None:
        payload = json.loads(TRACKED_SETTINGS_PATH.read_text(encoding="utf-8"))
        self.assertEqual(payload, asdict(AppSettings()))

    def test_tracked_settings_has_no_checked_in_credentials(self) -> None:
        payload = json.loads(TRACKED_SETTINGS_PATH.read_text(encoding="utf-8"))
        for field in SECRET_FIELDS:
            value = str(payload.get(field, "") or "").strip()
            self.assertEqual(value, "", f"{field} must be empty in tracked settings.")

    def test_tracked_settings_has_no_user_specific_home_paths(self) -> None:
        payload = json.loads(TRACKED_SETTINGS_PATH.read_text(encoding="utf-8"))
        violations: list[str] = []
        for location, value in _walk_strings(payload):
            normalized = value.strip()
            if any(pattern.match(normalized) for pattern in HOME_PATH_PATTERNS):
                violations.append(f"{location}={normalized}")
        self.assertFalse(violations, "Found user-specific absolute paths:\n" + "\n".join(violations))

    def test_tracked_performance_history_is_empty_template(self) -> None:
        payload = json.loads(TRACKED_HISTORY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(payload, [])

    def test_sidecar_build_scripts_bundle_template_quiz_json(self) -> None:
        cjs_text = SIDECAR_BUILD_SCRIPT.read_text(encoding="utf-8")
        sh_text = SIDECAR_BUILD_SHELL_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("template_quiz.json", cjs_text)
        self.assertIn("--add-data", cjs_text)
        self.assertIn("template_quiz.json", sh_text)
        self.assertIn("--add-data", sh_text)


if __name__ == "__main__":
    unittest.main()
