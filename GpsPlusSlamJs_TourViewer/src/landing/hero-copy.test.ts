/**
 * Why these tests matter: the hero's three lines under the headline are
 * the page's whole pitch, chosen word for word: what a maker does, the
 * promise that the tour needs no app and no account and stays in the
 * maker's own storage, and what the printed code does for a visitor. The
 * landing's browser spec pins where they stand, not what they say, so a
 * reworded line would otherwise pass every gate. The order matters too:
 * the promise is the emphasis between the two plain lines.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");

/** The text of the first `<p class="<cls>">` in the page, tags dropped and
 *  white space collapsed as a browser shows it; null when there is none. */
function lineText(cls: string): string | null {
  const match = new RegExp(`<p class="${cls}">([\\s\\S]*?)</p>`).exec(html);
  if (match === null) return null;
  return (match[1] ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the landing hero's lines in index.html", () => {
  it("says the three chosen lines, word for word", () => {
    expect(lineText("landing-lede")).toBe(
      "Make an AR tour with your phone and share it with a printed code.",
    );
    expect(lineText("landing-promise")).toBe(
      "No app. No account. Your tour stays with you, in your own Google Drive, Dropbox or similar.",
    );
    expect(lineText("landing-code-line")).toBe(
      "The code you hang up opens the tour and shows every visitor's phone exactly where it stands.",
    );
  });

  it("sets the promise in bold, as the one emphasis of the three", () => {
    expect(html).toMatch(
      /<p class="landing-promise">\s*<b\s*>[^<]+<\/b\s*>\s*<\/p>/,
    );
  });

  it("keeps them in order under the headline, before the Android line and the button", () => {
    const at = (needle: string) => html.indexOf(needle);
    const order = [
      'id="landing-title"',
      'class="landing-lede"',
      'class="landing-promise"',
      'class="landing-code-line"',
      'data-testid="landing-needs"',
      'data-testid="landing-begin-top"',
    ].map(at);
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("Tours run on Android phones with Chrome.");
  });

  it("no longer carries the two paragraphs it replaced", () => {
    expect(html).not.toContain("Here are the tools");
    expect(html).not.toContain("landing-make-line");
  });
});
