# `done-dialog.ts` - the editor's "Done" dialog

## Purpose

What is left to do when a creator leaves the desktop editor (tour editor
plan 2026-10-17-1816, W2, D18, D19): where the changes are, how the tour
at its link is updated for the host it lives on, that a file at a shared
link is public as soon as it is uploaded, and - while the file still
carries the walk recording - that the walk goes public with it unless it
is moved out. "Move the walk out" is offered here; the page does the move
(`edit-main.ts`, `EditorSession.moveWalkOut`).

## Public API

- `DRIVE_MOUNT_TIP_SHOWN` (false) - the switch for the Google-Drive-mount
  tip. It stays off until the owner has checked that a write through
  Drive for desktop keeps the Drive file id the printed code points at
  (the plan's review #10, D18). The words and `#done-drive-tip` are in
  place and tested with the switch on; turning it on is this constant.
- `DoneSaved`, `DoneFacts` - where the changes went (`in-place`,
  `downloaded`, `unchanged`, each with the file's name), the host, whether
  the newest bytes carry the walk, and the tip's switch.
- `doneWords(facts)` - the dialog's words: `where`, `update` (the host's
  steps from `tour-host.ts` `hostReplaceOnComputer`, naming the file),
  `publicLine`, `walk` (null without a walk) and `driveTip` (null unless
  the switch is on, the host is Drive and the file was written in place).
- `MOVE_LABELS` - the move button's idle and in-progress labels.
- `WalkMoveOutcome` - what the page's move came to: `moved` (with the
  walk's and the tour's file names), `refused` (a reason in words) or
  `cancelled` (the walk's file was not saved).
- `wireDoneDialog({ dom, moveWalk, onClose })` - `open(facts)`, `close()`,
  `isOpen()`. The host picker re-renders the update steps; the move button
  runs `moveWalk` once at a time.

## Invariants & assumptions

- The async-UI rule: the move button shows `MOVE_LABELS.moving` and is
  disabled while `moveWalk` runs; then `moved` hides the button and the
  walk's words and says where the walk went, while `refused`, `cancelled`
  and a thrown error say why and give the button back.
- A second click while a move runs starts nothing.
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

- `done-dialog.test.ts` - the words per case and host, the hidden tip and
  its switch, and the move's in-progress, moved, refused, cancelled and
  thrown states.
- `playwright-tests/editor.spec.js` - Done saves first and opens the
  dialog; the move writes the walk's zip and a walk-free tour; a failed
  write of either file leaves the tour file unchanged.
