// @ts-check
/**
 * The Tour Viewer's e2e plan: which Playwright project each spec runs in, and
 * which area of the app it covers, so a run can skip the specs a change
 * cannot reach. Read by `playwright.config.js` (the projects) and by
 * `scripts/e2e/run-projects.mjs` (the sequential runs and the area
 * selection). Every spec is listed once, here; a repo-config test holds the
 * table to the spec files on disk.
 */

import { isPackageDocMarkdown } from "../../scripts/test-changed/select.mjs";

/** The Playwright projects, in the order the runner runs them. */
export const PROJECTS = /** @type {const} */ (["dom", "webgl"]);

/**
 * Every spec: its project and its area.
 *
 * - project `webgl`: the page under test draws a WebGL scene as its subject,
 *   or opens the editor's default 3D view. These run at one worker, after the
 *   DOM specs, so two software-rendered scenes never share the CPU. The
 *   creator's landing also plays its small hero film behind several `dom`
 *   specs; their subject is the page, and they stay `dom`.
 * - area `editor`: only the desktop editor (`edit.html`); `viewer`: only the
 *   other pages (the visitor's and the phone creator's page, the check
 *   pages); `both`: the spec opens the editor and another page.
 * - lane (1 or 2 for a dom spec, 1 to 4 for a webgl spec): the CI job that
 *   runs the spec (see `LANES`). Balanced by the per-spec seconds of a local
 *   full run of 2026-11-05 (see the sidecar), each dom lane about half of the
 *   dom project and each webgl lane about a quarter of the 3D specs, lane 1
 *   lighter for its clouds spec's CI retries; rebalance from the uploaded
 *   JSON report's per-test durations.
 *
 * @type {Readonly<Record<string, { project: "dom" | "webgl", area: "editor" | "viewer" | "both", lane: 1 | 2 | 3 | 4 }>>}
 */
export const SPECS = {
  "ar-layout.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "ar-mode.spec.js": { project: "dom", area: "viewer", lane: 1 },
  "blocks-tour.spec.js": { project: "webgl", area: "both", lane: 4 },
  "character-maker.spec.js": { project: "dom", area: "viewer", lane: 1 },
  "character-views.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "code-auto-move.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "creator-indoor.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "creator-stations.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "editor-characters.spec.js": { project: "dom", area: "both", lane: 1 },
  "editor-entry.spec.js": { project: "dom", area: "editor", lane: 1 },
  "editor-files.spec.js": { project: "dom", area: "editor", lane: 1 },
  "editor.spec.js": { project: "dom", area: "editor", lane: 1 },
  "editor3d-add-palette.spec.js": { project: "webgl", area: "editor", lane: 2 },
  "editor3d-character.spec.js": { project: "webgl", area: "editor", lane: 4 },
  "editor3d-characters.spec.js": {
    project: "webgl",
    area: "both",
    lane: 2,
  },
  "editor3d-child-moves.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 3,
  },
  "editor3d-docking.spec.js": { project: "webgl", area: "editor", lane: 1 },
  "editor3d-edit.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-folders.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-globe-approach.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 1,
  },
  "editor3d-globe-buildings.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 1,
  },
  "editor3d-globe-clouds.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 1,
  },
  "editor3d-globe-default.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 2,
  },
  "editor3d-globe-osm-hold.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 2,
  },
  "editor3d-globe-start.spec.js": { project: "webgl", area: "editor", lane: 1 },
  "editor3d-globe.spec.js": { project: "webgl", area: "editor", lane: 1 },
  "editor3d-inspector.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-long-text.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-model.spec.js": { project: "webgl", area: "editor", lane: 4 },
  "editor3d-narration.spec.js": { project: "webgl", area: "editor", lane: 4 },
  "editor3d-phone.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-pictures.spec.js": { project: "webgl", area: "both", lane: 4 },
  "editor3d-shelf.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "editor3d-shell.spec.js": { project: "webgl", area: "editor", lane: 2 },
  "editor3d-station-ring.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 3,
  },
  "editor3d-tree.spec.js": { project: "webgl", area: "editor", lane: 2 },
  "editor3d-world-marks.spec.js": {
    project: "webgl",
    area: "editor",
    lane: 2,
  },
  "editor3d.spec.js": { project: "webgl", area: "editor", lane: 3 },
  "file-access-check.spec.js": { project: "dom", area: "viewer", lane: 1 },
  "item-lab.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "landing-film.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "landing.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "launch-and-errors.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "lectern-check.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "legal.spec.js": { project: "webgl", area: "both", lane: 4 },
  "long-text-check.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "model-views.spec.js": { project: "webgl", area: "viewer", lane: 4 },
  "narration-check.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "object-editing.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "older-format.spec.js": { project: "webgl", area: "both", lane: 4 },
  "open-file.spec.js": { project: "dom", area: "viewer", lane: 1 },
  "sample-tour.spec.js": { project: "dom", area: "viewer", lane: 1 },
  "setup-flow.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "stations.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "story-blocks-frame-time.spec.js": {
    project: "webgl",
    area: "viewer",
    lane: 4,
  },
  "story-blocks.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "story-picker.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "streaming.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "summary.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "view-switch.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "visitor-start.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "visitor-walk-layout.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "visitor-walk-radar.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "visitor-walk.spec.js": { project: "dom", area: "viewer", lane: 2 },
  "way-in.spec.js": { project: "dom", area: "both", lane: 1 },
};

