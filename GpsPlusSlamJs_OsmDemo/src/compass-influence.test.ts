/**
 * Why this test matters: the 0-end of this slider is the whole reason the
 * mapping is a separate module. `compass-steady-state.ts` computes
 * `clamp01((1 − obs) + obs·trust·weight)`, which at `weight = 0` is
 * **`1 − observability`** — a FULL compass override at low observability. And
 * switching the rotation prior off falls through to the cold-start override,
 * whose curve is identical and which has been default-ON since 2026-07-25. So a
 * genuine zero takes THREE settings, and a slider that dispatches fewer ships a
 * zero end where the compass still drives. That is not observable from the UI;
 * it is only observable here.
 */

import { describe, expect, it } from "vitest";

import {
  COMPASS_INFLUENCE_DEFAULT,
  COMPASS_INFLUENCE_STEP,
  compassSettingsFor,
  describeCompassInfluence,
  COMPASS_EXPERIMENT_DEFAULTS,
} from "./compass-influence.js";

describe("compassSettingsFor", () => {
  it("silences the compass COMPLETELY at zero, which takes three settings", () => {
    // Disabling the rotation prior alone is not zero: the cold-start override
    // has the same curve and is on by default, so it takes over. Both off, and
    // the weight zeroed, is the only combination that means what the label says.
    // The three that matter are asserted individually rather than by deep
    // equality on the whole shape: the object gained four experimental fields
    // in round four, and a deep-equal test would have to be rewritten every
    // time one is added while asserting nothing more than it does now.
    const settings = compassSettingsFor(0);
    expect(settings.rotationPriorEnabled).toBe(false);
    expect(settings.coldStartOverrideEnabled).toBe(false);
    expect(settings.experimentEnabled).toBe(false);
    expect(settings.voteWeight).toBe(0);
  });

  it("turns the cold-start override OFF at every non-zero position too", () => {
    // While the rotation prior is on, which is the default. The two stages are
    // an `if/else` on the same weight and the prior wins, so leaving the
    // override on would be inert rather than confounding — but false is the
    // honest statement of which stage is driving.
    //
    // It flips back ON when the prior is switched off; see "hands back to the
    // validated Stage 0" below, which is the half a review caught.
    for (const influence of [0.05, 0.1, 0.5, 1]) {
      expect(compassSettingsFor(influence).coldStartOverrideEnabled).toBe(
        false,
      );
    }
  });

  it("enables the experiment combo above zero, or the slider is provably inert", () => {
    // The steady-state term is multiplied by `trustScalar`, which is 0 unless
    // the trust state is exactly `trusted`. The field corpus measured
    // compass-GPS offsets of -4.3…+18.8° against a default tolerance of 8°,
    // which "rarely activates trust on real devices" — so without the combo's
    // 15° tolerance the weight is identically 0 at EVERY slider position while
    // walking, and the control does nothing at all.
    expect(compassSettingsFor(0.5).experimentEnabled).toBe(true);
    expect(compassSettingsFor(1).rotationPriorEnabled).toBe(true);
  });

  it("passes the influence straight through as the vote weight", () => {
    expect(compassSettingsFor(0.35).voteWeight).toBe(0.35);
    expect(compassSettingsFor(1).voteWeight).toBe(1);
  });

  it("clamps out of range rather than dispatching an invalid weight", () => {
    // `setCompassVoteWeight` validates to [0,1]; sending something outside it
    // would be rejected somewhere the UI cannot see.
    expect(compassSettingsFor(1.4).voteWeight).toBe(1);
    expect(compassSettingsFor(-2).voteWeight).toBe(0);
    // And a clamped-to-zero value must be a REAL zero, not merely a small one:
    expect(compassSettingsFor(-2).rotationPriorEnabled).toBe(false);
  });

  it("clamps ASYMMETRICALLY — above range is FULL influence, not silence", () => {
    // Why this test matters (PR #313 review): the docstring claimed for a while
    // that out-of-range inputs "collapse to SILENT", which is true only of the
    // negative half — and only because that half clamps to 0, which is silent
    // for an unrelated reason. Above the range the clamp lands on 1, the
    // LOUDEST setting available and the exact opposite of the claim. Pinned so
    // the two halves cannot be described as one behaviour again.
    expect(compassSettingsFor(1.5)).toEqual(compassSettingsFor(1));
    expect(compassSettingsFor(1.5).rotationPriorEnabled).toBe(true);
    expect(compassSettingsFor(1.5).experimentEnabled).toBe(true);
    expect(compassSettingsFor(1.5).voteWeight).toBe(1);
    // The negative half, stated beside it so the asymmetry is visible in one place:
    expect(compassSettingsFor(-0.5)).toEqual(compassSettingsFor(0));
  });

  it("treats a non-finite influence as fully off", () => {
    // Defensive: a range input cannot produce this, but a restored preference
    // can, and "compass drives with a NaN weight" is the worst available state.
    expect(compassSettingsFor(Number.NaN)).toEqual(compassSettingsFor(0));
  });

  it("matches the RecorderApp's STEP, and deliberately not its default", () => {
    // A compass-vote slider already ships there — range 0-1, step 0.05. Two
    // apps disagreeing about the SCALE of the same knob would make a field note
    // taken in one useless against the other, so the step is shared.
    //
    // THE DEFAULT IS NOT SHARED, and the divergence is deliberate. The recorder
    // ships the library's 0.1; this demo ships 0.8 because it is the testbed
    // where the higher weight is being evaluated, and because the recorder's
    // own experiment is largely inert on real phones anyway (its 8° tolerance
    // grants trust on 55 of 81 corpus recordings against 64 at the 15° this app
    // uses). The exact value is pinned in the round-four block below.
    expect(COMPASS_INFLUENCE_STEP).toBe(0.05);
  });
});

