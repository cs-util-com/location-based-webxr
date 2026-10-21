/**
 * What the visitor's start page shows about the tour (polish round M4a,
 * the owner's V4 with one cover photo, D-R12/D-R14).
 *
 * Why these tests matter: the page leads with the tour's name, a subline
 * and one photo. A tour without a name must still read as a tour, the
 * subline must count what a visitor will find, and the cover must be one
 * of the tour's own photos - never anything else in the zip.
 */
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type {
  TourManifest,
  TourObject,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { tourOf } from "./test-support/v3-tour.js";
import { visitorStartView, wireVisitorStart } from "./visitor-start.js";

const GEO: TourStation["geo"] = {
  lat: 47,
  lon: 8,
  alt: 400,
  rotation: [0, 0, 0, 1],
};

function pin(id: string): TourObject {
  return {
    id,
    kind: "pin",
    label: id,
    geo: GEO,
    createdAtIso: "2026-10-13T00:00:00.000Z",
  } as unknown as TourObject;
}

function photo(id: string): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    geo: GEO,
    createdAtIso: "2026-10-13T00:00:00.000Z",
  } as unknown as TourObject;
}

/** A version 3 tour: each of `objects` in a station of its own. */
function tour(
  extra: Partial<TourManifest> & { objects?: readonly TourObject[] },
): TourManifest {
  const { objects = [], ...rest } = extra;
  return tourOf(objects, rest);
}

/** `count` stations without content, as an earlier file kept for its
 *  walk's debug camera captures (`walk-N`). */
function emptyStations(count: number): TourStation[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `walk-${String(i)}`,
    geo: GEO,
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items: [],
  }));
}

describe("visitorStartView", () => {
  it("leads with the tour's name, trimmed", () => {
    expect(visitorStartView(tour({ title: "  Harbour Lights " })).title).toBe(
      "Harbour Lights",
    );
  });

  it("still reads as a tour without a name, and says a zip without tour.json is not finished", () => {
    expect(visitorStartView(tour({})).title).toBe("An AR tour");
    expect(visitorStartView(tour({ title: "   " })).title).toBe("An AR tour");
    // The printed code may point at the hosted file before its first
    // Finish: the start page says so instead of an empty promise.
    expect(visitorStartView(null)).toEqual({
      title: "An AR tour",
      subline: "This tour is not finished yet.",
      description: null,
      coverPath: null,
      pageTitle: "Tour Viewer",
    });
  });

  it("counts the places a visitor will find", () => {
    expect(
      visitorStartView(tour({ objects: [pin("a"), photo("b"), pin("c")] }))
        .subline,
    ).toBe("3 places to discover");
    expect(visitorStartView(tour({ objects: [pin("a")] })).subline).toBe(
      "1 place to discover",
    );
    // A tour without stations is not finished: nothing to discover yet.
    expect(visitorStartView(tour({ title: "Harbour" })).subline).toBe(
      "This tour is not finished yet.",
    );
    // A tour of stations (the sample) counts its stations.
    const station = emptyStations(1)[0]!;
    expect(
      visitorStartView(tour({ stations: [station, station] })).subline,
    ).toBe("2 places to discover");
    // Its stations are its places: the objects they show are not counted
    // twice (M4 review #10; since version 3 every object is in one).
    const shared = tour({ objects: [pin("a")] });
    const [only] = shared.stations;
    const both = {
      ...shared,
      stations: [{ ...only!, items: [...only!.items, ...only!.items] }],
    };
    expect(visitorStartView(both).subline).toBe("1 place to discover");
  });

  it("takes the tour's first photo as the cover, and none without a photo", () => {
    expect(
      visitorStartView(tour({ objects: [pin("a"), photo("b"), photo("c")] }))
        .coverPath,
    ).toBe("content/b.jpg");
    expect(
      visitorStartView(tour({ objects: [pin("a")] })).coverPath,
    ).toBeNull();
  });

  // Why (tour editor plan 2026-10-17-1816, W2): a creator may now choose
  // the cover and write a description in the editor; the start page must
  // show what they chose, and the tab (and a shared link's title) the
  // tour's name rather than the app's.
  it("takes the cover the creator chose over the first photo", () => {
    expect(
      visitorStartView(tour({ objects: [photo("b"), photo("c")], cover: "c" }))
        .coverPath,
    ).toBe("content/c.jpg");
  });

  it("shows the tour's description, trimmed, and none without one", () => {
    expect(
      visitorStartView(tour({ description: "  Up and back. " })).description,
    ).toBe("Up and back.");
    expect(visitorStartView(tour({})).description).toBeNull();
    expect(visitorStartView(null).description).toBeNull();
  });

  it("names the page after the tour, else the app", () => {
    expect(visitorStartView(tour({ title: " Harbour " })).pageTitle).toBe(
      "Harbour",
    );
    expect(visitorStartView(tour({})).pageTitle).toBe("Tour Viewer");
    expect(visitorStartView(null).pageTitle).toBe("Tour Viewer");
  });

  // (A test that the cover was never taken from a debug camera capture
  // stood here: a tour without a placed photo once took its first captured
  // frame. The field that named the frames is gone from the format, so
  // nothing can name one; the property below still says an empty station
  // gives no cover.)

  // The cover is read from the zip by its path: only the tour's own photos
  // may be named - a photo object's image - never anything else the
  // manifest holds (M4 review #8).
  it("only ever names one of the tour's own photos (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("pin", "photo"), { maxLength: 8 }),
        fc.nat({ max: 4 }),
        // A chosen cover (W2): a photo, a pin or an id the tour lacks.
        fc.option(
          fc
            .constantFrom("f", "p", "x")
            .chain((p) => fc.nat({ max: 9 }).map((n) => `${p}${String(n)}`)),
        ),
        (kinds, emptyCount, cover) => {
          const objects = kinds.map((kind, i) =>
            kind === "pin" ? pin(`p${String(i)}`) : photo(`f${String(i)}`),
          );
          const manifest = tour({
            objects,
            ...(cover === null ? {} : { cover }),
            ...(emptyCount === 0
              ? {}
              : { stations: emptyStations(emptyCount) }),
          });
          const { coverPath } = visitorStartView(manifest);
          // An empty station adds none.
          const own = objects.flatMap((o) =>
            o.kind === "photo" ? [(o as { image: string }).image] : [],
          );
          // The chosen photo when it is one of them, else the first of
          // them, in that order, or none when there is none.
          const chosen = objects.find(
            (o) => o.id === cover && o.kind === "photo",
          );
          expect(coverPath).toBe(
            chosen === undefined
              ? (own[0] ?? null)
              : (chosen as { image: string }).image,
          );
        },
      ),
    );
  });
});

