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
 * string is the ONLY remaining signal separating flat-and-loaded from
 * not-loaded. It must not be dropped by the collapsible header (DEC-R2-4).
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
  /** Peak-to-trough relief, metres. */
  readonly reliefM: number;
}

/**
 * The status-line phrase for a finished load. Never empty.
 *
 * The missing-post count is included only when non-zero: a partial field is a
 * different claim from a complete one, and silently averaging over the gaps
 * (which `buildHeightfieldData` does, deliberately) would otherwise be invisible.
 */
export function describeTerrain(field: TerrainRelief): string {
  if (!field.hasData) return "terrain unavailable — ground is flat";
  const missing =
    field.missing > 0
      ? ` (${field.missing}/${field.total} samples missing)`
      : "";
  return `terrain ±${Math.round(field.reliefM)} m${missing}`;
}
