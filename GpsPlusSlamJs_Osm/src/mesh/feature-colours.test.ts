import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUILDING_RGB,
  DEFAULT_ROAD_RGB,
  PEDESTRIAN_CLASSES,
  REFERENCE_GROUND_RGB,
  allBuildingColours,
  allRoadColours,
  buildingColour,
  channelDistance,
  luma,
  parseOsmColour,
  roadColour,
  saturation,
} from "./feature-colours.js";

/**
 * WHY THESE TESTS MATTER (W22/W23). A palette fails in ways that look like
 * design decisions. A road the same tone as the ground is invisible and reads as
 * a missing layer — that is not hypothetical, it is exactly what DEC-R2-13
 * measured: the first road colour moved 77 pixels out of 460 800. A palette that
 * drifted loud would compete with the affordance heat ramp, which §2 of the
 * round-4 plan makes an invariant. And a malformed `building:colour` that parsed
 * to black would render a building as a hole.
 *
 * None of those throw, and none are visible from one camera angle. So the
 * contrast floor, the lightness band and the parser's rejections are asserted
 * rather than eyeballed.
 */
describe("buildingColour", () => {
  it("colours by CLASS, which every building has", () => {
    // The base of the axis (DEC-R4-5). Appearance tags are sparse, so a
    // class-less base would leave most of a city grey — which is the complaint.
    expect(buildingColour({ building: "house" })).not.toBe(
      buildingColour({ building: "industrial" }),
    );
    expect(buildingColour({ building: "house" })).not.toBe(
      DEFAULT_BUILDING_RGB,
    );
  });

  it("lets MATERIAL win over class", () => {
    // A brick house and a plastered house are different-looking things, and the
    // mapper said so. `streets-gl` makes the same call.
    expect(
      buildingColour({ building: "house", "building:material": "brick" }),
    ).toBe(buildingColour({ "building:material": "brick" }));
  });

  it("lets an explicit COLOUR win over everything", () => {
    // The strongest statement a mapper can make about this one building.
    expect(
      buildingColour({
        building: "house",
        "building:material": "brick",
        "building:colour": "#123456",
      }),
    ).toBe(0x123456);
  });

  it("falls back rather than going black on an unknown class", () => {
    // A black building reads as a rendering failure. The old uniform grey is a
    // perfectly honest "we do not know".
    expect(buildingColour({ building: "yes" })).toBe(DEFAULT_BUILDING_RGB);
    expect(buildingColour({})).toBe(DEFAULT_BUILDING_RGB);
  });

  it("keeps the whole palette inside one lightness band", () => {
    // THE INVARIANT §2 OF THE PLAN NAMES: the heat ramp stays the loudest thing
    // on screen. A skyline that spans black to white would read as a chart, and
    // R4-14 already warns the scene is close to too colourful.
    for (const colour of allBuildingColours()) {
      expect(luma(colour)).toBeGreaterThan(120);
      expect(luma(colour)).toBeLessThan(215);
    }
  });

  it("keeps the palette desaturated, so it never competes with the ramp", () => {
    // Saturation as max-minus-min channel. The heat ramp is fully saturated; a
    // building palette anywhere near it would be a second colour language.
    for (const colour of allBuildingColours()) {
      const r = (colour >> 16) & 0xff;
      const g = (colour >> 8) & 0xff;
      const b = colour & 0xff;
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(85);
    }
  });
});

describe("roadColour", () => {
  it("colours by CLASS, so the hierarchy reads without a legend", () => {
    expect(roadColour({ highway: "motorway" })).not.toBe(
      roadColour({ highway: "footway" }),
    );
  });

  it("lets SURFACE win over class", () => {
    // What the road is made of is the stronger claim where a mapper has said it.
    // OSM2World colours by surface alone; this uses it as the override.
    expect(roadColour({ highway: "residential", surface: "gravel" })).toBe(
      roadColour({ surface: "gravel" }),
    );
  });

  it("falls back for an unknown class", () => {
    expect(roadColour({ highway: "raceway" })).toBe(DEFAULT_ROAD_RGB);
  });

  it("KEEPS EVERY ROAD DISTINGUISHABLE FROM THE GROUND", () => {
    // THE ASSERTION THIS FILE EXISTS FOR, and it is not theoretical. DEC-R2-13
    // recorded the measurement: an asphalt-reasoned 0x2f333d rendered within a
    // few levels of the ground and switching the roads layer on moved 77 pixels
    // out of 460 800. "A road that cannot be told from the ground it lies on is
    // a failed layer whatever the test says" — so every colour in the palette is
    // checked, not just the default.
    for (const colour of allRoadColours()) {
      expect(channelDistance(colour, REFERENCE_GROUND_RGB)).toBeGreaterThan(40);
    }
  });

  it("stays inside the same lightness band as the buildings", () => {
    for (const colour of allRoadColours()) {
      expect(luma(colour)).toBeGreaterThan(120);
      expect(luma(colour)).toBeLessThan(215);
    }
  });
});

