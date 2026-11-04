# editor-tours.js

## Purpose

What the editor's file specs share (`editor.spec.js`, on the 2D map, and
`editor-files.spec.js`, with no 3D view): the fixture tours built in the
test, the real file chooser, the browser's download read back, an
origin-private file offered by a stand-in picker, and the draft's
readiness mark. Moved out of `editor.spec.js` when its file and draft walks
moved to a spec of their own, so both specs build the same tours.

## Public API

- Tours, built in the test through the framework's serializer:
  - `editorTour({ station, farStation })` - "Editor fixture": the pin
    `pin-markup` (text `MARKUP`, a label carrying markup, "Town hall"), the
    photo `photo-ok` ("Fountain", a real 1x1 PNG) and `photo-big` ("Too
    big", a PNG whose header claims 5000 x 5000 px), each in a station of
    its own (`st-<id>`), and two codes; `station`: the story station
    `gate` at the first code, `farStation`: two more stations.
  - `wrappedTour({ pin, extra })` - "Wrapped fixture" in the wrapped shape
    (`mytour/...`): a walk recording and its frame, a code with no stored
    position; `pin`: the pin `pin-wrapped`, `extra`: `pin-elsewhere`
    ("Added elsewhere", as another program's edit would add).
  - `zip(entries)`, `geo(north, east)` (metres from `AT`), `TINY_PNG`,
    `oversizedPng()`.
- Page set-ups:
  - `answerTiles(page)` - the map's OpenStreetMap tiles answered with
    `TINY_PNG`.
  - `newEditorPage(context)` - a second `/edit.html` in the same context
    (the same origin-private file system), no open or save picker, the
    tiles answered.
  - `noSavePicker(page)` - the save picker taken away before the page
    loads, so a save is a download Playwright sees.
  - `autosaveOutOfTheWay(page)` - the dev-only autosave timings set to an
    hour.
- Files:
  - `openThroughChooser(page, buffer, name)` - the tour opened through the
    real file chooser of `#drop`.
  - `offerOpfsFile(page, buffer, name, { permission })` - the bytes written
    to the origin-private file `name`, which the page's open picker hands
    out (a real handle, so an in-place write runs for real).
  - `offerExistingOpfsFile(page, name)` - that file offered as it is now.
  - `readOpfsTour(page, name)` - an origin-private file, as a zip's texts.
  - `saveAndRead(page, run)` - the download `run` (File's Save by default)
    makes: `{ name, manifest, names }`.
  - `downloadedNames(download)` - a download's zip entry names, sorted.
- `backedUp(page)` - waits for `body[data-draft="saved"]`: every draft
  write landed (a page is closed only after it, as `page.close()` skips
  `beforeunload`).

## Invariants & assumptions

- The tours are built in the test from the framework's own
  `createEmptyTourManifest` and `serializeTourManifest`, so they follow
  the current format; no fixture file on disk is read.
- The pickers are stand-ins: `showOpenFilePicker` and `showSaveFilePicker`
  are set or deleted by the walk, never by the page.
- An editor-only helper by `e2e-plan.js`'s `pathArea`: a change to it
  runs the editor's specs.

## Examples

```js
await page.goto("/edit.html");
await openThroughChooser(page, await editorTour(), "editor-fixture.zip");
const saved = await saveAndRead(page);
```

## Tests

A test helper: exercised by `editor.spec.js` and `editor-files.spec.js`.
