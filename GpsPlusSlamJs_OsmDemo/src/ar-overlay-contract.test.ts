import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The two `dom-overlay` contract items the r541 field report ran into, pinned
 * so they cannot silently regress.
 *
 * **Both are DEFENSIVE, and neither is proven to be the reported cause.** The
 * research pass (plan §12) found an active, unfixed Chrome Android bug —
 * crbug 41397012, touch offset by the top-bar height plus a white margin at the
 * screen bottom, worst in WebAR — that would produce BOTH reported symptoms on
 * its own: a compass bar that floats above a gap, and a gear button that does
 * not respond because the tap lands elsewhere. That can only be settled on a
 * device, by a cold Chrome restart and a clean AR entry.
 *
 * These two fixes are correct regardless of which cause is real, which is why
 * they are worth having anyway — and they are kept in their own commit so they
 * can be reverted independently if the device test exonerates them.
 */

const INDEX_HTML = new URL("../index.html", import.meta.url);

describe("the dom-overlay contract", () => {
  it("asks for viewport-fit=cover, or every safe-area inset is silently 0", () => {
    // Why this test matters: `env(safe-area-inset-*)` returns **0** unless the
    // viewport meta opts in with `viewport-fit=cover`. Without it, CSS written
    // to pin a bar to the true bottom edge of a phone resolves its inset to
    // nothing and the bar sits wherever the layout happens to leave it — with no
    // error, no warning, and CSS that reads as correct.
    //
    // That is a candidate explanation for the compass bar being reported as
    // floating rather than flush (Q8), independent of the Chrome bug above.
    // Source: Chrome's edge-to-edge migration guide.
    const html = readFileSync(INDEX_HTML, "utf8");
    const viewport = /<meta\s+name="viewport"[^>]*content="([^"]*)"/i.exec(
      html,
    );

    expect(viewport, "no viewport meta tag at all").not.toBeNull();
    expect(viewport?.[1] ?? "").toMatch(/viewport-fit\s*=\s*cover/);
  });
});