describe("parseOsmColour", () => {
  it("reads both hex forms, expanding the short one correctly", () => {
    expect(parseOsmColour("#ff8800")).toBe(0xff8800);
    // `#abc` is `#aabbcc`, not `#0a0b0c` — the second is a plausible-looking
    // near-black, which is the worst kind of wrong for a building.
    expect(parseOsmColour("#abc")).toBe(0xaabbcc);
    expect(parseOsmColour("  #FF8800  ")).toBe(0xff8800);
  });

  it("returns undefined rather than black for anything malformed", () => {
    // A building rendered black reads as a rendering failure, and `#gggggg` is
    // a real thing people type. Falling through to the class colour is the
    // honest answer.
    expect(parseOsmColour("#gggggg")).toBeUndefined();
    expect(parseOsmColour("beige")).toBeUndefined();
    expect(parseOsmColour("")).toBeUndefined();
    expect(parseOsmColour(undefined)).toBeUndefined();
  });

  it("does NOT resolve CSS colour names, deliberately", () => {
    // The CSS list is 148 entries of which a handful appear in OSM, and a wrong
    // colour is worse than the class default because it looks like a decision.
    expect(parseOsmColour("red")).toBeUndefined();
  });
});

/**
 * WHY THESE TESTS MATTER (DEC-R7b-4, DEC-R7b-4a). A testing session asked for
 * pedestrian ways to read differently from car roads. The class table already
 * gave them their own values — and it did not matter, for two reasons the
 * session could not have seen:
 *
 * 1. **`surface` overrode the class entirely**, so `highway=footway,
 *    surface=asphalt` and `highway=residential, surface=asphalt` rendered
 *    BYTE-IDENTICAL. In a well-mapped city centre `surface` is tagged often, so
 *    the class colour frequently was not the one on screen at all.
 * 2. **The difference was a hue nudge at identical brightness** — footway ≈ 165
 *    luma against residential ≈ 163. Invisible under the demo's low sun.
 *
 * THE SEPARATION IS SATURATION, NOT LIGHTNESS, and that is what makes it fit.
 * `allRoadColours` must stay inside a 120–215 lightness band (the test above),
 * and the car greys already occupy ~153–190 of it — so an "every path darker
 * than every car road" rule only fits in 120–153, noticeably darker than today.
 * The band says nothing about hue, and the heat ramp is Viridis: purple, blue,
 * teal, green, yellow, with NO warm hues at all. A brown path therefore cannot
 * compete with the ramp, which is what the muted-palette rule protects.
 */
describe("pedestrian ways read differently from car roads", () => {
  const CAR = ["motorway", "trunk", "primary", "secondary", "residential"];

  it("does not let `surface` erase the distinction", () => {
    // THE REPORTED BUG, exactly. Both are asphalt; only one is for cars.
    expect(roadColour({ highway: "footway", surface: "asphalt" })).not.toBe(
      roadColour({ highway: "residential", surface: "asphalt" }),
    );
  });

  it("still lets `surface` speak for a CAR road", () => {
    // The precedence flip is deliberately narrow. A gravel lane and a paved lane
    // are genuinely different surfaces and the class says nothing about it, so
    // reversing this for every road would trade one lost distinction for another.
    expect(roadColour({ highway: "residential", surface: "gravel" })).not.toBe(
      roadColour({ highway: "residential", surface: "asphalt" }),
    );
  });

  it("gives every pedestrian class a warm, saturated colour", () => {
    // Saturation rather than hue angle: the car colours are near-achromatic, and
    // a hue angle on a grey is meaningless. What separates the families is that
    // one has colour and the other does not.
    for (const highway of PEDESTRIAN_CLASSES) {
      const colour = roadColour({ highway });
      expect(saturation(colour), highway).toBeGreaterThan(0.16);
      // Warm: red channel above blue. This is the half that keeps paths clear of
      // the Viridis ramp, which is entirely cool.
      expect((colour >> 16) & 0xff, highway).toBeGreaterThan(colour & 0xff);
    }
  });

  it("keeps every car class near-achromatic, so the two never converge", () => {
    for (const highway of CAR) {
      expect(saturation(roadColour({ highway })), highway).toBeLessThan(0.14);
    }
  });

  it("keeps the browns inside the lightness band the buildings share", () => {
    // The hue does the separating, so nothing needs to escape the band. If a
    // path ever had to go dark to be distinguishable, that would be the signal
    // that the saturation approach had failed.
    for (const highway of PEDESTRIAN_CLASSES) {
      const value = luma(roadColour({ highway }));
      expect(value, highway).toBeGreaterThan(120);
      expect(value, highway).toBeLessThan(215);
    }
  });
});
