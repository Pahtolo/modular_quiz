# Modular Quiz

Desktop quiz app (Electron + React + Python/FastAPI) for generating quizzes, taking timed attempts, grading responses, and reviewing performance history.

Repository note: `settings/settings.json` is a sanitized template for source control only. Real runtime settings and API keys belong in app userData and should never be committed.

## What It Does (Current)
- Loads quizzes from a managed library and nested folders.
- Supports MCQ + short-answer questions with:
  - no-model (record ungraded),
  - Claude grading/explanations,
  - OpenAI grading/explanations.
- Provides `Explain` for both MCQ and short answers.
- Supports follow-up feedback chat with markdown + KaTeX rendering.
- Supports quiz clock modes: `stopwatch`, `timer`, and `off`.
- Tracks per-attempt history with drill-down, sort controls, and retrospective grading for ungraded answers.
- Generates quizzes from source material (`.txt`, `.md`, `.pdf`, `.docx`, `.pptx`) with OCR fallback for low-text PDFs.

## Runtime Targets
- `electron/`: primary desktop UI.
- `run_api.py`: local FastAPI backend entrypoint.
- `run_mcp.py`: MCP bridge server for ChatGPT Apps / MCP clients.
- `run.py`: optional terminal quiz runner.

## Quick Start (Electron App)
1. Install backend dependencies:
```bash
python3 -m pip install -r requirements-api.txt
```
2. Install frontend dependencies:
```bash
cd electron
npm install
```
3. Start dev app:
```bash
cd electron
npm run dev
```

## Run Backend API Manually
```bash
python3 run_api.py --host 127.0.0.1 --port 8766 --token dev-token
```

If `--token` is omitted, a random token is generated and printed to stdout as `API_TOKEN=...`.

## MCP Bridge (ChatGPT Apps / MCP Clients)
Start MCP bridge that proxies backend API routes:
```bash
python3 run_mcp.py --api-base-url http://127.0.0.1:8766 --api-token dev-token
```

Default streamable HTTP endpoint:
```text
http://127.0.0.1:8768/mcp
```

Typical local flow:
1. Start `run_api.py` and capture the API token.
2. Start `run_mcp.py` with the same token.
3. Tunnel `http://127.0.0.1:8768/mcp` over HTTPS for remote clients.
4. Use the HTTPS URL in ChatGPT connector settings.

## Build and Packaging
Build renderer:
```bash
cd electron
npm run build:renderer
```

Build bundled Python sidecar + OCR runtime staging:
```bash
cd electron
npm run build:sidecar
```

Prereqs for sidecar OCR staging:
- macOS: `brew install tesseract poppler`
- Windows: `choco install tesseract poppler`

Create artifacts:
```bash
cd electron
npm run dist -- --mac dmg
npm run dist -- --win nsis
```

## Test Commands
Run all backend tests:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```

Or with pytest:
```bash
pytest -q
```

## CI Workflows
- `macOS Package`: unsigned arm64 DMG artifacts on `v*` tags and manual dispatch.
- `Windows Package`: unsigned NSIS artifacts on `v*` tags and manual dispatch.
- `Secret Scan`: full-history gitleaks scan on `v*` tags and manual dispatch.

## Release Checklist (Open Source)
1. Run tests and hygiene checks:
```bash
python3 -m unittest tests.test_repo_hygiene
python3 -m unittest discover -s tests -p "test_*.py"
```
2. Run full-history local gitleaks:
```bash
docker run --rm -v "$(pwd):/repo" ghcr.io/gitleaks/gitleaks:latest \
  detect --source /repo --redact --report-format json --report-path /repo/gitleaks-report.json
```
3. Rotate and remediate if any secret is found.
4. Build/verify macOS and Windows artifacts.
5. Tag and push:
```bash
git tag v0.1.0
git push origin v0.1.0
```
