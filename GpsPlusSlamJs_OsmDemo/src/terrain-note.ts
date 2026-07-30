/**
 * The one sentence that says whether the terrain loaded.
 *
 * WHY THIS IS ITS OWN MODULE. It is three lines, and it was briefly duplicated —
 * once in the worker that computes the field and once in a test that fakes the
 * worker — which `check:dup` caught immediately. Duplicating it is worse than it
 * looks: the phrase's entire job is to distinguish "the ground here is genuinely
 * flat" from "the DEM did not load", so two copies that drift produce two
 * different answers to the one question the number exists to settle.
 *
 * It cannot live in `demo-worker.ts` for anything else to import, because that
 * module calls `self.addEventListener` at import time — pulling it into a vitest
 * run would execute the worker's message wiring on the main thread.
 *
 * WHY THE NUMBER MATTERS MORE THAN IT USED TO. DEC-R2-1 accepted that genuinely
 * flat ground should look flat (normal-based shading on sub-1° slopes shows
 * nothing, and that is now the correct outcome rather than a defect). So this
 * string is the ONLY remaining signal separating flat-and-loaded from not-loaded.
 *
 * AND IT IS HIDDEN WHILE THE HEADER IS COLLAPSED. An earlier revision of this
 * comment claimed the opposite — "it must not be dropped by the collapsible header"
 * — which the same PR contradicted: DEC-R2-4 hides `#status`, and
 * `header-collapse.ts` lists the status string among what it hides. Caught in
 * review, and recorded here as the real behaviour rather than the intended one.
 *
 * The gap is small but genuine: with the bar collapsed there is no way to tell flat
 * ground from a DEM that never loaded. It is not covered by DEC-R2-15's
 * auto-expand, because that fires on the error channel and a terrain load that
 * returns a flat field is not an error. Either the phrase needs a home outside the
 * collapsible region — the way the Terrarium attribution moved into Leaflet's
 * control for exactly this reason — or the collapsed bar needs to keep it. Filed as
 * a follow-up rather than decided here.
 *
 * @see terrain-note.ts.md
 */

/** The fields of a heightfield this phrase reads. */
export interface TerrainRelief {
  readonly hasData: boolean;
  /** Posts the provider had no answer for. */
  readonly missing: number;
  /** Posts requested. */
  readonly total: number;
  /** Peak-to-trough relief across the whole sampled field, metres. */
  readonly reliefM: number;
  /** Peak-to-trough relief near the user, metres. */
  readonly nearReliefM: number;
}

/**
 * The status-line phrase for a finished load. Never empty.
 *
 * TWO NUMBERS, NOT ONE (DEC-R2-22). The field grew from 600 m to 2.8 km, and over
 * that span a single figure stopped answering either question properly:
 *
 *  - **whole-field alone** reports tens of metres in hilly terrain while the ground
 *    under the user is flat, so it stops describing the surroundings;
 *  - **near-field alone** can read ±0 m for a field that loaded perfectly, which
 *    resurrects the exact ambiguity the number exists to kill.
 *
 * They are only both printed when they differ meaningfully — on genuinely flat
 * ground, or when the extent is no bigger than the near field, one number is the
 * honest answer and two would be noise in a status line that finding A3 already
 * calls overcrowded.
 *
 * The missing-post count is included only when non-zero: a partial field is a
 * different claim from a complete one, and silently averaging over the gaps (which
 * the sampler does, deliberately) would otherwise be invisible.
 */
export function describeTerrain(field: TerrainRelief): string {
  if (!field.hasData) return "terrain unavailable — ground is flat";
  const missing =
    field.missing > 0
      ? ` (${field.missing}/${field.total} samples missing)`
      : "";
  const near = Math.round(field.nearReliefM);
  const whole = Math.round(field.reliefM);
  const relief =
    near === whole
      ? `terrain ±${whole} m`
      : `terrain ±${near} m nearby / ±${whole} m in view`;
  return `${relief}${missing}`;
}
