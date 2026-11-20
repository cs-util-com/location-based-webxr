# starter-open.ts

## Purpose

"Start on this phone now, share later", the setup question's fourth answer
(`setup-path.ts`): one tap packs a new, empty tour (`packNewTour`), saves
it as a zip (the save picker where the browser has one, never the share
sheet) and opens that same zip as the tour - all before AR, because
placing needs an open tour (`creator-placement.ts`).

## Public API

- `wireStarterOpen({ button, pack, save, open, onError }): StarterOpen`
  - `pack()` - the new tour's zip;
  - `save(blob, filename)` - `seams.downloadZip`: true once delivered,
    false when the picker was cancelled;
  - `open(file)` - `archive-open.ts` `openFile`, an `OpenOutcome`;
  - `onError(message)` - the page's error channel;
  - the button's click runs `StarterOpen.run()`.
- `StarterOpen.run(): Promise<"opened" | "cancelled" | "failed" | "busy">`.
- `STARTER_OPEN_LABELS` - idle, saving, opening, opened, cancelled,
  failed, openFailed.

## Invariants & assumptions

- **Saved before opened:** the saved file is what the maker keeps; the
  open tour's work is written into a tour zip at Done. A tour without a
  file behind it is never opened here.
- Async UI feedback: the button is disabled with "Saving..." and
  "Opening..." while it runs (a second tap returns `busy`), and always
  ends enabled with the end state as its label.
- A cancelled picker is the maker's choice: no error, nothing opened.
- A failed pack or save reaches `onError` and opens nothing; a failed
  open (an outcome or a throw) says the zip WAS saved and how to open it.
- A superseded or cancelled open (a newer open took over, or the maker
  kept another tour's unsaved work) is left to that open to report; the
  button goes back to idle.

## Examples

```ts
wireStarterOpen({
  button: document.getElementById("starter-open"),
  pack: () => packNewTour(),
  save: (blob, name) => seams.downloadZip(blob, name),
  open: archive.openFile,
  onError: (message) => (errorBox.textContent = message),
});
```

## Tests

- `starter-open.test.ts` - save before open of the same zip, the labels on
  the way, a cancelled save, a failed pack or save, a failed open, a
  superseded open, the busy guard and the click.
- `playwright-tests/setup-path.spec.js` - the real page: the save through
  the download seam, the open settling, the create step opening, and a
  cancelled save opening nothing.
