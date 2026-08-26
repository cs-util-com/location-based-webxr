import { describe, expect, it } from "vitest";

import {
  MAX_HOME_PRINTABLE_SIDE_M,
  PRINT_BASE_URL,
  homePrintWarning,
  planPrintCode,
  printedSideCss,
} from "./qr-print";
import { AUTHOR_DEFAULT_SIZE_M } from "./qr-author-mode";
import { resolveQrPayload } from "./qr-launch-dispatch";

/**
 * Why these tests matter: the print panel is the creator's step ZERO — the
 * printed artifact is expensive to redo, and two silent mistakes would
 * survive into the field test: a launch URL whose `&c=` sits outside the
 * measured fits-a-QR guarantee, and a printed size that does not match
 * what the author later types into the minting panel (the whole PnP scale
 * hangs off that number). `printedSideCss` maps metres to exact CSS
 * centimetres — print CSS units are physically exact at 100% scale, which
 * is the point of rendering in-app instead of a generic generator.
 */
describe("planPrintCode", () => {
  it("builds the measured launch URL with the discriminator inside the guarantee", async () => {
    const plan = await planPrintCode(
      "https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0",
      "2",
    );
    expect(plan.url.startsWith(PRINT_BASE_URL)).toBe(true);
    expect(plan.url).toContain("c=2");
    // The builder picks the MEASURED smallest form (here the ~dictionary
    // codec, not raw) — what matters is that the app's own launch
    // dispatcher decodes it back to the exact hosting URL.
    const qr = new URL(plan.url).searchParams.get("qr");
    expect(qr).not.toBeNull();
    await expect(resolveQrPayload(qr as string, "https://x/")).resolves.toBe(
      "https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0",
    );
    expect(plan.qrVersion).toBeGreaterThan(0);
    expect(plan.qrVersion).toBeLessThanOrEqual(25); // the scannable ceiling
  });

  it("rejects a non-URL input in plain words", async () => {
    await expect(planPrintCode("not a url", "1")).rejects.toThrow();
  });

  it("omits &c= for the default code — both readers already fall back to it", async () => {
    // Printing c=1 spends 4 bytes of a bit-costed payload and disqualifies
    // the densest path-form candidates for nothing: absent-c reads as "1"
    // in codeFromSearch and codeFromDetectedText alike (PR #364 review).
    const plan = await planPrintCode(
      "https://www.dropbox.com/scl/fi/abc/tour.zip?rlkey=k&dl=0",
      "1",
    );
    expect(new URL(plan.url).searchParams.has("c")).toBe(false);
  });

  it("prints the BARE host so the forward keeps the densest encodings (ZD-9)", () => {
    // The landing page owns "/" and forwards ?qr= untouched to the viewer;
    // a path in the printed base would forfeit the dense forms forever.
    expect(new URL(PRINT_BASE_URL).pathname).toBe("/");
  });
});

describe("homePrintWarning", () => {
  it("is silent for the default size and warns in plain words past the page budget", () => {
    // A clipped QR does not decode AT ALL, and the panel's own "100% scale"
    // instruction is what turns overflow into a clip — so the warning must
    // ride in the same line (PR #364 review). The default must fit silently.
    expect(homePrintWarning(AUTHOR_DEFAULT_SIZE_M)).toBeNull();
    expect(homePrintWarning(MAX_HOME_PRINTABLE_SIDE_M)).toBeNull();
    const warning = homePrintWarning(0.2);
    expect(warning).toMatch(/cut off|will not scan/);
  });
});

describe("printedSideCss", () => {
  it("maps metres to exact CSS centimetres", () => {
    expect(printedSideCss(0.2)).toBe("20cm");
    expect(printedSideCss(0.145)).toBe("14.5cm");
  });

  it("keeps a hand-typed off-step size to 0.1 mm, as documented", () => {
    // The size input's `step` only gates the spinner — a typed 0.1234 m must
    // print as 12.34 cm, not snap to a full millimetre while the PnP solve
    // keeps the un-snapped value (PR #363 review: a silent ~0.3% scale bias).
    expect(printedSideCss(0.1234)).toBe("12.34cm");
    // ...and 0.1 mm is where the rounding stops: 123.46 mm → 12.35 cm.
    expect(printedSideCss(0.12346)).toBe("12.35cm");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-positive/non-finite size (%s)",
    (sizeM) => {
      expect(() => printedSideCss(sizeM)).toThrow();
    },
  );
});
