# Modular Quiz Feature Tracker

Use this file as the single source of truth for feature work across features.

## Update Rules

- Before editing code, review the feature section you are touching.
- After editing code, move completed items from `Action Items` to `Completed Tasks`.
- If new work appears during implementation, add it to `Action Items`.
- Use each feature's `Notes` section for personal reminders or implementation context.

## Feature: Quiz Generation Prompting

### Action Items

- _No pending action items._

### Completed Tasks

- [x] Bundle `template_quiz.json` into the packaged Python sidecar and resolve it from the PyInstaller temp directory so quiz generation works in production builds.
- [x] Claude defaults now ship with a current model alias, legacy shipped defaults migrate forward, and `404 not_found_error` model misses retry once against the account's available Claude models.
- [x] Packaged Claude and OpenAI HTTPS requests now use a bundled CA certificate store so frozen app releases do not fail with `CERTIFICATE_VERIFY_FAILED` on some machines.
- [x] 2026-03-08 EDT resolved/revalidated `BUGS_FOUND.md` active bugs with regression coverage updates (including `/v1/history/update` malformed `record` numeric payloads) and shifted local API runtime defaults to userData-style settings paths to protect tracked repo templates.
- [x] Ensure quiz generation injects `template_quiz.json` into the prompt.
- [x] Add prompt validation checks before quiz generation is run.
- [x] Consolidate provider-specific quiz generation prompts into one shared prompt builder.
- [x] Backfill missing/blank Claude-generated `title` and `instructions` values before quiz validation.
- [x] Feedback now speaks directly to the learner (`you/your`) instead of speaking about the user.
- [x] Context injection now requests backend extracted text and supports `.pptx`, `.pdf`, `.docx`, `.md`, and `.txt`.
- [x] Removed `Total` and `MCQ options` input fields; generation now always uses 4 options per MCQ.
- [x] Hardened Claude quiz generation JSON parsing with cleanup + retry when the first response is invalid.
- [x] Fixed generation count parsing to preserve `0` values and derive `total` from `mcq_count + short_count`.

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Library & Selector (QS) & Feedback

### Action Items

- _No pending action items._

### Completed Tasks

- [x] Validate numeric payload fields for `/v1/history/append` and `/v1/history/update` so malformed values return 422 instead of 500.
- [x] Right-clicking a quiz now focuses a cursor on the name, allowing inline quiz-name edits.
- [x] Left-clicking a quiz automatically opens its performance history.
- [x] Reject uploaded quiz JSON files where any MCQ has more than 4 options so oversized quizzes cannot load or run.
- [x] Reject non-positive `points` values in `/v1/grade/mcq` payload validation.
- [x] Reject multi-character MCQ `answer` values in `/v1/grade/mcq` payload validation (no silent truncation).
- [x] Reject out-of-range MCQ `answer` values in `/v1/grade/mcq` payload validation.
- [x] Reject non-string MCQ options in `/v1/grade/mcq` payload validation (no silent coercion).
- [x] Reject blank/whitespace-only MCQ options in `/v1/grade/mcq` payload validation.
- [x] Reject MCQ options that are blank/whitespace-only during quiz JSON load validation.
- [x] Prevent duplicate question IDs from colliding feedback thread/draft state by keying feedback threads with index-stable question keys and rejecting duplicate IDs at quiz load time.
- [x] Change quiz folder selection to GUI method.
- [x] Automatically initialize and select the quizzes directory on install.
- [x] Read quiz title from JSON and show it in QS.
- [x] Ignore files that are not `.json`.
- [x] Ignore folders.
- [x] Move `Start quiz` button out of QS column.
- [x] Place `Start quiz` button below QS column.
- [x] Avoid displaying full file paths in QS.
- [x] Move dedicated quizzes folder to `/modular_quiz`.
- [x] QS showed JSON filename instead of in-file quiz title.
- [x] Add sort/filter controls for large quiz libraries.
- [x] Add feature to rename quizzes by right clicking the quiz. This should edit the JSON file behind the scenes.
- [x] Remove the refresh button and add an auto-refresh feature
- [x] Allow folders to collapse
- [x] Remove the "Rename" box. Renaming should be done by Right clicking the quiz
- [x] Create a visual difference between folders and files
- [x] Fix right-click rename flow by replacing browser prompt with in-app rename dialog.
- [x] Ensure fresh installs start with an empty managed `Quizzes` library under userData (no bundled starter quizzes).
- [x] If new feedback has been given without the feedback tab open, add a glowing animation to the feedback tab. Remove the animation once the tab is opened.
- [x] Errors that result from an invalid API key no longer persist after the API key is updated and models are refreshed.
- [x] Feedback chat now renders markdown and KaTeX.
- [x] Feedback chat now uses the full sidebar column instead of nesting a second column/card inside it.
- [x] Feedback chat thread now uses the sidebar card directly instead of a nested framed log panel.
- [x] Feedback chat now shows a typing animation while the model is generating a response.
- [x] Model-generated explanations and feedback follow-ups now request KaTeX formatting whenever math is used.
- [x] Each question now has its own feedback history.
- [x] Clicking `Explain` now shows the model typing animation in the feedback window.
- [x] The feedback window no longer repeats raw `You are correct` / `You are incorrect` result messages that are already shown in question navigation.
- [x] Double clicking a quiz now starts it.
- [x] The feedback tab no longer animates on question advancement unless actual feedback is available.
- [x] The Feedback scrollbar now sits against the right interior wall of the feedback panel.
- [x] Validate short-answer `question.points` in API parsing so non-integer values return 422 instead of 500.
- [x] Reject non-positive short-answer `question.points` values (`0`/negative) instead of silently coercing values during grading.

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Navigation

