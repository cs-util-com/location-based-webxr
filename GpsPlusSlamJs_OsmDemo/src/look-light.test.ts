/**
 * The time-of-day blend's light.
 *
 * WHY THESE TESTS MATTER. At weight 1 on a look the blend must light the
 * city exactly as that look's fixed scheme does, or the blend and the fixed
 * scheme disagree at their shared ends; between looks the mix must stay a
 * light the atmosphere accepts (a rising gain ramp, a veil strength in
 * [0, 1], a sky balance of luminance 1). And a field the viewer set must
 * hold through every look, as it does through a scheme switch.
 */

import fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIGHT_SETTINGS,
  lightDefaultsFor,
  type LightSettings,
} from "./light-settings.js";
import { TIME_OF_DAY_LOOKS } from "./look-choice.js";
import { blendLookLight, lookLightSettings, rigLightOf } from "./look-light.js";

const PER_LOOK = lookLightSettings(
  DEFAULT_LIGHT_SETTINGS,
  DEFAULT_LIGHT_SETTINGS,
  new Set(),
);
const LOOKS = TIME_OF_DAY_LOOKS.length;
const unit = (k: number) => TIME_OF_DAY_LOOKS.map((_, j) => (j === k ? 1 : 0));

const weightsArb = fc
  .array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: LOOKS,
    maxLength: LOOKS,
  })
  .filter((w) => w.reduce((a, b) => a + b, 0) > 1e-3)
  .map((w) => {
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  });

describe("lookLightSettings", () => {
  it("gives each look its own light when the viewer set nothing", () => {
    TIME_OF_DAY_LOOKS.forEach((look, k) =>
      expect(PER_LOOK[k]).toEqual(lightDefaultsFor(look)),
    );
  });

  // WHY: a viewer who set the exposure at the day look means it for the
  // blend; a dusk look that took it back would undo the slider.
  it("keeps a field the viewer set in every look", () => {
    const current = { ...DEFAULT_LIGHT_SETTINGS, exposureEv: 0.5 };
    const perLook = lookLightSettings(
      current,
      DEFAULT_LIGHT_SETTINGS,
      new Set(["exposureEv"]),
    );
    for (const [k, s] of perLook.entries()) {
      expect(s.exposureEv).toBe(0.5);
      expect(s.hazeVeilLightness).toBe(
        lightDefaultsFor(TIME_OF_DAY_LOOKS[k]!).hazeVeilLightness,
      );
    }
  });
});

