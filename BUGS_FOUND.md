# Bugs Found (Automation Scan)

Date: 2026-03-06 11:22 EST (implementation pass)
Scope: Implemented fixes for all six tracked bugs + reran tests/build
Checks run:
- `pytest -q` -> 61 passed
- `cd electron && npm run build:renderer` -> success

## Status Summary

- All six previously tracked bugs were implemented in this pass.
- No new bugs were discovered during this implementation run.
- Remaining work is manual UI verification of the new manager interactions.

## Implemented Fixes

1. `Finish Quiz` now exits completed quiz sessions
- `Finish Quiz` no longer loops inside the completed quiz view.
- Completed-session click now clears active quiz session state and returns to the non-active quiz view.

2. Feedback thread collisions from duplicate question IDs
- Feedback thread keys now include stable question index + ID, preventing thread/draft collisions.
- Quiz loading now rejects duplicate question IDs with a clear validation error.

3. Quiz Folder Manager right-click rename
- Manager context menu now includes `Rename` for folders and quizzes.
- Quiz rename continues to update quiz title JSON.
- Folder rename now has a dedicated backend endpoint.

4. Quiz Folder Manager drag-and-drop move
- Added drag/drop move interactions in the Quiz Folder Manager tree.
- Added backend move endpoint with managed-root safety validation.
- Prevents invalid moves (for example moving a folder into itself/descendants).

5. Generator output-folder inline creation
- Added inline `Create Folder` action beside the output-folder selector in Generate.
- New folder is created inside managed `Quizzes`, tree refreshes, and selector auto-targets the new folder.

6. Claude generation blank `title`/`instructions`
- Claude payload normalization now backfills blank/missing `title` and `instructions` with safe defaults before validation.
- Added regression test coverage for this edge case.

## Added/Updated Test Coverage

- API tests:
  - folder rename + item move flow
  - invalid folder move rejection
  - duplicate question ID load rejection
- Claude client test:
  - blank title/instructions backfill behavior

## Manual UI Verification Plan (for your review)

1. Finish Quiz exit flow
- Start and complete a quiz.
- Click `Finish Quiz`.
- Confirm the app exits active quiz mode.

2. Quiz Folder Manager rename
- Right-click folder -> `Rename` -> confirm tree updates.
- Right-click quiz -> `Rename` -> confirm title updates in quiz tree.

3. Quiz Folder Manager drag/drop moves
- Drag a quiz into a different folder.
- Drag a folder into another folder.
- Confirm invalid self/descendant moves are blocked with an error.

4. Generator output folder creation
- In Generate, click `Create Folder` beside output folder.
- Confirm folder appears in selector and generated quiz writes into it.
