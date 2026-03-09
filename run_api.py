#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path

import uvicorn

from quiz_app.api import create_app


def _parse_args() -> argparse.Namespace:
    default_settings_path = (
        Path(os.getenv("MODULAR_QUIZ_SETTINGS_PATH", "~/.modular_quiz/settings/settings.json"))
        .expanduser()
        .as_posix()
    )
    parser = argparse.ArgumentParser(description="Run Modular Quiz local HTTP API.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--token", help="Bearer token for API auth. If omitted, a random token is generated.")
    parser.add_argument(
        "--settings-path",
        default=default_settings_path,
        help=(
            "Path to settings JSON for API context. "
            "Defaults to ~/.modular_quiz/settings/settings.json to avoid mutating tracked repo templates."
        ),
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Project root used for resolving legacy import defaults.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    token = (args.token or "").strip() or secrets.token_urlsafe(32)
    settings_path = Path(args.settings_path).expanduser().resolve()
    project_root = Path(args.project_root).expanduser().resolve()

    app = create_app(settings_path=settings_path, api_token=token, project_root=project_root)

    print(f"API_TOKEN={token}")
    print(f"API_SETTINGS_PATH={settings_path}")
    print(f"API_PROJECT_ROOT={project_root}")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
