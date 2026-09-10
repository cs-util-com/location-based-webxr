/**
 * Why these tests matter: step 2 tells creators to put their tour link
 * through a URL shortener, and that advice is only safe with its warning
 * attached. Measured 2026-09-10 with an `Origin` header set to the app's
 * own: a live `bit.ly` redirect carries no `access-control-allow-origin`,
 * so a browser fetching the tour through one fails at the redirect and the
 * tour never opens. `t.co`'s carries the reflected origin, so this is a
 * per-provider setting rather than a fact about shorteners.
 *
 * The failure mode this copy exists to prevent is the nasty kind: the
 * creator taps their own short link, the browser follows the redirect with
 * no CORS check at all, the page appears, and everything looks fine - while
 * every visitor gets nothing. A recommendation whose warning drifts away
 * from it is therefore worse than no recommendation, which is why these
 * assert CO-LOCATION rather than mere presence somewhere in the file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");

/**
 * The print step's own copy: everything between the element that shows the
 * encoded address and the visitor-preview link that closes the step. Sliced
 * from the markup rather than matched against the whole file so that a
 * warning living in some other step cannot satisfy these tests.
 */
function printStepCopy(): string {
  const start = html.indexOf('id="print-url-out"');
  const end = html.indexOf('id="visitor-link"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("the shortener advice carries its warning", () => {
  it("still recommends shortening, because the density win is real", () => {
    // The alternative on the table was dropping the advice entirely. It was
    // rejected: a shorter payload means fewer, chunkier modules, which is
    // what lets a code be read from across a room. This pins that the
    // warning below was added INSTEAD of a removal, not alongside one.
    expect(printStepCopy()).toMatch(/shortener/i);
  });

  it("names bit.ly, the provider measured to break the tour", () => {
    // Naming it is the whole value. "Some shorteners may not work" sends a
    // creator to try one at random with no way to tell which they got.
    expect(printStepCopy()).toMatch(/bit\.ly/i);
  });

  it("tells the creator their own tap is not a test", () => {
    // The symptom, not the mechanism: nobody can inspect a response header,
    // and the address bar follows a redirect without any CORS check, so the
    // one check a creator would naturally run is the one that lies. The
    // copy has to say so in words, and point at step 1 instead.
    const copy = printStepCopy();
    expect(copy).toMatch(/proves nothing|is not (?:a|the) test/i);
    expect(copy).toMatch(/step 1/i);
  });

  it("does not offer t.co as the way out", () => {
    // t.co is the provider whose redirect was PROVEN to carry the header,
    // and recommending it would still be wrong: it only shortens links
    // posted on X, so a creator cannot put a tour through it. Proven and
    // usable are different questions, and this test exists because the
    // first draft of this change nearly conflated them.
    expect(printStepCopy()).not.toMatch(/t\.co/i);
  });
});
