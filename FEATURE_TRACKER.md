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

- [x] Ensure quiz generation injects `template_quiz.json` into the prompt.
- [x] Add prompt validation checks before quiz generation is run.
- [x] Consolidate provider-specific quiz generation prompts into one shared prompt builder.
- [x] Feedback now speaks directly to the learner (`you/your`) instead of speaking about the user.
- [x] Context injection now requests backend extracted text and supports `.pptx`, `.pdf`, `.docx`, `.md`, and `.txt`.
- [x] Removed `Total` and `MCQ options` input fields; generation now always uses 4 options per MCQ.
- [x] Hardened Claude quiz generation JSON parsing with cleanup + retry when the first response is invalid.
- [x] Fixed generation count parsing to preserve `0` values and derive `total` from `mcq_count + short_count`.

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Library & Selector (QS)

### Action Items
- [x] If new feedback has been given without the feedback tab open, add a glowing animation to the feedback tab. Remove the animation once the tab is opened. 

### Completed Tasks

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
### Notes

- _Add private notes for this feature here._

## Feature: Quiz Navigation

### Action Items

- _No pending action items._


### Completed Tasks

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
- [x] Replace `Latest Feedback` with a follow-up chatbox so users can ask additional feedback questions.
- [x] Add `Quizzes`/`Feedback` tabs to the left quiz directory card so users can switch between directory and feedback chat in one panel.

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

### Notes

- Stopwatch feature needs work; no option to stop. Timer starts when stopwatch does, users can freely swap between. 
- Add stopwatch settings in the settings page
- Add option for timer to stop the quiz and mark unanswered questions wrong

## Feature: Quiz Generator

### Action Items

- [ ] for the 'Output Folder' dropdown menu, add a ' Create New Folder ' option, maybe with a '+' somewhere in there. 


### Completed Tasks

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

### Notes

- _Add private notes for this feature here._

## Feature: Settings

### Action Items

- _No pending action items._


### Completed Tasks

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
- [x] Add `Automatically inject context` setting to reuse quiz-generation source files as grading/explanation context.
- [x] Sanitize tracked `settings/settings.json` and `settings/performance_history.json` to safe template defaults.
- [x] Add CI hygiene guard to block committed credentials and user-specific home-directory paths in tracked settings.
### Notes

- _Add private notes for this feature here._

## Feature: Performance History

### Action Items

- _No pending action items._

### Completed Tasks

- [x] Add `Performance History` section to `FEATURE_TRACKER.md`.
- [x] Remove `Performance History` top tab and add right-click quiz context menu with `Rename` and `Performance History`.
- [x] Move Performance History UI into the quiz sidebar so it replaces the quiz navigation block.
- [x] Add `Return to quiz` button in Performance History view, shown only during an active quiz.
- [x] Remove Performance History filter dropdown and show only attempts for the currently selected quiz history context.
- [x] Opening Performance History during an unfinished quiz now prompts confirmation before exiting.
- [x] Viewing Performance History now exits the current quiz session and discards unsaved progress.
- [x] Add left/right arrow navigation across recently opened quiz histories (most recent first).
- [x] Map left/right keyboard arrows to history context navigation when viewing Performance History.
- [x] Remove `No quiz loaded` from the main card header.
- [x] Skip exit confirmation when the quiz has no recorded progress.
- [x] Show `Performance History` as the main card title when history is open and remove duplicate in-panel heading.
- [x] Show quiz title (not filename) in history context navigation.
- [x] Show selected session details in a right-side column instead of below the session list.
- [x] Remove quiz-name line from each session item.
- [x] Remove `1 of 3 (most recent first)` context text.
- [x] Fix blank renderer page by moving Performance History derived state above keyboard-effect usage.
- [x] Add scroll behavior so Performance History session list and detail panel stay accessible instead of clipping.
- [x] Add explicit flex-height constraints so standalone Performance History reliably shows session/detail scroll areas.
- [x] Replace session date label with oldest-first `Attempt #` numbering.
- [x] Show `Attempt #`, `% correct`, and grader side-by-side in each session row.
- [x] Add `Sort by` control to Performance History with `Most recent` and `Least recent` options.
- [x] Show the selected attempt Date/Time at the top-right of the attempt breakdown panel.

### Notes

- _Add private notes for this feature here._

## Feature: Workflow Automation

### Action Items

- [ ] Add a weekly cleanup pass to archive completed items older than 30 days.

### Completed Tasks

- [x] Create a feature-organized tracker with `To-Do`, `Bugs`, `Ideas`, and `Notes` sections.
- [x] Update local agent instructions to require tracker reconciliation after repo edits.
- [x] Remove thread-link tracking from the workflow to avoid ambiguity.
- [x] Merge `To-Do`, `Bugs`, and `Ideas` into `Action Items`.
- [x] Add `Completed Tasks` sections for each feature.
- [x] Add `Windows Package` GitHub workflow to build unsigned NSIS installers and publish artifacts on tags/manual dispatch.
- [x] Add full-history `Secret Scan` workflow using gitleaks as a release gate for public publishing.
- [x] Add open-source readiness docs (`LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, and `CODE_OF_CONDUCT.md`) plus README release checklist.

### Notes

- _Use this for process/coordination notes across features._

## Feature Template

Copy this block when adding a new feature:

```markdown
## Feature: <Feature Name>

### Action Items

- [ ] ...

### Completed Tasks

- [x] ...

### Notes

- _Add private notes for this feature here._
```
