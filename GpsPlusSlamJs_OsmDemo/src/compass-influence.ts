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
 * **WHY THE TRUST TOLERANCE IS PART OF NON-ZERO INFLUENCE.** The steady-state
 * term is multiplied by `trustScalar`, which is `0` unless the trust state
 * is exactly `trusted`. The §6a field corpus measured per-session
 * compass↔GPS offsets of **−4.3…+18.8°** against a default
 * `compassTrustAgreeToleranceDeg` of **8**, which "rarely activates trust on
 * real devices". Without an activating tolerance this slider is identically
 * inert at every position while walking, which is not a control, it is a
 * decoration. The tolerance reaches the solve through the standalone
 * `setCompassTrustAgreeToleranceDeg` setter (`gps-plus-slam-js` `9574b432b`,
 * 2026-08-20), dispatched from `main.ts` `onCompassSettings` where all seven
 * dispatches live; this module stays pure and dispatches nothing.
 *
 * **THE EXPERIMENT COMBO IS NOT DISPATCHED ANY MORE** (removed 2026-09-02,
 * PR #403 review). `setCompassExperimentEnabled` writes exactly three keys
 * in the library's `alignmentConfigFromState` (`useCompassRotationPrior`,
 * the tolerance (15°) and pair selection), and this app dispatches a
 * standalone setter for every one of them: the prior is set by
 * `setCompassRotationPriorEnabled`, and the tolerance and pair selection are
 * individually-decided tri-states that the derivation applies AFTER the combo
 * and therefore always won over it (verified in gps-plus-slam-js 1.22.0's
 * dist). So with the prior on the combo changed nothing, and with the prior
 * off it silently forced the prior back on (the PR #400 finding). Dropping it
 * makes the derived config identical in the ON arm and removes the OFF arm's
 * dependence on a library precedence this repo could not pin. History: the
 * combo was dispatched from here while it was the only way to reach an
 * activating tolerance; an earlier docstring even claimed no standalone
 * setter existed, corrected 2026-09-01 after it misled a planning session.
 *
 * The vote weight is mapped by `gpsDataSlice` unconditionally and after every
 * flag, so the slider's value is never overwritten by any of them.
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
/**
 * Where the slider starts.
 *
 * **0.8 since 2026-08-20, was 0.1.** Two independent reasons, and the field one
 * came first: the owner reported 0.8 as consistently fixing perceived rotation
 * across several sessions. The 2026-08-20 trust-gate census then measured 0.8
 * with the `ramp` gate as better than `binary` on both stability columns —
 * visible jumps 263 vs 285, fine wobble 0.071° vs 0.078° — at an accuracy
 * difference three orders of magnitude below the effect of the weight change
 * itself.
 *
 * **It is NOT free**, and the number is here so nobody has to guess: against the
 * shipped 0.1 the same census measures +2.9° of walk-heading error and +3.6 m
 * of RMS **against the GPS track**. Whether that is error or correction is
 * exactly what the corpus cannot say, because it has no yaw reference
 * independent of GPS.
 */
export const COMPASS_INFLUENCE_DEFAULT = 0.8;

/** The three-way trust gate, mirroring the library's own union. */
export type CompassTrustGateMode = "off" | "binary" | "ramp";

/**
 * The experimental compass options, exposed as controls so the trade is
 * measured on a street rather than argued in a document.
 *
 * Every one of these is a library setting that ships OFF or at a different
 * value, and two of them are documented there as not field-validated. They are
 * grouped here because they are only interpretable together.
 */
export interface CompassExperiments {
  /**
   * The master switch. `true` = Stage C, the trust-gated continuum; `false` =
   * fall back to the **validated** Stage 0 the RecorderApp ships.
   */
  readonly rotationPriorEnabled: boolean;
  /** How the Stage-C vote is gated on trust. */
  readonly trustGateMode: CompassTrustGateMode;
  /** C-prime — re-solves the alignment on compass-weighted pairs once trusted. */
  readonly pairSelectionEnabled: boolean;
  /** How close compass and GPS yaw must agree before trust is granted. */
  readonly trustToleranceDeg: number;
  /** The compass-health gate, which down-weights a drifting compass. */
  readonly webXRConsistencyEnabled: boolean;
}

/**
 * What the demo ships.
 *
 * **`ramp` rather than the library's `binary`**, and the demo opts in alone so
 * every other consumer is unchanged. At a vote weight of 0.8 the binary gate
 * steps the vote by the FULL weight on every trust flip — the mechanism the
 * census identifies as the source of added yaw jumps, and one that scales with
 * the weight, so it is eight times more visible at 0.8 than at the old 0.1.
 *
 * **Tolerance 15°, not the library's 8°.** At 8°, against field compass-vs-GPS
 * offsets of -4.3…+18.8°, trust reaches `trusted` on 55 of 81 corpus recordings
 * against 64 at 15° — i.e. the experiment is substantially switched off by its
 * own threshold, which is part of why the RecorderApp's results were
 * inconclusive.
 */
export const COMPASS_EXPERIMENT_DEFAULTS: CompassExperiments = {
  rotationPriorEnabled: true,
  trustGateMode: "ramp",
  pairSelectionEnabled: true,
  trustToleranceDeg: 15,
  webXRConsistencyEnabled: false,
};

/** The dispatches that together mean "the compass has this much say". */
export interface CompassSettings {
  /** `setCompassRotationPriorEnabled` — Stage C, the trust-gated continuum. */
  readonly rotationPriorEnabled: boolean;
  /**
   * `setColdStartOverrideEnabled` — **false at every position while the prior is
   * on**. Left on it would be inert anyway (the two stages are an `if/else` on
   * the same weight, and the prior wins), but false is the honest statement of
   * which stage is driving.
   *
   * **It flips back to `true` when the prior is switched OFF**, and that half is
   * not optional: without it, "prior off" silences the compass entirely instead
   * of returning to the validated Stage 0, so the toggle would compare the
   * experiment against nothing rather than against the baseline.
   */
  readonly coldStartOverrideEnabled: boolean;
  /** `setCompassVoteWeight` — validated to `[0,1]` by the library. */
  readonly voteWeight: number;
  /** `setCompassTrustGateMode`. */
  readonly trustGateMode: CompassTrustGateMode;
  /** `setCompassPairSelectionEnabled`. */
  readonly pairSelectionEnabled: boolean;
  /** `setCompassTrustAgreeToleranceDeg` - the activating tolerance; see the
   *  module docstring for why the slider is inert without it. */
  readonly trustToleranceDeg: number;
  /** `setCompassWebXRConsistencyEnabled`. */
  readonly webXRConsistencyEnabled: boolean;
}

/**
 * Everything off: the only combination that genuinely silences the compass.
 *
 * **No experimental toggle can reintroduce it**, because "GPS only" is the
 * control arm of every comparison made with this slider.
 */
const SILENT: CompassSettings = {
  rotationPriorEnabled: false,
  coldStartOverrideEnabled: false,
  voteWeight: 0,
  trustGateMode: "binary",
  pairSelectionEnabled: false,
  trustToleranceDeg: COMPASS_EXPERIMENT_DEFAULTS.trustToleranceDeg,
  webXRConsistencyEnabled: false,
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
export function compassSettingsFor(
  influence: number,
  experiments: CompassExperiments = COMPASS_EXPERIMENT_DEFAULTS,
): CompassSettings {
  if (!Number.isFinite(influence)) return SILENT;
  const weight = Math.min(1, Math.max(0, influence));
  if (weight === 0) return SILENT;
  return {
    rotationPriorEnabled: experiments.rotationPriorEnabled,
    // THE FALL-THROUGH, and it is the half that is easy to miss: with the prior
    // off the solve uses Stage 0, whose flag this app otherwise pins false — so
    // without flipping it back, "prior off" would mean "no compass at all"
    // rather than "the validated baseline".
    coldStartOverrideEnabled: !experiments.rotationPriorEnabled,
    // No experiment combo here (removed 2026-09-02): every key it wrote is
    // dispatched standalone, so it was config-neutral with the prior on and
    // force-re-enabled the prior with it off. See the module docstring.
    voteWeight: weight,
    trustGateMode: experiments.trustGateMode,
    pairSelectionEnabled: experiments.pairSelectionEnabled,
    trustToleranceDeg: experiments.trustToleranceDeg,
    webXRConsistencyEnabled: experiments.webXRConsistencyEnabled,
  };
}

/**
 * What the solve last published about the compass, for the readout.
 *
 * Every field optional and every absence meaningful: before the first fix
 * nothing has been measured, and rendering `now 0.00` there would claim the
 * compass is contributing nothing — a different fact from having no measurement.
 */
export interface CompassLiveState {
  /** `0` = yaw unobservable (cold start); `1` = fully observable. */
  readonly observability?: number | undefined;
  /** The blend weight the solve actually used this event. */
  readonly appliedWeight?: number | undefined;
  /** The trust machine's state, which decides whether the target is in play. */
  readonly trust?: "dormant" | "untrusted" | "trusted" | undefined;
}

/**
 * Observability at or above which the library validates the compass against GPS
 * yaw — the same threshold `COMPASS_TRUST_OBSERVABLE_THRESHOLD` uses. Below it
 * the weight is `1 − observability` whatever the slider says, which is the
 * "cold start" phase.
 */
const OBSERVABLE_THRESHOLD = 0.5;

/**
 * The label beside the slider.
 *
 * **The ends are NAMED, not just numbered.** Outdoors, `0.00` does not tell
 * anyone that the compass is now ignored entirely, and that is the single most
 * useful thing the control can say about where it is set.
 *
 * **AND THE LIVE VALUE IS SHOWN BESIDE THE TARGET (DEC-Y12).** The slider sets a
 * STEADY-STATE target that only applies once yaw is observable and the compass
 * is trusted; before that the solve uses a completely different number. The old
 * readout showed `compass 0.10` while, standing still, the compass had 100% of
 * the say — describing the steady state during cold start, which is exactly the
 * regime being judged.
 *
 * **The `untrusted` phase is the most valuable thing here.** An untrusted
 * Stage-C vote collapses to `1 − observability` for EVERY weight, so a 0.1
 * session and a 0.8 session are byte-identical and nothing else on screen would
 * distinguish them.
 */
export function describeCompassInfluence(
  influence: number,
  live?: CompassLiveState,
): string {
  const weight = Number.isFinite(influence)
    ? Math.min(1, Math.max(0, influence))
    : 0;
  const value = `compass ${weight.toFixed(2)}`;
  if (weight === 0) return `${value} — GPS only`;
  // The other named end, kept from the original readout: at 1.00 the slider is
  // no longer a vote, and "full" says that where a bare number does not.
  if (weight === 1 && live?.appliedWeight === undefined) {
    return `${value} — full`;
  }

  const applied = live?.appliedWeight;
  if (applied === undefined || !Number.isFinite(applied)) {
    // Nothing measured yet, or a poisoned value from a replayed solve. Showing
    // the target alone is honest; `compass NaN` on a readout whose purpose is
    // trust is worse than showing less.
    return live === undefined ? value : `${value} target`;
  }

  const observability = live?.observability;
  const phase =
    typeof observability === "number" &&
    Number.isFinite(observability) &&
    observability < OBSERVABLE_THRESHOLD
      ? "cold start"
      : live?.trust === "trusted"
        ? "trusted"
        : "untrusted";

  return `${value} target — now ${applied.toFixed(2)} ${phase}`;
}

/**
 * The trust gate, in the words the readout uses.
 *
 * **WHY A TRANSIENT LINE RATHER THAN A PERMANENT ONE (DEC-K6).** A field
 * session switched the gate between `ramp` and `binary` and reported that
 * nothing happened — "so als würde er einfach komplett ignorieren, was da
 * gerade eingestellt ist".
 *
 * **The maths is correct and no instant jump is possible**: the reducer only
 * writes the field, the alignment matrix is recomputed only when a GPS
 * observation arrives, and the view lerps toward it rather than snapping.
 * `ramp` and `binary` are also mathematically identical outside the
 * `untrusted` regime, and then for at most three steps. So the defect is the
 * missing ACKNOWLEDGEMENT, not the behaviour.
 *
 * It is transient because the readout's row is width-constrained — DEC-J8
 * shortened the hint beside it to 20 characters to stop the box wrapping to
 * three rows — so a permanently appended `· gate binary` would risk undoing
 * that. And it is in the readout because the experiment panel CLOSES itself on
 * change, which is precisely why the change had nothing to look at.
 */
export function describeTrustGate(mode: CompassTrustGateMode): string {
  // `off` is the one that deserves words: it means the compass is trusted
  // unconditionally, which is a different kind of setting from the other two.
  if (mode === "off") return "gate off — compass always trusted";
  return `gate ${mode}`;
}
