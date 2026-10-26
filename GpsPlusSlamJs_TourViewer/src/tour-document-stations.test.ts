/**
 * Why these tests matter: the station actions are the 3D editor's edits of
 * the tour's structure - a station's title, radius, description and card
 * image, a station added, deleted, reordered or duplicated, an item
 * duplicated, put on the ground or resized, an item moved into a station
 * of its own. Each is ONE undo step, each must count as a change (or
 * autosave and Save would never write it), and each must leave a tour the
 * format accepts: a route to a deleted station, a radius out of bounds or
 * a model size out of bounds would make every later save fail. Each guard
 * is tested at its edges and just outside them.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { localPoseOf } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { horizontalM } from "./move-with-code.js";
import { routedTo } from "./tour-content.js";
import {
  changeCount,
  documentObjects,
  initialTourDocumentState,
  manifestNow,
  manifestToWrite,
  stationDeleteRefusal,
  stationEditChange,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";

const AT = { lat: 48.52, lon: 9.05, alt: 400 };

function pin(id: string, lat = 48.52): TourObject {
  return {
    id,
    kind: "pin",
    label: `pin ${id}`,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function photo(id: string, lat: number): TourObject {
  return {
    id,
    kind: "photo",
    image: `content/${id}.jpg`,
    imageWidth: 4,
    imageHeight: 3,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

function model(id: string, lat: number, sizeM = 2): TourObject {
  return {
    id,
    kind: "model",
    asset: "m1",
    sizeM,
    createdAtIso: "2026-10-18T00:00:00.000Z",
    geo: { lat, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
  };
}

/** Stations a (pin), b (pin), f (photo), m (model), and a story station
 *  "story" whose `next` and quiz route name st-b and st-a, and whose
 *  image step names the image asset img1. Read through the format's own
 *  parser, so the fixture is a tour the format accepts. */
const OPENED: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      tourOf(
        [pin("a"), pin("b", 48.5202), photo("f", 48.5204), model("m", 48.5206)],
        {
          minor: 1,
          assets: [
            {
              id: "img1",
              path: "content/img1.png",
              kind: "image",
              width: 1,
              height: 1,
            },
            { id: "m1", path: "content/m1.glb", kind: "model" },
          ],
          stations: [
            {
              id: "story",
              title: "The story",
              geo: { ...AT, lat: 48.53, rotation: [0, 0, 0, 1] },
              activateRadiusM: 50,
              foundRadiusM: 25,
              hint: "arrow",
              next: stationIdOf("b"),
              steps: [
                {
                  id: "s1",
                  action: { kind: "image", asset: "img1" },
                  advance: { mode: "tap" },
                },
                {
                  id: "q1",
                  action: {
                    kind: "quiz",
                    question: "Which way?",
                    points: 1,
                    answer: {
                      type: "single",
                      options: [
                        { id: "o1", label: "Left" },
                        { id: "o2", label: "Right" },
                      ],
                      correct: "o1",
                    },
                    route: {
                      correct: stationIdOf("b"),
                      wrong: stationIdOf("a"),
                      byOption: { o1: stationIdOf("b"), o2: stationIdOf("a") },
                    },
                  },
                  advance: { mode: "tap" },
                },
              ],
              items: [],
            },
          ],
        },
      ),
    ),
  ),
);

function open(manifest: TourManifest = OPENED): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest }));
}

function frameOf(state: TourDocumentState, id: string) {
  const frame = state.stations.find((s) => s.id === id);
  if (frame === undefined) throw new Error(`no station ${id}`);
  return frame;
}

function objectOf(state: TourDocumentState, id: string): TourObject {
  const found = documentObjects(state).find((o) => o.object.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found.object;
}

/** What a save that landed leaves. */
function save(state: TourDocumentState): TourDocumentState {
  const written = manifestToWrite(state);
  if (written === null) throw new Error("nothing open");
  return reduce(
    state,
    act.saved({
      generation: state.generation,
      written,
      appliedDeletions: [...state.deleted],
      stationsAtStart: state.stations,
    }),
  );
}

/** The manifest a save writes, read back by the format's parser: a tour
 *  the format refuses throws here. */
function readBack(state: TourDocumentState): TourManifest {
  const written = manifestToWrite(state);
  if (written === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(written)));
}

