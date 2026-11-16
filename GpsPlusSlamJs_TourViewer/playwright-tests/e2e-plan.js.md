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
- `LANES`: `["dom-1", "dom-2", "webgl-1", ..., "webgl-4"]`, the CI jobs the
  browser specs are split into (`E2E_LANE`, `.github/workflows/ci.yml`).
- `specsOfLane(lane)`: the specs of the lane's project (`dom-N`: `dom`,
  `webgl-N`: `webgl`) whose entry has `lane: N`. Throws `RangeError` on
  any name `LANES` does not hold (`dom` alone included).
- Every entry of `SPECS` carries `lane`: 1-2 for a `dom` spec, 1-4 for a
  `webgl` spec.
- **The lanes in the per-PR tier** (`E2E_TIER=pr`, the default; see
  [`scripts/e2e/tier.mjs`](../../scripts/e2e/tier.mjs.md)): the same six
  jobs, each running the `@pr` tests of its own specs plus any spec file
  the pull request changed, whole. A tagged 3D test runs in its spec's lane;
  nothing is moved for the tier. A lane job that selects no test fails, so
  `tests/repo-config/e2e-pr-tier.test.js` requires a tagged test in every
  lane: when a lane's last tag goes, tag another of its tests or move a
  tagged spec into it. In the full set (`E2E_TIER=full`) the lanes run
  every test, as balanced above.

## Invariants & assumptions

- **The project criterion:** `webgl` when the page under test draws a WebGL
  scene as its subject (the editor's 3D view and globe, the landing's film,
  the model, character and lectern check pages, the frame-time probe), or
  opens the editor's default 3D view; `dom` otherwise. Caveat: the creator's
  landing plays its small hero film behind several `dom` specs; their
  subject is the page, so they stay `dom`.
- **The area criterion:** `editor` opens only the editor's pages
  (`EDITOR_PAGES`: `edit.html` and `asset-optimizer-check.html`, the check
  page that runs the editor's own optimizers); `viewer` opens only other
  pages; `both` opens an editor page and another page.
- **What `pathArea` calls editor-only:** the editor's pages, `src/editor/`,
  `src/editor3d/`, the editor kit's `src/chrome/` (its only folder today;
  a new kit folder is `null` until classified), and the editor-only spec
  helpers `editor3d-fixture.js`, `editor-menus.js` and `editor-tours.js`. **Viewer-only:** `index.html` and `src/landing/`,
  except the modules the editor imports too (`film-math.ts`, `clamp01.ts`).
  Everything else in the package (the shared `src/*.ts`, the other pages,
  `package.json`, the other helpers) and every path outside it, except the
  kit folders above, is `null`.
- **Fail safe:** a path not named is `null`, so a new folder runs every spec
  until someone classifies it. CI and the full cascade never narrow.
- **Lanes (CI only):** every spec has exactly one lane, so a new
  spec fails `tests/repo-config/tour-viewer-e2e-plan.test.js` until it gets
  one. The first split (2026-11-05) was balanced by hand from the per-spec
  durations of CI runs 41761594716 and 41820703091 (one worker, about 22-30
  min a lane); rebalance it from the uploaded `playwright-report-tour-*`
  reports once they exist. The globe clouds spec (about 8-10 min an
  attempt) went to lane 1 and the globe buildings spec (about 5 min) to
  lane 3 by the estimates of the 2026-11-04 e2e cost audit, so lane 1 is
  the longest (about 35 min, up to about 55 with the clouds test retried).
