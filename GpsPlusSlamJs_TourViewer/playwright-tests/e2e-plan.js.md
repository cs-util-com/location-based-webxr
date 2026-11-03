# e2e-plan.js

## Purpose

The Tour Viewer's e2e plan: the Playwright project of every spec (`dom` or
`webgl`) and the area of the app it covers (`editor`, `viewer` or `both`),
so the e2e stage can run the DOM specs at several workers, then the WebGL
specs at one, and a local `test:changed` run can skip the specs a change
cannot reach.

## Public API

- `PROJECTS`: `["dom", "webgl"]`, in the order the runner runs them.
- `SPECS`: spec file name -> `{ project, area }`, one entry per spec file.
- `specsOf(project)`: that project's spec file names (read by
  `playwright.config.js` as `testMatch`).
- `LOCAL_DOM_WORKERS`: the `dom` project's worker count in a local run
  (the GitHub runner always uses one; `E2E_DOM_WORKERS` overrides it, see
  `scripts/e2e/project-runs.mjs`).
- `pathArea(path)`: the area a changed repo path can affect: `editor`,
  `viewer`, `spec` (a spec file), `none` (a unit test, the timings file, or
  doc markdown by `test:changed`'s own rule, `isPackageDocMarkdown` in
  `scripts/test-changed/select.mjs`: a sidecar, a README or CHANGELOG, a
  `docs/` file) or `null` (unknown or shared: everything runs). Other
  markdown keeps its folder's area (the app may read it).
- `selectSpecs(changedPaths)`: `{ all: true, reason }` when any path is
  `null` or both areas changed; else `{ all: false, areas, specs }`, the
  changed area's specs, the `both` specs and any changed spec file.
- `RESULTS_DIR`, `RESULTS_NAME`: where the config's CI JSON reporter writes,
  from the package.

## Invariants & assumptions

- **The project criterion:** `webgl` when the page under test draws a WebGL
  scene as its subject (the editor's 3D view and globe, the landing's film,
  the model, character and lectern check pages, the frame-time probe), or
  opens the editor's default 3D view; `dom` otherwise. Caveat: the creator's
  landing plays its small hero film behind several `dom` specs; their
  subject is the page, so they stay `dom`.
- **The area criterion:** `editor` opens only `edit.html`; `viewer` opens
  only other pages; `both` opens the editor and another page.
- **What `pathArea` calls editor-only:** `edit.html`, `src/editor/`,
  `src/editor3d/`, the editor kit's `src/chrome/` (its only folder today;
  a new kit folder is `null` until classified), and the editor-only spec
  helpers `editor3d-fixture.js` and
  `editor-menus.js`. **Viewer-only:** `index.html` and `src/landing/`,
  except the modules the editor imports too (`film-math.ts`, `clamp01.ts`).
  Everything else in the package (the shared `src/*.ts`, the other pages,
  `package.json`, the other helpers) and every path outside it, except the
  kit folders above, is `null`.
- **Fail safe:** a path not named is `null`, so a new folder runs every spec
  until someone classifies it. CI and the full cascade never narrow.

## Measurement (2026-11-01)

One run each, `CI=1` (so 2 retries), through the machine slot (no other
gate in the slot; other agents' non-slot work on the machine was not
controlled), at webxr r1008's tip `d477336c7`:

- one project at 1 worker (before the split): 51.4 min (3082 s), 548 passed,
  1 failed, 0 flaky, 3 skipped;
- split, `dom` at 2 workers: `dom` 13.6 min (388 passed), `webgl` 35.9 min
  (160 passed, 1 failed), 0 flaky; 49.5 min;
- split, `dom` at 3 workers: `dom` 11.7 min (388 passed), `webgl` 31.4 min
  (160 passed, 1 failed), 0 flaky; 43.1 min.

The one failure is the same in all three runs, failed on every retry
(`editor3d-globe-approach.spec.js:133`, a `role="status"` element still in
the 3D view), so it is a defect of that commit, not of the split. Flaky stayed
0 at 2 and 3 workers, so the split is kept, at 3.