/** One undo step back, and it gives back exactly `before`'s stations. */
function expectOneStep(
  before: TourDocumentState,
  after: TourDocumentState,
): void {
  expect(after.past.length).toBe(before.past.length + 1);
  const back = reduce(after, act.undone());
  expect(back.stations).toEqual(before.stations);
  expect(documentObjects(back).map((o) => o.object)).toEqual(
    documentObjects(before).map((o) => o.object),
  );
}

describe("stationEdited: a station's title, radius, description and card image", () => {
  it("sets a trimmed title as one step that counts as a change; a blank one removes it", () => {
    const before = open();
    const after = reduce(
      before,
      act.stationEdited({
        stationId: "story",
        edit: { title: "  The old gate  " },
        what: "rename",
      }),
    );
    expect(frameOf(after, "story").title).toBe("The old gate");
    expect(changeCount(after)).toBe(1);
    expectOneStep(before, after);
    const blank = reduce(
      after,
      act.stationEdited({
        stationId: "story",
        edit: { title: "   " },
        what: "rename",
      }),
    );
    expect(frameOf(blank, "story").title).toBeUndefined();
    expect(readBack(blank).stations.find((s) => s.id === "story")?.title).toBe(
      undefined,
    );
  });

  it("refuses a title over 80 characters and changes nothing; 80 is taken", () => {
    const state = open();
    expect(
      stationEditChange(state, "story", { title: "x".repeat(81) }),
    ).toEqual({ kind: "refused", reason: "title" });
    const after = reduce(
      state,
      act.stationEdited({
        stationId: "story",
        edit: { title: "x".repeat(81) },
        what: "rename",
      }),
    );
    expect(after).toBe(state);
    expect(
      stationEditChange(state, "story", { title: "x".repeat(80) }).kind,
    ).toBe("edited");
  });

  it("sets the found radius from 2 m to 300 m with the preload ring at twice it, and refuses just outside", () => {
    const state = open();
    for (const [found, preload] of [
      [2, 4],
      [300, 600],
      [40, 80],
    ] as const) {
      const after = reduce(
        state,
        act.stationEdited({
          stationId: stationIdOf("a"),
          edit: { foundRadiusM: found },
          what: "radius",
        }),
      );
      expect(frameOf(after, stationIdOf("a"))).toMatchObject({
        foundRadiusM: found,
        activateRadiusM: preload,
      });
      expect(changeCount(after)).toBe(1);
      readBack(after);
    }
    for (const bad of [1.999, 300.001, Number.NaN, 0]) {
      expect(
        stationEditChange(state, stationIdOf("a"), { foundRadiusM: bad }),
      ).toEqual({ kind: "refused", reason: "radius" });
      expect(
        reduce(
          state,
          act.stationEdited({
            stationId: stationIdOf("a"),
            edit: { foundRadiusM: bad },
            what: "radius",
          }),
        ),
      ).toBe(state);
    }
  });

  it("sets a trimmed description and removes a blank one; refuses one over 2000 characters", () => {
    const state = open();
    const after = reduce(
      state,
      act.stationEdited({
        stationId: "story",
        edit: { description: "  A walk.\nSecond line.  " },
        what: "description",
      }),
    );
    expect(frameOf(after, "story").description).toBe("A walk.\nSecond line.");
    expect(readBack(after).minor).toBe(2);
    expect(
      stationEditChange(state, "story", { description: "x".repeat(2000) }).kind,
    ).toBe("edited");
    expect(
      stationEditChange(state, "story", { description: "x".repeat(2001) }),
    ).toEqual({ kind: "refused", reason: "description" });
    const cleared = reduce(
      after,
      act.stationEdited({
        stationId: "story",
        edit: { description: "" },
        what: "description",
      }),
    );
    expect(frameOf(cleared, "story").description).toBeUndefined();
  });

  it("takes a card image of a photo of THAT station or an image asset, refuses any other, and null removes it", () => {
    const state = open();
    const own = reduce(
      state,
      act.stationEdited({
        stationId: stationIdOf("f"),
        edit: { image: "f" },
        what: "image",
      }),
    );
    expect(frameOf(own, stationIdOf("f")).image).toBe("f");
    expect(
      readBack(own).stations.find((s) => s.id === stationIdOf("f"))?.image,
    ).toBe("f");
    const asset = reduce(
      state,
      act.stationEdited({
        stationId: "story",
        edit: { image: "img1" },
        what: "image",
      }),
    );
    expect(frameOf(asset, "story").image).toBe("img1");
    for (const bad of ["f", "nope", "m1", "not an id!"]) {
      expect(stationEditChange(state, "story", { image: bad })).toEqual({
        kind: "refused",
        reason: "image",
      });
    }
    const removed = reduce(
      asset,
      act.stationEdited({
        stationId: "story",
        edit: { image: null },
        what: "image",
      }),
    );
    expect(frameOf(removed, "story").image).toBeUndefined();
  });

  it("an unknown station is missing and changes nothing; the same values are no step", () => {
    const state = open();
    expect(stationEditChange(state, "nope", { title: "x" })).toEqual({
      kind: "missing",
    });
    expect(stationEditChange(state, "story", { title: "The story" })).toEqual({
      kind: "unchanged",
    });
    expect(
      reduce(
        state,
        act.stationEdited({
          stationId: "story",
          edit: { title: "The story", foundRadiusM: 25 },
          what: "same",
        }),
      ),
    ).toBe(state);
  });
});

