import { describe, expect, it } from "vitest";

import { PAIRS } from "./bench-export";
import { PAIR_GUIDE } from "./bench-guide";
import { GUIDED_STEPS, LIGHT_NOTE, guidedCard } from "./guided-texts";
import { DIAGRAM_KINDS } from "./guided-diagram";

const DASHES = /[‒-―]/;

// Why this test matters: the guided view walks a first-time tester through
// every pair with three short lines (photo A, the change, photo B) and a
// picture; a pair without one of them leaves that tester with nothing to
// go by, and a text with markup would show its tags (they are set as text).
describe("GUIDED_STEPS", () => {
  it("has a title, three steps and a known diagram for every protocol pair", () => {
    expect(Object.keys(GUIDED_STEPS).sort()).toEqual(
      PAIRS.map((p) => p.key).sort(),
    );
    for (const { key } of PAIRS) {
      const g = GUIDED_STEPS[key];
      for (const t of [g.title, g.a, g.change, g.b]) {
        expect(t.trim(), key).not.toBe("");
        expect(t, key).not.toMatch(DASHES);
        expect(t, key).not.toMatch(/[<>]/);
      }
      expect(DIAGRAM_KINDS, key).toContain(g.diagram);
    }
  });

  // Why: the dimmed pairs failed in the field when the light was dimmed
  // before photo A; the guided steps must say "light on" for A and put the
  // dimming in the change, between the two photos.
  it("keeps the light on for photo A of the dimmed pairs and dims between", () => {
    for (const key of ["1b", "1c"] as const) {
      expect(GUIDED_STEPS[key].a, key).toMatch(/^Light ON/);
      expect(GUIDED_STEPS[key].change, key).toMatch(/^Dim/);
      expect(GUIDED_STEPS[key].b, key).toMatch(/without moving the phone/);
    }
  });

  it("gives each pair its own title", () => {
    const titles = PAIRS.map((p) => GUIDED_STEPS[p.key].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("guidedCard", () => {
  // Why: purpose and avoid line have one source (PAIR_GUIDE), shared with
  // the other view, so the two views never disagree on what a pair tests.
  it("takes purpose and avoid from the pair guide", () => {
    for (const { key } of PAIRS) {
      const c = guidedCard(key);
      expect(c.purpose).toBe(PAIR_GUIDE[key].purpose);
      expect(c.avoid).toBe(PAIR_GUIDE[key].avoid);
      expect(c.title).toBe(GUIDED_STEPS[key].title);
    }
  });
});

describe("LIGHT_NOTE", () => {
  // Why: the review after photo B is where a failed light check must say
  // what to retake; "ok" is the one note that asks for nothing.
  it("names the photo to retake for every failed light check", () => {
    expect(LIGHT_NOTE.ok).toMatch(/ok/);
    expect(LIGHT_NOTE["too-dark-a"]).toMatch(/retake A/);
    expect(LIGHT_NOTE["too-dark-b"]).toMatch(/retake B/);
    expect(LIGHT_NOTE.changed).toMatch(/Retake B/);
    expect(LIGHT_NOTE["not-darker"]).toMatch(/retake A.*retake B/);
    for (const t of Object.values(LIGHT_NOTE)) {
      expect(t).not.toMatch(DASHES);
    }
  });
});
