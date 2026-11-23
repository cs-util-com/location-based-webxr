// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { DIAGRAM_KINDS, diagramSvg } from "./guided-diagram";
import { shotCard } from "./guided-texts";
import { shotList } from "./scenes";

const shotOf = (key: string) => shotList(1, 0).find((s) => s.key === key)!;

const parse = (svg: string): Document =>
  new DOMParser().parseFromString(svg, "image/svg+xml");

// Why this test matters: the diagram is the one picture that tells a tester
// what changes between photo A and B; the page puts it in as markup, so it
// must stay well-formed SVG, carry both panels and a text alternative, and
// differ per kind (a copy-paste slip would show the same picture twice).
describe("diagramSvg", () => {
  it("is well-formed SVG with panel A, panel B and a label for every kind", () => {
    for (const kind of DIAGRAM_KINDS) {
      const doc = parse(diagramSvg(kind));
      expect(doc.getElementsByTagName("parsererror"), kind).toHaveLength(0);
      const svg = doc.documentElement;
      expect(svg.tagName, kind).toBe("svg");
      expect(svg.getAttribute("viewBox"), kind).toBe("0 0 300 100");
      expect(svg.getAttribute("role"), kind).toBe("img");
      expect(svg.getAttribute("aria-label")?.trim(), kind).not.toBe("");
      const texts = [...svg.getElementsByTagName("text")].map(
        (t) => t.textContent,
      );
      expect(texts, kind).toContain("A");
      expect(texts, kind).toContain("B");
    }
  });

  it("draws a different picture for every kind", () => {
    const all = DIAGRAM_KINDS.map(diagramSvg);
    expect(new Set(all).size).toBe(all.length);
  });

  // Why: the light diagrams show the dimming as a darker panel B; a
  // control pair shows no change, so its arrow says so.
  it("says what changes between the panels", () => {
    expect(diagramSvg("light-same")).toContain(">nothing<");
    expect(diagramSvg("light-dim")).toContain(">dim<");
    expect(diagramSvg("rot-35")).toContain(">tilt<");
    expect(diagramSvg("dist-2x")).toContain(">step back<");
    // Why: F5 is taken after F4 at 3 m by stepping forward to 1 m; a
    // picture saying "step back" contradicts the card next to it.
    expect(diagramSvg("dist-forward")).toContain(">step forward<");
    expect(shotCard(shotOf("F5")).diagram).toBe("dist-forward");
    expect(diagramSvg("side-flat")).toContain(">step aside<");
  });
});
