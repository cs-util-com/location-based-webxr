/**
 * Unit tests for the design-token reader.
 *
 * Why these tests matter: the HUD's tint is the design system's accent, and
 * the demo passes the LIVE token value so a re-tuned `--accent` moves the
 * WebGL indicators with the CSS. The reader sits between a stylesheet that
 * may be absent (jsdom, an app that does not vendor the sheet) and a
 * framework option that must then be omitted, not passed as an empty string
 * (which `THREE.Color` would read as black).
 */
import { describe, expect, it } from "vitest";

import { readCssToken, type TokenView } from "./design-token";

function viewWith(values: Record<string, string>): TokenView {
  return {
    document: { documentElement: {} as Element },
    getComputedStyle: () =>
      ({
        getPropertyValue: (name: string) => values[name] ?? "",
      }) as CSSStyleDeclaration,
  };
}

describe("readCssToken", () => {
  it("returns the trimmed token value when the sheet defines it", () => {
    expect(
      readCssToken("--accent", viewWith({ "--accent": " #f2971f " })),
    ).toBe("#f2971f");
  });

  it("returns undefined when the token is absent or empty, so the caller omits the option", () => {
    expect(readCssToken("--accent", viewWith({}))).toBeUndefined();
    expect(
      readCssToken("--accent", viewWith({ "--accent": "   " })),
    ).toBeUndefined();
  });

  it("returns undefined without a window (node, workers)", () => {
    expect(readCssToken("--accent", undefined)).toBeUndefined();
  });

  it("refuses a name that is not a custom property", () => {
    // A bare `accent` reads a regular CSS property and would silently return
    // whatever the root element computes for it.
    expect(() => readCssToken("accent", viewWith({}))).toThrow(TypeError);
  });
});
