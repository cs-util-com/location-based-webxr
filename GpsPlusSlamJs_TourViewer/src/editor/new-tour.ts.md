# `new-tour.ts` - starting a new, empty tour in the editor

## Purpose

Makes a new, empty tour as a file and opens it in the desktop editor the
way a chosen tour opens, so the rest of the editor (draft, save, globe)
needs nothing new. Its zip comes from the start page's packer
(`../starter-tour.ts`).

## Public API

- `NEW_TOUR_FILE_NAME` - `"new-tour.zip"`, the name the save dialog
  suggests.
- `newTourFile({ mint? }) -> Promise<File>` - a new tour's zip with a
  freshly minted `tourId` (throws as `newTourManifest` does for a bad id).
- `startNewTour(deps) -> Promise<boolean>` - asks where to save
  (`deps.askSaveFile`, synchronously), then makes the file, opens it
  (`deps.open`) and keeps it in the chosen file (`deps.keepInChosenFile`).
  A pick the tour never reaches goes to `deps.settleUnusedPick`; a failure
  is said through `deps.failed`. Resolves true when the tour opened; never
  rejects.

## Invariants

- **The save dialog is asked first, before any await**, as for the sample
  tour: a browser opens it only close to a click. So `startNewTour` must
  be called in the click handler itself.
- **Every new tour has its own draft**: the minted id is its file key, so
  a second new tour is never offered the first one's edits.
- No UI of its own: which button or card starts a new tour is the entry
  UI's choice, wired in `edit-main.ts`.

## Examples

```ts
button.addEventListener("click", () => {
  void startNewTour({
    askSaveFile: askOpenSaveFile,
    open: openFile,
    keepInChosenFile: (file, pick) => void keepInChosenFile(editor, file, pick),
    settleUnusedPick,
    failed: (reason) => toast(reason),
  });
});
```

## Tests

- `new-tour.test.ts` - distinct keys and draft keys for two new tours, the
  same-id control, the file opens as a tour, the id rule, a property over
  valid ids, and the order (ask before await, keep or settle after).