describe("blendLookLight", () => {
  // WHY: the blend and the fixed scheme must agree at their shared ends.
  it("is each look's own light at weight 1", () => {
    for (let k = 0; k < LOOKS; k++) {
      const { settings, light } = blendLookLight(PER_LOOK, unit(k));
      expect(settings).toEqual(PER_LOOK[k]);
      expect(light).toEqual(rigLightOf(PER_LOOK[k]!));
    }
  });

  it("mixes the scalar fields linearly", () => {
    const { settings, light } = blendLookLight(PER_LOOK, [0, 0.5, 0.5, 0]);
    const golden = PER_LOOK[1]!;
    const dusk = PER_LOOK[2]!;
    expect(settings.exposureEv).toBeCloseTo(
      (golden.exposureEv + dusk.exposureEv) / 2,
      12,
    );
    expect(light.exposure.ev).toBeCloseTo(settings.exposureEv, 12);
    expect(light.haze.visibilityKm).toBeCloseTo(
      (golden.hazeVisibilityKm + dusk.hazeVisibilityKm) / 2,
      12,
    );
  });

  // WHY: golden hour has no veil and dusk has one; halfway the veil must be
  // dusk's colour at half strength, not a lighter, shifted colour.
  it("fades a veil in by weight rather than shifting its colour", () => {
    const duskVeil = rigLightOf(PER_LOOK[2]!).veil!;
    const { light } = blendLookLight(PER_LOOK, [0, 0.5, 0.5, 0]);
    expect(light.veil!.strength).toBeCloseTo(0.5, 12);
    light.veil!.colour.forEach((c, i) =>
      expect(c).toBeCloseTo(0.5 * duskVeil.colour[i]!, 12),
    );
    expect(light.veil!.riseDeg).toBeCloseTo(duskVeil.riseDeg, 12);
  });

  // WHY: the sky balance is a cast of luminance 1; a mix with a look
  // without one (golden) must count that look as no cast, not drop it.
  it("mixes the sky balance with no cast for a look without one", () => {
    const dusk = rigLightOf(PER_LOOK[2]!).skyBalance!;
    const { light } = blendLookLight(PER_LOOK, [0, 0.5, 0.5, 0]);
    light.skyBalance!.forEach((g, c) =>
      expect(g).toBeCloseTo(0.5 * (dusk[c] ?? NaN) + 0.5, 12),
    );
    expect(
      blendLookLight(PER_LOOK, [0.5, 0.5, 0, 0]).light.skyBalance,
    ).toBeNull();
  });

  it("stays a light the atmosphere accepts, for any weights", () => {
    fc.assert(
      fc.property(weightsArb, (weights) => {
        const { settings, light } = blendLookLight(PER_LOOK, weights);
        expect(settings.gainFullDeg).toBeGreaterThan(settings.gainFromDeg);
        // No veil, or no cast, passes as a valid one would.
        const strength = light.veil?.strength ?? 0.5;
        expect(strength).toBeGreaterThan(0);
        expect(strength).toBeLessThanOrEqual(1 + 1e-12);
        const [r, g, b] = light.skyBalance ?? [1, 1, 1];
        expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 2);
        for (const field of Object.keys(settings) as (keyof LightSettings)[]) {
          const values = PER_LOOK.map((s) => s[field]);
          expect(settings[field]).toBeGreaterThanOrEqual(
            Math.min(...values) - 1e-9,
          );
          expect(settings[field]).toBeLessThanOrEqual(
            Math.max(...values) + 1e-9,
          );
        }
      }),
    );
  });

  it("refuses bad weights or lists before any work", () => {
    expect(() => blendLookLight(PER_LOOK, [1, 0])).toThrow(RangeError);
    expect(() => blendLookLight(PER_LOOK.slice(1), unit(0))).toThrow(
      RangeError,
    );
    expect(() => blendLookLight(PER_LOOK, [0.5, NaN, 0.5, 0])).toThrow(
      RangeError,
    );
    expect(() => blendLookLight(PER_LOOK, [-0.5, 1.5, 0, 0])).toThrow(
      RangeError,
    );
    expect(() => blendLookLight(PER_LOOK, [0.5, 0.4, 0, 0])).toThrow(
      RangeError,
    );
  });
});

/**
 * Source-text checks, because `BuildingView` and `main.ts` cannot be run in
 * the unit suite: they pin that a sun step is one atmosphere update and that
 * the page's sun is the store's, so the tests above test what the page runs.
 */
describe("the page's sun step", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const view = readFileSync(path.join(HERE, "building-view.ts"), "utf-8");
  const main = readFileSync(path.join(HERE, "main.ts"), "utf-8");

  // WHY: a light update and a separate sun update were two sky rebuilds and
  // two bakes per step (about 17 + 31 ms each on the phone).
  it("BuildingView updates the atmosphere once per sun step", () => {
    expect(view.split("this.atmosphere.setLight(")).toHaveLength(2);
    expect(view).toContain("this.atmosphere.setLight(light, angles)");
    expect(view.split("this.finishSunStep(")).toHaveLength(4);
  });

  // WHY: the sun is app state; a second copy in a closure is how two views
  // disagree about the time.
  it("main keeps the sun in the store, and the view follows it there", () => {
    expect(main).not.toMatch(/let sunInstant|let sunPlace/);
    expect(main).toContain("store.dispatch(sunMoved(next))");
    expect(main).toContain("store.dispatch(sunPlaceMoved(");
    expect(main).not.toContain("buildingView.setSunAngles(");
    expect(main).not.toContain("buildingView.setLightSettings(settings)");
  });
});
