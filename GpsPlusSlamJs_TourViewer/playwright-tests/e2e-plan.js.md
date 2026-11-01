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
