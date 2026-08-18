/**
 * The 0–1 compass influence, mapped to the settings that actually produce it
 * (DEC-E2).
 *
 * **WHY THIS IS A MODULE AND NOT A LINE IN AN EVENT HANDLER.** "Influence 0"
 * does not mean "vote weight 0". `compass-steady-state.ts` computes
 * `clamp01((1 − obs) + obs·trust·weight)`, so at `weight = 0` the result is
 * **`1 − observability`** — a *full* compass override whenever yaw is poorly
 * observable, which is exactly when someone would reach for the slider. And
 * turning the rotation prior off does not help either: that falls through to the
 * **cold-start override**, whose curve is identical and which has been default
 * **on** since 2026-07-25.
 *
 * So a genuine zero needs **three** settings, and getting it wrong ships a
 * slider whose zero end still lets the compass drive — invisible from the UI,
 * and visible here.
 *
 * **WHY THE EXPERIMENT COMBO IS PART OF NON-ZERO INFLUENCE.** The steady-state
 * term is multiplied by `trustScalar`, which is `0` unless the trust state is
 * exactly `trusted`. The §6a field corpus measured per-session compass↔GPS
 * offsets of **−4.3…+18.8°** against a default `compassTrustAgreeToleranceDeg`
 * of **8**, which "rarely activates trust on real devices". There is no
 * standalone runtime setter for that tolerance — the only way to reach it is
 * `setCompassExperimentEnabled`, whose combo pins it to **15°**. Without it this
 * slider is identically inert at every position while walking, which is not a
 * control, it is a decoration.
 *
 * The combo maps `useCompassRotationPrior`, the tolerance and pair selection —
 * and **not** the vote weight, which `gpsDataSlice` maps afterwards and
 * unconditionally. Verified rather than assumed: the slider's value survives the
 * combo.
 *
 * Pure on purpose, like `elevation-nudge.ts`: the mapping is the part worth
 * testing and it should be testable without a store, a session or a DOM.
 *
 * @see compass-influence.ts.md
 */

/**
 * Slider granularity.
 *
 * **0.05, matching the RecorderApp's existing `compass-vote-weight` control.**
 * Two apps disagreeing about the scale of the same knob would make a field note
 * taken in one useless against the other.
 */
export const COMPASS_INFLUENCE_STEP = 0.05;

/** Where the slider starts — the library's own `compassSteadyStateMaxWeight`. */
export const COMPASS_INFLUENCE_DEFAULT = 0.1;

/** The four dispatches that together mean "the compass has this much say". */
export interface CompassSettings {
  /** `setCompassRotationPriorEnabled` — Stage C, the trust-gated continuum. */
  readonly rotationPriorEnabled: boolean;
  /**
   * `setColdStartOverrideEnabled` — **false at every position**, including the
   * non-zero ones. Left on, its curve drives yaw alongside the prior and the
   * slider is no longer the thing being measured.
   */
  readonly coldStartOverrideEnabled: boolean;
  /** `setCompassExperimentEnabled` — the 15° tolerance that lets trust exist. */
  readonly experimentEnabled: boolean;
  /** `setCompassVoteWeight` — validated to `[0,1]` by the library. */
  readonly voteWeight: number;
}

/** Everything off: the only combination that genuinely silences the compass. */
const SILENT: CompassSettings = {
  rotationPriorEnabled: false,
  coldStartOverrideEnabled: false,
  experimentEnabled: false,
  voteWeight: 0,
};

/**
 * Map a 0–1 influence to the settings that produce it.
 *
 * Out-of-range inputs CLAMP into `[0,1]` and non-finite inputs collapse to
 * {@link SILENT}, rather than either being passed on: `setCompassVoteWeight`
 * validates to `[0,1]` and would reject them somewhere the UI cannot see, and
 * "the compass drives with a NaN weight" is the worst state available.
 *
 * **The clamp is ASYMMETRIC in effect.** A clamped `-0.5` reaches 0 and is
 * therefore genuinely silent, but a clamped `1.5` reaches 1 — FULL influence,
 * not silence. Said explicitly because this docstring claimed the opposite
 * until the PR #313 review, while the sidecar and the code were both right.
 */
export function compassSettingsFor(influence: number): CompassSettings {
  if (!Number.isFinite(influence)) return SILENT;
  const weight = Math.min(1, Math.max(0, influence));
  if (weight === 0) return SILENT;
  return {
    rotationPriorEnabled: true,
    coldStartOverrideEnabled: false,
    experimentEnabled: true,
    voteWeight: weight,
  };
}

/**
 * The label beside the slider.
 *
 * **The ends are NAMED, not just numbered.** Outdoors, `0.00` does not tell
 * anyone that the compass is now ignored entirely, and that is the single most
 * useful thing the control can say about where it is set.
 */
export function describeCompassInfluence(influence: number): string {
  const weight = Number.isFinite(influence)
    ? Math.min(1, Math.max(0, influence))
    : 0;
  const value = `compass ${weight.toFixed(2)}`;
  if (weight === 0) return `${value} — GPS only`;
  if (weight === 1) return `${value} — full`;
  return value;
}
