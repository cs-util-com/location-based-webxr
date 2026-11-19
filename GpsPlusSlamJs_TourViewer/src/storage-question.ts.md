# storage-question.ts

## Purpose

Step 1's opening question on the creator page: "Before you make anything,
your tour needs its file in your storage. Is it there already?". The file
comes first for two reasons the page now says before any choice: its link
goes into the printed code, and only an open tour keeps a copy of what is
placed on this phone. Each answer leads to its one way in:

- "No, this is a new tour" reveals the host tiles (`host-picker.ts`) with
  those reasons;
- "Yes, I have its link" moves on to step 2 (the link);
- "Yes, the zip is on this phone" opens the device's file picker
  (`#open-file`, `archive-open.ts`) and reveals the line holding that
  button.

## Public API

- `STORAGE_ANSWERS` - `["newTour", "link", "zip"]`, the page's order.
- `wireStorageQuestion({ dom, onLink, onZip })`
  - `dom.answers` - one toggle button per answer; `aria-pressed` marks the
    given one, `"false"` on all before any answer.
  - `dom.panels.newTour` - the host tiles and the reasons; shown for a new
    tour only.
  - `dom.panels.zip` - the "Open it from this device" line; shown for a zip
    only, so the open's in-progress label and its retry stay in view.
  - `onLink()` - called on the link answer (main: open step 2, focus the
    field).
  - `onZip()` - called inside the zip answer's tap (main: click
    `#open-file`), so the picker keeps the tap's user activation.

## Invariants & assumptions

- One answer at a time: at most one panel shows, and only the last answer
  reads pressed (the property test pins it for any sequence of taps).
- The answer is passing UI state, read by nothing else and never stored:
  what matters lives in the step it leads to (the chosen host in
  `tour-host.ts`, the link, the open tour). It is a closure, not store
  state, for that reason.
- The DOM surface is structural, so the tests run in node with plain
  objects; the answer buttons wear `host-tile`'s pressed look
  (`index.html`).

## Examples

```ts
wireStorageQuestion({
  dom: {
    answers: { newTour, link, zip },
    panels: { newTour: newTourPanel, zip: zipLine },
  },
  onLink: () => wizard.openStep("link"),
  onZip: () => openFileButton.click(),
});
```

## Tests

- `storage-question.test.ts` - each answer's effect, and a fast-check
  property over any sequence of answers.
- `playwright-tests/setup-flow.spec.js` (a first visit: the tiles show only
  after the new-tour answer), `open-file.spec.js` (the zip answer opens the
  picker), `ar-mode.spec.js` (the starter zip behind the new-tour answer).
