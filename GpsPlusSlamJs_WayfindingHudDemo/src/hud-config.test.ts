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
    const config = { distanceMin: 2, distanceMax: 5, indicatorScale: 0.8 };
    expect(sanitizeHudDemoConfig(config, AR_HUD_CONFIG)).toEqual(config);
  });

  it("clamps an inverted deadband so max never undercuts min", () => {
    const result = sanitizeHudDemoConfig(
      { distanceMin: 6, distanceMax: 2, indicatorScale: 1 },
      AR_HUD_CONFIG,
    );
    expect(result.distanceMin).toBe(6);
    expect(result.distanceMax).toBe(6);
  });

  it("clamps a negative distanceMin to zero", () => {
    const result = sanitizeHudDemoConfig(
      { distanceMin: -3, distanceMax: 2, indicatorScale: 1 },
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
      },
      SIM_HUD_CONFIG,
    );
    expect(result).toEqual(SIM_HUD_CONFIG);
  });

  it("clamps the indicator scale into its positive range", () => {
    const tiny = sanitizeHudDemoConfig(
      { distanceMin: 1, distanceMax: 2, indicatorScale: 0 },
      AR_HUD_CONFIG,
    );
    expect(tiny.indicatorScale).toBe(0.1);
    const huge = sanitizeHudDemoConfig(
      { distanceMin: 1, distanceMax: 2, indicatorScale: 99 },
      AR_HUD_CONFIG,
    );
    expect(huge.indicatorScale).toBe(5);
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