### Action Items

- _No pending action items._

### Completed Tasks

- [x] Render short-answer KaTeX inline inside the markdown notebook editor so math appears in the same editor box and the raw markdown source returns when the cursor enters an expression.
- [x] Preserve explicit `\(...\)` and `\[...\]` math through `react-markdown` by rewriting those delimiters to markdown-safe KaTeX sentinels before live rendering.
- [x] Prevent lone `$` text such as currency and shell variables from corrupting later live KaTeX auto-formatting by wrapping generated math with markdown-safe sentinel delimiters and only skipping closed math spans.
- [x] Keep auto-generated inline math visible through `react-markdown` by teaching the live KaTeX renderer to consume those markdown-safe sentinel delimiters.
- [x] Keep decorated algebra like `2a_1 + 3b^2 = 0` in a single live KaTeX span while leaving decorated identifier prose such as `2a_1` and `2x_speed` unformatted.
- [x] Fix live math auto-formatting so composite terms like `2ab/3cd` normalize into valid fractions and neighboring prose tokens like `2x`/`3x` do not falsely trigger each other.
- [x] Hide the short-answer live preview pane whenever the `KaTeX` toggle is turned off.
- [x] Rename the short-answer math auto-format toggle button to `KaTeX` for clearer quiz UI wording.
- [x] Refine live math auto-formatting so prose tokens like `10x` and `gpt-5x` stay plain text while multi-letter algebra like `2ab` and `12xy` still renders in full equations.
- [x] Remove stale short-answer markdown preview reset calls so quiz start no longer throws `setShortAnswerMarkdownPreview is not defined` or leave the sidebar stuck on Performance History.
- [x] Replace the markdown preview button with an always-on live render pane so markdown and KaTeX update while short-answer text is being typed.
- [x] Broaden math auto-formatting to cover ordinary implicit variables like `3a` and symbolic fractions like `ab/cd` while still protecting actual relative paths such as `src/utils`.
- [x] Extend short-answer math auto-formatting to render implicit multiplication terms like `5x` and `5x^2` while leaving unit-like prose such as `5g` alone.
- [x] Fix markdown math auto-format named-function escaping and keep relative path references from being rewritten as fractions in preview.
- [x] Tighten short-answer math auto-format heuristics so markdown links, API paths, hyphenated prose, numeric ranges, and isolated chapter-style fractions remain plain text in preview.
- [x] Add a short-answer markdown preview toggle that auto-formats plain-text math into KaTeX-style rendering without changing the saved answer text.
- [x] Restrict Performance History `Sort by` control to `Sessions` view and hide it in `Chart` view.
- [x] Replace the short-answer textarea with a notebook-style Markdown/Code editor with markdown preview, syntax-highlighted code mode, and fenced-code serialization for grading/history compatibility.
- [x] Preserve leading indentation in stored short-answer answers and expected text so markdown code blocks survive history append/load round trips.
- [x] Preserve notebook answer formatting in follow-up feedback payloads and use longer code fences when code answers contain embedded triple backticks.
- [x] Align notebook code editor and rendered code-block syntax colors with VS Code-style Light+/Dark+ token coloring.
- [x] Declare `@lezer/highlight` directly in the Electron renderer package so the VS Code notebook theme does not depend on a transitive install.
- [x] Add a full-screen toggle for the short-answer code editor so longer notebook answers can be edited without the quiz layout constraints.
- [x] Preserve the short-answer code editor cursor, selection, scroll position, and undo history when toggling full-screen mode.
- [x] Limit full-screen editor state restoration to the current answer so cached CodeMirror state cannot leak into other short-answer questions.
- [x] Only arm short-answer full-screen state restoration during full-screen transitions, not on normal editor updates or question changes.
- [x] Keep short-answer full-screen viewport and focus restoration scoped to full-screen transitions so new answers do not inherit stale scroll/focus state.
- [x] Apply the notebook CodeMirror foreground/background styling directly inside the portaled full-screen editor so non-active lines render correctly in full-screen mode.
- [x] Add 'Explain' button for short answer questions.
- [x] Detect and render code for short answer responses.
- [x] Add quiz clock metrics to performance history
- [x] Expand MCQ keyboard shortcuts beyond fixed `A-D` so imported quizzes with 5+ options remain keyboard-answerable.
- [x] `Finish Quiz` now exits the completed quiz session and returns to the non-active quiz view.
- [x] Add back and forward arrows for question navigation.
- [x] Add navigation column to jump to specific questions.
- [x] Bind left/right arrow keys to backward/forward navigation.
- [x] Bind Enter key to move forward.
- [x] Fix auto-advance so it works reliably.
- [x] Add optional per-question timer with visible countdown.
- [x] When auto-advance is enabled, it should be impossible to navigate to previous questions (add a warning in the settings).
- [x] "A", "B", "C", and "D" on the keyboard should click A, B, C, and D, respectively.
- [x] Remove the 'Selected quiz' element from the Quiz Navigation block.
- [x] Remove duplicate quiz-screen preferred model dropdown; keep model selection only in Settings.
- [x] Remove the option to self score. Questions are recorded as ungraded when no model is selected.
- [x] Change Question Nav "Done" highlight from green to blue.
- [x] In Question Nav, show `Correct` (green) and `Incorrect` (red) when feedback on answer is enabled.
- [x] In Question Nav, when feedback is on quiz completion, show answered questions as `Done` (blue) until quiz completion, then switch to `Correct`/`Incorrect`.
- [x] Once a quiz has been completed, `Finish Quiz` and `Restart Quiz` permanently replace `Next`.
- [x] Add `See Performance History` button at quiz completion for the current quiz.
- [x] Prompt with the same mid-quiz confirmation message when switching to a different quiz.
- [x] Add retrospective grading action in Performance History for attempts with ungraded questions.
- [x] Add `Inject Context` button left of `Explain`/`Next` to import supporting materials for better model feedback.
- [x] Add `View Injected Context` with a minimize-friendly file list so users can quickly return to the quiz.
- [x] Keep injected context hidden by default until `View Injected Context` is clicked.
- [x] Replace `Latest Feedback` with a follow-up chatbox so users can ask additional feedback questions.
- [x] Add `Quizzes`/`Feedback` tabs to the left quiz directory card so users can switch between directory and feedback chat in one panel.
- [x] Quiz timer expiry now auto-finishes the attempt and records every unanswered question as timed out.
- [x] Pausing the timer or stopwatch now hides the active quiz content until unpaused.
- [x] Pressing the spacebar now toggles quiz pause/resume for the timer or stopwatch.

