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
} from "./compass-influence.js";

describe("compassSettingsFor", () => {
  it("silences the compass COMPLETELY at zero, which takes three settings", () => {
    // Disabling the rotation prior alone is not zero: the cold-start override
    // has the same curve and is on by default, so it takes over. Both off, and
    // the weight zeroed, is the only combination that means what the label says.
    expect(compassSettingsFor(0)).toEqual({
      rotationPriorEnabled: false,
      coldStartOverrideEnabled: false,
      experimentEnabled: false,
      voteWeight: 0,
    });
  });

  it("turns the cold-start override OFF at every non-zero position too", () => {
    // Otherwise two mechanisms drive yaw at once and the slider is not what is
    // being measured — the override's curve would confound every reading.
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

  it("matches the RecorderApp's step and default", () => {
    // A compass-vote slider already ships there — range 0-1, step 0.05, default
    // 0.1. Two demos disagreeing about the scale of the same knob would make
    // field notes from one useless against the other.
    expect(COMPASS_INFLUENCE_STEP).toBe(0.05);
    expect(COMPASS_INFLUENCE_DEFAULT).toBe(0.1);
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