- **Rebalanced 2026-11-05** after a second round of test cuts, from
  the per-spec seconds of one local full run (`E2E_TIER=full`, `dom` at 3
  workers, `webgl` at 1): the `dom` project (1,766 s of test time, one
  worker on CI, so about 28 min in one job) split in two of about 880 s
  each: lane 1 `ar-mode` (442 s), `editor` (295 s), `editor-files` (96
  s) and five short specs; lane 2 the rest. The 3D lanes (2,031 s of test
  time, the globe spec cut short by a red test, so about 2,120 s) at about
  490-570 s each: `editor3d-globe-start` (83 s) from lane 2 and
  `editor3d-globe-buildings` (38 s in that run; its test waits for the
  relief again since, so that figure is low) from lane 3 moved to lane 1,
  the lightest by those seconds, for its clouds spec's CI retries. Local
  seconds are not CI minutes; rebalance from the uploaded reports.

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
- **(c) dies with the map or the older view (DELETED on 2026-11-05 by a
  second round of test cuts, before the map itself goes: since the
  globe opens by default no creator reaches them; the list below is kept
  as the record of what went, with its old line numbers):** `editor.spec.js` 276 (the card beside its marker), 343 (the
  rail's layout per viewport), 424 and 451 (the map's top bar and menus),
  721 (the card against the debug panel), 1180 (a marker drag), 1332 (a
  station and its code both reachable on the map); `editor3d-globe.spec.js`
  302 (the OrbitControls view, nothing of the globe asked for);
  `editor3d.spec.js` 43, 170 and 211 (the switch to and from the map, and
  the map's quiet open of a tour with nothing placed), and the older-view
  half of 279, 321 and 371.
- **(d) a gap in the globe editor, listed, not built:** the rail's search
  (`#filter`, `editor.spec.js` 1963: a group's count follows a delete while
  the search hides it; the tree has no filter; that test was deleted with
  class (c)); the rail's list of every
  code and note by kind, labels as text (245; the tree lists stations and
  their items).

**The cost of moving (a), measured on the sample tour in the software
renderer:** a globe open takes 2.5-2.9 s to the 3D view and about 2 s more
to its stations, against 0.2 s for the map; one tree click, an inspector
rename and a Save download took 38-42 s on the globe (globe imagery
refused) and about 60 s with it served. Moved one for one, `editor.spec.js`
(the `dom` project, 3 workers) would go to the `webgl` project's single
worker at about 40 s a test: on the order of an hour more per full run.

**First batch, moved to the globe (2026-11-03).** `editor3d-character`,
`editor3d-long-text` and `editor3d-narration` (six tests) run on the globe
with `noApproach`. A first try without it failed five of the six (533 s
against 143 s on the older view). Each failure was the harness, not the
editor:

- Without `noApproach`, every open first played the approach flight in the
  software renderer, and the 90 s of `test.slow()` did not cover it: this
  explains character 180, long-text 89 and 297, and narration 189.
- With `noApproach` and a budget sized from the measured runs, all six
  pass. Measured with CI=1 and one worker: character 2.2 min, long-text
  2.7, 1.5 and 3.6 min, narration 1.2 and 2.0 min. Each spec's budget is
  about twice its slowest test, and a comment states the measurement.
- long-text 326 (the three sizes): one bounding-box read took longer
  than the 5 s default poll under the globe's slow frames. Both of its
  polls now wait 30 s; the gap they assert (14 px) is unchanged.

**Second batch, the draft walks without a 3D view (2026-11-03).** A spike
on six draft tests compared two ways to run them:

- on the globe: 12.5 min, and two failed on the "Saving…" status under
  slow frames;
- with no 3D view: 33.1 s (2.4-4.1 s a test), all passing. WebGL is
  refused and the open shows the cannot-open page.

The draft walks only need the file round trip, so the second way was
chosen: the 15 draft tests (from `editor.spec.js`) are now in
`editor-files.spec.js` (the `dom` project). Each edit is one session
call through the test hook, read back from the manifest, with no map rail
or card. Their shared tour builders and file helpers are in
`editor-tours.js`.

**Still in class (a):** `editor.spec.js` has 104 titles, about 86 of them
class (a). The autosave and undo walks are next, though some of them press
the map's card or its delete control and cannot be expressed through the
hook. Also still in (a): `editor-entry` (4), `blocks-tour` (2) and the
`?globe=0` specs other than the first batch (`editor3d-inspector`,
`-tree`, `-shell`, `-edit`, `-model`, `editor3d.spec.js` 186 and 251).
Classes (b), (c) and (d) are unchanged.

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
