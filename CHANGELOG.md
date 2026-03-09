# Changelog

## v0.2.0 - 2026-03-09

### User-facing updates since v0.1.0
- Added short-answer explain flows, follow-up feedback chat, markdown/KaTeX rendering, typing states, and cleaner feedback sidebar layouts.
- Expanded quiz flow controls with injected context, per-question feedback history, richer navigation, optional timers/stopwatch modes, pause/resume controls, and performance-history chart/filter improvements.
- Improved quiz library management with inline rename, better file/folder handling, folder manager resizing and move actions, and stronger quiz-load validation.
- Added settings for shuffled MCQ answers, clock off mode, improved preferred-model handling, and more robust API key display behavior.
- Hardened grading/history validation, including stricter MCQ payload checks and `422` handling for malformed history payload updates.

### Packaging and platform updates
- Shipped dependency-complete installers with bundled OCR/runtime sidecars and better Windows/macOS OCR dependency discovery.
- Improved fresh-install behavior for the managed quiz library and packaging workflow reliability across macOS and Windows.

### Developer workflow updates
- Added a PR review helper script for inspecting open PR review threads and manually triggering Codex review when needed.
- Adjusted the review helper workflow to assume Codex review on push, with manual trigger fallback only.
