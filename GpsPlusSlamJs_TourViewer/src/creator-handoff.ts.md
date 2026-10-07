# creator-handoff.ts

## Purpose

The rebuilt zip's hand-off after a Finish: the download / share / Drive-save
button, its labels per open tour, the result line, and the "replace the
hosted file" steps it earns. Split out of `creator-setup.ts` unchanged in
the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`).

## Public API

- `wireCreatorHandoff({ ctx, seams, dom, render }): CreatorHandoff` -
  wires the download button (`dom`: `downloadButton`, `finishStatus`,
  `replaceHelp`, `replaceHelpShare`, `replaceHelpGeneric`,
  `replaceHelpDrive`); `render` re-renders the creator panel when a
  delivered file changes the save guard.
- `CreatorHandoff`:
  - `drive()` - the open tour is on Google Drive (it saves, never shares);
  - `route()` - `finishRoute({ canShare, drive })` for the open tour;
  - `idleLabel()` - the button's idle label for the open tour (the Finish
    sets it when it reveals the button);
  - `reset()` - a tour closed: the button disabled with its idle label,
    the line cleared, the replace steps hidden and the generic text back.

## Invariants & assumptions

- **A Drive tour's finish SAVES and shows the Drive steps** (Drive replace
  plan §2 decisions 1 and 4): the route is `finishRoute({canShare,
drive})`, per open tour (`isDriveUrl` of the archive link) - never frozen
  at wiring - so a Drive tour takes `seams.downloadZip` even on a phone that
  could share, and its button reads "Save the zip to this phone". Its ready
  line (`FINISH_LABELS.readyDrive`) warns about an older copy in Downloads
  BEFORE the tap, and its status after the save is `savedToPhone`. Once the
  zip is delivered, `replaceHelpDrive` shows `driveReplaceSteps` as numbered
  lines (textContent; the module stays DOM-free) with the zip's name, and
  `replaceHelpGeneric` hides; `resetFinishStep` restores the generic text.
  A hosted name a phone would change is saved as `downloadSafeName` and the
  steps ask for the same rename on Drive.
- **Hand-off:** `seams.shareOrDownloadZip` - the device share sheet where
  the browser can share FILES, else the framework's picker-or-anchor. The
  button's LABEL comes from `seams.canShareZip()`, read once at wire time,
  because a button reading "Download" on a phone that will open a share
  sheet names the wrong action before it is pressed. Two independent
  facts come back:
  - `delivered` reveals the replace instructions (the last thing to do,
    and only once there is a file to do it with); false - a dismissed
    picker, or a share sheet that handed nothing over - keeps the button
    live. Async-UI rule on both branches.
  - The reveal is ONE-WAY for `replaceHelp` and follows the last DELIVERED
    hand-off for `replaceHelpShare`. A creator who saved, tapped again and
    dismissed the picker keeps the step-6 instructions they earned; one who
    shared and then saved stops being told to go looking in another app.
    And the whole continuation is guarded on `ctx.openGeneration`, because
    a share sheet can stay up across a tour close - the reveal would
    otherwise land on the closed tour's panel and still be on screen when
    the next tour reached its finish (PR #440 review).
  - `route` picks the copy, and this is the half that matters: "the link
    and the printed code stay the same" is TRUE after a save over the
    hosted file and FALSE after a share, which normally creates a new file
    with a new id while the printed code still points at the old one. The
    share route therefore also reveals `#replace-help-share`, one extra
    sentence saying so. The four outcomes are pure functions
    (`finishHandoffStatus`, `finishIdleLabel`, `finishBusyLabel` in
    `qr-author-mode.ts`), tested there, because three of them cannot be
    reached in a headless browser.
    `resetFinishStep` (a hook, called when a tour closes) disables the
    button, clears the status and hides both blocks, so a re-opened tour
    never shows the previous one's dead download button.

- `seams.canShareZip()` is asked once, at wiring; the ROUTE is derived per
  open tour.
- A delivered save marks `ctx.rebuiltZip.delivered` (the U2 save guard
  stops asking) and re-renders the panel.

## Tests

Composed: `creator-finish.test.ts` (the hand-off routes, the reveal rules,
the generation guard, the delivered mark) and the e2e finish specs; the
pure labels in `qr-author-mode.test.ts`. The sampled mutant "saved file
not marked delivered" (`scripts/fixtures/creator-setup.mutants.json`) is killed.
