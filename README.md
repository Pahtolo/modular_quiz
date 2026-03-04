# Modular Quiz

Electron + React desktop app with a Python backend for quiz taking, grading, and quiz generation.

## Current Runtime Targets
- `electron/`: primary desktop UI (default)
- `run_api.py`: local FastAPI backend entrypoint
- `run.py`: optional terminal quiz runner

PySide6 GUI has been removed.

## Quick Start (Electron)
1. Install backend dependencies:
```bash
python3 -m pip install -r requirements-api.txt
```
2. Install frontend dependencies:
```bash
cd electron
npm install
```
3. Run in development:
```bash
cd electron
npm run dev
```

## Backend API (manual)
Run the backend standalone:
```bash
python3 run_api.py --host 127.0.0.1 --port 8766 --token dev-token
```

## Build and Package (Electron)
Build renderer:
```bash
cd electron
npm run build:renderer
```

Build bundled Python sidecar:
```bash
cd electron
npm run build:sidecar
```

Create macOS package artifact:
```bash
cd electron
npm run dist
```

## Features
- Quiz browser from configured `quiz_roots`
- MCQ + short-answer grading (self, Claude, OpenAI)
- Quiz generation from source material (`.txt`, `.md`, `.docx`, `.pptx`, `.pdf`)
- PDF low-text detection with OCR handoff marker (`needs_ocr`)
- Performance history and attempt drill-down
- Settings persistence and legacy import

## Tests
Run all tests:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```
