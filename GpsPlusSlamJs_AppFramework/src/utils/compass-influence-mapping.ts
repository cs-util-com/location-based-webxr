/**
 * The compass-influence mapping: one 0..1 number → the SET of library
 * settings that together mean "the compass has this much say".
 *
 * Shared behaviour with a contract, so it lives here (root reuse rule, DEC-H3)
 * and is deep-imported by every app that offers a compass-influence slider -
 * the OSM demo since 2026-08-20, the recorder's in-recording field wheel since
 * 2026-09-02. Moved out of the demo on 2026-09-02; the demo's EXPERIMENT
 * DEFAULTS (its `ramp` gate, its 15° tolerance) deliberately did NOT move with
 * it: they are that app's decisions, so `experiments` is a REQUIRED parameter
 * and this module exports no defaults.
 *
 * WHY "INFLUENCE 0" IS THREE SETTINGS, NOT ONE. At vote weight 0 the
 * steady-state formula is `1 − observability` - a FULL compass override
 * precisely when yaw is poorly observable - and switching the rotation prior
 * off falls through to the cold-start override, whose curve is identical and
 * which is default-ON. The only combination that genuinely silences the
 * compass is prior OFF + cold-start OFF + weight 0 (`SILENT`), and no
 * experiment toggle may reintroduce any of them at zero: "GPS only" is the
 * control arm of every comparison made with the slider.
 *
 * WHY THE COLD-START FLAG FLIPS WITH THE PRIOR. With the prior on, the
 * cold-start override is inert anyway (the two stages are an if/else on the
 * same weight, and the prior wins), so `false` is the honest statement of
 * which stage drives. With the prior OFF it must flip back to `true`, or
 * "prior off" would mean "no compass at all" instead of "the validated Stage 0
 * baseline" - and the toggle would compare the experiment against nothing.
 *
 * See `compass-influence-mapping.ts.md`.
 */

import type { CompassTrustGateMode } from 'gps-plus-slam-js';

/**
 * The experimental compass options an app exposes alongside the slider. Every
 * one is a library setting that ships OFF or at a different value; they are
 * grouped because they are only interpretable together, and the app that
 * offers them owns their defaults.
 */
export interface CompassExperiments {
  /** `true` = Stage C, the trust-gated continuum; `false` = the validated Stage 0. */
  readonly rotationPriorEnabled: boolean;
  /** How the Stage-C vote is gated on trust. */
  readonly trustGateMode: CompassTrustGateMode;
  /** Compass-guided pair re-solve once trusted (C-prime). */
  readonly pairSelectionEnabled: boolean;
  /** How close compass and GPS yaw must agree before trust is granted, degrees. */
  readonly trustToleranceDeg: number;
  /** The compass-health gate, which down-weights a drifting compass. */
  readonly webXRConsistencyEnabled: boolean;
}

/** The dispatches that together mean "the compass has this much say". */
export interface CompassSettings {
  /** `setCompassRotationPriorEnabled`. */
  readonly rotationPriorEnabled: boolean;
  /** `setColdStartOverrideEnabled` - false while the prior is on, true when it is off. */
  readonly coldStartOverrideEnabled: boolean;
  /** `setCompassVoteWeight` - validated to [0, 1] by the library. */
  readonly voteWeight: number;
  /** `setCompassTrustGateMode`. */
  readonly trustGateMode: CompassTrustGateMode;
  /** `setCompassPairSelectionEnabled`. */
  readonly pairSelectionEnabled: boolean;
  /** `setCompassTrustAgreeToleranceDeg` - the activating tolerance. */
  readonly trustToleranceDeg: number;
  /** `setCompassWebXRConsistencyEnabled`. */
  readonly webXRConsistencyEnabled: boolean;
}

/**
 * Everything off: the only combination that genuinely silences the compass.
 * The tolerance and gate mode carry the app's own values because they are
 * inert without a prior; every switch that could give the compass a say is off.
 */
export function silentCompassSettings(
  experiments: CompassExperiments
): CompassSettings {
  return {
    rotationPriorEnabled: false,
    coldStartOverrideEnabled: false,
    voteWeight: 0,
    trustGateMode: experiments.trustGateMode,
    pairSelectionEnabled: false,
    trustToleranceDeg: experiments.trustToleranceDeg,
    webXRConsistencyEnabled: false,
  };
}

/**
 * Map a 0..1 influence to the settings that produce it.
 *
 * Out-of-range inputs CLAMP into [0, 1] and non-finite inputs collapse to
 * silence, rather than either being passed on: `setCompassVoteWeight` would
 * reject them somewhere the UI cannot see, and "the compass drives with a NaN
 * weight" is the worst state available. The clamp is ASYMMETRIC in effect: a
 * clamped −0.5 reaches 0 and is genuinely silent, a clamped 1.5 reaches 1 -
 * FULL influence, not silence.
 */
export function compassSettingsFor(
  influence: number,
  experiments: CompassExperiments
): CompassSettings {
  if (!Number.isFinite(influence)) return silentCompassSettings(experiments);
  const weight = Math.min(1, Math.max(0, influence));
  if (weight === 0) return silentCompassSettings(experiments);
  return {
    rotationPriorEnabled: experiments.rotationPriorEnabled,
    coldStartOverrideEnabled: !experiments.rotationPriorEnabled,
    voteWeight: weight,
    trustGateMode: experiments.trustGateMode,
    pairSelectionEnabled: experiments.pairSelectionEnabled,
    trustToleranceDeg: experiments.trustToleranceDeg,
    webXRConsistencyEnabled: experiments.webXRConsistencyEnabled,
  };
}
