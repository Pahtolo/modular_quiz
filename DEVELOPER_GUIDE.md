# Developer Guide: Modular Quiz

## Runtime Architecture
- Renderer: Electron + React (`electron/src`)
- Main process: Electron bridge/process manager (`electron/main.cjs`, `electron/preload.cjs`)
- Backend: FastAPI over localhost (`quiz_app/api/server.py`, `run_api.py`)
- Core logic: Python modules in `quiz_app/*`

PySide6 desktop GUI has been removed.

## Entry Points
- `run_api.py`: start backend directly
- `electron` scripts:
  - `npm run dev`
  - `npm run build:renderer`
  - `npm run build:sidecar`
  - `npm run dist`
- `run.py`: optional terminal runner for manual CLI workflows

## Core Modules
- `quiz_app/models.py`: quiz/question dataclasses
- `quiz_app/loader.py`: quiz JSON validation and loading
- `quiz_app/discovery.py`: quiz file discovery
- `quiz_app/graders.py`: MCQ + short-answer grading primitives
- `quiz_app/providers.py`: provider model contracts
- `quiz_app/claude_client.py`: Claude integration
- `quiz_app/openai_client.py`: OpenAI integration
- `quiz_app/openai_auth.py`: OpenAI OAuth PKCE helpers
- `quiz_app/history.py`: attempt history persistence
- `quiz_app/settings_store.py`: settings schema + normalization + persistence

## Generation Pipeline
- `quiz_app/generator/extractors.py`: source collection + extraction
- `quiz_app/generator/ocr.py`: OCR helpers (`pdftoppm`, `tesseract`)
- `quiz_app/generator/service.py`: orchestration and output writing
- `quiz_app/generator/types.py`: request/result dataclasses

## API Surface
Implemented in `quiz_app/api/server.py` under `/v1/*`, including:
- health/models/settings
- quiz tree/load
- grading/explanations
- history read/append
- source collection + generation run
- OpenAI OAuth connect trigger

All `/v1/*` routes require bearer token auth.

## Settings
Default file path: `settings/settings.json` (or Electron userData location in packaged mode).

Important fields include:
- `quiz_roots`
- `preferred_model_key`
- provider auth/model fields
- generation defaults/output
- `performance_history_path`

## Testing
Run full suite:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

Run API tests only:
```bash
python3 -m unittest tests.test_api_server -v
```

## PR Review Loop Helper
- `python3 scripts/pr_review_helper.py status --json` inspects the open PR for the current branch and lists unresolved review threads.
- `python3 scripts/pr_review_helper.py rereview` posts a rereview comment on the current branch PR after fixes are pushed.
- The helper expects `gh` to be installed and authenticated for the current shell session.
