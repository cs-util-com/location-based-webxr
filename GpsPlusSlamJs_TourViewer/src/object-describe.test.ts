/**
 * Why these tests matter: the object list (`object-list.ts`) and the
 * summary map (`summary-model.ts`) each named a photo on their own, and
 * the two rules had drifted: a caption of blanks read "Photo" on the map
 * and a blank title in the list. The desktop editor is the third page
 * that names objects (M6 E1 plan review #3, root CLAUDE.md DEC-H3), so
 * the rule lives once, here.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type {
  TourPicture,
  TourPin,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import { codeDistanceLine, objectTitle } from "./object-describe.js";
import { createTourViewerStore } from "./tour-viewer-session.js";

// The geo maths is the licensed library's: it runs once a store exists.
beforeAll(() => {
  createTourViewerStore();
});

const GEO = { lat: 47.5, lon: 8.7, alt: 400 };

function pin(label: string): TourPin {
  return {
    id: "p",
    kind: "shortText",
    view: "pin",
    caption: label,
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { ...GEO, headingDeg: 0 },
  };
}

function photo(label?: string): TourPicture {
  return {
    id: "f",
    kind: "picture",
    view: "plane",
    image: "f",
    widthM: 1,
    imageAsset: {
      id: "f",
      path: "content/f.jpg",
      kind: "image",
      width: 4,
      height: 3,
    },
    createdAtIso: "2026-09-11T00:00:01.000Z",
    geo: { ...GEO, rotation: [0, 0, 0, 1] },
    ...(label === undefined ? {} : { caption: label }),
  };
}

/** A code `northM` metres north of the objects. */
function codeAt(northM: number): QrGeoPose {
  return {
    lat: GEO.lat + northM / 111_320,
    lon: GEO.lon,
    alt: GEO.alt,
    headingDeg: 0,
  };
}

describe("objectTitle", () => {
  it("is a pin's text", () => {
    expect(objectTitle(pin("The town hall"))).toBe("The town hall");
  });

  it("is a photo's caption, or 'Photo' when it has none or only blanks", () => {
    expect(objectTitle(photo("Market day"))).toBe("Market day");
    expect(objectTitle(photo())).toBe("Photo");
    expect(objectTitle(photo("   "))).toBe("Photo");
  });
});

describe("codeDistanceLine", () => {
  it("names the distance to the code, or to the nearest of several", () => {
    expect(codeDistanceLine(pin("x"), [codeAt(4)])).toBe("4 m from the code");
    expect(codeDistanceLine(pin("x"), [codeAt(30), codeAt(12)])).toBe(
      "12 m from the nearest code",
    );
  });

  it("says nothing without a code", () => {
    expect(codeDistanceLine(pin("x"), [])).toBe("");
  });
});
