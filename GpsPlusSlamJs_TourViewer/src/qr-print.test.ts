import { describe, expect, it } from "vitest";

import { PRINT_BASE_URL, planPrintCode, printedSideCss } from "./qr-print";
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
