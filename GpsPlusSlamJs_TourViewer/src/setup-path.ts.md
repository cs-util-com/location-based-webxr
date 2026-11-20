# setup-path.ts

## Purpose

The creator's setup path. Step 1 asks ONE question and only routes; each of
its four answers leads to a short checklist of wizard steps, shown as step
2 with the current item active (`setup-stage.ts`). The answer is page state
in the store (the `setupPath` slice) and kept on the device, so a reload
resumes the same path.

## Public API

- `SETUP_ANSWERS` / `type SetupAnswer` - `share-now` (new tour, shared
  now), `have-link`, `file-here` (the zip is on this phone), `start-here`
  (start on this phone, share later).
- `SETUP_PATHS[answer]` - the checklist:
  - `share-now`: host, link, print, hang, measure, done;
  - `have-link`: link, print, hang, measure, done;
  - `file-here`: file, measure, done;
  - `start-here`: starter, measure, done.
- `firstStepOf(answer, hostChosen)` - the path's first step; share-now
  starts at its link when a host is already stored (`tour-host.ts`).
- `stepAfterTourOpens(answer | null)` - where a freshly opened tour lands:
  `measure` on the file paths (no link, so nothing to print first),
  `print` otherwise (a step remembered for the tour still wins,
  `wizard.presentTour`).
- `answerForOpenedTour(answer | null, "link" | "file")` - the chosen
  answer, else the one implied by how the tour opened (a launch link, a
  remembered link, the "already have a tour" section), so an open tour
  never sits under the question.
- `parseSetupAnswer(raw)`, `SETUP_ANSWER_KEY` (`tour-viewer.setup.path`),
  `readSetupAnswer(store?)`, `writeSetupAnswer(store?, answer | null)` -
  the device copy; null is written as `""`.
- The slice: `setupPathReducer`, `setupAnswered(answer | null)`,
  `selectSetupAnswer(state)`.

## Invariants & assumptions

- Every path holds wizard steps, each once, and ends in `measure`, `done`
  (a property test).
- Anything stored other than the four answers reads as no answer.
- Storage access is guarded: a blocked or missing store reads null, and a
  refused write leaves the answer in the page's store for the visit.
- No DOM; the wiring is in `main.ts` (what a tap does) and
  `setup-stage.ts` (what shows).

## Examples

```ts
const answer = readSetupAnswer(localStorage); // e.g. "start-here"
wizard.openStep(firstStepOf(answer ?? "share-now", hostChosen));
```

## Tests

- `setup-path.test.ts` - each path, the property over every answer, the
  first step with and without a stored host, the step after an open, the
  inferred answer, the parser (property), the storage round-trip and a
  throwing store, and the slice.
- `playwright-tests/setup-path.spec.js` - the question and each path in a
  browser, the answer surviving a reload.
