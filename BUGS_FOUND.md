# Bugs Found (Automation Scan)

Date: 2026-03-08 23:03 EDT
Scope: Re-validated tracked API validation/runtime bugs and repository hygiene behavior after history payload parsing fixes.

## Checks Run

- `pytest -q tests/test_api_server.py -k 'history and malformed'`
- `pytest -q`
- Static edge-case sweep of numeric parsing in `quiz_app/api/server.py`
- Runtime-path review for API defaults in `run_api.py`

## Resolved In This Pass

- `/v1/history/update` malformed `record` numeric fields are now explicitly regression-tested to ensure `422 VALIDATION_ERROR` responses instead of `500` crashes.
- `run_api.py` now defaults to `~/.modular_quiz/settings/settings.json` to avoid mutating tracked repo template files (`settings/settings.json`, `settings/performance_history.json`) during local runtime use.

## Active Bugs

- None found in current automated validation scope.

## Notes

- The prior `/v1/history/append` and `/v1/history/update` numeric parsing crashes are already covered by guarded coercion in `quiz_app/api/server.py` and now have explicit regression coverage for malformed match and record payloads.
- Keep using user-data settings paths when running the API locally outside tests.
