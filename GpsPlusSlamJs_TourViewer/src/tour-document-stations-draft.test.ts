/**
 * Why these tests matter: a station's edit lives only in the tour
 * document until a save writes it; the draft is what brings it back after
 * a closed tab or a crash. Every station action must survive the round
 * trip "record, reload, read against the opened tour, restore" unchanged:
 * a title lost, a station added and not back, a deleted station back
 * again, a route left naming a station that is gone (which the format
 * refuses, so every later save would fail), or a copied station's card
 * image dropped because the record was read without its photos. A record
 * written before stations were recorded whole must still restore.
 */

import { describe, expect, it } from "vitest";
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
  type TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  documentFrames,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type StationFrame,
  type TourDocumentState,
} from "./tour-document.js";
import { parseSettingsRecord, settingsRecord } from "./tour-document-draft.js";
import { stationIdOf, tourOf } from "./test-support/v3-tour.js";

function pin(id: string, lat: number): TourObject {
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

/** Pins a and b, photo f, and a story station routing to st-b, with an
 *  image step naming the image asset img1. */
const OPENED: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      tourOf([pin("a", 48.52), pin("b", 48.5202), photo("f", 48.5204)], {
        assets: [
          {
            id: "img1",
            path: "content/img1.png",
            kind: "image",
            width: 1,
            height: 1,
          },
        ],
        stations: [
          {
            id: "story",
            geo: { lat: 48.53, lon: 9.05, alt: 400, rotation: [0, 0, 0, 1] },
            activateRadiusM: 50,
            foundRadiusM: 25,
            hint: "arrow",
            next: stationIdOf("b"),
            steps: [
              {
                id: "s1",
                block: { kind: "image", asset: "img1" },
                advance: { mode: "tap" },
              },
            ],
            items: [],
          },
        ],
      }),
    ),
  ),
);

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

/** What a reload brings back: the record as stored, read against the
 *  opened tour, and the objects' records, restored into a fresh open. */
function reloaded(state: TourDocumentState): TourDocumentState {
  const text = JSON.stringify(settingsRecord(state));
  const record = parseSettingsRecord(text, OPENED);
  if (record === undefined) throw new Error("the record did not read");
  return reduce(
    open(),
    act.restored({
      objects: state.placed.map((p) => p.object),
      deleted: [...state.deleted],
      ...(record.stations === undefined ? {} : { stations: record.stations }),
      ...(record.createdStations === undefined
        ? {}
        : { createdStations: record.createdStations }),
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      ...(record.order === undefined ? {} : { order: record.order }),
      ...(record.deletedStations === undefined
        ? {}
        : { deletedStations: record.deletedStations }),
      ...(record.handMadeStations === undefined
        ? {}
        : { handMadeStations: record.handMadeStations }),
      what: "restore",
    }),
  );
}

function expectSameDocument(
  restored: TourDocumentState,
  state: TourDocumentState,
): void {
  expect(documentFrames(restored)).toEqual(documentFrames(state));
  expect(
    documentObjects(restored)
      .map((o) => o.object)
      .sort((x, y) => x.id.localeCompare(y.id)),
  ).toEqual(
    documentObjects(state)
      .map((o) => o.object)
      .sort((x, y) => x.id.localeCompare(y.id)),
  );
  expect(manifestToWrite(restored)).toEqual(manifestToWrite(state));
}