### Notes

- Feature to save ungraded quiz responses to be graded later

## Feature: UI/UX

### Action Items

- _No pending action items._

### Completed Tasks

- [x] Feedback log should show only most recent feedback.
- [x] Remove the top status/header banner and move theme mode toggle into Settings.
- [x] Quiz screen no longer requires page scrolling when the app window is maximized.
- [x] Add a quiz stopwatch on the right side of the navigation controls that starts with each quiz run.
- [x] Add a right-click stopwatch dropdown to switch to a customizable quiz timer that also starts with quiz start.
- [x] Move stopwatch/timer display to the right side of the top navigation banner (`Quiz`, `Generate`, `Settings`).
- [x] Replace the hidden right-click quiz clock menu with visible Pause/Resume controls in the top navigation.
- [x] Pausing the quiz clock now freezes both the quiz clock and per-question timer while locking quiz interaction.

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Generator

### Action Items

- _No pending action items._

### Completed Tasks

- [x] 2026-03-08 21:03 EDT automation bug-scan reran tests/build, reconfirmed six active API/runtime+hygiene bugs (no new bug classes), and refreshed `BUGS_FOUND.md` with updated evidence plus UI-testing/edge-case fix-later instructions.
- [x] 2026-03-08 19:48 EDT automation bug-scan reran tests/build, confirmed three existing API validation/runtime bugs, identified two additional history payload parsing 500-crash paths, and refreshed `BUGS_FOUND.md` with UI-testing + edge-case search/fix instructions.
- [x] 2026-03-08 14:51 EDT automation bug-scan reran tests/build, identified three active API validation/runtime bugs, and created `BUGS_FOUND.md` with UI-testing + edge-case follow-up instructions.
- [x] Generator drag-and-drop now stages dropped file data when local file paths are unavailable.
- [x] 2026-03-08 03:01 EDT automation bug-scan reran tests/build, revalidated two active bugs, and refreshed `BUGS_FOUND.md` with UI-testing and edge-case search/fix instructions.
- [x] 2026-03-08 00:02 EST automation bug-scan reran tests/build, revalidated two active bugs, and refreshed `BUGS_FOUND.md` with UI-testing and edge-case search/fix instructions.
- [x] 2026-03-07 20:02 EST automation bug-scan reran tests/build, revalidated two active bugs, and refreshed `BUGS_FOUND.md` with UI-testing and edge-case search/fix instructions.
- [x] 2026-03-07 00:07 EST automation bug-scan reran tests/build, revalidated five existing bugs, identified two additional `/v1/grade/mcq` validation gaps (multi-character answers and non-positive points), and refreshed `BUGS_FOUND.md` with UI-testing + edge-case fix instructions.
- [x] 2026-03-06 23:42 EST automation bug-scan reran tests/build, revalidated five active edge-case bugs, and refreshed `BUGS_FOUND.md` with UI-testing + edge-case search/fix instructions.
- [x] 2026-03-06 18:51 EST automation bug-scan reran tests/build, confirmed five active edge-case bugs, and refreshed `BUGS_FOUND.md` with UI-testing + edge-case search/fix instructions.
- [x] 2026-03-06 16:06 EST automation bug-scan reran tests/build, confirmed three active edge-case bugs, and refreshed `BUGS_FOUND.md` with UI-testing + edge-case search/fix instructions.
- [x] 2026-03-06 16:05 EST automation bug-scan reran tests/build, revalidated two active edge-case bugs, and refreshed `BUGS_FOUND.md` with UI-testing + edge-case search/fix instructions.
- [x] 2026-03-06 12:52 EST automation bug-scan reran tests/build, found two active edge-case bugs, and refreshed `BUGS_FOUND.md` with UI-testing + fix instructions.
- [x] Add inline `Create Folder` action next to the generator output-folder selector and auto-select the new folder.
- [x] Ensure the Quiz Generator `Create Folder` button works reliably when the managed quiz folder is ready.
- [x] Backfill blank/missing Claude-generated `title` and `instructions` values before validation.
- [x] 2026-03-06 11:00 EST automation bug-scan reran tests/build, revalidated six active bugs, and refreshed `BUGS_FOUND.md` with UI + edge-case fix planning.
- [x] 2026-03-06 09:01 EST automation bug-scan reran tests/build, revalidated six tracked bugs, and refreshed `BUGS_FOUND.md` with UI + edge-case fix planning.
- [x] 2026-03-06 latest automation bug-scan reran tests/build, revalidated six active bugs, and refreshed `BUGS_FOUND.md` with UI + edge-case fix planning.
- [x] Ran automation bug-scan pass and updated `BUGS_FOUND.md` with UI-testing and edge-case search plan.
- [x] 2026-03-06 automation bug-scan: revalidated current issues and refreshed `BUGS_FOUND.md` with reproducible evidence plus a UI/edge-case fix plan.
- [x] Ran an automation bug-scan pass and documented findings in `BUGS_FOUND.md`.
- [x] Add option to choose output folder for newly generated quizzes (must remain inside `Quizzes`).
- [x] Keep only two source input options: drag and drop, and import from Finder.
- [x] Add constrained output-folder selection for generator outputs.
- [x] Add a preflight summary showing source files and target output folder.
- [x] Sanitize deprecated Claude model IDs and auto-fallback to an available Claude model during generation.
- [x] Add "Generating..." loading state and spinner while quiz generation is running.
- [x] Remove "Open Target Folder" button from Quiz Generator UI.
- [x] Normalize generated question IDs so blank/missing IDs are auto-filled before quiz validation.
- [x] For uploaded items, show file names instead of full paths.
- [x] Prevent blank Generator view by normalizing tab keys (`generator` -> `generate`) during tab switches/render.
- [x] Build pre-flight summary automatically when sources change (no manual preflight button).
- [x] Keep numeric fields editable while typing; only coerce empty values to `0` on blur or Enter/Return.
- [x] Keep one-button generation source import on Windows while supporting files and folders via smart picker mode.
- [x] Preserve dropped folder roots for generation sources when detectable, with file fallback when not detectable.
- [x] Add OCR fallback execution for low-text PDFs during extraction; generation now uses OCR text when available.
- [x] Bundle generation/runtime dependencies (`pypdf`, `python-docx`, `python-pptx`) and staged OCR runtime in installer sidecars.
- [x] Retry OpenAI quiz generation after transient 5xx/520 failures, with smaller-prompt fallback and JSON repair retry.

