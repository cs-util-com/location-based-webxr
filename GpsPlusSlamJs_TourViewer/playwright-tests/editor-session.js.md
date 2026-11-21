# editor-session.js

## Purpose

How the editor's file specs (`editor.spec.js`, `editor-files.spec.js`)
walk a tour with no 3D view: WebGL is refused before the page loads, so an
opened tour shows the page that says the 3D view cannot open, while the
File menu, the status line, the toasts and the draft stay in use. An edit
goes through the editor session the way a control of the page would, and
what the tour holds is read back from the manifest the page would write.

## Public API

- Object ids of the fixture tours (`editor-tours.js`): `TOWN_HALL`
  (`pin-markup`), `FOUNTAIN` (`photo-ok`), `WRAPPED_PIN`, `ADDED_ELSEWHERE`.
- `withoutWebgl(context)` - an init script for every page of the context:
  no open picker, `getContext("webgl*")` answers `null`.
- `tourShown(page)` - waits for the start dialog to close (it closes once
  the tour it opened is the editor's) and the cannot-open page to show.
- `sessionEdit(page, { act, id, args }, expected)` - one session edit
  through `window.__tourEditor.edit()`, the inspector's own commit path
  (a delete's Undo offer ended, refresh, autosave told); the outcome's kind must
  be `expected`. `editText(page, id, text)` and `remove(page, id)` are its
  two common forms.
- `deleteWithUndo(page, id)` - the page's own Delete (`deleteSelection`),
  with its "Deleted ..." toast and Undo.
- `editorManifest(page)`, `captionOf(page, id)`, `placeOf(page, id)` -
  the tour as a save would write it, an object's text or caption, and an
  object's station place and position.
- `expectCaption(page, id, caption)` - waits for the tour, then polls
  `captionOf`. `GONE` (`null`) is what `captionOf` answers for an
  object the tour does not hold, apart from `undefined` for one with no
  caption, so a check that an object is gone cannot pass on one that only
  lost its text.
- `setNoGps(page, on)` - the tour's "no GPS" choice through Tour details.

## Invariants

- Every edit and read waits for `tourShown` first: a tour opened again
  shows the old tour's page until the new one is the editor's, and the
  hook's manifest is `null` before any tour is open.
- The hook exists in the dev server only (`import.meta.env.DEV`), which is
  what the e2e runs against.

## Tests

A test helper: exercised by `editor.spec.js` and `editor-files.spec.js`.
