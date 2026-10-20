# `edit.html` - the desktop editor (M6 E1)

## Purpose

The Tour Viewer's second page, for a computer: open the tour zip the
phone's Finish saved and see every printed code, pin and photo on a full
map, in the owner's chosen layout (variant 1, the left rail:
`public/prototypes/editor-1-left-rail/`), and fix a pin's text, move a note or
delete one, then Save a new copy (M6 E2a). Design and decisions:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
(§5, §9).

A Vite build entry (`vite.config.ts`, `edit`), so it is built and reachable
on a deployed branch preview at `/tour/edit.html`; linked from the setup
page's "You already have a tour?" box and from step 5 on a device without
AR (tour editor plan 2026-10-17-1816, W1).

## Structure

- `#map` - the full-window map (`src/editor/editor-map.ts`).
- `#debug-panel` - the debug layer's "Show debug data" switch
  (`#debug-data-input`, ticked) and its line (`#debug-status`, a live
  region), shown only for a tour whose file carries a walk
  (`src/editor/debug-capture-layer.ts`).
- `#topbar` - the tour's title (`#tour-name`, a button that opens the
  tour's details, W2) and file name, the "Keep the debug data in
  the tour file" switch (`#keep-walk`, only for a tour carrying a walk,
  unticked; hidden for a file opened for writing, which keeps its walk), `#save-status`,
  `#save-btn` (Save downloads the tour, M6 E2a), `#done-btn` ("Done",
  W2), "Open another tour".
- `#rail` - the codes, pins and photos (`src/editor/editor-rail.ts`).
- `#card`, `#offscreen-chip` - the card beside the selected marker
  (`src/editor/editor-card.ts`).
- `#open-modal` - "Open a tour": the file input inside `#drop` (a click
  opens the chooser; a drop works too), `#open-status` (the async state),
  `#open-error`, "Use the sample tour", and `#link-form` (`#link-input`,
  `#link-btn` "Open the link": a hosted tour from its link, tour editor
  plan 2026-10-17-1816 W1; a text input, so the dialog, not the browser,
  says what is wrong with a link).
- `#open-fineprint` - what Save does, written per browser by
  `edit-main.ts` (`saveFinePrint`); the markup's text is the one for a
  browser without the file picker. A span inside the fine print, beside
  its Privacy link (`legal.html#privacy`, W6).
- `#details-modal` - "Tour details" (W2 of the tour editor plan
  2026-10-17-1816): `#details-form` with `#details-name` (the format keeps
  80 characters), `#details-description` (2000), `#details-covers` (the
  cover radios `edit-main.ts` draws; `#details-covers-none` when the tour
  has no photo to choose), `#details-contact` (320), `#details-error`
  (`role="alert"`), Cancel and Apply (`src/editor/details-dialog.ts`). Above the toasts (z-index). Each
  field's `maxlength` is TWICE the format's limit (160, 4000, 640): the
  attribute counts UTF-16 units, the format code points, and a character
  outside the Basic Multilingual Plane (an emoji) is two units - a cap at
  the format's number stopped 80 emoji at 40 (the r875 milestone review
  #8). The save's check decides and says why; `src/page-contracts.test.ts`
  holds the caps. The phone's `#tour-name-input` (`index.html`) keeps 80:
  the phone writes that field's value without the format's check, so its
  cap is the only bound there until the phone adopts the details rule.
- `#done-modal` - "Done editing" (W2, D18, D19; `src/editor/done-dialog.ts`):
  `#done-where`, the host picker `#done-host` (options drawn by
  `edit-main.ts`) with `#done-update`, `#done-public`, `#done-drive-tip`
  (hidden: `DRIVE_MOUNT_TIP_SHOWN` is off until the owner's check),
  `#done-walk` (only while the file carries the walk: `#done-walk-text`,
  `#done-move` "Move the walk out", `#done-move-status`), a Privacy link
  (`legal.html#privacy`) and Close. Above the toasts (z-index).
- `#toasts` - "Opened <file>: N codes, M notes".

## Invariants

- Every text the zip supplies is set with `textContent` by the modules;
  the page holds no tour data in its markup.
- Its look is `src/editor/editor.css` (paper tokens of its own), not
  `design.css` - a `<link>` in the head, not an import of `edit-main.ts`:
  a module's CSS arrives with the module, so the page painted unstyled
  until the module had loaded (tour editor plan 2026-10-17-1816, W1). The
  map's Leaflet CSS stays an import of `editor-map.ts`: nothing of the
  map shows before the module runs anyway.
- The visitor page never imports `src/editor/` (dependency-cruiser rule
  `viewer-not-to-editor`), so a visitor never downloads the editor's
  Leaflet.

## Tests

`playwright-tests/editor-entry.spec.js` (the link form: busy until the
linked tour opened, a refused link, text that is not a link),
`playwright-tests/way-in.spec.js` (the first paint with the module held
back: the editor's paper, not the browser's plain page),
`playwright-tests/editor.spec.js` (the real file chooser, the rail and the
markers, the card beside its marker, a capped photo, a refused non-tour,
the layout at three viewports, the details dialog, the fine print, Done
and the walk's move).
