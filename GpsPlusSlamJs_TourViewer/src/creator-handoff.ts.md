# creator-handoff.ts

## Purpose

The rebuilt zip's hand-off after a Finish: the Finish saves the zip by
itself and the one button left saves it again, the result line, and the
"replace the hosted file" steps a save earns (the 2026-10-08 field test,
F4; owner decisions D-F4a, D-F4b). Split out of `creator-setup.ts` in the
code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`);
the automatic save is in
`GpsPlusSlamJs_Docs/docs/2026-10-08-1455-tour-recording-field-test-2-findings.md`
§8.

## Public API

- `wireCreatorHandoff({ ctx, seams, dom, render, host? }): CreatorHandoff` - wires
  the button (`dom`: `downloadButton`, `finishStatus`, `replaceHelp`,
  `replaceHelpGeneric`, `replaceHelpDrive`, `replaceDriveCopy`);
  `seams.downloadZip` is the save; `seams.copyText` (optional) is the
  Drive address button's copy, run through the framework's
  `copyWithFeedback` (follow-up F7, DEC-H3) - shown with the Drive steps when
  `driveFileAddress` reads the open link, labelled by `DRIVE_COPY_LABELS`
  (busy, then "Copied" or, failed, the address to copy by hand; hidden again
  on `reset`);
  `render` re-renders the creator panel when a delivered file changes the
  save guard. `host` (polish round M2, step 6) is the host chosen in step 1,
  read at each save: a tour that is not on Drive gets that host's own
  replace text (`tour-host.ts` `hostReplaceText`) in `replaceHelpGeneric`,
  in place of the page's paragraph about every host, which `reset` puts
  back. A Drive link keeps its own numbered steps whatever the host says
  (the link is the fact, the stored host a preference).
- `CreatorHandoff`:
  - `save(notes?)` - save the rebuilt zip to this phone. The Finish calls it
    once the zip is rebuilt, with its result sentences (the code's
    position, a walk left out, photos not placed) as `notes`; the button
    calls it without them, and the notes stay;
  - `offer(notes)` - the zip waits for the button instead: an AR session is
    still running, and a download must not start inside it (F4 milestone
    review #1, #6). The line says "Not saved" with the notes; the button is
    live;
  - `reset()` - a tour closed: the button disabled with its label, the line
    and the notes cleared, the replace steps hidden and the generic text
    back, the upload question hidden and forgotten.
- `onUploaded?` (follow-up F19) - the creator answered yes to the question
  after a delivered save; `creator-setup.ts` passes `draft.uploaded()`
  (`creator-draft.ts`), which resolves whether it was noted. Without it the
  question is never asked. `dom.uploadAsk`, `uploadAskText`, `uploadYes`,
  `uploadNo` are its box, line and answers; `UPLOAD_ASK_LABELS` its words.

## Invariants & assumptions

- **The Finish saves; the button saves again** (D-F4a, D-F4b). The owner's
  second field test ended with only the troubleshooting recording on the
  phone: the tour zip waited on a button they never saw. The save is
  always the plain one (`seams.downloadZip`), also where the phone could
  share - a share sheet needs a fresh tap, which the Finish's own save does
  not have. On a desktop (F4 milestone review #8) a Finish quick enough to
  end inside the tap's activation window opens the save picker; after it,
  the picker refuses and the framework falls back to a plain download
  (with a logged warning), which needs no tap.
- **A Drive save asks to check the name** (`savedToPhone`, F4 milestone
  review #2): the page cannot know the name the phone gave the file, and a
  repeat download's "name (1).zip" is a new file to Drive. With the save
  automatic there is no moment before it to warn; step 1 of the Drive steps
  is the check.
- **A failed save is not a failed Finish** (`saveFailed`, review #9): the
  zip is made; the line says it could not be saved and names the button.
- **The status line is the save's sentence, then the Finish's notes**, so
  the code's position line (and its large-turn warning) stays on screen
  through every save.
- **Async-UI rule:** "Saving…" and a disabled button before the await; the
  durable end state after - "Saved as …" (a Drive tour: "… in Downloads",
  and the Drive steps), or "Not saved", or the failure, each with the
  button live again ("Save the tour zip again"). A seam that throws is a
  failure on the line, never a broken Finish.
- **Delivered:** a save that delivered marks `ctx.rebuiltZip.delivered`, so
  the leave guard stops asking and Finish comes back (U2).
- **The replace steps are earned, one way:** they appear on a delivered
  save; a later save that did not go through takes nothing back - they are
  the flow's last instruction (PR #439 review #3). Only `reset` hides them.
  A Drive tour gets `driveReplaceSteps` with the hosted file's name (or the
  zip's, with a check-the-name step), in place of the generic text.
- **A tour closed under an open save:** every post-await path re-checks
  `ctx.openGeneration`, so a save that settles after a close changes
  nothing on the next tour's panel (PR #440 review); `reset` restores the
  button's label for the same reason (PR #441 review).

- **Asked once per Finish (F19, owner decision 2026-10-14).** After the
  save that DELIVERED a Finish's file - never before, never for a save that
  did not go through, never again for another save of the same file (keyed
  by the rebuilt blob) - the steps end with "Did you upload it?". Yes:
  "Noting it…" with both answers off, then "Noted…" or, when the draft
  could not note it, a line saying a note deleted on a computer may be
  offered back and can be declined; the answers go, the line stays. Not
  yet: the question goes, the draft stays as it is (as does no answer). The
  next Finish's file asks again; a tour close hides it.

## Examples

```ts
const handoff = wireCreatorHandoff({ ctx, seams, dom, render });
// At the end of a Finish, the zip rebuilt and on the page:
handoff.save(notes);
```

## Tests

- `creator-finish.test.ts` "the save cannot be forgotten": the Finish saves
  once by itself under the hosted name; a save that did not go through says
  so, keeps the leave question, and the button saves again; a later failed
  save keeps the replace steps; a save that throws reports it.
- `creator-handoff.test.ts` "the Drive address button": shown with the Drive
  steps, the copied address, both async outcomes, hidden off Drive and after
  a close.
- `creator-handoff.test.ts` "the replace steps follow the chosen host": the
  host's own text after a save, the paragraph with no host, and its return
  on a tour close.
- `creator-handoff.test.ts` "the question after a download-only Finish":
  hidden until a delivered save, asked once, the yes's progress and both
  outcomes, Not yet, the same file saved again, the next Finish, a close.
  The composed walk (a yes, then a desktop delete honoured; no yes, the pin
  offered back) is in `authoring-settle.test.ts` (F19).
- `qr-author-mode.test.ts` "the finish saves the tour zip by itself" and the
  Drive steps: the copy.
- `playwright-tests/ar-mode.spec.js`: the Finish's own save in a browser,
  the button's save again, the Drive tour's name and steps, and the
  upload question answered yes (F19).
