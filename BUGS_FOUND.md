# Bugs Found (Automation Scan)

Date: 2026-03-08 03:01 EDT
Scope: Full app bug scan with automated checks and targeted UI/edge-case validation

Checks run:
- `pytest -q` -> `72 passed, 2 subtests passed`
- `cd electron && npm run build` -> success
- Static keyboard-handler review in [`electron/src/App.jsx`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/electron/src/App.jsx)
- FastAPI `TestClient` malformed-payload probe against `/v1/explain/mcq` with stubbed provider client

## Findings Summary

- 2 active bugs found.
- 1 frontend keyboard edge-case bug.
- 1 API validation bug in the MCQ explanation endpoint.

## Active Bugs

### 1) Pressing Enter on 5+ option MCQs can submit an invalid answer token
- Severity: Medium
- Area: Quiz keyboard input
- Evidence:
  - [`electron/src/App.jsx:2513`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/electron/src/App.jsx:2513) uppercases any key into `upperKey`.
  - [`electron/src/App.jsx:2515`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/electron/src/App.jsx:2515) maps `upperKey.charCodeAt(0) - 65` to an MCQ index.
  - [`electron/src/App.jsx:2519`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/electron/src/App.jsx:2519) submits `upperKey` directly via `submitMcqAnswer(upperKey)`.
  - `event.key === "Enter"` becomes `"ENTER"`; index math treats leading `E` as option `E` when 5+ options exist.
- Why this is a bug:
  - Enter should navigate, not submit a letter answer.
  - Non-single-letter tokens can enter grading/explanation paths.
- Repro:
  1. Open an unlocked MCQ with at least 5 options.
  2. Press Enter.
  3. Observe answer submission behavior tied to `"ENTER"`/`E`.

### 2) `/v1/explain/mcq` accepts malformed option and answer payloads
- Severity: Medium
- Area: API validation consistency
- Evidence:
  - [`quiz_app/api/server.py:1275`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:1275) validates only that `options` is a list with 2+ items.
  - [`quiz_app/api/server.py:1285`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:1285) coerces options using `str(x)` instead of strict validation.
  - Confirmed in this run (stubbed provider) that malformed payloads return `200`:
    - `options: ["   ", "B"]`
    - `options: [1, {"x": 2}]`
    - `correct_answer: "AB"` with two options
- Why this is a bug:
  - Validation parity with `/v1/grade/mcq` is broken.
  - Silent coercion can mask client defects and produce unreliable explanations.
- Repro:
  1. Send malformed payloads above to `POST /v1/explain/mcq`.
  2. Endpoint returns `200` instead of `422`.

## Plan: UI Testing + Edge-Case Search

1. UI testing plan
- Validate keyboard behavior on locked and unlocked MCQs using `Enter`, letters `A-Z`, arrows, and space pause toggle.
- Test 2/4/5/6-option MCQs and verify only single-letter valid options trigger submission.
- Confirm Enter only advances navigation logic and never maps to an option letter.

2. Edge-case search plan
- Probe `/v1/explain/mcq` with malformed inputs: blank/whitespace options, non-string options, multi-character answers, empty answers, and out-of-range answers.
- Diff validation behavior against `/v1/grade/mcq` and document any mismatch as a bug candidate.
- Add at least one coercion-trap case per field (numeric, object, null-like strings).

3. Regression test plan
- Frontend regression: keyboard test for MCQ flow ensuring Enter/non-letter keys do not submit answers.
- API regression: `/v1/explain/mcq` tests asserting malformed `options`, `user_answer`, and `correct_answer` return `422`.

## Fix Notes For Next Prompt (Self Instructions)

1. In [`electron/src/App.jsx`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/electron/src/App.jsx), gate MCQ hotkeys to exact single-character `A-Z` before index mapping/submission.
2. In [`quiz_app/api/server.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py), implement strict `/v1/explain/mcq` input validation matching `/v1/grade/mcq`.
3. Add tests for:
- Enter/non-letter keyboard regression in the frontend.
- Malformed explain payloads returning `422` in API tests.
