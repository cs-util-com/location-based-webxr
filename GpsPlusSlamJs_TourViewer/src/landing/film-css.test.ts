/**
 * Why these tests matter: three of the bar's promises live only in its
 * stylesheet, where no unit test of the model can see them. The current
 * segment drawn solid red while paused (the rule must outrank the playing
 * fill, which is a custom property for exactly that reason), every
 * segment's outline at 3:1 against the paper so a light grey "seen" part
 * is still visible, and a hit area of at least 24 px however thin the
 * visible track (WCAG 2.5.8).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  new URL("./landing-film.css", import.meta.url),
  "utf8",
);

function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(CSS);
  if (!m?.[1]) throw new Error(`no hex value for ${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const PAPER = "#f4eedf";

describe("film stylesheet: the bar", () => {
  it("fills the playing segment through a custom property, so the paused rule can outrank it", () => {
    expect(rule(".lf-seg-fill")).toContain(
      "transform: scaleX(var(--lf-fill, 0))",
    );
    expect(rule(".lf-film.lf-paused .lf-seg-current .lf-seg-fill")).toContain(
      "transform: none",
    );
    expect(rule(".lf-film.lf-paused .lf-seg-current::after")).toContain(
      "var(--lf-route)",
    );
  });

  it("outlines every segment at 3:1 or more against the paper, the current one in red", () => {
    expect(contrast(token("--lf-track-line"), PAPER)).toBeGreaterThanOrEqual(3);
    expect(contrast("#cf4428", PAPER)).toBeGreaterThanOrEqual(3);
    expect(rule(".lf-seg-track")).toContain(
      "inset 0 0 0 1px var(--lf-track-line)",
    );
    expect(rule(".lf-seg-current .lf-seg-track")).toContain("var(--lf-route)");
  });

  it("gives each segment a hit area of at least 24 px", () => {
    const m = /height:\s*(\d+)px/.exec(rule(".lf-seg"));
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(24);
    expect(
      Number(/min-width:\s*(\d+)px/.exec(rule(".lf-play"))?.[1]),
    ).toBeGreaterThanOrEqual(24);
  });
});

describe("film stylesheet: the lint grammar and the prefix", () => {
  it("uses none of clamp(), color-mix() or dvh, which the stylesheet validator rejects", () => {
    expect(CSS).not.toMatch(/clamp\(|color-mix\(|\bdvh\b/);
  });

  // the film's own reset is scoped by a zero-specificity :where(.lf-film)
  it("styles nothing outside its own lf- classes", () => {
    const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0]!.trim())
      .filter(
        (sel) =>
          sel !== "" && !sel.startsWith("@") && !/^(from|to|\d+%)$/.test(sel),
      );
    for (const sel of selectors) {
      for (const part of sel.split(",")) {
        expect(part.trim(), sel).toMatch(/^(\.lf-|:where\(\.lf-film\) )/);
      }
    }
  });
});