describe("describeCompassInfluence", () => {
  it("names the two ends rather than only numbering them", () => {
    // "0.00" does not tell a user outdoors that the compass is now ignored.
    expect(describeCompassInfluence(0)).toBe("compass 0.00 — GPS only");
    expect(describeCompassInfluence(1)).toBe("compass 1.00 — full");
  });

  it("shows two decimals in between, because the step is 0.05", () => {
    expect(describeCompassInfluence(0.35)).toBe("compass 0.35");
    expect(describeCompassInfluence(0.1)).toBe("compass 0.10");
  });

  it("never renders a non-finite influence as a setting", () => {
    expect(describeCompassInfluence(Number.NaN)).toBe(
      "compass 0.00 — GPS only",
    );
  });
});

describe("the experimental options (Q2 steps 5-7)", () => {
  /**
   * Why these tests matter: the demo is being used as a field testbed for
   * compass mechanisms that the library ships OFF and documents as not
   * field-validated. Each toggle has to reach exactly one library setting, and
   * the master switch has a second half that is easy to forget — see the
   * fall-through test below, which is the one a review caught.
   */
  it("defaults the vote weight to 0.8, the census-backed value", () => {
    // Was 0.1. The 2026-08-20 trust-gate census measured 0.8 with the `ramp`
    // gate as better than `binary` on both stability columns at no measurable
    // accuracy cost, and the field report that started this round said 0.8
    // fixed perceived rotation. Pinned so a revert is deliberate.
    expect(COMPASS_INFLUENCE_DEFAULT).toBe(0.8);
  });

  it("defaults the trust gate to `ramp`, not the library's `binary`", () => {
    // The library default stays `binary` so every other consumer is unchanged;
    // the demo opts in. At 0.8 the binary gate steps the vote by the FULL
    // weight on every trust flip, which is the mechanism the census measures as
    // the source of added yaw jumps.
    expect(COMPASS_EXPERIMENT_DEFAULTS.trustGateMode).toBe("ramp");
  });

  it("carries each experimental toggle through to its own setting", () => {
    const settings = compassSettingsFor(0.5, {
      ...COMPASS_EXPERIMENT_DEFAULTS,
      trustGateMode: "off",
      pairSelectionEnabled: false,
      trustToleranceDeg: 25,
      webXRConsistencyEnabled: true,
    });
    expect(settings.trustGateMode).toBe("off");
    expect(settings.pairSelectionEnabled).toBe(false);
    expect(settings.trustToleranceDeg).toBe(25);
    expect(settings.webXRConsistencyEnabled).toBe(true);
    expect(settings.voteWeight).toBe(0.5);
  });

  it("turning the rotation prior OFF hands back to the validated Stage 0", () => {
    // THE HALF A REVIEW CAUGHT. The two stages are an if/else on the same
    // weight, so switching the prior off falls through to the cold-start
    // override — and this app pins THAT flag false at every slider position.
    // Without flipping it back, "prior off" would silence the compass entirely
    // rather than returning to the mode the RecorderApp ships and the field
    // validated. The toggle would then be comparing "experiment" against
    // "nothing", not against the baseline.
    const settings = compassSettingsFor(0.5, {
      ...COMPASS_EXPERIMENT_DEFAULTS,
      rotationPriorEnabled: false,
    });
    expect(settings.rotationPriorEnabled).toBe(false);
    expect(settings.coldStartOverrideEnabled).toBe(true);
  });

  it("keeps the prior ON and the override OFF at every non-zero position", () => {
    for (const influence of [0.05, 0.5, 1]) {
      const settings = compassSettingsFor(influence);
      expect(settings.rotationPriorEnabled).toBe(true);
      expect(settings.coldStartOverrideEnabled).toBe(false);
    }
  });

  it("stays genuinely silent at zero, whatever the experiments say", () => {
    // Influence 0 must silence the compass completely — the one combination
    // that does. An experimental toggle must not be able to reintroduce it,
    // because "GPS only" is the control arm of every comparison made here.
    const settings = compassSettingsFor(0, {
      ...COMPASS_EXPERIMENT_DEFAULTS,
      trustGateMode: "off",
      rotationPriorEnabled: true,
    });
    expect(settings.rotationPriorEnabled).toBe(false);
    expect(settings.coldStartOverrideEnabled).toBe(false);
    expect(settings.experimentEnabled).toBe(false);
    expect(settings.voteWeight).toBe(0);
  });
});

