# finish-guard.ts

## Purpose

The creator's save cannot be forgotten (UI round 1, U2:
`GpsPlusSlamJs_Docs/docs/2026-10-06-1020-tour-viewer-ui-round-1-plan.md`;
owner decision 2026-10-06: one big tapped Save, and a warning before
leaving unsaved - not an automatic download, which would name repeat saves
"name (1).zip" and break Drive's same-name Replace). Pure rules over what
the page knows.

## Public API

- `type FinishGuardInput` - `{ sessionLive, arAvailable, placedCount,
deletedCount, rebuilt: { delivered } | null }`.
- `unsavedWork(input)` - changes since the last Finish, or a rebuilt file
  not saved.
- `finishButtonText(input)` - "Finish - rebuild the zip", or "Finish and
  save your changes" after AR with changes not finished (the back gesture
  ends a session without a Finish; plan review F-3).
- `hideFinishForResult(input)` - on a phone, Finish steps aside while the
  rebuilt file waits for its save (the save is the page's one primary
  action); a desktop keeps it (editing on the page and finishing again is
  its flow, plan review D-8).
- `leaveNeedsConfirm(input)` - only while a rebuilt file was not saved;
  unfinished changes are in the draft and offered again, so they never ask.
- `LEAVE_UNSAVED_QUESTION` - the question `main.ts` asks before another
  tour replaces the open one.

## Invariants & assumptions

- "Delivered" is the hand-off's own report (`HandoffOutcome.delivered`):
  a dismissed picker or share sheet keeps asking.
- `beforeunload` (wired in `main.ts`) is partial on Android: a closed tab,
  a swipe-away or an OS discard do not fire it. The draft is what survives
  those.

## Tests

`finish-guard.test.ts` (each rule); `creator-finish.test.ts` ("the save
cannot be forgotten": asks before a save, stops after a delivered one, keeps
asking after a dismissed one, the Finish label after a back-gesture exit;
the keep-the-walk switch hidden in AR).
