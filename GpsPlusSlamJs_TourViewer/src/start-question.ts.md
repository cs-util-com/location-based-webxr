# start-question.ts

## Purpose

The setup's start question (creator setup flow, round 2, the
"conversation" variant): step 1 asks "How do you want to start?" with
four answer cards, a tap only routes, and step 2 shows that answer's
panel - a short why and one primary action. A fifth panel, `share`, is
what Done's "Make your code now" leads to for a tour started on this
phone.

## Public API

- `START_BLOCKS` - step 2's blocks: `host` (the host tiles, their steps
  and the starter, `host-picker.ts`), `linkField` (the link form and its
  notes), `codeHangs` ("Your code already hangs?"), `file` (the file
  open), `later` (the start-here action and its notes).
- `panelView(panel)` - `{ heading, why, blocks }` for step 2:
  - `new` - store the tour, then paste its link: the host recipe with the
    starter, then the link field.
  - `share` - the same blocks; the host steps start from the zip saved at
    Done and offer no starter (`host-picker.ts` reads `panel()`).
  - `link` - the link field, and "Start at the code" for a code that
    already hangs (step 5, where `scan-open.ts` opens the tour from it).
  - `file` - the file open.
  - `later` - "Save the tour file and start".
- `startOnThisPhone({ pack, save, open, tourOpen })` - packs the empty
  starter, saves it (`save` resolves whether the creator kept it), and
  only then opens that same file as the tour. Resolves `opened`,
  `already-open` (a tour is open: nothing is packed, saved or opened),
  `not-saved` (dismissed: nothing opens), `cancelled` (saved, the creator
  declined to leave the open tour), `not-opened` (saved, the open did not
  succeed) or `failed` (the pack or the save threw). Never rejects.
- `START_LABELS` - the start button's labels: idle, busy, then one per
  outcome.
- `wireStartQuestion({ dom, store, initial, openStep, hosted, onTourChange, onPanel?, start })`
  - the answer lives in the page's store (`start-question-slice.ts`,
    which also holds `START_ANSWERS` and `StartPanel`): a tap dispatches
    `startPanelShown`, and step 2 draws whatever the store holds,
    `onPanel` telling the host tiles when it changed;
  - an answer card shows its panel and opens step 2 (`link`); nothing
    else happens on that tap;
  - every "back to the question" link opens step 1;
  - "Start at the code" opens step 5 (`measure`);
  - the start button runs `startOnThisPhone`, busy and disabled while it
    runs, its outcome's label after (async-UI rule);
  - at wiring and on every change of the open tour (`onTourChange`, the
    wizard's), `makeCode` shows when the open tour has no link
    (`hosted()` false), and
    `doneStep.dataset.hosted` tells the page's CSS to hide the replace
    steps and the "uploaded?" question, which speak of a link that does
    not exist yet;
  - `makeCodeButton` shows the `share` panel and opens step 2;
  - `initial` draws a panel without opening a step (the wizard opens the
    first step: `link` for a creator with a stored host, whose panel is
    `new`).
  - Returns nothing: a reader of the answer uses `selectStartPanel`.

## Invariants & assumptions

- **A tap on an answer only routes.** Nothing is packed, saved, opened or
  stored by it (tested as a property over the answers).
- **The answer is store state, the open step is not.** Two views read the
  answer (step 2's panel and the host tiles, which offer no starter for
  `share`), so it is the store's (`start-question-slice.ts`); it is never
  saved, and a reload starts at the question again (or at `new` for a
  stored host). Which step is open stays the wizard's (`wizard.ts`).
- **An open tour is never replaced from here.** The page's open asks
  before leaving a tour only while a rebuilt file is unsaved, so pins
  placed since would be lost without a question, and each try would save
  another empty `tour.zip`; so the start button does nothing while a tour
  is open (`already-open`), a second tap after its own open included.
- **Save before open.** A dismissed save opens nothing: a tour opened from
  a file the creator did not keep would hold their work only in the page's
  backup. The save runs after a short await (packing an empty zip takes
  milliseconds), inside the tap's user activation.
- **Honest copy:** the start-here why says the saved file stays empty
  until Done; its panel says placing needs GPS (outdoors) on a new tour,
  which has no measured code; Done's "Make your code now" says GPS-placed
  pins may shift when the code is measured on a later visit, which is not
  tested.

## Examples

```ts
const start = wireStartQuestion({
  dom,
  initial: readTourHost(stepStore) === null ? null : "new",
  openStep: (step) => wizard.openStep(step),
  hosted: () => wizard.hosted(),
  onTourChange: (listener) => wizard.onTourChange(listener),
  onPanel: () => hostPicker.render(),
  start: {
    pack: () => packNewTour(),
    save: (blob, name) => seams.downloadZip(blob, name),
    open: (file) => archive.openFile(file, "measure-step"),
    tourOpen: () => ctx.session !== null,
  },
});
```

## Tests

- `start-question.test.ts` - every panel's heading, why and blocks; a
  panel dispatched from elsewhere is drawn; the
  routing as a property (a tap shows its panel, opens step 2, does nothing
  else); the back links; "Start at the code"; Done's "Make your code now"
  for a tour with and without a link, redrawn on a tour change, and its
  route to `share`; save before open, a dismissed save opening nothing,
  the failures, a declined open told from a failed one, nothing done
  while a tour is open; the start button's async labels and a second tap
  after its own open.
- `playwright-tests/setup-flow.spec.js` - the question and its routes in
  the real page; `playwright-tests/start-later.spec.js` - "Start on this
  phone now" saves `tour.zip` and opens it at step 5.
