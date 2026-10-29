/**
 * Why these tests matter: a character of a station's story is set in the
 * 3D inspector - his view, how the step showing him moves on, the heading
 * he faces - as an edit of his station. Each must be ONE undo step that
 * counts as a change and reaches the saved tour as the format reads it,
 * and anything the format would refuse must change nothing (a refused
 * value written would make every later save fail).
 */
import { describe, expect, it } from "vitest";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { restYawOf } from "./character-views.js";
import {
  changeCount,
  initialTourDocumentState,
  manifestToWrite,
  stationEditChange,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type StationCharacterEdit,
  type TourDocumentState,
} from "./tour-document.js";

const POSE = { position: [3, 0, 1], rotation: [0, 0, 0, 1] };

/** A station "gate" whose story shows a long text, then Wendel (a
 *  declared character) in the speak view, each moving on by a tap. */
const OPENED: TourManifest = parseTourManifest({
  ...createEmptyTourManifest(),
  minor: 2,
  assets: [
    {
      id: "wendel",
      path: "content/wendel.png",
      kind: "image",
      width: 512,
      height: 1024,
    },
  ],
  characters: [{ id: "wendel", name: "Wendel", image: "wendel" }],
  stations: [
    {
      id: "gate",
      title: "The gate",
      geo: { lat: 48.52, lon: 9.05, alt: 400, headingDeg: 0 },
      activateRadiusM: 50,
      foundRadiusM: 25,
      hint: "arrow",
      blocks: [
        {
          id: "intro",
          kind: "longText",
          view: "card",
          title: "The siege",
          body: "In 1632 the gate held.",
          pose: POSE,
        },
        {
          id: "w1",
          kind: "character",
          view: "speak",
          character: "wendel",
          name: "Wendel",
          image: "wendel",
          caption: "Good day, traveller!",
          pose: POSE,
        },
      ],
      steps: [
        {
          id: "s1",
          action: { kind: "show", block: "intro" },
          advance: { mode: "tap" },
        },
        {
          id: "s2",
          action: { kind: "show", block: "w1" },
          advance: { mode: "tap" },
        },
      ],
    },
  ],
});

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

function edit(
  state: TourDocumentState,
  character: StationCharacterEdit,
): TourDocumentState {
  return reduce(
    state,
    act.stationEdited({
      stationId: "gate",
      edit: { character },
      what: "the change of the gate",
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

function gateOf(manifest: TourManifest) {
  const gate = manifest.stations.find((s) => s.id === "gate");
  if (gate === undefined) throw new Error("no gate");
  return gate;
}

function wendelOf(manifest: TourManifest) {
  const block = gateOf(manifest).blocks.find((b) => b.id === "w1");
  if (block?.kind !== "character") throw new Error("no Wendel");
  return block;
}

/** One undo step back gives back exactly `before`'s stations. */
function expectOneStep(
  before: TourDocumentState,
  after: TourDocumentState,
): void {
  expect(after.past.length).toBe(before.past.length + 1);
  expect(reduce(after, act.undone()).stations).toEqual(before.stations);
}

describe("stationEdited: a character of the station's story", () => {
  it("sets his view as one step that counts as a change, and the saved tour reads it back", () => {
    const before = open();
    const after = edit(before, { block: "w1", view: "two-stations" });
    expect(changeCount(after)).toBe(1);
    expectOneStep(before, after);
    const saved = readBack(after);
    expect(wendelOf(saved).view).toBe("two-stations");
    // Nothing else of him changes: his line, his declaration, his place.
    expect(wendelOf(saved)).toMatchObject({
      caption: "Good day, traveller!",
      character: "wendel",
      pose: POSE,
    });
  });

  it("moves the step showing him on when his line ends, and back on a tap; the other steps keep theirs", () => {
    const lineEnd = edit(open(), { block: "w1", advance: "lineEnd" });
    expect(gateOf(readBack(lineEnd)).steps.map((s) => s.advance)).toEqual([
      { mode: "tap" },
      { mode: "lineEnd" },
    ]);
    const tap = edit(lineEnd, { block: "w1", advance: "tap" });
    expect(gateOf(readBack(tap)).steps.map((s) => s.advance.mode)).toEqual([
      "tap",
      "tap",
    ]);
    expectOneStep(lineEnd, tap);
  });

  it("turns him to face a heading, his place kept", () => {
    const after = edit(open(), { block: "w1", facingDeg: 180 });
    const wendel = wendelOf(readBack(after));
    expect(wendel.pose.position).toEqual(POSE.position);
    // Facing south: the station frame's -x, restYawOf's yaw of -pi/2.
    expect(Math.cos(restYawOf(wendel.pose.rotation) + Math.PI / 2)).toBeCloseTo(
      1,
      9,
    );
  });

  it("refuses what the format would refuse, and changes nothing", () => {
    const state = open();
    const refused: StationCharacterEdit[] = [
      // A block of the station that is no character, and none at all.
      { block: "intro", view: "bubble" },
      { block: "nobody", view: "bubble" },
      // A view of another kind, and none of the format's.
      { block: "w1", view: "pin" },
      { block: "w1", view: "dance" },
      // An advance mode the inspector does not set, and none at all.
      { block: "w1", advance: "auto" as "tap" },
      { block: "w1", advance: "jump" as "tap" },
      // A facing that is no number.
      { block: "w1", facingDeg: Number.NaN },
    ];
    for (const character of refused) {
      expect(stationEditChange(state, "gate", { character })).toEqual({
        kind: "refused",
        reason: "character",
      });
      expect(edit(state, character)).toBe(state);
    }
  });

  it("finds nothing to change in the view he has", () => {
    expect(
      stationEditChange(open(), "gate", {
        character: { block: "w1", view: "speak" },
      }),
    ).toEqual({ kind: "unchanged" });
  });
});