describe("the draft keeps the stations whole", () => {
  it("a station renamed comes back renamed", () => {
    const state = reduce(
      open(),
      act.stationEdited({
        stationId: "story",
        edit: { title: "The gate", foundRadiusM: 40, description: "Here." },
        what: "rename",
      }),
    );
    expect(settingsRecord(state).frames).toBeDefined();
    expectSameDocument(reloaded(state), state);
  });

  it("a station added, one deleted (its route pruned), the order changed and an item copied all come back", () => {
    let state = open();
    state = reduce(
      state,
      act.stationAdded({
        at: { lat: 48.54, lon: 9.05, alt: 400 },
        stationId: "added1",
        what: "add",
      }),
    );
    state = reduce(
      state,
      act.stationDeleted({ stationId: stationIdOf("b"), what: "delete" }),
    );
    state = reduce(
      state,
      act.stationsReordered({
        order: [...state.stations.map((s) => s.id)].reverse(),
        what: "reorder",
      }),
    );
    state = reduce(
      state,
      act.objectDuplicated({
        id: "a",
        newId: "a2",
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "copy",
      }),
    );
    expect(settingsRecord(state).deletedStations).toEqual([stationIdOf("b")]);
    const restored = reloaded(state);
    expectSameDocument(restored, state);
    expect(restored.stations.some((s) => s.id === stationIdOf("b"))).toBe(
      false,
    );
  });

  // Why: a station split off its item's station would come back at the
  // tour's end from a reload unless the draft records the order.
  it("a station split off its item's station comes back in that station's place", () => {
    const state0 = open();
    const found = documentObjects(state0).find((o) => o.object.id === "a");
    if (found === undefined) throw new Error("no a");
    const state = reduce(
      state0,
      act.moved({
        object: { ...found.object, geo: { ...found.object.geo, alt: 401 } },
        newStation: true,
        afterHome: true,
        newStationId: "own1",
        what: "split",
      }),
    );
    // The item's station is left empty and leaves the tour; the new one
    // takes its place rather than the tour's end.
    expect((manifestToWrite(state)?.stations ?? []).map((s) => s.id)).toEqual([
      "story",
      "own1",
      stationIdOf("b"),
      stationIdOf("f"),
    ]);
    expectSameDocument(reloaded(state), state);
  });

  it("the record carries only the stations edited here, and an order only when a restore needs one", () => {
    // Why: a record of every station whole put the poses and the names of
    // stations nobody edited here back over a file changed elsewhere.
    const renamed = reduce(
      open(),
      act.stationEdited({
        stationId: stationIdOf("a"),
        edit: { title: "The gate" },
        what: "rename",
      }),
    );
    const record = settingsRecord(renamed);
    expect(record.frames?.map((f) => f.id)).toEqual([stationIdOf("a")]);
    expect(record.order).toBeUndefined();
    const reordered = reduce(
      renamed,
      act.stationsReordered({
        order: [...renamed.stations.map((s) => s.id)].reverse(),
        what: "reorder",
      }),
    );
    expect(settingsRecord(reordered).frames?.map((f) => f.id)).toEqual([
      stationIdOf("a"),
    ]);
    expect(settingsRecord(reordered).order).toEqual(
      [...renamed.stations.map((s) => s.id)].reverse(),
    );
    // A copy stands right after its original: only an order puts it there.
    const copied = reduce(
      open(),
      act.stationDuplicated({
        stationId: stationIdOf("a"),
        newStationId: "acopy",
        newItemIds: { a: "a2" },
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "copy",
      }),
    );
    expect(settingsRecord(copied).frames?.map((f) => f.id)).toEqual(["acopy"]);
    const order = settingsRecord(copied).order ?? [];
    expect(order.indexOf("acopy")).toBe(order.indexOf(stationIdOf("a")) + 1);
    expectSameDocument(reloaded(copied), copied);
  });

  it("a recorded frame comes back at the document's pose, not the one it was recorded at", () => {
    const state = open();
    const at = state.stations.find((s) => s.id === stationIdOf("a"))!;
    const restored = reduce(
      state,
      act.restored({
        objects: [],
        deleted: [],
        frames: [
          {
            ...at,
            title: "The gate",
            geo: { ...at.geo, lat: at.geo.lat + 0.001 },
          },
        ],
        what: "restore",
      }),
    );
    const a = restored.stations.find((s) => s.id === stationIdOf("a"));
    expect(a?.title).toBe("The gate");
    expect(a?.geo).toEqual(at.geo);
  });

  it("a station deleted is recorded; an automatic one a save dropped once its last item's delete emptied it is not", () => {
    // Why: the offer named an emptied automatic station "a station
    // deleted", though nobody deleted it: it follows its item, as it does
    // while the item's delete is unwritten, and the item's tombstone drops
    // it again on a restore.
    const deleted = reduce(
      open(),
      act.stationDeleted({ stationId: "story", what: "delete" }),
    );
    expect(settingsRecord(deleted).deletedStations).toEqual(["story"]);
    const emptied = reduce(
      reduce(
        open(),
        act.stationEdited({
          stationId: stationIdOf("a"),
          edit: { title: "The gate" },
          what: "rename",
        }),
      ),
      act.deleted({ id: "f", what: "delete" }),
    );
    const written = manifestToWrite(emptied);
    if (written === null) throw new Error("nothing open");
    const saved = reduce(
      emptied,
      act.saved({
        generation: emptied.generation,
        written,
        appliedDeletions: [...emptied.deleted],
        stationsAtStart: emptied.stations,
      }),
    );
    expect(saved.written?.stations.some((s) => s.id === stationIdOf("f"))).toBe(
      false,
    );
    expect(settingsRecord(saved).frames?.map((f) => f.id)).toEqual([
      stationIdOf("a"),
    ]);
    expect(settingsRecord(saved).deletedStations).toBeUndefined();
  });

  it("a copied station keeps the card image of its own copied photo through the record", () => {
    // Why: a created frame was read without any items, so the image of its
    // own photo read as gone and was dropped on every restore.
    let state = reduce(
      open(),
      act.stationDuplicated({
        stationId: stationIdOf("f"),
        newStationId: "fcopy",
        newItemIds: { f: "f2" },
        createdAtIso: "2026-10-22T00:00:00.000Z",
        what: "copy",
      }),
    );
    state = reduce(
      state,
      act.stationEdited({
        stationId: "fcopy",
        edit: { image: "f2" },
        what: "image",
      }),
    );
    const record = parseSettingsRecord(
      JSON.stringify(settingsRecord(state)),
      OPENED,
    );
    expect(record?.frames?.find((f) => f.id === "fcopy")?.image).toBe("f2");
    expect(record?.createdStations?.find((f) => f.id === "fcopy")?.image).toBe(
      "f2",
    );
    const restored = reloaded(state);
    expectSameDocument(restored, state);
    expect(
      manifestToWrite(restored)?.stations.find((s) => s.id === "fcopy")?.image,
    ).toBe("f2");
  });

  it("a recorded frame with an image step reads against the opened tour's assets, and is lost without them", () => {
    const state = reduce(
      open(),
      act.stationEdited({
        stationId: "story",
        edit: { title: "Story" },
        what: "rename",
      }),
    );
    const text = JSON.stringify(settingsRecord(state));
    expect(
      parseSettingsRecord(text, OPENED)?.frames?.some((f) => f.id === "story"),
    ).toBe(true);
    expect(
      parseSettingsRecord(text)?.frames?.some((f) => f.id === "story"),
    ).toBe(false);
  });

  it("a deleted station an object still names stays, and a route to a station gone is pruned", () => {
    const state = open();
    const restored = reduce(
      state,
      act.restored({
        objects: [],
        deleted: [],
        frames: [...documentFrames(state)],
        deletedStations: [stationIdOf("a"), stationIdOf("b")],
        what: "restore",
      }),
    );
    // st-a and st-b hold their pins: an object names them, so they stay.
    expect(restored.stations.map((s) => s.id)).toContain(stationIdOf("a"));
    const withoutB = reduce(
      reduce(state, act.deleted({ id: "b", what: "d" })),
      act.restored({
        objects: [],
        deleted: [],
        deletedStations: [stationIdOf("b")],
        what: "restore",
      }),
    );
    const story = withoutB.stations.find((s) => s.id === "story");
    expect(story?.next).toBeUndefined();
    // The tour the next save writes reads back.
    const written = manifestToWrite(withoutB);
    expect(written).not.toBeNull();
    if (written !== null)
      parseTourManifest(JSON.parse(serializeTourManifest(written)));
  });

  // Why: a created station reaches `restored` from a draft written by any
  // page, read against whichever tour was opened then. One whose story
  // names an asset this tour lacks, or that routes to a station this tour
  // lacks, would make every later save fail (the format refuses both), so
  // the reducer checks it against the stations and assets it merges into:
  // the first is left out (its pin is seated by the station rule), the
  // second keeps its frame without the dangling route.
  it("a created station is checked against the tour it is restored into: a missing asset leaves it out, a missing route target is pruned", () => {
    const at: StationFrame["geo"] = {
      lat: 48.6,
      lon: 9.05,
      alt: 400,
      rotation: [0, 0, 0, 1],
    };
    const frame = {
      id: "made",
      geo: at,
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow" as const,
      steps: [],
    };
    const restored = reduce(
      open(),
      act.restored({
        objects: [
          { ...pin("p", 48.6), station: "noAsset" },
          { ...pin("q", 48.6), station: "made" },
        ],
        deleted: [],
        createdStations: [
          {
            ...frame,
            id: "noAsset",
            steps: [
              {
                id: "s1",
                block: { kind: "image", asset: "elsewhere" },
                advance: { mode: "tap" },
              },
            ],
          },
          { ...frame, next: "nowhere" },
        ],
        what: "restore",
      }),
    );
    const ids = restored.stations.map((s) => s.id);
    expect(ids).not.toContain("noAsset");
    expect(ids).toContain("made");
    expect(
      restored.stations.find((s) => s.id === "made")?.next,
    ).toBeUndefined();
    const p = documentObjects(restored).find((o) => o.object.id === "p");
    expect(p).toBeDefined();
    expect(ids).toContain(p?.object.station);
    // The tour the next save writes reads back (a throw fails the test).
    const written = manifestToWrite(restored);
    expect(written).not.toBeNull();
    if (written !== null)
      parseTourManifest(JSON.parse(serializeTourManifest(written)));
  });

  it("a record written before stations were recorded whole still reads and restores its poses", () => {
    const moved = {
      lat: 48.5201,
      lon: 9.0501,
      alt: 401,
      rotation: [0, 0, 0, 1],
    };
    const text = JSON.stringify({
      needsNoGps: false,
      stations: OPENED.stations.map(({ id, geo }) =>
        id === stationIdOf("a") ? { id, geo: moved } : { id, geo },
      ),
    });
    const record = parseSettingsRecord(text, OPENED);
    expect(record?.frames).toBeUndefined();
    expect(record?.deletedStations).toBeUndefined();
    const restored = reduce(
      open(),
      act.restored({
        objects: [],
        deleted: [],
        ...(record?.stations === undefined
          ? {}
          : { stations: record.stations }),
        what: "restore",
      }),
    );
    expect(
      restored.stations.find((s) => s.id === stationIdOf("a"))?.geo,
    ).toEqual(moved);
    expect(restored.framesRecorded).toBe(false);
  });
});