describe("wireVisitorStart", () => {
  // Why: the cover is read from the zip after the open; a newer tour
  // opened meanwhile must not get the older one's photo, a photo that
  // fails the page's picture check is not shown, and a closed tour leaves
  // no photo and no object URL behind.
  function setup(
    check: (blob: Blob) => Promise<string | null> = () => Promise.resolve(null),
  ) {
    const dom = {
      title: { textContent: "" },
      subline: { textContent: "", hidden: true },
      description: { textContent: "", hidden: true },
      page: { title: "" },
      cover: { hidden: true },
      coverImage: { src: "" },
    };
    const urls: string[] = [];
    const revoked: string[] = [];
    let next = 0;
    const start = wireVisitorStart({
      dom,
      createObjectUrl: () => {
        next += 1;
        const url = `blob:${String(next)}`;
        urls.push(url);
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
      checkPicture: check,
    });
    return { dom, start, urls, revoked };
  }

  const named = tour({ title: "Harbour Lights", objects: [photo("b")] });

  it("writes the name and the subline, and shows the cover once it loads", async () => {
    const { dom, start } = setup();
    const loadImage = vi.fn(() => Promise.resolve(new Blob(["x"])));
    start.present(named, loadImage);
    expect(dom.title.textContent).toBe("Harbour Lights");
    expect(dom.subline.textContent).toBe("1 place to discover");
    expect(dom.subline.hidden).toBe(false);
    expect(dom.page.title).toBe("Harbour Lights");
    expect(dom.description.hidden).toBe(true);
    await vi.waitFor(() => {
      expect(dom.cover.hidden).toBe(false);
    });
    expect(loadImage).toHaveBeenCalledWith("content/b.jpg");
    expect(dom.coverImage.src).toBe("blob:1");
  });

  it("does not show a photo that fails the picture check", async () => {
    const { dom, start, revoked } = setup(() => Promise.resolve("too large"));
    start.present(named, () => Promise.resolve(new Blob(["x"])));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dom.cover.hidden).toBe(true);
    expect(revoked).toEqual([]);
  });

  it("keeps a newer tour's cover over an older one that loads later", async () => {
    const { dom, start } = setup();
    let finishOld: (blob: Blob) => void = () => undefined;
    start.present(named, () => new Promise((resolve) => (finishOld = resolve)));
    const newer = tour({ title: "Castle walk", objects: [photo("c")] });
    start.present(newer, () => Promise.resolve(new Blob(["new"])));
    await vi.waitFor(() => {
      expect(dom.cover.hidden).toBe(false);
    });
    finishOld(new Blob(["old"]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dom.title.textContent).toBe("Castle walk");
    expect(dom.coverImage.src).toBe("blob:1");
  });

  it("clears the page and releases the photo when the tour closes", async () => {
    const { dom, start, revoked } = setup();
    start.present(named, () => Promise.resolve(new Blob(["x"])));
    await vi.waitFor(() => {
      expect(dom.cover.hidden).toBe(false);
    });
    start.clear();
    expect(dom.title.textContent).toBe("An AR tour");
    // No tour open is not an unfinished tour: nothing is said about one.
    expect(dom.subline.hidden).toBe(true);
    expect(dom.subline.textContent).toBe("");
    expect(dom.cover.hidden).toBe(true);
    expect(revoked).toEqual(["blob:1"]);
    expect(dom.page.title).toBe("Tour Viewer");
  });

  it("writes the description under the subline, and hides it for none", () => {
    const { dom, start } = setup();
    start.present(tour({ description: "Up and back." }), () =>
      Promise.reject(new Error("no photo")),
    );
    expect(dom.description.textContent).toBe("Up and back.");
    expect(dom.description.hidden).toBe(false);
    start.clear();
    expect(dom.description.textContent).toBe("");
    expect(dom.description.hidden).toBe(true);
  });
});