### Notes

- _Add private notes for this feature here._

## Feature: Settings

### Action Items

- [ ] Configure macOS code-signing/notarization secrets so packaged macOS releases can use in-app auto-update in production.

### Completed Tasks

- [x] Add in-app update checks/download/install controls in Settings, backed by Electron auto-updater and GitHub Releases metadata.
- [x] Keep unfocused API key displays clipped inside their Settings boxes instead of bleeding past the field boundary.
- [x] Remove the `Minimize` button from the main Quiz Folder Manager panel.
- [x] Allow the Quiz Folder Manager panel that houses the folder structure to be resized by dragging its edges and corners.
- [x] Fix Quiz Folder Manager edge-resize behavior so north-edge drags can regrow correctly and always stop on pointer cancellation/loss.
- [x] Keep Quiz Folder Manager library polling active while the new main-header Manager tab is open.
- [x] When entering an API key, let the `Enter` key deselect the textbox.
- [x] Add a setting to shuffle MCQ answer order on each quiz attempt.
- [x] Add setting to turn quiz clock off
- [x] Add Quiz Folder Manager drag-and-drop move support for quizzes/folders with managed-root safety checks.
- [x] Add Quiz Folder Manager right-click rename action for folders and quizzes.
- [x] Ensure Quiz Folder Manager `New Folder` flow is functional with managed-library refresh/selection updates.
- [x] Remove option to change performance history directory.
- [x] Remove option to change quiz directory.
- [x] Rename model option to `No model`.
- [x] Make feedback mode labels descriptive (no snake_case).
- [x] Split auto-advance into its own on/off toggle grouped with auto-advance delay.
- [x] Add feedback option: Show feedback on answer.
- [x] Add feedback option: Show feedback on quiz completion.
- [x] Group auto-advance controls as one feature.
- [x] Add settings search/filter for faster navigation.
- [x] Prompt the user to save settings if they try to click off the settings tab.
- [x] Rename `Connect OpenAI OAuth` to `Sign in with OpenAI`.
- [x] Wire `Sign in with OpenAI` to open the OpenAI sign-in webpage.
- [x] Ensure `Sign in with OpenAI` completes OAuth connection and stores OAuth tokens in app settings.
- [x] Add OpenAI OAuth client-ID validation and defaults for OpenAI OAuth endpoints.
- [x] Scaffold MCP bridge server that maps backend quiz/settings routes into MCP tools for ChatGPT Apps integration.
- [x] Remove `Sign in with OpenAI` and hide OAuth-specific OpenAI settings controls from Settings UI.
- [x] Mask `OpenAI API key` input in Settings.
- [x] Convert `Claude model selected` and `OpenAI model selected` settings fields from text inputs to dropdown menus.
- [x] Make auto-advance delay editable without requiring auto-advance to be enabled first.
- [x] Remove `Claude model selected` and `OpenAI model selected` controls from Settings.
- [x] Apply `Preferred model` to both quiz generation and quiz feedback flows.
- [x] Preserve the current preferred model key in Settings even when model lists refresh.
- [x] Unable to change auto-advance delay. Ensure textfield is editable
- [x] Ensure 'Preferred model' option includes all models for the user given the entered API keys. This option should apply to both quiz generation and quiz feedback
- [x] Remove 'Claude model selected' option
- [x] Remove 'OpenAI model selected' option
- [x] Format preferred-model dropdown labels as human-readable model names (for example, `Claude 3 Haiku`).
- [x] Model options should not be formatted "Claude: claude-3-haiku-20240307". Should instead be formated "Claude 3 Haiku"
- [x] Preserve decimal version formatting in model labels (for example, `Claude Opus 4.6`, not `Claude Opus 4 6`).
- [x] Pass `GH_TOKEN` into tagged macOS and Windows packaging builds so `electron-builder` can publish release installers instead of failing before artifact upload.
