/**
 * Unit tests for the shared HUD option derivation.
 *
 * Why these tests matter: both hosts build the framework HUD from this one
 * function, so a key that is present when it should be absent (an
 * `indicatorColor: undefined`, an empty sprite URL) would reach the framework
 * from BOTH modes at once. The presence/absence of each optional key is the
 * contract, and it is asserted with `in`, not with `toBeUndefined`.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./design-token", () => ({
  readCssToken: vi.fn((): string | undefined => undefined),
}));
import { readCssToken } from "./design-token";
import { hudLookOptions } from "./hud-options";

const CONFIG = {
  distanceMin: 1.5,
  distanceMax: 3,
  indicatorScale: 2,
  imageIndicators: false,
  entrance: true,
};

describe("hudLookOptions", () => {
  it("carries the deadband and scale, and no optional key when nothing asks for one", () => {
    const options = hudLookOptions(CONFIG);
    expect(options).toEqual({
      distanceMin: 1.5,
      distanceMax: 3,
      indicatorScale: 2,
    });
    expect("indicatorColor" in options).toBe(false);
    expect("arrowSprite" in options).toBe(false);
  });

  it("passes the live accent token as indicatorColor when the sheet defines it", () => {
    vi.mocked(readCssToken).mockReturnValueOnce("#123456");
    const options = hudLookOptions(CONFIG);
    expect(readCssToken).toHaveBeenCalledWith("--accent");
    expect(options.indicatorColor).toBe("#123456");
  });

  it("adds both sprite URLs when image indicators are on", () => {
    const options = hudLookOptions({ ...CONFIG, imageIndicators: true });
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*\.svg$/);
    expect(options.circleSprite).toMatch(/wayfinding-diamond.*\.svg$/);
  });
});

describe("hudLookOptions — the entrance", () => {
  // Why these tests matter: the framework rejects `circleEntrance` next to
  // `circleSprite`, and it needs BOTH tokens; a derivation that passed the
  // sprite alongside, or the entrance with a missing token, would throw in
  // both hosts at once (HUD diamond entrance plan, M4).
  it("passes circleEntrance with the two tokens and OMITS circleSprite when image indicators and the entrance are on", () => {
    vi.mocked(readCssToken).mockImplementation((name) =>
      name === "--accent" ? "#f2971f" : name === "--ink" ? "#fff" : undefined,
    );
    const options = hudLookOptions({
      ...CONFIG,
      imageIndicators: true,
      entrance: true,
    });
    expect(options.circleEntrance).toEqual({ ink: "#fff", accent: "#f2971f" });
    expect("circleSprite" in options).toBe(false);
    expect(options.arrowSprite).toMatch(/wayfinding-arrow.*.svg$/);
    vi.mocked(readCssToken).mockReset();
    vi.mocked(readCssToken).mockReturnValue(undefined);
  });

  it("falls back to the static sprite when the entrance is off, or a token is missing, or image indicators are off", () => {
    vi.mocked(readCssToken).mockImplementation((name) =>
      name === "--accent" ? "#f2971f" : name === "--ink" ? "#fff" : undefined,
    );
    const off = hudLookOptions({
      ...CONFIG,
      imageIndicators: true,
      entrance: false,
    });
    expect("circleEntrance" in off).toBe(false);
    expect(off.circleSprite).toMatch(/wayfinding-diamond.*.svg$/);
    vi.mocked(readCssToken).mockReset();
    vi.mocked(readCssToken).mockReturnValue(undefined);
    const noTokens = hudLookOptions({
      ...CONFIG,
      imageIndicators: true,
      entrance: true,
    });
    expect("circleEntrance" in noTokens).toBe(false);
    expect(noTokens.circleSprite).toMatch(/wayfinding-diamond.*.svg$/);
    const procedural = hudLookOptions({ ...CONFIG, entrance: true });
    expect("circleEntrance" in procedural).toBe(false);
    expect("circleSprite" in procedural).toBe(false);
  });
});
