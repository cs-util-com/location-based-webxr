/**
 * Why these tests matter: an item moved onto ANOTHER station changes two
 * stations in one step. A free item is an object record naming its station
 * and its world place, so a move that kept either would leave it standing
 * by the old station or listed under it; a story's entries live in the
 * frames, so a move that changed one frame only would write an id twice
 * (the format refuses the file) or lose it. Each test writes the tour
 * through the format's own reader, rebuilds it from the draft and checks
 * that one undo gives the tour back.
 */
import {
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourFreeBlocks } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { tourStories } from "gps-plus-slam-app-framework/ar/tour-story";
import { describe, expect, it } from "vitest";

import { NARRATION_DEFAULT_RADIUS_M } from "./kinds/audio/sound-reach.js";
import { stationContent, storyOf } from "./test-support/station-content.js";
import { tourOf } from "./test-support/tour-of.js";
import {
  changeCount,
  childMoveChange,
  documentObjects,
  initialTourDocumentState,
  manifestToWrite,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type TourDocumentState,
} from "./tour-document.js";
import {
  parseSettingsRecord,
  settingsRecord,
  settingsRecordText,
} from "./tour-document-draft.js";

const WELL = { lat: 48.52, lon: 9.05, alt: 400 };
const MILL = { lat: 48.52, lon: 9.0514, alt: 402 };
const OFF = { position: [3, 0.5, 1], rotation: [0, 0, 0, 1] } as const;

function line(id: string, caption: string) {
  return { id, kind: "shortText", view: "card", caption, pose: OFF } as const;
}

const FREE_PIN = {
  id: "well-sign",
  kind: "shortText",
  view: "pin",
  caption: "The well",
  createdAtIso: "2026-11-06T00:00:00.000Z",
  pose: OFF,
} as const;

const station = (id: string, at: typeof WELL, children: unknown[]) => ({
  id,
  title: `The ${id}`,
  geo: { ...at, rotation: [0, 0, 0, 1] as const },
  activateRadiusM: 50,
  foundRadiusM: 25,
  hint: "arrow" as const,
  ...stationContent(children as Parameters<typeof stationContent>[0]),
});

const OPENED: TourManifest = parseTourManifest(
  JSON.parse(
    serializeTourManifest(
      tourOf([], {
        stations: [
          station("well", WELL, [
            storyOf("miller", [line("m1", "The miller")], "The miller"),
            FREE_PIN,
          ]),
          station("mill", MILL, [
            storyOf("tale", [line("t1", "A tale")], "A tale"),
          ]),
        ],
      }),
    ),
  ),
);

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

/** What the next write carries, read back by the format. */
function written(state: TourDocumentState): TourManifest {
  const manifest = manifestToWrite(state);
  if (manifest === null) throw new Error("nothing open");
  return parseTourManifest(JSON.parse(serializeTourManifest(manifest)));
}

function stationOf(state: TourDocumentState, id: string) {
  const found = written(state).stations.find((s) => s.id === id);
  if (found === undefined) throw new Error(`no station ${id}`);
  return found;
}

const freeIds = (state: TourDocumentState, id: string) =>
  tourFreeBlocks(stationOf(state, id)).map((b) => b.id);

const storyIds = (state: TourDocumentState, id: string) =>
  tourStories(stationOf(state, id)).map((s) => s.id);

/** The document a reload rebuilds from what the draft stores. */
function reloaded(state: TourDocumentState): TourDocumentState {
  const record = parseSettingsRecord(
    settingsRecordText(settingsRecord(state)),
    OPENED,
  );
  if (record === undefined) throw new Error("the record did not read");
  return reduce(
    open(),
    act.restored({
      objects: state.placed.map((p) => p.object),
      deleted: state.deleted,
      ...(record.frames === undefined ? {} : { frames: record.frames }),
      what: "restore",
    }),
  );
}

const toMill = (id: string) =>
  act.childMoved({
    id,
    to: { place: "station", station: "mill" },
    what: `the move of ${id}`,
  });

/** One undo gives `before` back; the draft rebuilds `after`. */
function oneStep(before: TourDocumentState, after: TourDocumentState): void {
  expect(after.past.length).toBe(before.past.length + 1);
  expect(manifestToWrite(reduce(after, act.undone()))).toEqual(
    manifestToWrite(before),
  );
  expect(manifestToWrite(reloaded(after))).toEqual(manifestToWrite(after));
}

