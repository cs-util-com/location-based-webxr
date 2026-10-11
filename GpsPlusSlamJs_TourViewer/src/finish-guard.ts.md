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
deletedCount, codeCount, rebuilt: { delivered } | null, draftPersists,
finishFailed }`. `codeCount` (code book plan M4c-1): codes measured or
  improved that no Finish has written yet - unsaved work like a placement.
- `unsavedWork(input)` - changes since the last Finish, or a rebuilt file
  not saved.
- `finishButtonText(input)` - "Finish - rebuild the zip", or "Finish and
  save your changes" after AR with changes not finished (the back gesture
  ends a session without a Finish; plan review F-3).
- `hideFinishForResult(input)` - on a phone, Finish steps aside while the
  rebuilt file waits for its save (the save is the page's one primary
  action); a desktop keeps it (editing on the page and finishing again is
  its flow, plan review D-8); never after a failed Finish, so its retry
  stays reachable (U2 milestone review #4).
- `leaveNeedsConfirm(input)` - while a rebuilt file was not saved, and,
  when no draft backs them up (`draftPersists` false), while there are
  unfinished changes at all; with the draft they are offered again, so they
  never ask (U2 milestone review #3).
- `leaveQuestion(input)` - what `main.ts` asks then: it promises "your
  changes stay on this phone" only while the draft backs them up.

## Invariants & assumptions

- "Delivered" is the save's own report (`seams.downloadZip`'s result, the
  Finish's own save or the button's; field test 2, F4): a dismissed picker
  keeps asking. The anchor-download
  fallback reports delivered whatever happened (the browser gives no
  signal).
- `draftPersists` is false once the page noted a failed backup
  (`creator-setup.ts`'s `noteNoPersistence`).
- `beforeunload` (wired in `main.ts`) is partial on Android: a closed tab,
  a swipe-away or an OS discard do not fire it. The draft is what survives
  those.

## Tests

`finish-guard.test.ts` (each rule, the backup and failed-Finish cases);
`creator-finish.test.ts` ("the save cannot be forgotten", "after the
Finish, the save leads"); `archive-open.test.ts` (a declined question
leaves the open tour untouched).
