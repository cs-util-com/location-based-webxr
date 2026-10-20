# editor/details-dialog.ts

## Purpose

The desktop editor's "Tour details" dialog (tour editor plan
2026-10-17-1816, W2): the tour's name, description, cover and contact,
opened from the tour's name in the top bar (`edit.html` `#tour-name`). It
edits nothing itself: Apply hands the whole form to the editor session
(`EditorSession.setDetails`), which checks it by the format's rules
(`gps-plus-slam-app-framework/ar/tour-details`) and makes each changed field
a pending change, saved by Save or autosave like any other edit.

## Public API

- `wireDetailsDialog(deps): DetailsDialog`
  - `deps.dom` - `DetailsDialogDom`: the backdrop (shown/hidden), the form
    (its `submit` is Apply), the name, description and contact fields, the
    error line, and the Cancel button. Structural, so the tests run in node.
  - `deps.current()` - the details as they stand now (`DetailsForm`).
  - `deps.showCovers(selected)` / `deps.chosenCover()` - the page's cover
    picker (radios with thumbnails, `edit-main.ts`), drawn on open and read
    on Apply; `null` is "no cover".
  - `deps.apply(form)` - the session's edit; returns a `DetailsOutcome`.
  - `deps.onApplied(kind)` - after Apply closed the dialog: `"changed"` or
    `"unchanged"` (the page refreshes, says it in a toast, tells autosave).
  - `deps.onClose()` - the dialog closed either way (the page gives focus
    back to the name).
  - `open()`, `close()` (Cancel, Esc), `isOpen()`.
- `DetailsForm` (`../tour-details-form.ts`) - `{ name, description, cover: string | null, contact }`;
  an empty text is "none". Shared with `editor-session.ts`.
- `DetailsOutcome` - `{ kind: "changed" | "unchanged" }` or
  `{ kind: "refused", reason }`.

## Invariants & assumptions

- A refusal keeps the dialog open, with what was typed and the session's
  reason in the error line (`role="alert"`): nothing typed is lost to a
  refusal.
- Apply ends in a final state either way (the async-UI rule): closed with
  a toast for a change or no change, or open with the reason.
- Close is idempotent: `onClose` runs once per open.
- A submit while closed does nothing (a stale Enter cannot apply).
- The error line is cleared on every open and close.

## Examples

```ts
const details = wireDetailsDialog({
  dom,
  current: () => editor.details(),
  showCovers,
  chosenCover,
  apply: (form) => editor.setDetails(form),
  onApplied: (kind) => toast(kind === "changed" ? "Changed" : "As it was"),
  onClose: () => tourName.focus(),
});
tourName.addEventListener("click", () => details.open());
```

## Tests

- `details-dialog.test.ts` - opens with the values, Apply hands the whole
  form and closes (changed and unchanged), a refusal stays open with the
  reason, the error clears on reopen, Cancel applies nothing, a submit
  while closed does nothing.
- `playwright-tests/editor.spec.js` - the dialog in the page: the details
  saved into `tour.json` (minor 3), an emptied name removing the title, a
  refused contact, Esc and focus.
