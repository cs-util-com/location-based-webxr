/**
 * What the last frame actually cost the GPU (W10, N5).
 *
 * WHY THIS EXISTS. R4-17 asks whether the meshes are "as efficient as possible",
 * and nothing in the demo could answer it. The status line reports volumes,
 * parts, triangles, plates, roads, POI and areas — every one of them a count of
 * things BUILT, not of things drawn. The number that separates "one merged city"
 * from "two thousand cones" is the DRAW CALL count, and it was not on screen.
 *
 * That matters beyond curiosity: Stage 3 trades one draw call for many
 * (chunking the geometry so it can be frustum-culled at all), and without this
 * readout that trade would be argued rather than measured. This repo has already
 * had one constant justified by a remembered figure that did not reproduce.
 *
 * WHY A PURE FORMATTER. `renderer.info` cannot be read without a `WebGLRenderer`,
 * so the value comes from the view and the SENTENCE is built here — the same
 * split every other presentational decision in this demo uses, and the reason
 * the format can be pinned without a GPU.
 *
 * @see draw-cost.ts.md
 */

/** What `THREE.WebGLRenderer.info.render` reports, narrowed to what is shown. */
export interface DrawCost {
  /** Draw calls issued for the last frame. */
  readonly calls: number;
  /** Triangles submitted for the last frame. */
  readonly triangles: number;
}

/**
 * The status-line fragment, or `""` when nothing has been drawn yet.
 *
 * EMPTY RATHER THAN "0 draws", because before the first frame those are
 * different claims: "the renderer has drawn nothing" and "the renderer drew a
 * frame containing nothing" look identical as a zero, and the second is a
 * failure worth noticing. `writeStatus` drops empty parts, so an unmeasured
 * cost simply does not appear.
 *
 * Triangles are formatted with thousands separators because the interesting
 * comparisons are between six-figure numbers, where an unseparated digit string
 * is unreadable at a glance — and glancing is the whole use of a status line.
 */
export function describeDrawCost(cost: DrawCost | undefined): string {
  if (cost === undefined) return "";
  // A frame that issued no calls at all has not happened yet — three resets the
  // counters per render, so zero means "no render since the last reset".
  if (cost.calls === 0) return "";
  return `${cost.calls} draws / ${cost.triangles.toLocaleString("en-US")} tri`;
}