describe("the effective card image: a picture that is gone is not written", () => {
  it("deleting the photo a card shows drops the image from what is written - the write equals the file - and its undo brings it back", () => {
    // Why: a card image naming a deleted photo was kept in the manifest the
    // document called written while the writer left it out of the file, so
    // the two disagreed after every such save.
    const shown = reduce(
      open(),
      act.stationEdited({
        stationId: stationIdOf("f"),
        edit: { image: "f", title: "The fountain" },
        what: "image",
      }),
    );
    const gone = reduce(shown, act.deleted({ id: "f", what: "delete" }));
    const station = manifestNow(gone)?.stations.find(
      (s) => s.id === stationIdOf("f"),
    );
    // Its title keeps the emptied station; its card image went with the
    // photo.
    expect(station?.title).toBe("The fountain");
    expect(station?.image).toBeUndefined();
    const saved = save(gone);
    expect(saved.written?.stations).toEqual(readBack(gone).stations);
    expect(changeCount(saved)).toBe(0);
    const undone = reduce(saved, act.undone());
    expect(
      manifestNow(undone)?.stations.find((s) => s.id === stationIdOf("f"))
        ?.image,
    ).toBe("f");
  });
});

describe("stationAdded", () => {
  it("adds a station at a point with the next number as its title, kept and written though it holds nothing", () => {
    const before = open();
    const after = reduce(
      before,
      act.stationAdded({ at: AT, stationId: "new1", what: "add" }),
    );
    const frame = frameOf(after, "new1");
    expect(frame).toMatchObject({
      title: "Station 6",
      foundRadiusM: 25,
      activateRadiusM: 50,
      geo: { lat: AT.lat, lon: AT.lon, alt: AT.alt },
    });
    expect(after.stations.at(-1)?.id).toBe("new1");
    expect(changeCount(after)).toBe(1);
    expect(readBack(after).stations.some((s) => s.id === "new1")).toBe(true);
    expectOneStep(before, after);
  });

  it("refuses an id the tour carries and a point nobody can draw", () => {
    const state = open();
    expect(
      reduce(
        state,
        act.stationAdded({ at: AT, stationId: "story", what: "add" }),
      ),
    ).toBe(state);
    expect(
      reduce(
        state,
        act.stationAdded({
          at: { ...AT, lat: Number.NaN },
          stationId: "x1",
          what: "add",
        }),
      ),
    ).toBe(state);
    expect(
      reduce(
        state,
        act.stationAdded({
          at: { ...AT, lat: 91 },
          stationId: "x2",
          what: "add",
        }),
      ),
    ).toBe(state);
  });
});