**What one run each cannot tell:** the unchanged `webgl` project (1 worker
in both split runs) took 35.9 and 31.4 min, a 4.5 min spread from run-to-run
noise alone. That is more than the 1.9 min between 2 and 3 DOM workers, so 3
over 2 is not proven by these runs; it was chosen because it was not worse
and had no flaky test. The split's own gain, the DOM specs from about 18 min
at one worker (the baseline's total minus a `webgl` share of 31-36 min) to
12-14 min, is of the same order as that noise, too. More runs would settle
both.

## Off the map and the older 3D view (inventory, 2026-11-03)

The globe is the editor's 3D view; the 2D map and the older OrbitControls
view (`?globe=0`) are to be removed. What each editor spec still opens, by
what becomes of it (counts are `test(` titles; a title in a loop counts
once):

- **(a) shared with the globe editor: to be moved to it.**
  - `editor.spec.js`, about 101 of its 117 titles: save, save a copy, in
    place and a second tab (1599-2053), drafts (2117-2826), autosave and
    undo across saves (2826-3783), "needs no GPS" (3783, 3850), details
    (3886, 3955), the open dialog (310, 322, 958, 986, 1462, 3992), pin
    edits (1052-1460), Done and the walk's move out (4039-4704), tours
    without a file (4729-4959), link, sample and hosted saves
    (5165-5688). They edit through the map's rail and card (`editTownHall`,
    `editPin`); on the globe a pin's text is the inspector's title field.
  - `editor-entry.spec.js` (4) and `blocks-tour.spec.js` (2): on the map
    (`startOnMap`) only to keep the 3D view's tiles out.
  - Pinned to `?globe=0` when the globe became the default:
    `editor3d-character` (1), `editor3d-long-text` (3),
    `editor3d-narration` (2), `editor3d-inspector` (6), `editor3d-tree`
    (7), `editor3d-shell` (15; its pen test at 991 runs on the map and in
    3D), `editor3d-edit` (9), `editor3d-model` (4, `openSample` then the
    switch), `editor3d.spec.js` 186 and 251 (its failure tests at 279, 321
    and 371 run on both views).
- **(b) map-only until the globe editor has the panel:** `editor.spec.js`
  567, 590, 638, 692, 816, 865, 922 (a walk's debug data on the map and its
  panel; the globe draws no debug data yet, `editor3d-shell` 896).
- **(c) dies with the map or the older view (deleted with them, not
  before):** `editor.spec.js` 276 (the card beside its marker), 343 (the
  rail's layout per viewport), 424 and 451 (the map's top bar and menus),
  721 (the card against the debug panel), 1180 (a marker drag), 1332 (a
  station and its code both reachable on the map); `editor3d-globe.spec.js`
  302 (the OrbitControls view, nothing of the globe asked for);
  `editor3d.spec.js` 43, 170 and 211 (the switch to and from the map, and
  the map's quiet open of a tour with nothing placed), and the older-view
  half of 279, 321 and 371.
- **(d) a gap in the globe editor, listed, not built:** the rail's search
  (`#filter`, `editor.spec.js` 1963: a group's count follows a delete while
  the search hides it; the tree has no filter); the rail's list of every
  code and note by kind, labels as text (245; the tree lists stations and
  their items).

**The cost of moving (a), measured on the sample tour in the software
renderer:** a globe open takes 2.5-2.9 s to the 3D view and about 2 s more
to its stations, against 0.2 s for the map; one tree click, an inspector
rename and a Save download took 38-42 s on the globe (globe imagery
refused) and about 60 s with it served. Moved one for one, `editor.spec.js`
(the `dom` project, 3 workers) would go to the `webgl` project's single
worker at about 40 s a test: on the order of an hour more per full run.

**First batch, tried and held back (2026-11-03).** `editor3d-character`,
`editor3d-long-text` and `editor3d-narration` were moved to the globe one
for one (only the link changed, globe imagery refused). On the older view
the six tests pass in 143 s; on the globe five failed in 533 s, each for
a reason of its own, so they stay on `?globe=0` until each is understood:

- character 180: the second `page.goto` (open again) ran into the 90 s
  limit, which fits a leave-page prompt for unsaved work holding the
  navigation.
- long-text 89: the code-mark callout never offered its fix button
  (`[data-lw="part-fix"]`) after the part was picked.
- long-text 297: Ctrl+S in the writer gave no download within 90 s.
- long-text 326: the 14 px gap between the preview and the inspector
  did not settle within 5 s.
- narration 189: `#shell-inspector` was not found for its width check.

Whether these are test assumptions of the older view or gaps of the
globe editor is open; Ctrl+S and the open-again prompt would be real
gaps if they reproduce by hand.

## Examples

```js
selectSpecs(["GpsPlusSlamJs_TourViewer/src/editor3d/editor3d-scene.ts"]);
// -> { all: false, areas: ["editor"], specs: [the editor and both specs] }
selectSpecs(["GpsPlusSlamJs_TourViewer/src/main.ts"]);
// -> { all: true, reason: "GpsPlusSlamJs_TourViewer/src/main.ts" }
```

## Tests

`tests/repo-config/tour-viewer-e2e-plan.test.js`: the table equals the spec
files on disk and splits them between the projects with nothing doubled;
each spec's area agrees with what its text opens (`/edit.html`, another
page, the editor fixture); editor-fixture specs are `webgl`; no module the
plan calls editor-only is reachable by imports from a non-editor page, and
no viewer-only one from the editor (the scan follows any file kind, drops a
`?raw` or `?url` suffix, follows the kit's exports into its sources, and
fails on an import it cannot resolve); `selectSpecs` per case.
