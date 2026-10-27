import { describe, expect, it } from "vitest";

import { USE_CASES, type UseCase } from "./use-case-data.js";
import { chroma, ROUTE_RAMP, USE_CASE_TREATMENTS } from "./use-case-draw.js";

/** Every piece of text a visitor of the page can read, per entry. */
function textsOf(entry: UseCase): string[] {
  const inPicture = USE_CASE_TREATMENTS.flatMap((t) =>
    [...entry.overlay(t).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(
      (m) => m[1] ?? "",
    ),
  );
  return [entry.title, entry.sentence, entry.alt, ...inPicture];
}

describe("USE_CASES", () => {
  // Why: twenty is the most the page was given room for, and a section
  // with fewer than the four required examples is not this section.
  it("holds between four and twenty examples", () => {
    expect(USE_CASES.length).toBeGreaterThanOrEqual(4);
    expect(USE_CASES.length).toBeLessThanOrEqual(20);
  });

  // Why: these four are required by name and must not be curated away;
  // they also come first, so they are among those shown before "More ideas".
  it("starts with the castle, the birthday hunt, the shop windows and the indoor exhibition", () => {
    expect(USE_CASES.slice(0, 4).map((u) => u.id)).toEqual([
      "castle-tower",
      "birthday-hunt",
      "shop-window-paintings",
      "indoor-exhibition",
    ]);
  });

  it("has unique ids and titles", () => {
    expect(new Set(USE_CASES.map((u) => u.id)).size).toBe(USE_CASES.length);
    expect(new Set(USE_CASES.map((u) => u.title)).size).toBe(USE_CASES.length);
  });

  // Why: the id names SVG parts and test ids; a space or capital in it
  // would make a selector that silently matches nothing.
  it.each(USE_CASES.map((u) => [u.id, u] as const))(
    "%s has a kebab-case id, a short title, one sentence and alt text",
    (_id, u) => {
      expect(u.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(u.title.trim()).toBe(u.title);
      expect(u.title.length).toBeGreaterThan(5);
      expect(u.title.length).toBeLessThanOrEqual(40);
      // One sentence: ends in a full stop and has no other sentence end.
      expect(u.sentence).toMatch(/^[A-Z][^.!?]*\.$/);
      expect(u.sentence.length).toBeGreaterThanOrEqual(60);
      expect(u.sentence.length).toBeLessThanOrEqual(200);
      // The alt says what is real and what is seen through the phone.
      expect(u.alt).toMatch(/through the phone/i);
      expect(u.alt.length).toBeGreaterThanOrEqual(40);
    },
  );

  // Why: no real place, organisation or person on the page. A small deny
  // list of the names one reaches for first (cities, rivers, landmarks,
  // brands) catches the obvious slip.
  it("names no real place, organisation or brand", () => {
    const deny =
      /\b(london|paris|berlin|munich|vienna|rome|new york|amsterdam|prague|zurich|hamburg|cologne|dresden|thames|rhine|danube|seine|alps|bavaria|tuscany|eiffel|louvre|google|apple|samsung|android|chrome|instagram|facebook|youtube|disney|lego|ikea|unesco|national trust|starbucks)\b/i;
    for (const u of USE_CASES) {
      for (const text of textsOf(u)) expect(text).not.toMatch(deny);
    }
  });

  // Why: the deny list cannot know every name; a capital letter inside a
  // text is how a proper noun shows, so a capital is only allowed where a
  // text or a sentence part starts.
  it("has no capitalised word inside a text, so no proper noun slips in", () => {
    for (const u of USE_CASES) {
      for (const text of textsOf(u)) {
        const inner = text.replace(/(^|[.:;!?]\s+)[A-Z]/g, "$1x");
        expect(inner, `${u.id}: "${text}"`).not.toMatch(/[A-Z]/);
      }
    }
  });

  // Why: the castle shows the visitor's view only; the app cannot make a
  // 3D model, so nothing may say how the standing tower came to be.
  it("never says how the castle's tower was made", () => {
    const castle = USE_CASES.find((u) => u.id === "castle-tower");
    expect(castle).toBeDefined();
    for (const text of textsOf(castle as UseCase)) {
      expect(text).not.toMatch(/model|3d|scan|reconstruct|rebuil|modell/i);
    }
  });

  // Why: the honest claims. A visitor sees words, pictures and drawings at
  // a spot; nothing on the page promises sound, video or moving content.
  it("promises nothing the tour cannot show", () => {
    const unsupported =
      /\b(hear|hears|listen|sound|audio|music|video|film|plays|animated|moves|waves|talks|speaks)\b/i;
    for (const u of USE_CASES) {
      expect(u.sentence, u.id).not.toMatch(unsupported);
      expect(u.alt, u.id).not.toMatch(unsupported);
    }
  });

  // Why: the indoor exhibition is shown plainly, as working, without a
  // hedge that would read as "not really".
  it("shows the indoor exhibition plainly, indoors and without a hedge", () => {
    const indoor = USE_CASES.find((u) => u.id === "indoor-exhibition");
    expect(indoor?.alt).toMatch(/^indoors/i);
    for (const u of USE_CASES) {
      expect(u.sentence).not.toMatch(
        /\b(soon|not yet|one day|planned feature|may work)\b/i,
      );
    }
  });
});

describe("the pictures", () => {
  // Why: the real scene must read as the muted, flat world, so every colour
  // in it stays far below the route colour's chroma (167); 48 keeps paper,
  // stone and sage tones and rejects anything that would compete.
  it.each(USE_CASES.map((u) => [u.id, u] as const))(
    "%s draws its real scene in muted colours only",
    (_id, u) => {
      const colours = [...u.scene.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(
        (m) => m[0],
      );
      expect(colours.length).toBeGreaterThan(0);
      for (const c of colours)
        expect(chroma(c), `${u.id} ${c}`).toBeLessThanOrEqual(48);
      expect(u.scene).not.toMatch(/filter=|<text/);
    },
  );

  // Why: in the route-light look the augmented object is drawn in the
  // route's colours, so each overlay must use the ramp.
  it.each(USE_CASES.map((u) => [u.id, u] as const))(
    "%s draws its overlay in the route's colours in the route-light look",
    (_id, u) => {
      const overlay = u.overlay("route-light");
      expect(ROUTE_RAMP.some((c) => overlay.includes(c))).toBe(true);
      expect(u.overlay("true-colour").length).toBeGreaterThan(0);
    },
  );

  // Why: inline SVGs share one document, so a picture must not bring its
  // own ids (a duplicate id silently points every url(#) at the first one).
  it("brings no ids of its own", () => {
    for (const u of USE_CASES) {
      for (const t of USE_CASE_TREATMENTS) {
        expect(u.scene + u.overlay(t)).not.toMatch(/\bid="/);
      }
    }
  });

  // Why: the drawings stay inside the 210 x 100 screen; a coordinate far
  // outside it is a typo that would draw nothing visible.
  it("keeps every coordinate near the screen", () => {
    for (const u of USE_CASES) {
      const svg = u.scene + u.overlay("route-light");
      for (const m of svg.matchAll(/\b(?:x|cx|x1|x2)="(-?[\d.]+)"/g)) {
        const v = Number(m[1]);
        expect(v, `${u.id} x=${v}`).toBeGreaterThanOrEqual(-20);
        expect(v, `${u.id} x=${v}`).toBeLessThanOrEqual(230);
      }
      for (const m of svg.matchAll(/\b(?:y|cy|y1|y2)="(-?[\d.]+)"/g)) {
        const v = Number(m[1]);
        expect(v, `${u.id} y=${v}`).toBeGreaterThanOrEqual(-20);
        expect(v, `${u.id} y=${v}`).toBeLessThanOrEqual(120);
      }
    }
  });
});
