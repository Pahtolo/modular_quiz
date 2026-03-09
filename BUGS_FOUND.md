# Bugs Found (Automation Scan)

Date: 2026-03-08 21:12 EDT
Scope: App bug scan focused on API validation/runtime edge cases and repository hygiene regressions, updated after fixing short-answer points validation

## Checks Run

- `pytest -q tests/test_api_server.py -k 'short and (points or explain_short or grading_endpoints)'` -> `5 passed, 32 deselected, 4 subtests passed`
- `pytest -q` -> `78 passed, 6 subtests passed`
- Static edge-case sweep of numeric parsing in `quiz_app/api/server.py`
- Repo hygiene artifact inspection of tracked files: `settings/settings.json` and `settings/performance_history.json`

## Resolved In This Pass

- `/v1/grade/short` and `/v1/explain/short` now reject non-integer short-question points with `422 VALIDATION_ERROR` instead of crashing with `500`.
- Short-answer `question.points` values of `0` or negative numbers now return `422 VALIDATION_ERROR` instead of being silently coerced to `2`.

## Active Bugs

### 1) `/v1/history/update` can crash with 500 on non-numeric `match` fields

- Severity: High
- Files: [`quiz_app/api/server.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:1411)
- Repro:
1. POST `/v1/history/update` with `match.score: "abc"` (or invalid `max_score` / `duration_seconds`).
2. Observe 500 `RUNTIME_ERROR`.
- Expected:
  - Return 422 `VALIDATION_ERROR` for malformed `match` numeric fields.
- Actual:
  - Raw conversions in `update_history` bubble exceptions as 500.
- Evidence:
  - `history_update match.score=abc -> 500 RUNTIME_ERROR`

### 2) `/v1/history/append` can crash with 500 on non-numeric attempt summary fields

- Severity: High
- Files: [`quiz_app/api/server.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:379)
- Repro:
1. POST `/v1/history/append` with `score: "abc"` (also reproducible for `max_score`, `percent`, `duration_seconds`).
2. Observe 500 `RUNTIME_ERROR`.
- Expected:
  - Return 422 `VALIDATION_ERROR` for malformed attempt numeric fields.
- Actual:
  - `_attempt_from_payload` performs direct numeric casts without guarded validation.
- Evidence:
  - `history_append score=abc -> 500 RUNTIME_ERROR`

### 3) `/v1/history/update` can crash with 500 on non-numeric `record` fields (top-level and per-question)

- Severity: High
- Files: [`quiz_app/api/server.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:345)
- Repro:
1. POST `/v1/history/update` with valid `match` and malformed `record.duration_seconds: "oops"`.
2. POST `/v1/history/update` with malformed `record.questions[0].points_awarded: "x"`.
3. Observe 500 `RUNTIME_ERROR`.
- Expected:
  - Return 422 `VALIDATION_ERROR` and reject malformed `record` payloads.
- Actual:
  - `_attempt_from_payload` conversion errors propagate to the global 500 handler.
- Evidence:
  - `history_update record.duration=oops -> 500 RUNTIME_ERROR`
  - `history_update record.question.points_awarded=x -> 500 RUNTIME_ERROR`

### 4) Repository hygiene regression: tracked settings/history templates are runtime-mutated, causing test-suite failures

- Severity: Medium
- Files: [`quiz_app/api/server.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/quiz_app/api/server.py:65), [`settings/settings.json`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/settings/settings.json:1), [`settings/performance_history.json`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/settings/performance_history.json:1), [`tests/test_repo_hygiene.py`](/Users/michaelcollins/Library/Mobile Documents/iCloud~md~obsidian/Documents/Spring 2026/modular_quiz/tests/test_repo_hygiene.py:47)
- Repro:
1. Run API flows that call `_settings(...)` and history append/update using the default `settings/settings.json`.
2. Run `pytest -q`.
3. Observe hygiene failures:
   - tracked settings differs from `AppSettings()` defaults
   - tracked settings includes user-specific absolute home paths
   - tracked performance history template is no longer an empty list
- Expected:
  - Runtime app usage should not leave tracked template files in a state that fails hygiene tests.
- Actual:
  - Runtime writes mutate tracked template files and break repository hygiene checks.
- Evidence:
  - `FAILED tests/test_repo_hygiene.py::RepoHygieneTests::test_tracked_settings_matches_defaults`
  - `FAILED tests/test_repo_hygiene.py::RepoHygieneTests::test_tracked_settings_has_no_user_specific_home_paths`
  - `FAILED tests/test_repo_hygiene.py::RepoHygieneTests::test_tracked_performance_history_is_empty_template`

## Fix-Later Instructions (for implementation pass after review)

1. Add a shared attempt numeric validator for `_attempt_from_payload`:
   - validate `score`, `max_score`, `percent`, `duration_seconds`
   - validate per-question `points_awarded`, `max_points`
   - return 422 `VALIDATION_ERROR` on parse/type failures.
2. Add `_history_match_numeric_fields_from_payload` helper for `/v1/history/update` match parsing (`score`, `max_score`, `duration_seconds`) with 422 failures for invalid input.
3. Add repository hygiene protection for runtime settings/history state:
   - avoid mutating tracked template files during local runtime scans
   - ensure scan/test tooling uses temp paths or sanitized reset for `settings/settings.json` and `settings/performance_history.json`
   - keep `tests/test_repo_hygiene.py` green after bug-scan repro workflows.
4. Add regression tests:
   - `/v1/history/append` rejects invalid numeric summary fields with 422.
   - `/v1/history/update` rejects invalid `match` numeric fields with 422.
   - `/v1/history/update` rejects invalid `record` numeric fields (top-level + question entries) with 422.
5. Re-run:
   - `pytest -q`
   - `cd electron && npm run build`
6. Manual UI verification:
   - run short-answer grading/explain flows and confirm validation errors surface as controlled UI errors (no server crash messaging)
   - run performance-history regrade/update flow and verify malformed payloads are blocked with clear validation messages.

## Plan: UI Testing + Edge-Case Search (next pass)

1. UI testing plan
   - Complete one short-answer quiz attempt end-to-end (`Explain`, follow-up chat, `Finish Quiz`, history view).
   - Validate UI behavior for backend 422 responses in `/v1/grade/short`, `/v1/explain/short`, `/v1/history/append`, and `/v1/history/update`.
   - Confirm no regressions in quiz completion, history refresh, and retrospective grading flows.
   - Verify a normal local app run does not leave tracked `settings/settings.json` or `settings/performance_history.json` in a hygiene-failing state.
2. Edge-case search plan
   - Fuzz short-answer question payloads: `points`, `id`, `expected`, and `self_score` (missing/type/boundary values).
   - Fuzz history payloads:
     - top-level attempt numeric fields (`score`, `max_score`, `percent`, `duration_seconds`)
     - nested question numeric fields (`points_awarded`, `max_points`)
     - `match` object numeric fields in `/v1/history/update`.
   - Compare validation strictness parity between MCQ, short-answer, and history endpoints.
   - Fuzz runtime settings-path scenarios (default tracked path vs temp/userData path) to confirm hygiene invariants hold.
3. Regression strategy
   - Add tests first for each discovered crash/edge case.
   - Re-run full tests/build and then one manual UI smoke pass before proposing fixes.
   - End each scan by verifying `git status --short` does not contain mutated tracked template artifacts.
