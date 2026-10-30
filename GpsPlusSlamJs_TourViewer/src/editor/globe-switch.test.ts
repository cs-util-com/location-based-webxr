/**
 * Why these tests matter: the editor on the globe ships behind a link
 * switch until the owner has tried it, so the switch must be OFF for every
 * link that does not ask for it (the default editor's e2e opens without
 * it), and the two tuning knobs the owner sets by hand in the link must
 * never turn a typo into a broken view: a value that is not a number in
 * range falls back to the default instead of hiding everything (0 px) or
 * nothing (Infinity).
 */
import { describe, expect, it } from "vitest";

import { GLOBE_SWITCH, readGlobeSwitch } from "./globe-switch.js";

describe("readGlobeSwitch", () => {
  it("is off with its defaults for a link without the switch", () => {
    expect(readGlobeSwitch("")).toEqual({
      on: false,
      hidePx: GLOBE_SWITCH.hidePx.fallback,
      crowdPx: GLOBE_SWITCH.crowdPx.fallback,
    });
    expect(readGlobeSwitch("?tour=https://example.org/walk.zip").on).toBe(
      false,
    );
  });

  it("is on only for globe=1", () => {
    expect(readGlobeSwitch("?globe=1").on).toBe(true);
    expect(readGlobeSwitch("globe=1").on).toBe(true);
    for (const value of ["0", "", "yes", "true", "2"]) {
      expect(readGlobeSwitch(`?globe=${value}`).on).toBe(false);
    }
  });

  it("reads both knobs", () => {
    expect(readGlobeSwitch("?globe=1&globeHidePx=5&globeCrowdPx=40")).toEqual({
      on: true,
      hidePx: 5,
      crowdPx: 40,
    });
    expect(readGlobeSwitch("?globeHidePx=2.5").hidePx).toBe(2.5);
  });

  // Why: a knob out of its range or not a number is a typo; the default
  // keeps the view usable and the owner sees the knob had no effect.
  it("falls back to the default for a knob that is not a number in range", () => {
    const { hidePx, crowdPx } = GLOBE_SWITCH;
    for (const bad of ["", "abc", "NaN", "Infinity", "-1", "1e9"]) {
      expect(readGlobeSwitch(`?globeHidePx=${bad}`).hidePx).toBe(
        hidePx.fallback,
      );
      expect(readGlobeSwitch(`?globeCrowdPx=${bad}`).crowdPx).toBe(
        crowdPx.fallback,
      );
    }
    expect(readGlobeSwitch(`?globeHidePx=${hidePx.min}`).hidePx).toBe(
      hidePx.min,
    );
    expect(readGlobeSwitch(`?globeHidePx=${hidePx.min / 2}`).hidePx).toBe(
      hidePx.fallback,
    );
    expect(readGlobeSwitch(`?globeCrowdPx=${crowdPx.max}`).crowdPx).toBe(
      crowdPx.max,
    );
    // 0 turns the crowding off: no pin is ever closer than 0 px.
    expect(readGlobeSwitch("?globeCrowdPx=0").crowdPx).toBe(0);
  });

  it("keeps its defaults inside their own ranges", () => {
    for (const knob of [GLOBE_SWITCH.hidePx, GLOBE_SWITCH.crowdPx]) {
      expect(knob.fallback).toBeGreaterThanOrEqual(knob.min);
      expect(knob.fallback).toBeLessThanOrEqual(knob.max);
    }
  });
});