describe("describeCompassInfluence with live diagnostics (DEC-Y12)", () => {
  /**
   * Why these tests matter: the readout said `compass 0.10` while, standing
   * still, the compass had 100% of the say — it described the STEADY STATE and
   * was displayed during cold start, which is exactly the regime the owner was
   * judging. Worse, an untrusted Stage C collapses to `1 − observability` for
   * EVERY weight, so a 0.1 session and a 0.8 session can be byte-identical with
   * nothing on screen to say so.
   *
   * The fix is to show the target and the live value together, named by phase.
   * Each phase below is a state a field observer must be able to tell apart.
   */
  it("shows the target alone when the solve has published nothing yet", () => {
    // Before the first fix there is no measurement. Inventing "now 0.00" would
    // claim the compass is contributing nothing, which is a different fact.
    expect(describeCompassInfluence(0.8, {})).toBe("compass 0.80 target");
  });

  it("names the COLD-START phase, where the compass has full say", () => {
    // The regime the old readout misdescribed: weight 1.0 while showing 0.80.
    expect(
      describeCompassInfluence(0.8, { observability: 0, appliedWeight: 1 }),
    ).toBe("compass 0.80 target — now 1.00 cold start");
  });

  it("names the UNTRUSTED phase, where the slider is doing nothing", () => {
    // The single most useful thing this line can say. At full observability an
    // untrusted gate yields 0, so the slider position is irrelevant — and two
    // sessions at different settings are identical.
    expect(
      describeCompassInfluence(0.8, {
        observability: 1,
        appliedWeight: 0,
        trust: "untrusted",
      }),
    ).toBe("compass 0.80 target — now 0.00 untrusted");
  });

  it("names the TRUSTED phase, where the target is finally in play", () => {
    expect(
      describeCompassInfluence(0.8, {
        observability: 1,
        appliedWeight: 0.8,
        trust: "trusted",
      }),
    ).toBe("compass 0.80 target — now 0.80 trusted");
  });

  it("still names the silent end, which no phase should override", () => {
    expect(describeCompassInfluence(0)).toBe("compass 0.00 — GPS only");
  });

  it("survives a non-finite live weight rather than rendering NaN", () => {
    // The values come from a replayed or in-flight solve; `compass NaN` on a
    // readout whose purpose is trust is worse than showing only the target.
    expect(
      describeCompassInfluence(0.8, {
        observability: Number.NaN,
        appliedWeight: Number.NaN,
      }),
    ).toBe("compass 0.80 target");
  });
});
