# Contributing

## Development setup
1. Install Python dependencies:
```bash
python3 -m pip install -r requirements-api.txt
```
2. Install Electron dependencies:
```bash
cd electron
npm install
```

## Before opening a PR
1. Run tests:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```
2. Verify tracked settings are sanitized:
```bash
python3 -m unittest tests.test_repo_hygiene
```
3. Keep secrets out of commits:
  - Never commit API keys or OAuth tokens.
  - Runtime settings should stay in app userData paths, not tracked files.

## Pull request guidelines
1. Keep PRs focused and small where possible.
2. Include a short summary of behavior changes and test evidence.

## Commit guidance
1. Make one commit per logical change set.
2. Use clear commit subjects (imperative verb + scope).
3. Rebase/merge main before tagging releases.
