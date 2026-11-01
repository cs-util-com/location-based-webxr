// @ts-check
/**
 * The Tour Viewer's e2e plan: which Playwright project each spec runs in, and
 * which area of the app it covers, so a run can skip the specs a change
 * cannot reach. Read by `playwright.config.js` (the projects) and by
 * `scripts/e2e/run-projects.mjs` (the sequential runs and the area
 * selection). Every spec is listed once, here; a repo-config test holds the
 * table to the spec files on disk.
 */

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
 *
 * @type {Readonly<Record<string, { project: "dom" | "webgl", area: "editor" | "viewer" | "both" }>>}
 */
export const SPECS = {
  "ar-layout.spec.js": { project: "dom", area: "viewer" },
  "ar-mode.spec.js": { project: "dom", area: "viewer" },
  "blocks-tour.spec.js": { project: "webgl", area: "both" },
  "character-views.spec.js": { project: "webgl", area: "viewer" },
  "code-auto-move.spec.js": { project: "dom", area: "viewer" },
  "creator-indoor.spec.js": { project: "dom", area: "viewer" },
  "creator-stations.spec.js": { project: "dom", area: "viewer" },
  "editor-entry.spec.js": { project: "dom", area: "editor" },
  "editor.spec.js": { project: "dom", area: "editor" },
  "editor3d-character.spec.js": { project: "webgl", area: "editor" },
  "editor3d-edit.spec.js": { project: "webgl", area: "editor" },
  "editor3d-globe-approach.spec.js": { project: "webgl", area: "editor" },
  "editor3d-globe.spec.js": { project: "webgl", area: "editor" },
  "editor3d-inspector.spec.js": { project: "webgl", area: "editor" },
  "editor3d-model.spec.js": { project: "webgl", area: "editor" },
  "editor3d-shell.spec.js": { project: "webgl", area: "editor" },
  "editor3d-tree.spec.js": { project: "webgl", area: "editor" },
  "editor3d.spec.js": { project: "webgl", area: "editor" },
  "file-access-check.spec.js": { project: "dom", area: "viewer" },
  "landing-film.spec.js": { project: "webgl", area: "viewer" },
  "landing.spec.js": { project: "webgl", area: "viewer" },
  "launch-and-errors.spec.js": { project: "dom", area: "viewer" },
  "lectern-check.spec.js": { project: "webgl", area: "viewer" },
  "legal.spec.js": { project: "webgl", area: "both" },
  "model-views.spec.js": { project: "webgl", area: "viewer" },
  "object-editing.spec.js": { project: "dom", area: "viewer" },
  "older-format.spec.js": { project: "webgl", area: "both" },
  "open-file.spec.js": { project: "dom", area: "viewer" },
  "sample-tour.spec.js": { project: "dom", area: "viewer" },
  "setup-flow.spec.js": { project: "dom", area: "viewer" },
  "stations.spec.js": { project: "dom", area: "viewer" },
  "story-blocks-frame-time.spec.js": { project: "webgl", area: "viewer" },
  "story-blocks.spec.js": { project: "dom", area: "viewer" },
  "streaming.spec.js": { project: "dom", area: "viewer" },
  "summary.spec.js": { project: "dom", area: "viewer" },
  "visitor-start.spec.js": { project: "dom", area: "viewer" },
  "visitor-walk-layout.spec.js": { project: "dom", area: "viewer" },
  "visitor-walk-radar.spec.js": { project: "dom", area: "viewer" },
  "visitor-walk.spec.js": { project: "dom", area: "viewer" },
  "way-in.spec.js": { project: "dom", area: "both" },
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
};

/**
 * The area a changed repo path can affect.
 *
 * - `"editor"` / `"viewer"`: only that area's pages;
 * - `"spec"`: a spec file, which runs itself (see `selectSpecs`);
 * - `"none"`: nothing an e2e spec runs (a unit test, a sidecar, docs);
 * - `null`: unknown or shared, so every spec runs. Fail safe: a path not
 *   named here is `null`.
 *
 * The editor-only folders are held by the Tour Viewer's dependency-cruiser
 * rules (no viewer module imports `src/editor/`, `src/editor3d/`, nor the
 * kit's `chrome/`, `scene/` or `globe/`); the viewer-only ones, and both sets
 * transitively, by `tests/repo-config/tour-viewer-e2e-plan.test.js`.
 *
 * @param {string} rawPath - repo-relative, either slash style
 * @returns {"editor" | "viewer" | "spec" | "none" | null}
 */
export function pathArea(rawPath) {
  const path = String(rawPath).replaceAll("\\", "/");
  if (/(^|\/)docs\/test-timings\.md$/.test(path)) return "none";
  if (path.endsWith(".md") && !/\/(public|assets|fixtures)\//.test(path)) {
    return "none";
  }
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
  return /^(chrome|scene|globe)\//.test(inKit) ? "editor" : null;
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
