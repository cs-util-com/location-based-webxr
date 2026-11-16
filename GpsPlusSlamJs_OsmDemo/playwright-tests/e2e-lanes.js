// @ts-check
import { laneSpecs } from "../../scripts/e2e/project-runs.mjs";

/**
 * The OsmDemo browser suite's CI lanes: which GitHub job runs each spec file.
 * One job ran the whole suite serially for about 27 minutes, the longest job
 * of a run; the lanes run in parallel, one job each, chosen by the `E2E_LANE`
 * environment variable as the Tour Viewer's are (`laneSpecs` in
 * `scripts/e2e/project-runs.mjs`, which refuses an unknown or empty lane).
 * The config narrows `testMatch` to the lane's files; with no lane set every
 * spec runs, as before. A repo-config test holds the table to the spec files
 * on disk, and every lane to at least one `@pr` test.
 *
 * Whole spec files, not Playwright's `--shard`: that cuts the test list into
 * equal COUNTS, and one file here holds nearly half the time.
 */

/**
 * Every spec file and its lane, balanced by the per-file seconds of a green
 * full CI run (2026-11-16, 60 tests, 1626 s): lane 1 the 3D scene alone
 * (713 s), lane 2 about 434 s, lane 3 about 479 s. Rebalance from the
 * uploaded JSON report's durations. The 3D scene's file bounds the run: a
 * fourth lane buys nothing until that file is split.
 *
 * @type {Readonly<Record<string, 1 | 2 | 3>>}
 */
export const SPECS = {
  "scene-3d.spec.js": 1,
  "boot-and-shell.spec.js": 2,
  "data-and-caching.spec.js": 2,
  "loading-visibility.spec.js": 2,
  "scene-frame.spec.js": 2,
  "map-and-cells.spec.js": 3,
  "hud-layout.spec.js": 3,
  "layers-and-ground.spec.js": 3,
};

/** The lanes, one CI job each (`.github/workflows/ci.yml`). */
export const LANES = /** @type {const} */ (["osm-1", "osm-2", "osm-3"]);

/**
 * The spec file names of one lane, in table order.
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
  const n = Number(lane.slice("osm-".length));
  return Object.keys(SPECS).filter((name) => SPECS[name] === n);
}

/** @param {string} s */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The config's `testMatch` for the lane `E2E_LANE` names, or `undefined`
 * (Playwright's default, every spec) when none is set.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {RegExp[] | undefined}
 * @throws {RangeError} from `laneSpecs`, so a stale lane stops the run
 */
export function laneTestMatch(env) {
  const specs = laneSpecs(env, { LANES, specsOfLane });
  if (specs === null) return undefined;
  return specs.map((name) => new RegExp(`(^|[\\\\/])${escapeRegExp(name)}$`));
}
