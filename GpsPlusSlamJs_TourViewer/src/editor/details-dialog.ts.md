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
  - `deps.apply(form, needsNoGps?)` - the session's edit
    (`setDetails`); with `noGps` given, the box as it reads goes with the
    form, so one Apply is one edit and one undo step. Returns a
    `DetailsOutcome`.
  - `deps.onApplied(kind)` - after Apply closed the dialog: `"changed"` or
    `"unchanged"` (the page refreshes, says it in a toast, tells autosave).
  - `deps.onClose()` - the dialog closed either way (the page gives focus
    back to the name).
  - `deps.noGps?` - `DetailsNoGps`, the tour's "needs no GPS" setting in
    the dialog (the 3D view has no rail): `input` (the box), `current()`
    (the session's setting), `preview(on)` (the warnings for `on`,
    writing nothing); Apply hands the box to `deps.apply`.
  - `open()`, `close()` (Cancel, Esc), `isOpen()`.
- `DetailsForm` (`../tour-details-form.ts`) - `{ name, description, cover: string | null, contact }`;
  an empty text is "none". Shared with `editor-session.ts`.
- `DetailsOutcome` - `{ kind: "changed" | "unchanged" }` or
  `{ kind: "refused", reason }`.

## Invariants & assumptions

- The typed name, description and contact are handed on in NFC
  (`inputText`, B2a review 6).
- A refusal keeps the dialog open, with what was typed and the session's
  reason in the error line (`role="alert"`): nothing typed is lost to a
  refusal.
- Apply ends in a final state either way (the async-UI rule): closed with
  a toast for a change or no change, or open with the reason.
- Close is idempotent: `onClose` runs once per open.
- A submit while closed does nothing (a stale Enter cannot apply).
- The error line is cleared on every open and close.
- "Needs no GPS" is part of the form: open shows the setting as it stands
  and previews its warnings, a change of the box previews only, Apply
  writes it after the details (a refusal writes neither) and reports
  "changed" when either changed; Cancel writes nothing, and the next open
  shows the setting again, not the abandoned tick.

## Examples

```ts
const details = wireDetailsDialog({
  dom,
  current: () => editor.details(),
  showCovers,
  chosenCover,
  apply: (form, needsNoGps) => editor.setDetails(form, needsNoGps),
  onApplied: (kind) => toast(kind === "changed" ? "Changed" : "As it was"),
  onClose: () => tourName.focus(),
});
tourName.addEventListener("click", () => details.open());
```

## Tests

- `details-dialog.test.ts` - opens with the values, Apply hands the whole
  form and closes (changed and unchanged), a refusal stays open with the
  reason, the error clears on reopen, Cancel applies nothing, a submit
  while closed does nothing; "needs no GPS" shown on open, previewed on
  change, written by Apply alone, never by Cancel or a refused Apply.
- `playwright-tests/editor.spec.js` - the dialog in the page: the details
  saved into `tour.json` (minor 3), an emptied name removing the title, a
  refused contact, Esc and focus.
- `playwright-tests/editor3d-globe-default.spec.js` - "needs no GPS" set
  in the 3D view's dialog, saved, opened again and cleared.