describe("a station item moved onto another station", () => {
  it("moves a free pin there, standing at its centre, its record renamed", () => {
    const before = open();
    const after = reduce(before, toMill("well-sign"));
    expect(freeIds(after, "well")).toEqual([]);
    expect(freeIds(after, "mill")).toEqual(["well-sign"]);
    const pin = tourFreeBlocks(stationOf(after, "mill"))[0];
    expect(pin?.pose.position).toEqual([0, 0, 0]);
    const record = documentObjects(after).find(
      (o) => o.object.id === "well-sign",
    );
    expect(record?.object.station).toBe("mill");
    expect(record?.object.geo.lon).toBeCloseTo(MILL.lon, 6);
    // One change: the pin's record (its frames hold no free item).
    expect(changeCount(after)).toBe(1);
    oneStep(before, after);
  });

  // Why: a story's entries carry offsets in their station's frame; moved
  // whole they keep them, now around the other station's centre, and the
  // two frames that change count as two changes.
  it("moves a story whole after the other's stories, its entries' offsets kept", () => {
    const before = open();
    const after = reduce(before, toMill("miller"));
    expect(storyIds(after, "well")).toEqual([]);
    expect(storyIds(after, "mill")).toEqual(["tale", "miller"]);
    const miller = tourStories(stationOf(after, "mill"))[1];
    expect(miller?.children[0]).toMatchObject({ id: "m1", pose: OFF });
    expect(freeIds(after, "well")).toEqual(["well-sign"]);
    expect(changeCount(after)).toBe(2);
    oneStep(before, after);
  });

  it("moves a story's entry out to stand free at the other station's centre", () => {
    const before = open();
    const change = childMoveChange(before, "m1", {
      place: "station",
      station: "mill",
    });
    expect(change).toMatchObject({ kind: "moved", answers: 0, floored: true });
    const after = reduce(before, toMill("m1"));
    expect(tourStories(stationOf(after, "well"))[0]?.children).toEqual([]);
    const m1 = tourFreeBlocks(stationOf(after, "mill"))[0];
    expect(m1).toMatchObject({ id: "m1", view: "pin" });
    expect(m1?.pose.position).toEqual([0, 0, 0]);
    expect(
      documentObjects(after).find((o) => o.object.id === "m1")?.object.station,
    ).toBe("mill");
    oneStep(before, after);
  });

  it("writes nothing for a station that is not there or the item's own", () => {
    const before = open();
    const nowhere = act.childMoved({
      id: "well-sign",
      to: { place: "station", station: "nowhere" },
      what: "x",
    });
    expect(reduce(before, nowhere)).toBe(before);
    expect(
      childMoveChange(before, "well-sign", {
        place: "station",
        station: "well",
      }),
    ).toEqual({ kind: "unchanged" });
    expect(reduce(before, toMill("nobody"))).toBe(before);
  });
});

// Why: a sound in the world is a narration circle, and the format refuses
// one without a radius. Moved onto another station, an item keeps the
// radius its author gave it; a sound leaving a story's card (which has
// none) takes the editor's starting radius, so the written tour still
// reads and the circle still opens where the visitor stands.
describe("a sound moved onto another station", () => {
  const SOUND_TOUR: TourManifest = parseTourManifest(
    JSON.parse(
      serializeTourManifest(
        tourOf([], {
          assets: [{ id: "snd", path: "content/snd.mp3", kind: "audio" }],
          stations: [
            station("well", WELL, [
              storyOf(
                "voices",
                [
                  {
                    id: "said",
                    kind: "audio",
                    view: "card",
                    audio: "snd",
                    pose: OFF,
                  },
                  {
                    id: "circle",
                    kind: "audio",
                    view: "spot",
                    audio: "snd",
                    radiusM: 11,
                    pose: OFF,
                  },
                ],
                "Voices",
              ),
              {
                id: "guide",
                kind: "audio",
                view: "spot",
                audio: "snd",
                radiusM: 9,
                createdAtIso: "2026-11-06T00:00:00.000Z",
                pose: OFF,
              },
            ]),
            station("mill", MILL, []),
          ],
        }),
      ),
    ),
  );

  const openSounds = () =>
    reduce(initialTourDocumentState, act.opened({ manifest: SOUND_TOUR }));

  const soundAtMill = (state: TourDocumentState, id: string) =>
    tourFreeBlocks(stationOf(state, "mill")).find((b) => b.id === id);

  it("keeps a free sound's radius", () => {
    const before = openSounds();
    const after = reduce(before, toMill("guide"));
    expect(soundAtMill(after, "guide")).toMatchObject({
      view: "spot",
      radiusM: 9,
    });
    expect(manifestToWrite(reduce(after, act.undone()))).toEqual(
      manifestToWrite(before),
    );
  });

  it("keeps the radius of a story's narration circle", () => {
    const after = reduce(openSounds(), toMill("circle"));
    expect(soundAtMill(after, "circle")).toMatchObject({
      view: "spot",
      radiusM: 11,
    });
  });

  it("gives a story's card sound the starting radius", () => {
    const before = openSounds();
    expect(
      childMoveChange(before, "said", { place: "station", station: "mill" }),
    ).toMatchObject({ kind: "moved", floored: true });
    const after = reduce(before, toMill("said"));
    expect(soundAtMill(after, "said")).toMatchObject({
      view: "spot",
      radiusM: NARRATION_DEFAULT_RADIUS_M,
    });
  });
});
