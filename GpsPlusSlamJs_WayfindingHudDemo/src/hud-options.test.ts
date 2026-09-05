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
