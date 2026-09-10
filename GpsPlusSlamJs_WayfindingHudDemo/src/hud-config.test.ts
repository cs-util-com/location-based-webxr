/**
 * Unit tests for the HUD demo config sanitiser.
 *
 * Why these tests matter: slider values feed straight into
 * `createWayfindingHud`, which THROWS on malformed ranges (inverted deadband,
 * non-positive scale). A slider glitch or NaN parse must degrade to a clamped
 * config — the alternative is a dead HUD after a UI interaction.
 */
import { describe, expect, it } from "vitest";

import {
  AR_HUD_CONFIG,
  SIM_HUD_CONFIG,
  sanitizeHudDemoConfig,
} from "./hud-config";

describe("sanitizeHudDemoConfig", () => {
  it("passes a valid config through unchanged", () => {
    const config = {
      distanceMin: 2,
      distanceMax: 5,
      indicatorScale: 0.8,
      imageIndicators: true,
      entrance: true,
    };
    expect(sanitizeHudDemoConfig(config, AR_HUD_CONFIG)).toEqual(config);
  });

  it("clamps an inverted deadband so max never undercuts min", () => {
    const result = sanitizeHudDemoConfig(
      {
        distanceMin: 6,
        distanceMax: 2,
        indicatorScale: 1,
        imageIndicators: false,
        entrance: true,
      },
      AR_HUD_CONFIG,
    );
    expect(result.distanceMin).toBe(6);
    expect(result.distanceMax).toBe(6);
  });

  it("clamps a negative distanceMin to zero", () => {
    const result = sanitizeHudDemoConfig(
      {
        distanceMin: -3,
        distanceMax: 2,
        indicatorScale: 1,
        imageIndicators: false,
        entrance: true,
      },
      AR_HUD_CONFIG,
    );
    expect(result.distanceMin).toBe(0);
    expect(result.distanceMax).toBe(2);
  });

  it("replaces non-finite fields with the mode fallback", () => {
    const result = sanitizeHudDemoConfig(
      {
        distanceMin: Number.NaN,
        distanceMax: Number.POSITIVE_INFINITY,
        indicatorScale: Number.NaN,
        imageIndicators: false,
        entrance: true,
      },
      SIM_HUD_CONFIG,
    );
    expect(result).toEqual(SIM_HUD_CONFIG);
  });

  it("clamps the indicator scale into its positive range", () => {
    const tiny = sanitizeHudDemoConfig(
      {
        distanceMin: 1,
        distanceMax: 2,
        indicatorScale: 0,
        imageIndicators: false,
        entrance: true,
      },
      AR_HUD_CONFIG,
    );
    expect(tiny.indicatorScale).toBe(0.1);
    const huge = sanitizeHudDemoConfig(
      {
        distanceMin: 1,
        distanceMax: 2,
        indicatorScale: 99,
        imageIndicators: false,
        entrance: true,
      },
      AR_HUD_CONFIG,
    );
    expect(huge.indicatorScale).toBe(5);
  });

  // Why this test matters: the checkbox value reaches the sanitiser as part
  // of the same raw config the sliders feed; a non-boolean (undefined after a
  // DOM mishap) must degrade to the mode fallback, mirroring the numeric
  // finiteness rule — never to a truthy surprise.
  it("passes a boolean imageIndicators through and falls back on non-boolean", () => {
    const on = sanitizeHudDemoConfig(
      {
        distanceMin: 1,
        distanceMax: 2,
        indicatorScale: 1,
        imageIndicators: true,
        entrance: true,
      },
      AR_HUD_CONFIG,
    );
    expect(on.imageIndicators).toBe(true);
    const broken = sanitizeHudDemoConfig(
      {
        distanceMin: 1,
        distanceMax: 2,
        indicatorScale: 1,
        imageIndicators: undefined as unknown as boolean,
        entrance: true,
      },
      { ...AR_HUD_CONFIG, imageIndicators: true },
    );
    expect(broken.imageIndicators).toBe(true);
  });

  // Why this test matters: both entry modes must start on the procedural
  // (3D cone/ring) path — the image path is the opt-in demo comparison.
  it("keeps image indicators off in both mode defaults", () => {
    expect(AR_HUD_CONFIG.imageIndicators).toBe(false);
    expect(SIM_HUD_CONFIG.imageIndicators).toBe(false);
  });

  it("mode defaults are themselves valid (sanitising is identity)", () => {
    expect(sanitizeHudDemoConfig(AR_HUD_CONFIG, AR_HUD_CONFIG)).toEqual(
      AR_HUD_CONFIG,
    );
    expect(sanitizeHudDemoConfig(SIM_HUD_CONFIG, SIM_HUD_CONFIG)).toEqual(
      SIM_HUD_CONFIG,
    );
  });
});

describe("sanitizeHudDemoConfig — the entrance toggle", () => {
  // Why: the same boolean rule as image indicators — a checkbox read gone
  // wrong degrades to the mode fallback, never to truthiness (M4 of the HUD
  // diamond entrance plan). Both mode defaults ship with the entrance ON.
  it("keeps a boolean, falls back on garbage, and defaults ON in both modes", () => {
    const base = {
      distanceMin: 1,
      distanceMax: 2,
      indicatorScale: 1,
      imageIndicators: true,
    };
    expect(
      sanitizeHudDemoConfig({ ...base, entrance: false }, AR_HUD_CONFIG)
        .entrance,
    ).toBe(false);
    expect(
      sanitizeHudDemoConfig(
        { ...base, entrance: "yes" as unknown as boolean },
        AR_HUD_CONFIG,
      ).entrance,
    ).toBe(true);
    expect(AR_HUD_CONFIG.entrance).toBe(true);
    expect(SIM_HUD_CONFIG.entrance).toBe(true);
  });
});
