/**
 * The AR pose, back-projected into GPS (J7, DEC-J10).
 *
 * "Man muss ja quasi einfach nur die lokale Pose im AR-Space wieder
 * zurückprojizieren in den GPS-Space, und dann hat man eine saubere, stabile,
 * über das Alignment gefus[t]e GPS-Koordinate, wo der Nutzer gerade ist."
 *
 * **WHY THE SCENE GRAPH ALREADY HAS THE ANSWER.** `ar-scene-hierarchy.ts` is
 * `scene (GPS-world NUE) → arWorldGroup (receives the alignment) →
 * basisChangeNode → arpose → camera`, so the camera is a DESCENDANT of the
 * aligned group: its world position is already NUE metres about the framework's
 * `zero`, post-alignment. Nothing has to be multiplied here. `fusedBearingDeg`
 * relies on exactly the same property.
 *
 * **THE AXIS SWAP IS THE WHOLE REASON THIS IS A NAMED FUNCTION.** The scene root
 * is NUE — `x` North, `y` Up, `z` East — and `EnuPoint` is `{x: east, y:
 * north}`. Those are transposed with respect to each other, and getting it
 * wrong produces a coordinate that looks entirely reasonable and points
 * somewhere the user has never been. `ar-scene-hierarchy.ts` records two
 * independent readers getting this frame backwards.
 *
 * **NOT `calcGpsCoords` / `fusedGpsFromOdom` from the library**, which do the
 * same arithmetic. Both are wrapped in `gateFunction` → `assertLicenseActive()`.
 * That is satisfied at runtime — the demo's store activates a licence — and
 * hostile in this package's unit tests, which import no library function and
 * have no setup that activates one. Reaching for
 * `gps-plus-slam-js/internal`'s `_setLicenseActiveForTesting` would couple these
 * tests to an `@internal` API to obtain six lines of flat-earth arithmetic. The
 * OSM package's `enuFrameAt(origin).toLatLng(point)` is the same approximation,
 * already injected into `ar-mode.ts` as `enuFrameAt`, ungated and directly
 * testable — so this reuses that instead.
 *
 * @see ar-fused-gps.ts.md
 */

/** What the caller must supply. Structural, as `ar-origin.ts` keeps `EnuPoint`. */
export interface EnuInverse {
  toLatLng(point: { x: number; y: number }): { lat: number; lng: number };
}

/** A position in the scene root's frame: North, Up, East. */
export interface NuePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the camera is, in GPS, or `undefined` when it cannot be said.
 *
 * **`y` IS DELIBERATELY UNUSED and is not validated.** It is height, it comes
 * from a different source than the horizontal terms, and suppressing a perfectly
 * good position because the altitude is unusable would hide the line exactly
 * when the vertical solve is misbehaving — which is when it is most worth
 * reading.
 *
 * **A non-finite horizontal term yields NOTHING, never a number.** The same rule
 * the rest of this readout follows: unmeasured is omitted, never rendered. An
 * `Infinity` fed through the frame comes out as a real-looking coordinate, and
 * this line exists to be trusted against the raw one beside it.
 */
export function fusedGpsFrom(
  frame: EnuInverse,
  nue: NuePosition,
): { lat: number; lng: number } | undefined {
  if (!Number.isFinite(nue.x) || !Number.isFinite(nue.z)) return undefined;
  // THE SWAP, in one place: NUE `z` is East, NUE `x` is North.
  return frame.toLatLng({ x: nue.z, y: nue.x });
}
