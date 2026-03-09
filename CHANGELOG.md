# Changelog

## v0.2.2 - 2026-03-09

### Hotfix
- Fixed packaged Claude and OpenAI HTTPS requests so frozen app releases use a bundled CA certificate store instead of relying on host trust-store discovery.
- Fixed packaged OpenAI OAuth token exchange and refresh requests to use the same bundled certificate trust path.

### Packaging and platform updates
- Added `certifi` as an explicit sidecar runtime dependency so the packaged Python backend consistently ships with a usable CA bundle.

## v0.2.1 - 2026-03-09

This release supersedes `v0.2.0`, which was cut from the wrong branch and missed merged `master` fixes.

### User-facing updates since v0.1.0
- Added short-answer explain flows, follow-up feedback chat, markdown and KaTeX rendering, typing states, and a cleaner feedback sidebar layout.
- Expanded quiz flow controls with injected context, per-question feedback history, richer navigation, optional timers and stopwatch modes, pause and resume controls, and performance-history chart and filter improvements.
- Improved quiz library management with inline rename, better file and folder handling, resizable folder-manager panels, and stronger quiz-load validation.
- Added settings for shuffled MCQ answers, clock off mode, and improved API key display behavior.

### Validation and runtime fixes
- Hardened grading and history validation so malformed payloads return `422` errors instead of crashing, including stricter MCQ checks and short-answer points validation.
- Fixed additional runtime edge cases around quiz flow, generation, feedback behavior, and managed user-data storage defaults.

### Packaging and platform updates
- Shipped dependency-complete installers with bundled OCR and runtime sidecars plus better Windows and macOS OCR dependency discovery.
- Improved fresh-install behavior for the managed quiz library and packaging workflow reliability across macOS and Windows.
