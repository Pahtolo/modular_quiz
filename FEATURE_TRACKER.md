# Modular Quiz Feature Tracker

Use this file as the single source of truth for feature work across features.

## Update Rules

- Before editing code, review the feature section you are touching.
- After editing code, move completed items from `Action Items` to `Completed Tasks`.
- If new work appears during implementation, add it to `Action Items`.
- Use each feature's `Notes` section for personal reminders or implementation context.

## Feature: Quiz Generation Prompting

### Action Items

- [ ] Ensure quiz generation injects `template_quiz.json` into the prompt.
- [ ] Add prompt validation checks before quiz generation is run.

### Completed Tasks

- _No completed tasks yet._

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Library & Selector (QS)

### Action Items



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

- [ ] When auto-advance is enabled, it should be impossible to navigate to previous questions (add a warning in the settings)
- [ ] "A", "B", "C", and "D" on the keyboard should click A, B, C, and D, respectively.


### Completed Tasks

- [x] Add back and forward arrows for question navigation.
- [x] Add navigation column to jump to specific questions.
- [x] Bind left/right arrow keys to backward/forward navigation.
- [x] Bind Enter key to move forward.
- [x] Fix auto-advance so it works reliably.
- [x] Add optional per-question timer with visible countdown.

### Notes

- _Add private notes for this feature here._

## Feature: UI/UX

### Action Items
- [ ] Quiz screen should not have to scroll when application is maximized

### Completed Tasks

- [x] Feedback log should show only most recent feedback.
- [x] Remove the top status/header banner and move theme mode toggle into Settings.

### Notes

- _Add private notes for this feature here._

## Feature: Quiz Generator

### Action Items

- [ ] Add option to choose output folder for newly generated quizzes (must remain inside `Quizzes`).
- [ ] Keep only two source input options: drag and drop, and import from Finder.
- [ ] Generator does not offer constrained output-folder selection.
- [ ] Add a preflight summary showing source files and target output folder.

### Completed Tasks

- _No completed tasks yet._

### Notes

- _Add private notes for this feature here._

## Feature: Settings

### Action Items

- [ ] Configure production HTTPS endpoint and MCP auth metadata for ChatGPT connector deployment.

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