describe("stationDeleted", () => {
  it("deletes a station with its items and prunes every route that named it, as one step", () => {
    const before = open();
    const after = reduce(
      before,
      act.stationDeleted({ stationId: stationIdOf("b"), what: "delete" }),
    );
    expect(after.stations.some((s) => s.id === stationIdOf("b"))).toBe(false);
    expect(documentObjects(after).some((o) => o.object.id === "b")).toBe(false);
    for (const frame of after.stations) {
      expect(routedTo(frame)).not.toContain(stationIdOf("b"));
    }
    const story = frameOf(after, "story");
    expect(story.next).toBeUndefined();
    const quiz = story.steps.find((s) => s.id === "q1")?.action;
    expect(quiz?.kind === "quiz" ? quiz.route : null).toEqual({
      wrong: stationIdOf("a"),
      byOption: { o2: stationIdOf("a") },
    });
    // The write reads back: no route names a missing station.
    readBack(after);
    expect(changeCount(after)).toBeGreaterThan(0);
    expectOneStep(before, after);
  });

  it("a written photo moved out of its station, the station then deleted, and the photo deleted, leaves a tombstone", () => {
    // Why: the file still holds the photo in its old station, so its
    // delete must be recorded. Without the tombstone the document hid the
    // photo only because its old station was gone: a reload from the
    // draft (which records the deletes, not that inference) brought it
    // back with its station, and a save kept its picture in the zip (the
    // rebuild removes a picture by the deletes).
    let state = open();
    const f = documentObjects(state).find((o) => o.object.id === "f")!.object;
    state = reduce(
      state,
      act.moved({
        object: f,
        newStation: true,
        newStationId: "own1",
        what: "own",
      }),
    );
    state = reduce(
      state,
      act.stationDeleted({ stationId: stationIdOf("f"), what: "delete" }),
    );
    expect(
      documentObjects(state).find((o) => o.object.id === "f")?.hosted,
    ).toBe(true);
    state = reduce(state, act.deleted({ id: "f", what: "delete" }));
    expect(state.deleted).toEqual(["f"]);
    expect(documentObjects(state).some((o) => o.object.id === "f")).toBe(false);
    readBack(state);
  });

  it("an empty station deleted counts as one change; a route left with no target goes whole", () => {
    let state = open();
    state = reduce(
      state,
      act.stationDeleted({ stationId: stationIdOf("a"), what: "delete" }),
    );
    state = reduce(
      state,
      act.stationDeleted({ stationId: stationIdOf("b"), what: "delete" }),
    );
    const quiz = frameOf(state, "story").steps.find(
      (s) => s.id === "q1",
    )?.action;
    expect(quiz?.kind === "quiz" ? quiz.route : "none").toBeUndefined();
    const empty = reduce(
      open(),
      act.stationAdded({ at: AT, stationId: "e1", what: "add" }),
    );
    const saved = save(empty);
    const deleted = reduce(
      saved,
      act.stationDeleted({ stationId: "e1", what: "delete" }),
    );
    expect(changeCount(deleted)).toBe(1);
  });

  it("refuses the last station and an unknown one", () => {
    const one = open(tourOf([pin("a")]));
    expect(stationDeleteRefusal(one, stationIdOf("a"))).toBe("last");
    expect(
      reduce(
        one,
        act.stationDeleted({ stationId: stationIdOf("a"), what: "delete" }),
      ),
    ).toBe(one);
    expect(stationDeleteRefusal(open(), "nope")).toBe("missing");
    expect(stationDeleteRefusal(open(), "story")).toBeNull();
  });
});

describe("stationsReordered", () => {
  it("takes a permutation of the stations as one step that counts as one change", () => {
    const before = open();
    const order = [...before.stations.map((s) => s.id)].reverse();
    const after = reduce(
      before,
      act.stationsReordered({ order, what: "reorder" }),
    );
    expect(after.stations.map((s) => s.id)).toEqual(order);
    expect(changeCount(after)).toBe(1);
    expect(readBack(after).stations.map((s) => s.id)).toEqual(order);
    expectOneStep(before, after);
  });

  it("refuses anything but a permutation, and the same order is no step", () => {
    const state = open();
    const ids = state.stations.map((s) => s.id);
    for (const bad of [
      ids.slice(1),
      [...ids, "nope"],
      [ids[0] ?? "", ...ids.slice(0, -1)],
    ]) {
      expect(
        reduce(state, act.stationsReordered({ order: bad, what: "reorder" })),
      ).toBe(state);
    }
    expect(
      reduce(state, act.stationsReordered({ order: ids, what: "reorder" })),
    ).toBe(state);
  });
});

