/**
 * Why these tests matter: the film is a port of the landing prototype, chosen as it is,
 * and the plan keeps its eight parts in its order with the
 * visitor-first part and the add-words part. These tests pin the port to
 * the prototype (the park's numbers were read from the prototype's own code), the
 * story's turning points (the empty park before making, the finished
 * route at the end) and the declared views the timeline's camera rests
 * on: a part whose drawing names another view than its declaration would
 * cut the camera instead of moving it.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  BEAT_CAPTIONS,
  BEAT_TITLES,
  FILM_BEATS,
  TYPED_TITLE,
  frameAt,
} from "./film-story.js";
import {
  LEAD_IN,
  LIGHT,
  ROUTE,
  ROUTE_LEN,
  STATIONS,
  S_FIG,
  TREES,
} from "./film-park.js";

describe("film park: the port matches the prototype's numbers", () => {
  it("has the prototype's route, stations, person spot, lead-in and light", () => {
    expect(ROUTE_LEN).toBeCloseTo(69.83424315561673, 9);
    expect(STATIONS.map((s) => s.s)).toEqual(
      [
        4.816425761550385, 18.852106181316078, 31.120514342655575,
        56.830022561104926, 69.83424315561673,
      ].map((v) => expect.closeTo(v, 9) as unknown as number),
    );
    expect(S_FIG).toBeCloseTo(10.339415017720029, 9);
    expect(LEAD_IN).toBeCloseTo(2.954657340538831, 9);
    expect(LIGHT[0]).toBeCloseTo(0.16734289831207116, 12);
    expect(LIGHT[2]).toBeCloseTo(0.5473539571287632, 12);
  });

  it("scatters the prototype's 37 trees, the same first and last", () => {
    expect(TREES).toHaveLength(37);
    expect(TREES[0]).toEqual({
      x: expect.closeTo(-11.453521758460925, 9),
      z: expect.closeTo(7.359810661859635, 9),
      kind: 1,
      s: expect.closeTo(1.1580221940838007, 9),
    });
    expect(TREES.at(-1)?.x).toBeCloseTo(14.632349521138103, 9);
  });

  it("keeps every tree off the path", () => {
    for (const t of TREES) {
      for (let i = 0; i < ROUTE.pts.length; i += 2) {
        const p = ROUTE.pts[i]!;
        expect(Math.hypot(p[0] - t.x, p[1] - t.z)).toBeGreaterThanOrEqual(1.7);
      }
    }
  });
});

describe("film story: the parts", () => {
  it("keeps the prototype's eight parts, their lengths and their order", () => {
    expect(FILM_BEATS.map((b) => b.durS)).toEqual([
      4.3, 2.7, 2.1, 3.9, 4.1, 7.6, 4.3, 12.6,
    ]);
    expect(BEAT_TITLES).toEqual([
      "A tour",
      "What a visitor sees",
      "A story you know",
      "Walk there",
      "Add words and a picture",
      "Along the walk",
      "Hang the code",
      "Visitors scan it, no app to install",
    ]);
  });

  it("draws every part in the view the timeline is told about", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FILM_BEATS.length - 1 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (beat, frac) => {
          const spec = FILM_BEATS[beat]!;
          const t = frac * spec.durS;
          const declared = [...spec.views]
            .reverse()
            .find((v) => v.atS <= t)!.view;
          expect(frameAt(beat, t).s.view).toBe(declared);
        },
      ),
    );
  });

  it("shows a visitor at the first station before any making", () => {
    const { s, u } = frameAt(1, 2.7);
    expect(s.fig?.who).toBe("visitor");
    expect(u.on).toBe(true);
    expect(u.card).toBe(1);
    expect(u.pic).toBe(1);
  });

  it("empties the park before the making starts, the old photo where the phone was", () => {
    const { s, u } = frameAt(2, 2.1);
    expect(s.route).toBe(0);
    expect(s.pins.every((p) => p === 0)).toBe(true);
    expect(s.fig?.who).toBe("maker");
    expect(u.polaroid).toBe(1);
  });

  it("places one station, then types the whole title and adds the photo", () => {
    expect(frameAt(3, 3.9).s.pins).toEqual([1, 0, 0, 0, 0]);
    const { u } = frameAt(4, 4.1);
    expect(u.typed).toBe(TYPED_TITLE.length);
    expect(u.pic).toBe(1);
    expect(u.toolPic).toBe(true);
  });

  it("ends on the finished route, the visitor at its end and standing still", () => {
    const { s, u } = frameAt(7, 12.6);
    expect(s.route).toBe(ROUTE_LEN);
    expect(s.pins).toEqual([1, 1, 1, 1, 1]);
    expect(s.poster).toBe(1);
    expect(s.view).toBe("over");
    expect(s.fig).toMatchObject({ who: "visitor", bob: 0 });
    const end = ROUTE.at(ROUTE_LEN);
    expect(s.fig?.x).toBeCloseTo(end.x, 9);
    expect(s.fig?.z).toBeCloseTo(end.z, 9);
    expect(u.on).toBe(false);
  });

  it("clamps a moment outside its part and refuses a part that does not exist", () => {
    expect(frameAt(0, 99)).toEqual(frameAt(0, 4.3));
    expect(frameAt(0, Number.NaN)).toEqual(frameAt(0, 0));
    expect(() => frameAt(8, 0)).toThrow(RangeError);
    expect(() => frameAt(0.5, 0)).toThrow(RangeError);
  });
});

describe("film story: the captions", () => {
  it("has one sentence per part, and never claims the code places the stations", () => {
    expect(BEAT_CAPTIONS).toHaveLength(8);
    for (const c of BEAT_CAPTIONS) expect(c).toMatch(/^[A-Z].*\.$/);
    expect(BEAT_CAPTIONS[7]).toContain("scan it there to open the tour");
    // A visitor who expects to need an app stops at the code: the part
    // where the code is scanned says the tour opens in the phone's own
    // browser and there is nothing to install.
    expect(BEAT_CAPTIONS[7]).toMatch(/\bin their phone's browser\b/);
    expect(BEAT_CAPTIONS[7]).toContain("No app to install.");
    expect(BEAT_CAPTIONS.join(" ")).not.toMatch(
      /position|places the stations|anchor/i,
    );
  });
});
