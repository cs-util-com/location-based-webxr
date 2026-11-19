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
- **The caller has passed the unsaved-work guard**: a new tour replaces the
  open one, so its edits are lost unless the user said so, as File's
  Open… asks before the open dialog shows (`openAnotherTour` in
  `edit-main.ts`). A button inside that dialog has passed it; one
  anywhere else asks first.
- No UI of its own: which button or card starts a new tour is the entry
  UI's choice, wired in `edit-main.ts`.

## Examples

```ts
button.addEventListener("click", () => {
  // The unsaved-work guard first, as File's Open… asks it.
  if (unsavedWork() && !confirm("Your changes are not saved yet. ...")) return;
  void startNewTour({
    askSaveFile: askOpenSaveFile,
    open: openFile,
    // Kept only while a tour is open: an open that failed has no editor.
    keepInChosenFile: (file, pick) => {
      if (editor !== null && pick !== null) {
        void keepInChosenFile(editor, file, pick);
      } else {
        settleUnusedPick(pick);
      }
    },
    settleUnusedPick,
    failed: (reason) => toast(reason),
  });
});
```

## Tests

- `new-tour.test.ts` - distinct keys and draft keys for two new tours, the
  same-id control, the file opens as a tour, the id rule, a property over
  valid ids, and the order (ask before await, keep or settle after).