describe("stationDuplicated", () => {
  it("copies a station beside it with new ids, its items rigidly, a photo under its own file, as one step", () => {
    const before = open();
    const after = reduce(
      before,
      act.stationDuplicated({
        stationId: stationIdOf("f"),
        newStationId: "fcopy",
        newItemIds: { f: "f2" },
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    const ids = after.stations.map((s) => s.id);
    expect(ids.indexOf("fcopy")).toBe(ids.indexOf(stationIdOf("f")) + 1);
    const original = frameOf(after, stationIdOf("f"));
    const copy = frameOf(after, "fcopy");
    expect(copy.title).toBe("Station 4 copy");
    expect(copy.image).toBeUndefined();
    expect(horizontalM(original.geo, copy.geo)).toBeCloseTo(
      2 * original.foundRadiusM + 5,
      2,
    );
    const item = objectOf(after, "f2");
    expect(item).toMatchObject({
      station: "fcopy",
      kind: "photo",
      image: "content/f2.jpg",
      createdAtIso: "2026-10-22T00:00:00.000Z",
    });
    const was = localPoseOf(objectOf(after, "f").geo, original.geo).position;
    const now = localPoseOf(item.geo, copy.geo).position;
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs((now[i] ?? 0) - (was[i] ?? 0))).toBeLessThan(0.001);
    }
    expect(changeCount(after)).toBeGreaterThan(0);
    readBack(after);
    expectOneStep(before, after);
  });

  it("copies a story station's steps and routes, and refuses a taken id or an item left without one", () => {
    const state = open();
    const after = reduce(
      state,
      act.stationDuplicated({
        stationId: "story",
        newStationId: "story2",
        newItemIds: {},
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    expect(frameOf(after, "story2")).toMatchObject({
      title: "The story copy",
      steps: frameOf(state, "story").steps,
      next: stationIdOf("b"),
    });
    readBack(after);
    for (const bad of [
      { newStationId: "story", newItemIds: {} },
      { newStationId: "ok1", newItemIds: {} },
      { newStationId: "ok2", newItemIds: { f: "a" } },
    ]) {
      expect(
        reduce(
          state,
          act.stationDuplicated({
            stationId:
              bad.newStationId === "story" ? "story" : stationIdOf("f"),
            ...bad,
            createdAtIso: "2026-10-22T00:00:00.000Z",
            what: "duplicate",
          }),
        ),
      ).toBe(state);
    }
  });
});

describe("objectDuplicated", () => {
  it("copies an item 1.5 m east in its own station, its label marked, as one step", () => {
    const before = open();
    const after = reduce(
      before,
      act.objectDuplicated({
        id: "a",
        newId: "a2",
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    const copy = objectOf(after, "a2");
    expect(copy).toMatchObject({
      kind: "pin",
      label: "pin a copy",
      station: stationIdOf("a"),
    });
    expect(horizontalM(objectOf(after, "a").geo, copy.geo)).toBeCloseTo(1.5, 3);
    expect(changeCount(after)).toBe(1);
    readBack(after);
    expectOneStep(before, after);
  });

  it("refuses an unknown item and a taken id", () => {
    const state = open();
    for (const [id, newId] of [
      ["nope", "x1"],
      ["a", "b"],
      ["a", "m1"],
    ] as const) {
      expect(
        reduce(
          state,
          act.objectDuplicated({
            id,
            newId,
            createdAtIso: "2026-10-22T00:00:00.000Z",
            what: "duplicate",
          }),
        ),
      ).toBe(state);
    }
  });
});

describe("itemsGrounded", () => {
  it("puts N items at the given altitudes as ONE step; an unknown id refuses the whole", () => {
    const before = open();
    const after = reduce(
      before,
      act.itemsGrounded({
        items: [
          { id: "a", alt: 398.5 },
          { id: "b", alt: 401.25 },
        ],
        what: "ground",
      }),
    );
    expect(objectOf(after, "a").geo.alt).toBe(398.5);
    expect(objectOf(after, "b").geo.alt).toBe(401.25);
    expect(objectOf(after, "a").station).toBe(stationIdOf("a"));
    expect(changeCount(after)).toBe(2);
    expectOneStep(before, after);
    expect(
      reduce(
        before,
        act.itemsGrounded({
          items: [
            { id: "a", alt: 398 },
            { id: "nope", alt: 398 },
          ],
          what: "ground",
        }),
      ),
    ).toBe(before);
    expect(
      reduce(
        before,
        act.itemsGrounded({
          items: [{ id: "a", alt: Number.NaN }],
          what: "ground",
        }),
      ),
    ).toBe(before);
    expect(
      reduce(
        before,
        act.itemsGrounded({ items: [{ id: "a", alt: 400 }], what: "ground" }),
      ),
    ).toBe(before);
  });
});

describe("modelResized", () => {
  it("takes a size from 0.05 m to 500 m and refuses just outside, a non-model and an unknown id", () => {
    const state = open();
    for (const size of [0.05, 500, 3.5]) {
      const after = reduce(
        state,
        act.modelResized({ id: "m", sizeM: size, what: "resize" }),
      );
      const resized = objectOf(after, "m");
      expect(resized.kind === "model" ? resized.sizeM : null).toBe(size);
      expect(changeCount(after)).toBe(1);
      readBack(after);
    }
    for (const [id, size] of [
      ["m", 0.0499],
      ["m", 500.01],
      ["m", Number.NaN],
      ["a", 3],
      ["nope", 3],
    ] as const) {
      expect(
        reduce(state, act.modelResized({ id, sizeM: size, what: "resize" })),
      ).toBe(state);
    }
  });
});

describe("moved, into a station of its own", () => {
  it("starts a station where the item stands even within its station's radius, and the emptied one goes", () => {
    const before = open();
    const object = objectOf(before, "f");
    const after = reduce(
      before,
      act.moved({
        object: { ...object, geo: { ...object.geo, alt: 401 } },
        newStation: true,
        newStationId: "own1",
        what: "own station",
      }),
    );
    expect(objectOf(after, "f").station).toBe("own1");
    expect(objectOf(after, "f").geo.alt).toBe(401);
    expect(after.stations.some((s) => s.id === stationIdOf("f"))).toBe(false);
    readBack(after);
    expectOneStep(before, after);
  });
});

describe("changeCount, the stations", () => {
  it("counts a station the rule started for a placement once (the placement), never twice", () => {
    const state = reduce(
      open(),
      act.placed({ object: pin("n", 48.6), newStationId: "auto1", what: "p" }),
    );
    expect(state.stations.some((s) => s.id === "auto1")).toBe(true);
    expect(changeCount(state)).toBe(1);
  });

  it("counts a deleted pin's emptied station once (the delete)", () => {
    const state = reduce(open(), act.deleted({ id: "a", what: "d" }));
    expect(changeCount(state)).toBe(1);
  });
});

describe("stationDeleted (property)", () => {
  it("any order of station deletes leaves no route to a missing station, and a tour the format reads", () => {
    // Why: the format refuses a route to a station the tour lacks, so a
    // single dangling `next` or quiz target would make every later save
    // fail. Every station of the fixture is routed to by the story.
    const ids = OPENED.stations.map((s) => s.id);
    fc.assert(
      fc.property(fc.shuffledSubarray(ids), (order) => {
        let state = open();
        for (const stationId of order) {
          state = reduce(state, act.stationDeleted({ stationId, what: "d" }));
          const carried = new Set(
            (manifestNow(state)?.stations ?? []).map((s) => s.id),
          );
          for (const frame of manifestNow(state)?.stations ?? []) {
            for (const target of routedTo(frame)) {
              expect(carried.has(target)).toBe(true);
            }
          }
          readBack(state);
        }
        // The last station always stays.
        expect(manifestNow(state)?.stations.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe("a written station no frame names (emptied, until a write prunes it)", () => {
  // Why: such a station still shows in the tour the next write carries,
  // and a delete or a reorder of it worked, but its edit and its copy
  // looked only at the document's own frames and said "no such station".
  it("is edited and copied like any other station", () => {
    const state = reduce(open(), act.deleted({ id: "f", what: "delete" }));
    expect(state.stations.some((s) => s.id === stationIdOf("f"))).toBe(false);
    expect(
      manifestNow(state)?.stations.some((s) => s.id === stationIdOf("f")),
    ).toBe(true);
    expect(
      stationEditChange(state, stationIdOf("f"), { title: "Kept" }).kind,
    ).toBe("edited");
    const edited = reduce(
      state,
      act.stationEdited({
        stationId: stationIdOf("f"),
        edit: { title: "Kept" },
        what: "rename",
      }),
    );
    expect(
      readBack(edited).stations.find((s) => s.id === stationIdOf("f"))?.title,
    ).toBe("Kept");
    expectOneStep(state, edited);
    const copied = reduce(
      state,
      act.stationDuplicated({
        stationId: stationIdOf("f"),
        newStationId: "fcopy",
        newItemIds: {},
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    // The copy stands where the emptied original stood, and the original
    // stays unlisted. Listed back so the copy could stand after it, it
    // ordered the items moved out of it ahead of their new station's own
    // at a later reorder - an order a reload from the draft cannot give
    // back.
    const shownBefore = (manifestNow(state)?.stations ?? []).map((s) => s.id);
    const ids = (manifestNow(copied)?.stations ?? []).map((s) => s.id);
    expect(ids.indexOf("fcopy")).toBe(shownBefore.indexOf(stationIdOf("f")));
    expect(copied.stations.some((s) => s.id === stationIdOf("f"))).toBe(false);
    readBack(copied);
  });
});

describe("stationDuplicated, the copy's title and card image", () => {
  it("trims a long title so the copy's still fits 80 characters, and keeps a card image of an image asset", () => {
    // Why: "<title> copy" of an 80-character title is 85, which the title
    // field refuses (the copy could not be renamed back to it), and an
    // image asset stays valid on the copy - only an own photo does not.
    const long = `${"x".repeat(78)}\u{1F30D}`;
    let state = reduce(
      open(),
      act.stationEdited({
        stationId: "story",
        edit: { title: long, image: "img1" },
        what: "edit",
      }),
    );
    expect(frameOf(state, "story").title).toBe(long);
    state = reduce(
      state,
      act.stationDuplicated({
        stationId: "story",
        newStationId: "story2",
        newItemIds: {},
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "duplicate",
      }),
    );
    const copy = frameOf(state, "story2");
    expect([...(copy.title ?? "")]).toHaveLength(80);
    expect(copy.title).toBe(`${"x".repeat(75)} copy`);
    expect(copy.image).toBe("img1");
    expect(
      stationEditChange(state, "story2", { title: copy.title ?? "" }).kind,
    ).toBe("unchanged");
    readBack(state);
  });
});

describe("a bare empty station of the opened file", () => {
  it("deleted, saved and undone comes back", () => {
    // Why: a station with nothing of its own and no items is dropped from
    // the frames once the written file lacks it, so the undo of its
    // delete across a save brought nothing back.
    const bare = {
      id: "bare",
      geo: { ...AT, lat: 48.51, rotation: [0, 0, 0, 1] as const },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow" as const,
      steps: [],
      items: [],
    };
    const withBare: TourManifest = parseTourManifest(
      JSON.parse(
        serializeTourManifest({
          ...OPENED,
          stations: [
            ...OPENED.stations,
            { ...bare, geo: { ...bare.geo, rotation: [0, 0, 0, 1] } },
          ],
        }),
      ),
    );
    const deleted = reduce(
      open(withBare),
      act.stationDeleted({ stationId: "bare", what: "delete" }),
    );
    const saved = save(deleted);
    expect(saved.written?.stations.some((s) => s.id === "bare")).toBe(false);
    const undone = reduce(saved, act.undone());
    expect(manifestNow(undone)?.stations.map((s) => s.id)).toEqual(
      withBare.stations.map((s) => s.id),
    );
    expect(readBack(undone).stations.some((s) => s.id === "bare")).toBe(true);
  });
});