/**
 * The spec file names of one project, in table order.
 *
 * @param {"dom" | "webgl"} project
 * @returns {string[]}
 */
export function specsOf(project) {
  return Object.keys(SPECS).filter((name) => SPECS[name].project === project);
}

/**
 * The CI lanes, one GitHub job each, chosen by the `E2E_LANE` environment
 * variable (`scripts/e2e/project-runs.mjs`, `laneSpecs`): `dom-N` the DOM
 * specs whose `lane` is N, `webgl-N` the WebGL specs whose `lane` is N
 * (the DOM project runs at one worker on CI, so two jobs halve its wall
 * clock). Not Playwright's
 * `--shard`, which cuts the alphabetical list and would put every
 * `editor3d-globe-*` spec in one shard.
 */
export const LANES = /** @type {const} */ ([
  "dom-1",
  "dom-2",
  "webgl-1",
  "webgl-2",
  "webgl-3",
  "webgl-4",
]);

/**
 * The spec file names of one CI lane, in table order.
 *
 * @param {string} lane - one of `LANES`
 * @returns {string[]}
 * @throws {RangeError} on a lane `LANES` does not name
 */
export function specsOfLane(lane) {
  if (!(/** @type {readonly string[]} */ (LANES).includes(lane))) {
    throw new RangeError(
      `unknown e2e lane "${lane}"; known: ${LANES.join(", ")}`,
    );
  }
  const [project, n] = lane.split("-");
  return specsOf(/** @type {"dom" | "webgl"} */ (project)).filter(
    (name) => SPECS[name].lane === Number(n),
  );
}

/**
 * The DOM project's workers in a local run. The WebGL project always runs at
 * one. Chosen from the 2026-11-01 measurement (see the sidecar): 3 was not
 * slower than 2 and had no flaky test; one run each cannot rank them.
 */
export const LOCAL_DOM_WORKERS = 3;

/** This package's folder in the repo, the prefix of its changed paths. */
const PKG = "GpsPlusSlamJs_TourViewer/";

/** The editor kit's sources, which the editor imports and the viewer does not. */
const KIT = "GpsPlusSlamJs_EditorKit/src/";

/** The specs' folder inside the package. */
const SPECS_DIR = "playwright-tests/";

/** Package paths only the editor reaches (a file, or a folder's contents). */
const EDITOR_ONLY = ["edit.html", "src/editor", "src/editor3d"];

/**
 * Shared modules under an area's folder: the editor imports them too
 * (`src/editor3d/approach-arrival.ts` -> `film-math.ts` -> `clamp01.ts`).
 * The repo-config test finds any other by following the editor's imports.
 */
const SHARED_IN_VIEWER_FOLDERS = new Set([
  `${PKG}src/landing/film-math.ts`,
  `${PKG}src/landing/clamp01.ts`,
]);

/**
 * Spec helpers that only one area's specs (or `both` specs) import.
 * @type {Readonly<Record<string, "editor">>}
 */
const AREA_HELPERS = {
  [`${PKG}playwright-tests/editor3d-fixture.js`]: "editor",
  [`${PKG}playwright-tests/editor-menus.js`]: "editor",
  [`${PKG}playwright-tests/editor-tours.js`]: "editor",
};

