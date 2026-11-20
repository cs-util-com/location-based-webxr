import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Why this test matters: the page module can be mounted into another
 * page, and a stylesheet with rules on `:root`, `html`, `body`, `*` or a
 * bare `.btn` restyles that page too. Every style rule outside a nested
 * one must name the page root class, and every animation name must carry
 * the page's prefix (keyframe names are global).
 */

/** The selectors of every style rule that sits only inside at-rules
 *  (`@layer`, `@media`), never inside another style rule, and every
 *  `@keyframes` name. */
function outerRules(css: string): {
  selectors: string[];
  keyframes: string[];
} {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  const keyframes: string[] = [];
  const stack: ("at" | "rule" | "frames")[] = [];
  let prelude = "";
  for (const ch of text) {
    if (ch === "{") {
      const p = prelude.trim();
      prelude = "";
      const inside = stack.some((k) => k !== "at");
      if (p.startsWith("@keyframes")) {
        keyframes.push(p.slice("@keyframes".length).trim());
        stack.push("frames");
      } else if (p.startsWith("@")) {
        stack.push("at");
      } else {
        if (!inside) selectors.push(p);
        stack.push("rule");
      }
    } else if (ch === "}") {
      stack.pop();
      prelude = "";
    } else if (ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return { selectors, keyframes };
}

describe("trainer-page.css", () => {
  const css = readFileSync(
    new URL("./trainer-page.css", import.meta.url),
    "utf8",
  );

  it("scopes every rule under the page root class", () => {
    const { selectors } = outerRules(css);
    expect(selectors.length).toBeGreaterThan(0);
    for (const s of selectors) expect(s).toContain(".splat-page");
  });

  it("prefixes every animation name", () => {
    const { keyframes } = outerRules(css);
    for (const k of keyframes) expect(k.startsWith("splat-")).toBe(true);
  });

  it("finds an unscoped rule (the check itself)", () => {
    const { selectors, keyframes } = outerRules(
      "@layer a { :root { --x: 1; } @media (x) { .btn { y: 1; } } .splat-page { .z { a: b; } } @keyframes pulse { 50% { o: 1; } } }",
    );
    expect(selectors).toEqual([":root", ".btn", ".splat-page"]);
    expect(keyframes).toEqual(["pulse"]);
  });
});
