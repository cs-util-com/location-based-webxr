import fc from "fast-check";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import {
  COMPUTER_SCREEN_QUERY,
  isComputerScreen,
  onComputerScreenChange,
  LINK_QR_MAX_PX,
  LINK_QR_MODULE_PX,
  linkQrShown,
  linkQrSvg,
  shareLinkOf,
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
  const base: Parameters<typeof linkQrShown>[0] = {
    visitor: true,
    arStatus: "unsupported",
    withheld: false,
    computerScreen: true,
  };

  it("shows for a visitor on a computer that cannot show AR", () => {
    expect(linkQrShown(base)).toBe(true);
  });

  it.each<[string, Partial<Parameters<typeof linkQrShown>[0]>]>([
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

describe("onComputerScreenChange", () => {
  // Why: the code follows a window resized into or out of a computer
  // screen; a browser without the change event must not throw.
  it("listens to the computer-screen query's change event", () => {
    const asked: string[] = [];
    const added: string[] = [];
    let calls = 0;
    onComputerScreenChange(
      {
        matchMedia: (q) => {
          asked.push(q);
          return {
            matches: false,
            addEventListener: (type, listener) => {
              added.push(type);
              listener();
            },
          };
        },
      },
      () => {
        calls += 1;
      },
    );
    expect(asked).toEqual([COMPUTER_SCREEN_QUERY]);
    expect(added).toEqual(["change"]);
    expect(calls).toBe(1);
  });

  it("is a no-op where matchMedia, its change event, or either throws", () => {
    const listener = () => {
      throw new Error("must not be called");
    };
    expect(() => {
      onComputerScreenChange({}, listener);
    }).not.toThrow();
    expect(() => {
      onComputerScreenChange(
        { matchMedia: () => ({ matches: true }) },
        listener,
      );
    }).not.toThrow();
    expect(() => {
      onComputerScreenChange(
        {
          matchMedia: () => {
            throw new Error("no");
          },
        },
        listener,
      );
    }).not.toThrow();
    expect(() => {
      onComputerScreenChange(
        {
          matchMedia: () => ({
            matches: true,
            addEventListener: () => {
              throw new Error("no");
            },
          }),
        },
        listener,
      );
    }).not.toThrow();
  });
});

describe("shareLinkOf", () => {
  // Why: the code and Copy link carry the tour's link, not whatever else
  // the page's address holds: every extra character makes the code denser.
  it("keeps the page and its qr parameter only", () => {
    expect(
      shareLinkOf(
        "https://example.test/tour/?debug=1&qr=abc%20d&nocache=1#station-2",
      ),
    ).toBe("https://example.test/tour/?qr=abc%20d");
    // Its own encoding kept: the link of a plain address is unchanged.
    const plain = `https://example.test/tour/?qr=${encodeURIComponent("https://h.test/a b!(c).zip")}`;
    expect(shareLinkOf(plain)).toBe(plain);
    expect(shareLinkOf("https://example.test/tour/?qr=abc")).toBe(
      "https://example.test/tour/?qr=abc",
    );
  });

  // Why: a page opened from a file or a blob has no origin to print (its
  // `origin` reads "null", a blob's names the page that made it), so a
  // link built from origin and path read `null/...?qr=` or doubled the
  // host. The link is the page's own address with the query swapped.
  it("keeps a file or blob page's own address", () => {
    expect(shareLinkOf("file:///C:/tours/index.html?debug=1&qr=abc#top")).toBe(
      "file:///C:/tours/index.html?qr=abc",
    );
    expect(shareLinkOf("blob:https://example.test/1234?debug=1&qr=abc")).toBe(
      "blob:https://example.test/1234?qr=abc",
    );
  });

  it("gives an address without a qr parameter, or one it cannot read, back as it is", () => {
    expect(shareLinkOf("https://example.test/tour/?debug=1")).toBe(
      "https://example.test/tour/?debug=1",
    );
    expect(shareLinkOf("not a url")).toBe("not a url");
  });
});

/** Visitor links for the shortest to the longest form of storage provider
 *  link a tour is shared by (the forms `share-link.ts` resolves), on the
 *  viewer's own page. */
const PROVIDER_LINKS = [
  "https://raw.githubusercontent.com/a/b/main/t.zip",
  "https://www.dropbox.com/scl/fi/4xk2n8d0q6z1v9w3e5r7t/old-town-walk.zip?rlkey=8f3k2m9x0p1q7w4e6r5t2y8u1&dl=1",
  "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456/view?usp=sharing",
  "https://1drv.ms/u/s!AkXyZ0123456789abcdefghijklmnopQRSTUVwxyz?e=AbCdEf",
  "https://contoso-my.sharepoint.com/:u:/g/personal/first_last_contoso_onmicrosoft_com/EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCdEfGhIjKlMnOpQrStUvWxYz?e=AbC123&download=1",
].map((url) => `https://example.test/tour/?qr=${encodeURIComponent(url)}`);

describe("linkQrSvg size", () => {
  // Why: a fixed 124 px box scaled every code to fit, so a long link drew
  // modules of a fraction of a pixel, blurred and harder to scan from a
  // screen. Each module is a whole number of CSS pixels instead, the box
  // sized from the module count.
  it("draws each module a whole number of CSS pixels, the box from the module count", () => {
    expect(Number.isInteger(LINK_QR_MODULE_PX)).toBe(true);
    expect(LINK_QR_MODULE_PX).toBe(3);
    for (const link of PROVIDER_LINKS) {
      const svg = linkQrSvg(link);
      const { side } = drawnModules(svg);
      const px = String(side * LINK_QR_MODULE_PX);
      expect(svg, link).toContain(`width="${px}" height="${px}"`);
      // Still small enough to stand beside Copy link on a computer screen.
      expect(side * LINK_QR_MODULE_PX, link).toBeLessThanOrEqual(
        LINK_QR_MAX_PX,
      );
    }
  });

  // Why: the code stands beside the Copy link dial in the visitor's
  // column (at most 440 px with its padding, the dial up to 156 px, a
  // 40 px gap), so a code past about 240 px pushes the row out of it.
  // Such a link gets no code, the same way as one too long for any code;
  // the shown one is never larger than the room. The links are a 231 px
  // and a 243 px code, the two sizes either side of the limit.
  it("refuses a code larger than the room beside Copy link", () => {
    expect(LINK_QR_MAX_PX).toBe(240);
    const fits = `https://example.test/tour/?qr=${"a".repeat(310)}`;
    const tooLarge = `https://example.test/tour/?qr=${"a".repeat(340)}`;
    expect(drawnModules(linkQrSvg(fits)).side * LINK_QR_MODULE_PX).toBe(231);
    expect(() => linkQrSvg(tooLarge)).toThrow(RangeError);
    expect(
      (QRCode.create(tooLarge, { errorCorrectionLevel: "M" }).modules.size +
        4) *
        LINK_QR_MODULE_PX,
    ).toBe(243);
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
