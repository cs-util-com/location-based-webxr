import fc from "fast-check";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import {
  COMPUTER_SCREEN_QUERY,
  isComputerScreen,
  linkQrShown,
  linkQrSvg,
} from "./link-qr.js";

/** The dark modules an SVG from `linkQrSvg` draws, as "x,y" in modules
 *  of the code (the quiet zone taken off), read back from its path. */
function drawnModules(svg: string): { side: number; dark: Set<string> } {
  const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
  const path = /<path d="([^"]*)"/.exec(svg)?.[1] ?? "";
  const dark = new Set<string>();
  for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    dark.add(`${String(Number(m[1]) - 2)},${String(Number(m[2]) - 2)}`);
  }
  return { side, dark };
}

/** The dark modules of the library's own code for `url`, same keys. */
function expectedModules(url: string): { size: number; dark: Set<string> } {
  const { size, data } = QRCode.create(url, {
    errorCorrectionLevel: "M",
  }).modules;
  const dark = new Set<string>();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x] === 1) dark.add(`${String(x)},${String(y)}`);
    }
  }
  return { size, dark };
}

describe("linkQrShown", () => {
  // Why: the code is for moving the tour from a computer to a phone. A
  // phone without AR scanning it gains nothing, a device with AR needs
  // none, and a tour not finished yet has nothing to open elsewhere.
  const base = {
    visitor: true,
    arStatus: "unsupported",
    withheld: false,
    computerScreen: true,
  };

  it("shows for a visitor on a computer that cannot show AR", () => {
    expect(linkQrShown(base)).toBe(true);
  });

  it.each([
    ["a phone without AR", { computerScreen: false }],
    ["a creator", { visitor: false }],
    ["a device with AR", { arStatus: "ready" }],
    ["while AR support is checked", { arStatus: "checking" }],
    ["a tour not finished yet", { withheld: true }],
  ])("stays hidden for %s", (_name, change) => {
    expect(linkQrShown({ ...base, ...change })).toBe(false);
  });
});

describe("isComputerScreen", () => {
  // Why: the screen size decides the code; a browser that cannot answer
  // the media query must not throw on the visitor's page.
  it("asks the computer-screen query", () => {
    const asked: string[] = [];
    const answer = isComputerScreen({
      matchMedia: (q) => {
        asked.push(q);
        return { matches: true };
      },
    });
    expect(answer).toBe(true);
    expect(asked).toEqual([COMPUTER_SCREEN_QUERY]);
  });

  it("is false where matchMedia is missing or throws", () => {
    expect(isComputerScreen({})).toBe(false);
    expect(
      isComputerScreen({
        matchMedia: () => {
          throw new Error("no");
        },
      }),
    ).toBe(false);
  });
});

describe("linkQrSvg", () => {
  // Why: the code must encode exactly the link the page copies; reading
  // the drawn modules back and comparing them with the library's own code
  // for that link catches a swapped axis or an off-by-one quiet zone.
  it("draws the library's code for the link, module for module", () => {
    const url = "https://example.test/tour/?qr=abc";
    const svg = linkQrSvg(url);
    const want = expectedModules(url);
    const got = drawnModules(svg);
    expect(got.side).toBe(want.size + 4);
    expect(got.dark).toEqual(want.dark);
    expect(svg).toContain('fill="#fff"');
  });

  it("draws a different code for a different link", () => {
    expect(linkQrSvg("https://a.test/tour/?qr=1")).not.toBe(
      linkQrSvg("https://a.test/tour/?qr=2"),
    );
  });

  it("refuses an empty link", () => {
    expect(() => linkQrSvg("")).toThrow(TypeError);
  });

  it("matches the library's code for any link (property)", () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true }), (url) => {
        const want = expectedModules(url);
        const got = drawnModules(linkQrSvg(url));
        expect(got.side).toBe(want.size + 4);
        expect(got.dark).toEqual(want.dark);
      }),
      { numRuns: 40 },
    );
  });
});
