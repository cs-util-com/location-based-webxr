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
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { visitorStartView, wireVisitorStart } from "./visitor-start.js";

const GEO = {
  lat: 47,
  lon: 8,
  alt: 400,
  rotation: [0, 0, 0, 1],
} as const;

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

function tour(extra: Partial<TourManifest>): TourManifest {
  return { ...createEmptyTourManifest(), ...extra };
}

describe("visitorStartView", () => {
  it("leads with the tour's name, trimmed", () => {
    expect(visitorStartView(tour({ title: "  Harbour Lights " })).title).toBe(
      "Harbour Lights",
    );
  });

  it("still reads as a tour without a name, or before the manifest arrives", () => {
    expect(visitorStartView(tour({})).title).toBe("An AR tour");
    expect(visitorStartView(tour({ title: "   " })).title).toBe("An AR tour");
    expect(visitorStartView(null)).toEqual({
      title: "An AR tour",
      subline: null,
      coverPath: null,
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
    expect(visitorStartView(tour({})).subline).toBeNull();
    // A tour of stations (the sample) counts its stations.
    const station = {
      id: "s",
      title: "S",
    } as unknown as TourManifest["stations"][number];
    expect(
      visitorStartView(tour({ stations: [station, station] })).subline,
    ).toBe("2 places to discover");
    // Its stations are its places: the objects they show are not counted
    // twice (M4 review #10).
    expect(
      visitorStartView(
        tour({ stations: [station, station], objects: [pin("a"), pin("b")] }),
      ).subline,
    ).toBe("2 places to discover");
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

  // A tour made from a recording carries its photos as baked capture
  // spots, not as photo objects: they are its places and its cover too.
  it("counts and covers a recorded tour by its capture spots", () => {
    const spot = (image: string) => ({
      image,
      geo: { lat: 47, lon: 8, alt: 400, rotation: [0, 0, 0, 1] },
    });
    const recorded = tour({
      objects: [pin("a")],
      captureSpots: {
        fixes: 4,
        gpsAccuracyMedianM: 3,
        captures: [spot("images/frame-0.png"), spot("images/frame-1.png")],
      },
    } as unknown as Partial<TourManifest>);
    expect(visitorStartView(recorded)).toEqual({
      title: "An AR tour",
      subline: "3 places to discover",
      coverPath: "images/frame-0.png",
    });
    // A placed photo still comes first.
    expect(
      visitorStartView({ ...recorded, objects: [photo("b")] }).coverPath,
    ).toBe("content/b.jpg");
  });

  // The cover is read from the zip by its path: only the tour's own photos
  // may be named - a photo object's image, else a capture spot's - never
  // anything else the manifest holds (M4 review #8: capture spots were
  // never generated here).
  it("only ever names one of the tour's own photos (property)", () => {
    const capture = (i: number) => ({
      image: `images/frame-${String(i)}.png`,
      geo: { lat: 47, lon: 8, alt: 400, rotation: [0, 0, 0, 1] },
    });
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("pin", "photo"), { maxLength: 8 }),
        fc.nat({ max: 4 }),
        (kinds, captureCount) => {
          const objects = kinds.map((kind, i) =>
            kind === "pin" ? pin(`p${String(i)}`) : photo(`f${String(i)}`),
          );
          const captures = Array.from({ length: captureCount }, (_, i) =>
            capture(i),
          );
          const manifest = tour({
            objects,
            ...(captureCount === 0
              ? {}
              : {
                  captureSpots: {
                    fixes: 4,
                    gpsAccuracyMedianM: 3,
                    captures,
                  },
                }),
          } as unknown as Partial<TourManifest>);
          const { coverPath } = visitorStartView(manifest);
          const own = [
            ...objects.flatMap((o) =>
              o.kind === "photo" ? [(o as { image: string }).image] : [],
            ),
            ...captures.map((c) => c.image),
          ];
          // The first of them, in that order, or none when there is none.
          expect(coverPath).toBe(own[0] ?? null);
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
    expect(dom.subline.hidden).toBe(true);
    expect(dom.cover.hidden).toBe(true);
    expect(revoked).toEqual(["blob:1"]);
  });
});