/**
 * The area a changed repo path can affect.
 *
 * - `"editor"` / `"viewer"`: only that area's pages;
 * - `"spec"`: a spec file, which runs itself (see `selectSpecs`);
 * - `"none"`: nothing an e2e spec runs (a unit test, the timings file, doc
 *   markdown by `test:changed`'s own rule, `isPackageDocMarkdown`: a
 *   sidecar, a README or CHANGELOG, a `docs/` file);
 * - `null`: unknown or shared, so every spec runs. Fail safe: a path not
 *   named here is `null`.
 *
 * The editor-only folders are held by the Tour Viewer's dependency-cruiser
 * rules (no viewer module imports `src/editor/` or `src/editor3d/`) and its
 * `src/editor-only-packages.test.ts` (nor the kit's `./chrome`, the kit's
 * only folder today); the viewer-only ones, and both
 * sets transitively (the kit's sources included), by
 * `tests/repo-config/tour-viewer-e2e-plan.test.js`.
 *
 * @param {string} rawPath - repo-relative, either slash style
 * @returns {"editor" | "viewer" | "spec" | "none" | null}
 */
export function pathArea(rawPath) {
  const path = String(rawPath).replaceAll("\\", "/");
  if (/(^|\/)docs\/test-timings\.md$/.test(path)) return "none";
  if (isPackageDocMarkdown(path)) return "none";
  if (path.startsWith(KIT)) return kitArea(path.slice(KIT.length));
  if (path.startsWith(PKG)) return packageArea(path);
  return null;
}

/**
 * @param {string} inKit - a path under the editor kit's `src/`
 * @returns {"editor" | "none" | null}
 */
function kitArea(inKit) {
  if (/\.test\.ts$/.test(inKit)) return "none";
  return inKit.startsWith("chrome/") ? "editor" : null;
}

/**
 * @param {string} path - a repo path inside this package
 * @returns {"editor" | "viewer" | "spec" | "none" | null}
 */
function packageArea(path) {
  const inPkg = path.slice(PKG.length);
  if (inPkg.startsWith("src/") && /\.test\.ts$/.test(inPkg)) return "none";
  if (EDITOR_ONLY.some((p) => inPkg === p || inPkg.startsWith(`${p}/`))) {
    return "editor";
  }
  if (inPkg === "index.html" || inPkg.startsWith("src/landing/")) {
    return SHARED_IN_VIEWER_FOLDERS.has(path) ? null : "viewer";
  }
  if (inPkg.startsWith(SPECS_DIR)) {
    const name = inPkg.slice(SPECS_DIR.length);
    if (Object.hasOwn(SPECS, name)) return "spec";
    return /** @type {"editor" | undefined} */ (AREA_HELPERS[path]) ?? null;
  }
  return null;
}

/**
 * The specs a set of changed paths needs.
 *
 * Every spec when any path is unknown or shared, or when both areas changed.
 * Otherwise the changed area's specs plus the `both` specs, plus any changed
 * spec file itself. An empty list when nothing an e2e spec runs changed.
 *
 * @param {readonly string[]} changedPaths - repo-relative
 * @returns {{ all: true, reason: string } | { all: false, areas: string[], specs: string[] }}
 */
export function selectSpecs(changedPaths) {
  /** @type {Set<string>} */
  const areas = new Set();
  /** @type {Set<string>} */
  const changedSpecs = new Set();
  for (const raw of changedPaths) {
    if (raw === "") continue;
    const area = pathArea(raw);
    if (area === null) return { all: true, reason: raw };
    if (area === "none") continue;
    if (area === "spec") {
      changedSpecs.add(raw.replaceAll("\\", "/").split("/").pop() ?? "");
      continue;
    }
    areas.add(area);
  }
  if (areas.has("editor") && areas.has("viewer")) {
    return { all: true, reason: "both areas changed" };
  }
  const specs = Object.keys(SPECS).filter(
    (name) =>
      changedSpecs.has(name) ||
      areas.has(SPECS[name].area) ||
      (areas.size > 0 && SPECS[name].area === "both"),
  );
  return { all: false, areas: [...areas].sort(), specs };
}

/** Where the config's own JSON reporter writes (CI mode), from the package. */
export const RESULTS_DIR = "test-results";

/** The merged report's file name inside RESULTS_DIR. */
export const RESULTS_NAME = "results.json";
