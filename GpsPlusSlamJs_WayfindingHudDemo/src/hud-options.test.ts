/**
 * Unit tests for the shared HUD option derivation.
 *
 * Why these tests matter: both hosts build the framework HUD from this one
 * function, so a key that is present when it should be absent (an
 * `indicatorColor: undefined`, an empty sprite URL) would reach the framework
 * from BOTH modes at once. The presence/absence of each optional key is the
 * contract, and it is asserted with `in`, not with `toBeUndefined`; and every
 * branch's output is fed through the framework's REAL validator, so a
 * combination the framework rejects (the entrance next to the static sprite)
 * fails here rather than at HUD creation in both hosts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { validateWayfindingHudOptions } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";

vi.mock("./design-token", () => ({
  readCssToken: vi.fn((): string | undefined => undefined),
}));

import { readCssToken } from "./design-token";
import { hudLookOptions } from "./hud-options";
import type { HudDemoConfig } from "./hud-config";

const CONFIG: HudDemoConfig = {
  distanceMin: 1.5,
  distanceMax: 3,
  indicatorScale: 2,
  imageIndicators: false,
  entrance: true,
};

/** The sheet's two tokens, as `readCssToken` returns them when present. */
const tokens = (name: string): string | undefined =>
  name === "--accent" ? "#f2971f" : name === "--ink" ? "#fff" : undefined;

/** Every derivation must survive the framework's own validator. */
function acceptedByTheFramework(config: HudDemoConfig): void {
  expect(() =>
    validateWayfindingHudOptions({
      camera: new THREE.PerspectiveCamera(),
      getTargets: () => [],
      ...hudLookOptions(config),
    }),
  ).not.toThrow();
}

beforeEach(() => {
  // A persistent mock from one test must never leak into the next: a failing
  // assertion mid-test would otherwise turn one failure into a cascade.
  vi.mocked(readCssToken).mockReset();
  vi.mocked(readCssToken).mockReturnValue(undefined);
});

describe("hudLookOptions", () => {
  it("carries the deadband and scale, and no optional key when nothing asks for one", () => {
    const options = hudLookOptions({ ...CONFIG, entrance: false });
    expect(options).toEqual({
      distanceMin: 1.5,
      distanceMax: 3,
      indicatorScale: 2,
    });
    expect("indicatorColor" in options).toBe(false);
    expect("arrowSprite" in options).toBe(false);
    acceptedByTheFramework({ ...CONFIG, entrance: false });
  });

  it("passes the live accent token as indicatorColor when the sheet defines it", () => {
    vi.mocked(readCssToken).mockReturnValueOnce("#123456");
    const options = hudLookOptions(CONFIG);
    expect(readCssToken).toHaveBeenCalledWith("--accent");
    expect(options.indicatorColor).toBe("#123456");
  });

  it("adds both sprite URLs when image indicators are on and the entrance is off", () => {
    const config = { ...CONFIG, imageIndicators: true, entrance: false };
    const options = hudLookOptions(config);
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*\.svg$/);
    expect(options.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
    acceptedByTheFramework(config);
  });
});

describe("hudLookOptions — the entrance", () => {
  // Why these tests matter: the framework rejects `circleEntrance` next to
  // `circleSprite`, and it needs BOTH tokens; a derivation that passed the
  // sprite alongside, or the entrance with a missing token, would throw in
  // both hosts at once (HUD diamond entrance plan, M4).
  it("passes circleEntrance with the two tokens and OMITS circleSprite when image indicators and the entrance are on", () => {
    vi.mocked(readCssToken).mockImplementation(tokens);
    const config = { ...CONFIG, imageIndicators: true, entrance: true };
    const options = hudLookOptions(config);
    expect(options.circleEntrance).toEqual({ ink: "#fff", accent: "#f2971f" });
    expect("circleSprite" in options).toBe(false);
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*\.svg$/);
    acceptedByTheFramework(config);
  });

  it("falls back to the static sprite when the entrance is off, or a token is missing, or image indicators are off", () => {
    vi.mocked(readCssToken).mockImplementation(tokens);
    const off = { ...CONFIG, imageIndicators: true, entrance: false };
    const offOptions = hudLookOptions(off);
    expect("circleEntrance" in offOptions).toBe(false);
    expect(offOptions.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
    acceptedByTheFramework(off);

    vi.mocked(readCssToken).mockReset();
    vi.mocked(readCssToken).mockReturnValue(undefined);
    const noTokens = { ...CONFIG, imageIndicators: true, entrance: true };
    const noTokenOptions = hudLookOptions(noTokens);
    expect("circleEntrance" in noTokenOptions).toBe(false);
    expect(noTokenOptions.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
    acceptedByTheFramework(noTokens);

    const procedural = { ...CONFIG, entrance: true };
    const proceduralOptions = hudLookOptions(procedural);
    expect("circleEntrance" in proceduralOptions).toBe(false);
    expect("circleSprite" in proceduralOptions).toBe(false);
    acceptedByTheFramework(procedural);
  });
});
