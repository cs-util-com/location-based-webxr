# start-checklist.ts

## Purpose

Step 5's "Before you start" list, right above "Start creating" (creator
entry prototype, variant B, built into the real page on its own branch):
what keeps placed work safe, said only from what the page really knows.
And the sentence a start with no tour open is refused with.

## Public API

- `startChecklistView({ tourOpen, backupKept }): StartChecklistView` -
  three rows, pure:
  - `tour`: `done` while a tour is open, else `todo` with `linkShown`
    (the link to step 2), worded as what to do ("Open your tour on this
    phone") so an empty box never sits beside a claim. Its text claims the backup ("so everything you
    place is backed up here") only while `backupKept`.
  - `code`: always `reminder`, never checked - the page cannot see the
    hung code.
  - `no-backup`: `warning`, `shown` only when `backupKept` is false.
- `renderStartChecklist(dom, view)` - writes each row's `data-state`, its
  spoken state word ("Done:", "Not yet:", "Reminder:", "Warning:", in a
  visually hidden span, since the mark is CSS) and its text; hides the
  link and the warning row as the view says. Writes text only on change.
- `NO_TOUR_START_MESSAGE` - the refusal's sentence, shown in
  `#setup-status` by `creator-measuring.ts`'s `start()`.
- Exported types: `StartChecklistView`, `StartChecklistDom`,
  `StartChecklistInput`. The row types (`StartCheckRow`, `StartCheckState`,
  `StartCheckId`, `StartCheckRowDom`) stay module-private: nothing outside
  reads them by name.

## Invariants & assumptions

- **No state of its own.** `tourOpen` is `ctx.session !== null`;
  `backupKept` is `CreatorDraft.persists()`, which turns false only once
  the draft store failed for real (no OPFS, a refused directory, a failed
  write), never on a guess. Before any tour opened it reads true, so the
  warning row cannot show before the store was tried.
- At most one row is ever checked (the tour row), and never while no tour
  is open (`start-checklist.property.test.ts`).
- The list lives in `#ar-root` before `#enter-ar`; the page's CSS hides
  it during a session (`data-ar-active="true"`) and on a device without
  AR, with the button.

## Examples

```ts
renderStartChecklist(
  dom.startChecklist,
  startChecklistView({
    tourOpen: ctx.session !== null,
    backupKept: draft.persists(),
  }),
);
```

## Tests

- `start-checklist.test.ts`: each state of the rows, the render's
  attributes, spoken words and hidden parts, the refusal's wording.
- `start-checklist.property.test.ts`: for every input, the list claims
  only what the page knows.
- `creator-setup.test.ts` ("Start creating with no tour open"): the
  refusal through the composed setup, and its drop once a tour opens.
- `playwright-tests/ar-mode.spec.js`: the refusal in the real page, the
  reveal of step 2, the checked row after the open, the list hidden in AR,
  and the row's link landing on the link field.
