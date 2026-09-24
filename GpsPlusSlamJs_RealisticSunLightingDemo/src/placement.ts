/**
 * Tap-to-place view-model for the Realistic Sun Lighting Demo.
 *
 * Pure GPS gate logic that can be unit-tested without a WebXR session.
 * Follows the same pattern as GpsPlusSlamJs_MinimalExample to ensure
 * GPS anchoring works correctly by requiring a GPS fix before placement.
 */

/** Outcome of a tap, given the current GPS + reticle state. */
export type PlacementDecision =
  /** A GPS fix exists and a surface is under the screen centre — place now. */
  | { readonly kind: 'place' }
  /** No GPS fix yet — ignore the tap, show a "waiting for GPS…" hint. */
  | { readonly kind: 'waiting-for-gps' }
  /** GPS is ready but no surface is under the reticle — nothing to place on. */
  | { readonly kind: 'no-surface' };

/** Inputs to the GPS gate at the moment of a tap. */
export interface TapInput {
  /** Has at least one GPS fix been received since AR started? */
  readonly hasGpsFix: boolean;
  /** Is the hit-test reticle currently visible (a surface was found)? */
  readonly reticleVisible: boolean;
}

/**
 * Decide what a tap should do. GPS gating takes precedence over the surface
 * check so a pre-fix tap always surfaces the "waiting for GPS…" hint rather
 * than silently doing nothing. This preserves the shared-start-pose invariant
 * required for GPS anchoring to work correctly.
 */
export function decideTapPlacement(input: TapInput): PlacementDecision {
  if (!input.hasGpsFix) {
    return { kind: 'waiting-for-gps' };
  }
  if (!input.reticleVisible) {
    return { kind: 'no-surface' };
  }
  return { kind: 'place' };
}
