# `done-dialog.ts` - the editor's "Done" dialog

## Purpose

What is left to do when a creator leaves the desktop editor (tour editor
plan 2026-10-17-1816, W2, D18, D19): where the changes are, how the tour
at its link is updated for the host it lives on, that a file at a shared
link is public as soon as it is uploaded, and - while the file still
carries the walk recording - that the walk goes public with it unless it
is moved out. "Move the debug data out" is offered here (M2 of the
debug-captures plan: the moved-out file is the debug bundle,
`debug-bundle.ts`, and every text names it as debug data); the page does
the move (`edit-main.ts`, `EditorSession.moveWalkOut`).

## Public API

- `DRIVE_MOUNT_TIP_SHOWN` (false) - the switch for the Google-Drive-mount
  tip. It stays off until the owner has checked that a write through
  Drive for desktop keeps the Drive file id the printed code points at
  (the plan's review #10, D18). The words and `#done-drive-tip` are in
  place and tested with the switch on; turning it on is this constant.
- `DoneSaved`, `DoneFacts` - where the changes went (`in-place`,
  `downloaded`, `unchanged`, each with the file's name), the host, whether
  the newest bytes carry the walk (`true`, `false`, or `"unknown"` when
  the check failed: said as "may carry", never as none - the M4b milestone
  review #9), and the tip's switch.
- `doneWords(facts)` - the dialog's words: `where`, `update` (the host's
  steps from `tour-host.ts` `hostReplaceOnComputer`, naming the file),
  `publicLine`, `walk` (null without a walk) and `driveTip` (null unless
  the switch is on, the host is Drive and the file was written in place).
- `MOVE_LABELS` - the move button's idle, in-progress and second-step
  labels (`confirm`: take a downloaded walk out; `download`: download the
  tour without a walk already saved).
- `WalkMoveOutcome` - what the page's move came to: `moved` (the walk's
  and the tour's file names, and where the changes are now, `saved`),
  `downloaded` (the walk's zip was downloaded, the tour not yet rewritten;
  `confirm` is the second click's step), `walk-saved` (the walk is in the
  chosen file, and the tour, which has no file to write into, is
  downloaded on the second click - the M4b fix re-review #2), `refused`
  (a reason in words) or
  `cancelled` (the walk's file was not saved).
- `wireDoneDialog({ dom, moveWalk, onClose })` - `open(facts)`,
  `close(force?)`, `isOpen()`. The host picker re-renders the update steps; the move button
  runs `moveWalk` once at a time.

## Invariants & assumptions

- The async-UI rule: the move button shows `MOVE_LABELS.moving` and is
  disabled while `moveWalk` runs; then `moved` hides the button and the
  walk's words and says where the walk went, while `refused`, `cancelled`
  and a thrown error say why and give the button back.
- A second click while a move runs starts nothing. The click calls
  `moveWalk` (or the pending `confirm`) synchronously, so the page can
  open the browser's save dialog inside it (review #2).
- **While a move runs the dialog cannot be closed** (Esc and Close do
  nothing, Close is disabled): the move holds the page's save, and Done
  pressed meanwhile froze the tab (review #1). `close(true)` is the page's
  own close when it drops the tour; it also forgets a pending confirm.
- `downloaded` keeps the walk's words and turns the button into
  `MOVE_LABELS.confirm`: a started download is not a landed one, so the
  tour is rewritten only on that second click.
- `moved` re-renders the dialog from its `saved`, so the first line and
  the host's steps name what the tour file is now (review #10).
- An `open` clears the last move's line (unless a move still runs) and
  focuses the Close button; the page holds the rest of the page inert
  while the dialog shows (`page-inert.ts`).
- Pure words, structural DOM: the tests run in node.
- The host picker's options are the page's (`TOUR_HOSTS`); a value that is
  not a host is ignored.

## Examples

```ts
const done = wireDoneDialog({ dom, moveWalk: () => page.moveWalk(), onClose });
done.open({
  saved: { kind: "in-place", name: "castle.zip" },
  host: "drive",
  carriesWalk: true,
  driveMountTip: DRIVE_MOUNT_TIP_SHOWN,
});
```

## Tests

- `done-dialog.test.ts` - the words per case and host (the unknown walk
  among them), the hidden tip and its switch, and the move's in-progress,
  moved (with the first line following), downloaded-then-confirmed,
  walk-saved-then-downloaded,
  refused, cancelled and thrown states; the dialog held open while a move
  runs and closed by force.
- `playwright-tests/editor.spec.js` - Done saves first and opens the
  dialog; the save dialog is asked for on the click and the walk lands in
  the chosen file; without one, the walk is downloaded and the tour is
  rewritten on the second click; Done stays disabled and the dialog open
  while the move runs; a failed write of either file leaves the tour file
  unchanged, and the next save still carries the walk.
