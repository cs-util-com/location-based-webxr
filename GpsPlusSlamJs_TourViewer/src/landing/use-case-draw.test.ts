import { describe, expect, it } from "vitest";

import {
  augColour,
  card,
  chroma,
  photo,
  ROUTE_RAMP,
  screenLayers,
  treatmentDefs,
  USE_CASE_TREATMENTS,
} from "./use-case-draw.js";

describe("chroma", () => {
  // Why: the "real scene is muted" rule is measured with this, so it must
  // read a colour the way the drawings write one.
  it("is the spread between the largest and smallest channel", () => {
    expect(chroma("#cf4428")).toBe(0xcf - 0x28);
    expect(chroma("#ffffff")).toBe(0);
    expect(chroma("#abc")).toBe(0xcc - 0xaa);
  });

  it("refuses anything that is not a hex colour", () => {
    expect(() => chroma("red")).toThrow(TypeError);
    expect(() => chroma("#12345")).toThrow(TypeError);
  });
});

describe("augColour", () => {
  // Why: in the route-light look everything augmented is drawn in the
  // route's own colours, which is what makes it the one bright thing.
  it("maps every tone onto the route ramp in the route-light look", () => {
    for (const tone of [0, 1, 2, 3, 4] as const) {
      expect(augColour("route-light", "#3366aa", tone)).toBe(ROUTE_RAMP[tone]);
    }
  });

  // Why: the true-colour look keeps an object's own colours and lets the
  // dimmed scene and the lit edge carry the difference.
  it("keeps the natural colour in the true-colour look", () => {
    expect(augColour("true-colour", "#3366aa", 2)).toBe("#3366aa");
  });

  it("refuses a colour that is not hex, so a typo cannot reach the page", () => {
    expect(() => augColour("true-colour", "blue", 1)).toThrow(TypeError);
  });
});

describe("card", () => {
  // Why: card titles are written into SVG markup; a character like < or &
  // must arrive as text, never as markup.
  it("escapes its title and its text", () => {
    const out = card("route-light", {
      x: 10,
      y: 10,
      w: 80,
      title: "<b>Tom & Jo</b>",
      text: 'say "hi"',
    });
    expect(out).toContain("&lt;b&gt;Tom &amp; Jo&lt;/b&gt;");
    expect(out).toContain("say &quot;hi&quot;");
    expect(out).not.toContain("<b>");
  });

  it("is a rounded white card with a route-coloured edge", () => {
    const out = card("true-colour", { x: 0, y: 0, w: 60, title: "Clue" });
    expect(out).toMatch(/<rect [^>]*rx="[\d.]+"/);
    expect(out).toContain(`stroke="${ROUTE_RAMP[1]}"`);
  });

  // Why: SVG text cannot be measured in node, and a wider fallback face on
  // a phone pushed titles past their cards; a card sizes itself to a
  // generous estimate of its text and moves left rather than leave the
  // 210-wide screen.
  it("grows to fit a long title and stays on the screen", () => {
    const out = card("route-light", {
      x: 180,
      y: 0,
      w: 20,
      title: "The same bed in summer",
    });
    const [, x, w] =
      /<rect x="([\d.]+)" y="0" width="([\d.]+)"/.exec(out)?.map(Number) ?? [];
    expect(w).toBeGreaterThanOrEqual(22 * 8 * 0.6);
    expect((x ?? 0) + (w ?? 0)).toBeLessThanOrEqual(208);
  });

  it("refuses a card without a width", () => {
    expect(() => card("route-light", { x: 0, y: 0, w: 0, title: "x" })).toThrow(
      RangeError,
    );
  });
});

describe("photo", () => {
  it("frames its picture and rotates it about its centre", () => {
    const out = photo("route-light", {
      x: 20,
      y: 10,
      w: 40,
      h: 30,
      rot: -4,
      inner: '<rect width="1" height="1"/>',
    });
    expect(out).toContain('transform="rotate(-4 40 25)"');
    expect(out).toContain('<rect width="1" height="1"/>');
  });
});

describe("treatmentDefs", () => {
  // Why: the glow and the thin light outline are what mark a thing as
  // augmented in both looks; each look's filter must carry both.
  it.each(USE_CASE_TREATMENTS)("%s has a glow and a light outline", (t) => {
    const defs = treatmentDefs(t);
    expect(defs).toContain(`id="uc-glow-${t}"`);
    expect(defs).toMatch(/feMorphology[^>]*operator="dilate"/);
    expect(defs).toMatch(/feGaussianBlur/);
    expect(defs).toContain(`flood-color="${ROUTE_RAMP[1]}"`);
    expect(defs).toContain('flood-color="#ffffff"');
  });

  it("dims the scene only in the true-colour look", () => {
    expect(treatmentDefs("true-colour")).toContain('id="uc-mute-true-colour"');
    expect(treatmentDefs("route-light")).not.toContain("uc-mute");
  });
});

describe("screenLayers", () => {
  // Why: AR content is drawn over the camera image, so the overlay comes
  // after (on top of) the scene, and only the overlay glows.
  it("draws the overlay on top of the scene, and only the overlay glows", () => {
    const out = screenLayers("route-light", "<i-scene/>", "<i-overlay/>");
    expect(out.indexOf("<i-scene/>")).toBeLessThan(out.indexOf("<i-overlay/>"));
    expect(out).toMatch(
      /<g class="uc-aug" filter="url\(#uc-glow-route-light\)"><i-overlay\/><\/g>$/,
    );
    expect(out).toMatch(/^<g class="uc-real"><i-scene\/><\/g>/);
  });

  it("dims and veils the scene in the true-colour look", () => {
    const out = screenLayers("true-colour", "<i-scene/>", "<i-overlay/>");
    expect(out).toContain(
      '<g class="uc-real" filter="url(#uc-mute-true-colour)"><i-scene/></g>',
    );
    expect(out).toMatch(/<rect class="uc-veil" [^>]*\/>/);
  });

  it("refuses a look it does not know", () => {
    expect(() => screenLayers("neon" as never, "", "")).toThrow(RangeError);
  });
});
