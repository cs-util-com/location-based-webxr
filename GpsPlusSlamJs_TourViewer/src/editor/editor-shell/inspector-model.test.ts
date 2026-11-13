/**
 * Why these tests matter: the 3D view's inspector shows the selection's
 * fields read-only, and what it says must be what the file holds - a
 * radius, a size, a print size - in the units the creator thinks in, so
 * a creator who checks a station before going out reads the truth. An
 * item's heading comes from its rotation, so a rotation turned by a
 * known angle must read back as that angle; and a selection the tour no
 * longer has shows no inspector rather than a stale one. Where a station
 * or a code stands is said as the 3D view frames it: metres east and
 * north of the tour's centre, its height and its heading.
 */
import type { TourLocalPose } from "gps-plus-slam-app-framework/ar/tour-manifest";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Activates the licence an item's place in the world needs.
import "../../test-support/tour-of.js";

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";

import { TOUR_CHARACTER_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";

import { END_TARGET } from "../story-steps.js";
import { facingRotation } from "../../character-views.js";
import {
  buildInspector,
  inspectorCrumb,
  CHARACTER_VIEW_CHOICES,
  headingOfRotation,
  inspectorHint,
  ON_GROUND_M,
} from "./inspector-model.js";
import {
  stationContent,
  storyOf,
  withFreeBlocks,
} from "../../test-support/station-content.js";

const AT = "2026-10-22T10:00:00Z";

/** A unit quaternion turning by `deg` about the up axis (NUE: y up). */
function turn(deg: number): [number, number, number, number] {
  const half = (deg * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

const STATIONS: TourStation[] = [
  {
    id: "a",
    title: "Market Square",
    description: " Where the market meets ",
    geo: { lat: 48.1371234, lon: 11.5754321, alt: 562.25, headingDeg: 30 },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    ...stationContent([
      {
        id: "pin-1",
        kind: "shortText",
        view: "pin",
        caption: "Fountain, 1612",
        createdAtIso: AT,
        pose: { position: [4, 1.5, -2], rotation: [0, 0, 0, 1] },
      },
      {
        id: "model-1",
        kind: "model",
        view: "placed",
        asset: "horse",
        sizeM: 2.4,
        createdAtIso: AT,
        pose: { position: [0, 0, 0], rotation: turn(-90) },
      },
    ]),
  } as unknown as TourStation,
  {
    id: "b",
    geo: { lat: 48.138, lon: 11.576, alt: 560, headingDeg: 0 },
    activateRadiusM: 60,
    foundRadiusM: 30,
    hint: "arrow",
    ...stationContent([]),
  } as unknown as TourStation,
];

const CODES = [
  {
    id: "level-1",
    title: "Code 1",
    meta: "Printed code, measured on site",
    geo: { lat: 48.1, lon: 11.5, alt: 561.5, headingDeg: 180 },
    printSizeM: 0.5,
  },
  {
    id: "level-2",
    title: "Code 2",
    meta: "Printed code, no position stored yet",
    geo: null,
    printSizeM: null,
  },
];

function inspect(selected: string | null, unlockedStations: string[] = []) {
  return buildInspector({
    selected,
    stations: STATIONS,
    assets: [],
    codes: CODES,
    unlockedStations,
  });
}

/** The position the inspector shows for `selected`. */
function positionOf(selected: string) {
  const model = inspect(selected);
  if (model === null || !("position" in model) || model.position === null) {
    throw new Error(`no position for ${selected}`);
  }
  return model.position;
}

describe("inspectorCrumb", () => {
  const crumb = (selected: string | null, stations = STATIONS) =>
    inspectorCrumb({ selected, stations, codes: CODES });
  const tour = { label: "Tour", select: null };

  // Why: a free item's way up is its station, a code's the tour; nothing
  // selected, or a selection the tour lacks, is the tour itself.
  it("leads from a free item to its station and from a code to the tour", () => {
    expect(crumb("pin-1")).toEqual([
      tour,
      { label: "1 Market Square", select: "station:a" },
      { label: "Fountain, 1612", select: "pin-1" },
    ]);
    expect(crumb("level-1")).toEqual([
      tour,
      { label: "Code 1", select: "level-1" },
    ]);
    expect(crumb(null)).toEqual([tour]);
    expect(crumb("gone")).toEqual([tour]);
  });

  // Why: an item in a plain folder goes up to its folder, and the folder
  // to its station, as the tree nests them.
  it("leads from an item in a folder to its folder, then its station", () => {
    const station = {
      ...STATIONS[0]!,
      children: [
        {
          id: "f",
          kind: "folder",
          title: "Benches",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          children: [
            {
              id: "deep",
              kind: "shortText",
              view: "pin",
              caption: "Deep",
              createdAtIso: AT,
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            },
          ],
        },
      ],
    } as unknown as TourStation;
    const square = { label: "1 Market Square", select: "station:a" };
    const benches = { label: "Benches", select: "folder:f" };
    expect(crumb("deep", [station])).toEqual([
      tour,
      square,
      benches,
      { label: "Deep", select: "deep" },
    ]);
    expect(crumb("folder:f", [station])).toEqual([tour, square, benches]);
  });
});

describe("buildInspector", () => {
  it("shows nothing without a selection, or for one the tour does not have", () => {
    expect(inspect(null)).toBeNull();
    expect(inspect("station:gone")).toBeNull();
    expect(inspect("gone")).toBeNull();
  });

  it("shows a station's fields as the file holds them", () => {
    expect(inspect("station:a")).toEqual({
      kind: "station",
      title: "Market Square",
      name: "Market Square",
      sub: "Station 1 of 2",
      place: { number: 1, count: 2 },
      description: "Where the market meets",
      imagePath: null,
      images: [],
      imageId: null,
      foundRadiusM: 25,
      activateRadiusM: 50,
      outside: 0,
      offGround: null,
      groundOffM: null,
      locked: true,

      contents: [
        { id: "pin-1", kind: "pin", title: "Fountain, 1612" },
        { id: "model-1", kind: "model", title: expect.any(String) },
      ],
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 562.25,
        headingDeg: 30,
      },
    });
    expect(inspect("station:b")).toMatchObject({
      title: "Station 2",
      sub: "Station 2 of 2",
      description: null,
    });
  });

  // Why: the prototype says a station's place as
  // metres east and north of the tour's origin - the 3D view's centre, the
  // middle of the stations - not as degrees. Two stations stand either
  // side of their middle, about 42 m east-west and 97 m north-south apart (a degree is about
  // 74.46 km of longitude and 111.19 km of latitude there).
  it("says where a station stands in metres east and north of the tour's centre", () => {
    const a = positionOf("station:a");
    const b = positionOf("station:b");
    expect(a.eastM).toBeCloseTo(-b.eastM, 2);
    expect(a.northM).toBeCloseTo(-b.northM, 2);
    expect(b.eastM - a.eastM).toBeCloseTo((11.576 - 11.5754321) * 74_460, 0);
    expect(b.northM - a.northM).toBeCloseTo((48.138 - 48.1371234) * 111_190, 0);
  });

  // Why: a story is a folder of the tree now. Selecting one, or one of its
  // entries, must open that thing's inspector and no longer the station's:
  // what the creator reads and types here is what the tour holds.
  describe("a story and its entries", () => {
    const POSE: TourLocalPose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const STORY_STATION = {
      ...STATIONS[1],
      title: "The gate",
      ...stationContent([
        storyOf(
          "legend",
          [
            {
              id: "intro",
              kind: "longText",
              view: "card",
              title: "The siege",
              body: "In 1632...",
              pose: POSE,
              advance: { mode: "auto", afterS: 8 },
            },
            {
              id: "wendel",
              kind: "character",
              view: "two-stations",
              name: "Wendel",
              image: "cut",
              caption: "Follow me",
              pose: { position: [2, 0, 0], rotation: facingRotation(200)! },
              advance: { mode: "lineEnd" },
            },
            {
              id: "way",
              kind: "choice",
              prompt: "Which way?",
              options: [
                { id: "o1", label: "Back", goto: "intro" },
                { id: "o2", label: "On" },
                { id: "o3", label: "Stop", end: true },
              ],
            },
            {
              id: "age",
              kind: "quiz",
              question: "How old?",
              points: 2,
              answer: {
                type: "single",
                options: [
                  { id: "o1", label: "Old" },
                  { id: "o2", label: "New" },
                ],
                correct: "o1",
              },
            },
            {
              id: "year",
              kind: "quiz",
              question: "Which year?",
              points: 1,
              answer: { type: "number", value: 1632, tolerance: 1 },
            },
          ],
          "The legend",
        ),
        {
          id: "clip",
          kind: "video",
          view: "card",
          video: "v",
          transcript: "",
          title: "A clip",
          pose: POSE,
        },
      ]),
    } as unknown as TourStation;
    const inStory = (selected: string) =>
      buildInspector({
        selected,
        stations: [STATIONS[0]!, STORY_STATION],
        assets: [],
        codes: CODES,
      });

    it("lists a station's stories first in its Contents, and no story parts", () => {
      const model = inStory("station:b");
      expect(model?.kind).toBe("station");
      if (model?.kind !== "station") return;
      expect(model.contents.map((c) => c.id)).toEqual(["story:legend", "clip"]);
      expect(model).not.toHaveProperty("story");
    });

    it("shows a story's title, its place and its steps as cards", () => {
      const model = inStory("story:legend");
      expect(model).toMatchObject({
        kind: "story",
        storyId: "legend",
        stationId: "b",
        // Its station's only story: no step, nothing to go into; it may
        // go whole onto the other station.
        moves: {
          step: { earlier: false, later: false },
          targets: [],
          stations: [{ id: "a", label: "Market Square" }],
        },
        title: "The legend",
        sub: "Story",
      });
      if (model?.kind !== "story") throw new Error("no story");
      expect(model).not.toHaveProperty("opened");
      expect(
        model.cards.map((c) => [c.id, c.kind, c.number, c.tag, c.title]),
      ).toEqual([
        ["intro", "text", 1, "Shows a long text", "The siege"],
        ["wendel", "character", 2, "Shows a character", "Wendel"],
        ["way", "choice", 3, "Asks", "Which way?"],
        ["age", "quiz", 4, "Quiz", "How old?"],
        ["year", "quiz", 5, "Quiz", "Which year?"],
      ]);
    });

    // Why: a card opened in place edits its step with the step's own
    // controls, so the story's inspector carries the step's inspector for
    // each open card, in the story's order; an id the story lacks opens
    // nothing.
    it("carries the inspectors of the cards open in place", () => {
      const model = buildInspector({
        selected: "story:legend",
        stations: [STATIONS[0]!, STORY_STATION],
        assets: [],
        codes: CODES,
        openCards: ["way", "gone", "intro"],
      });
      if (model?.kind !== "story") throw new Error("no story");
      expect(
        model.opened?.map((m) => [m.kind, "id" in m ? m.id : null]),
      ).toEqual([
        ["storyEntry", "intro"],
        ["storyStep", "way"],
      ]);
    });

    it("shows a story's block by its texts and how it moves on", () => {
      const model = inStory("intro");
      expect(model?.kind).toBe("storyEntry");
      if (model?.kind !== "storyEntry") return;
      expect(model.stationId).toBe("b");
      expect(model.title).toBe("The siege");
      expect(model.sub).toBe("Long text, entry 1");
      expect(model.advance).toEqual({ mode: "auto", afterS: 8 });
      expect(model.block.fields.map((f) => [f.name, f.value])).toEqual([
        ["title", "The siege"],
        ["body", "In 1632..."],
      ]);
      expect(model.block.character).toBeUndefined();
    });

    // Why: a story character is set here (his view, how his step moves on,
    // his facing), so this must read them as the file holds them.
    it("reads a story character's view, how he moves on and his facing", () => {
      const model = inStory("wendel");
      if (model?.kind !== "storyEntry") throw new Error("no entry");
      expect(model.block.character).toMatchObject({
        view: "two-stations",
        advance: "lineEnd",
      });
      expect(model.block.character?.facingDeg).toBeCloseTo(200, 6);
      expect(CHARACTER_VIEW_CHOICES.map((c) => c.view)).toEqual([
        ...TOUR_CHARACTER_VIEWS,
      ]);
    });

    // Why: an answer that ends the story names no step, and must not read
    // as one that plays on - those two lead to different places.
    it("sums up a choice: each answer and where it leads", () => {
      expect(inStory("way")).toMatchObject({
        kind: "storyStep",
        stepKind: "choice",
        id: "way",
        stationId: "b",
        title: "Which way?",
        sub: "Choice, entry 3",
        lines: [
          "Back - goes to The siege",
          "On - plays on",
          "Stop - ends the story",
        ],
      });
    });

    // Why: the crumb is the way back to every level above a step, and Back
    // takes its last-but-one part: a step's way up is its story, the
    // story's its station, the station's the whole tour.
    it("says where a story's step, the story and its station stand", () => {
      const crumb = (selected: string) =>
        inspectorCrumb({
          selected,
          stations: [STATIONS[0]!, STORY_STATION],
          codes: CODES,
        });
      const tour = { label: "Tour", select: null };
      const station = { label: "2 The gate", select: "station:b" };
      const story = { label: "The legend", select: "story:legend" };
      expect(crumb("way")).toEqual([
        tour,
        station,
        story,
        { label: "Step 3", select: "way" },
      ]);
      expect(crumb("story:legend")).toEqual([tour, station, story]);
      expect(crumb("station:b")).toEqual([tour, station]);
    });

    // Why: the choice inspector edits each answer's words and where it
    // leads; the picker's value must be the answer's own way, and the chip
    // must say a backward jump as one, since it is drawn apart.
    it("lays out a choice's answers to edit, each with its way on", () => {
      const model = inStory("way");
      if (model?.kind !== "storyStep") throw new Error("no step");
      expect(model.form?.prompt).toBe("Which way?");
      expect(model.form?.answers).toEqual([
        {
          id: "o1",
          label: "Back",
          way: "intro",
          jump: "goes back to step 1",
          back: true,
          right: false,
        },
        {
          id: "o2",
          label: "On",
          way: "",
          jump: "next: step 4",
          back: false,
          right: false,
        },
        {
          id: "o3",
          label: "Stop",
          way: END_TARGET,
          jump: "ends the story",
          back: false,
          right: false,
        },
      ]);
      expect(model.form?.ways.map((w) => w.label)).toEqual([
        "Next step (4: Quiz: How old?)",
        "Jump to step 5: Quiz: Which year?",
        "Go back to step 1: The siege",
        "Go back to step 2: Wendel",
        "Ask this again (step 3)",
        "End the story",
      ]);
      expect(model.form).toMatchObject({
        canAdd: true,
        canRemove: true,
        points: null,
        then: null,
      });
    });

    // Why: a quiz does not branch, so its inspector says where the story
    // goes on instead of offering a jump; a quiz of a typed answer is not
    // edited here and keeps its summary only.
    it("lays out a single quiz to edit, and says where the story goes on", () => {
      const model = inStory("age");
      if (model?.kind !== "storyStep") throw new Error("no step");
      expect(model.form).toMatchObject({
        prompt: "How old?",
        points: 2,
        ways: [],
        canAdd: true,
        canRemove: false,
        then: "Right or wrong, the visitor sees the result, and the story goes on at step 5: Quiz: Which year?",
      });
      expect(model.form?.answers.map((a) => [a.label, a.right])).toEqual([
        ["Old", true],
        ["New", false],
      ]);
      const year = inStory("year");
      expect(year?.kind === "storyStep" && year.form).toBeUndefined();
    });

    it("sums up a quiz: its points, and its answers with the right one", () => {
      expect(inStory("age")).toMatchObject({
        kind: "storyStep",
        stepKind: "quiz",
        title: "How old?",
        lines: ["2 points", "Old - right", "New"],
      });
      expect(inStory("year")).toMatchObject({
        lines: ["1 point", "1632, within 1"],
      });
    });

    // Why: a video's card has no place in the world, so it is an item with
    // its texts and no offset, heading or ground to show or edit, and the
    // hint says the 3D view has no handle for it.
    it("shows a free block with no place in the world by its texts", () => {
      const model = inStory("clip");
      expect(model?.kind).toBe("item");
      if (model?.kind !== "item") return;
      expect(model.title).toBe("A clip");
      expect(model.sub).toBe("Video in The gate");
      expect(model.stationId).toBe("b");
      expect(model.itemKind).toBe("video");
      expect(model.fields.map((f) => f.name)).toEqual(["title", "transcript"]);
      expect(model).toMatchObject({
        offset: null,
        headingDeg: null,
        turns: false,
        groundOffM: null,
      });
      expect(inspectorHint(model)).toBe(
        "A clip - it has no place in the 3D view; Esc deselects",
      );
    });

    // Why: a free character stands in the world like any item, so he gets
    // the item's inspector - his place, his turn, the ground under him -
    // where he had his texts alone.
    it("shows a free character as an item with his place and his turn", () => {
      const zz = {
        id: "zz",
        kind: "character",
        view: "speak",
        name: "Zz",
        image: "cut",
        pose: { position: [3, 0, -4], rotation: turn(-90) },
      };
      const station = {
        ...STATIONS[0]!,
        children: [zz],
      } as unknown as TourStation;
      const model = buildInspector({
        selected: "zz",
        stations: [station],
        assets: [],
        codes: CODES,
        groundAt: () => 562.25,
      });
      expect(model).toMatchObject({
        kind: "item",
        itemKind: "character",
        offset: { northM: 3, upM: 0, eastM: -4 },
        turns: true,
      });
      if (model?.kind !== "item") return;
      expect(model.headingDeg).toBeCloseTo(90, 6);
      expect(model.groundOffM).toBe(0);
      expect(inspectorHint(model)).toBe(
        "Zz - drag the middle to move along the ground, the round arrow to turn",
      );
    });

    // Why: an item in a folder shows where it stands from its station's
    // anchor, its folder composed in, as it always has, and its height off
    // the ground is judged there too. A folder 10 m north and 2 m up,
    // turned a quarter, holds a pin 5 m north and 1 m up in it: 10 m north,
    // 5 m west and 3 m over the anchor.
    it("shows an item in a folder where it stands from the anchor", () => {
      const folder = {
        id: "f",
        kind: "folder",
        pose: { position: [10, 2, 0], rotation: turn(90) },
        children: [
          {
            id: "deep",
            kind: "shortText",
            view: "pin",
            caption: "Deep",
            createdAtIso: AT,
            pose: { position: [5, 1, 0], rotation: [0, 0, 0, 1] },
          },
        ],
      };
      const station = {
        ...STATIONS[0]!,
        children: [folder],
      } as unknown as TourStation;
      const at = (groundAt?: () => number) =>
        buildInspector({
          selected: "deep",
          stations: [station],
          assets: [],
          codes: CODES,
          ...(groundAt === undefined ? {} : { groundAt }),
        });
      const shown = at();
      expect(shown).toMatchObject({ kind: "item", groundOffM: null });
      if (shown?.kind !== "item") return;
      expect(shown.offset?.northM).toBeCloseTo(10, 9);
      expect(shown.offset?.upM).toBeCloseTo(3, 9);
      expect(shown.offset?.eastM).toBeCloseTo(-5, 9);
      expect(shown.headingDeg).toBeCloseTo(270, 6);
      expect(at(() => 562.25)).toMatchObject({ groundOffM: 3 });
      // The station's count of items off the ground judges it there too.
      expect(
        buildInspector({
          selected: "station:a",
          stations: [station],
          assets: [],
          codes: CODES,
          groundAt: () => 565.25,
        }),
      ).toMatchObject({ offGround: 0 });
    });

    // Why: a free sound stands in the world (a narration circle or a
    // zone), so it gets the item's inspector - its place, its turn, its
    // handles - with the numbers of its view to type beside its texts.
    it("shows a free sound as an item, with its view's numbers", () => {
      const sound = {
        id: "voice",
        kind: "audio",
        view: "spot",
        audio: "a",
        radiusM: 6,
        title: "The guide",
        pose: POSE,
      };
      const station = {
        ...STATIONS[0]!,
        children: [sound],
      } as unknown as TourStation;
      const model = buildInspector({
        selected: "voice",
        stations: [station],
        assets: [],
        codes: CODES,
      });
      expect(model).toMatchObject({ kind: "item", itemKind: "audio" });
      if (model?.kind !== "item") return;
      expect(model.fields.map((f) => [f.name, f.value])).toEqual([
        ["title", "The guide"],
        ["transcript", ""],
        ["radiusM", "6"],
      ]);
    });

    // Why: the inspector's Earlier, Later and Move buttons are the
    // keyboard's way to move an item; each offers only a move the rule
    // takes, so a choice (its answers name its story's entries) offers no
    // way out, and a free item no step (the free items have no order).
    it("offers the moves the rule takes: steps in a story, out of it, into it", () => {
      const moves = (id: string) => {
        const model = inStory(id);
        return model !== null && "moves" in model ? model.moves : undefined;
      };
      expect(moves("intro")).toEqual({
        step: { earlier: false, later: true },
        targets: [{ list: "free", label: "Move out of the story" }],
        stations: [{ id: "a", label: "Market Square" }],
      });
      // A choice leaves its story nowhere, onto another station neither.
      expect(moves("way")).toEqual({
        step: { earlier: true, later: true },
        targets: [],
        stations: [],
      });
      expect(moves("year")?.step).toEqual({ earlier: true, later: false });
      expect(moves("clip")).toEqual({
        step: null,
        targets: [{ list: "story:legend", label: 'Move into "The legend"' }],
        stations: [{ id: "a", label: "Market Square" }],
      });
    });

    // Why: a free item whose file the tour on disk does
    // not hold yet is refused a story (the frame would name a file a
    // reload lacks); its inspector must not offer the Move it would refuse.
    it("offers no story to a free item whose file is not saved yet", () => {
      const model = buildInspector({
        selected: "clip",
        stations: [STATIONS[0]!, STORY_STATION],
        assets: [],
        codes: CODES,
        selectedFileUnsaved: true,
      });
      // Onto another station it stays a free item, whose own record
      // carries its file: that move is offered.
      expect(model !== null && "moves" in model ? model.moves : null).toEqual({
        step: null,
        targets: [],
        stations: [{ id: "a", label: "Market Square" }],
      });
    });

    it("hints at what can be done, and answers nothing for a gone story", () => {
      expect(inspectorHint(inStory("story:legend"))).toContain("The legend");
      expect(inStory("story:gone")).toBeNull();
    });
  });

  it("shows an item's kind, its station, its offset and its size", () => {
    expect(inspect("pin-1")).toEqual({
      kind: "item",
      itemKind: "shortText",
      title: "Fountain, 1612",
      sub: "Pin in Market Square",
      stationId: "a",
      // A free item has no order, and its station no story to go into.
      moves: {
        step: null,
        targets: [],
        // The other station, by its title (untitled: its place).
        stations: [{ id: "b", label: "Station 2" }],
      },
      text: "Fountain, 1612",
      extent: null,
      // Only a model has notes, sections and a view.
      model: null,
      // Only a free long text has the writer.
      longText: null,
      // B2c: its other text fields, by the format's caps.
      fields: [
        {
          name: "description",
          label: "Description",
          value: "",
          max: 160,
          prose: true,
          unit: "codePoints",
          required: false,
        },
      ],
      offset: { northM: 4, upM: 1.5, eastM: -2 },
      headingDeg: 0,
      // A pin faces the visitor: its gizmo has no round arrow.
      turns: false,
      groundOffM: null,
    });
    expect(inspect("model-1")).toMatchObject({
      itemKind: "model",
      title: "3D model",
      sub: "3D model in Market Square",
      extent: {
        field: "sizeM",
        label: "Size",
        meaning: "Its largest side",
        value: 2.4,
        min: 0.05,
        max: 500,
      },
      fields: [{ name: "title", label: "Title", max: 80, prose: false }],
      headingDeg: 90,
      turns: true,
    });
  });

  it("shows a code's print size and position, or that it has none", () => {
    expect(inspect("level-1")).toEqual({
      kind: "code",
      title: "Code 1",
      sub: "Printed code, measured on site",
      printSizeM: 0.5,
      position: {
        eastM: expect.any(Number),
        northM: expect.any(Number),
        altM: 561.5,
        headingDeg: 180,
      },
    });
    // The code stands about 4 km south-west of the stations' centre.
    const code = positionOf("level-1");
    expect(code.northM).toBeCloseTo((48.1 - 48.1375617) * 111_190, -1);
    expect(code.eastM).toBeCloseTo((11.5 - 11.57571605) * 74_460, -1);
    expect(inspect("level-2")).toMatchObject({
      printSizeM: null,
      position: null,
    });
  });
});

// Why this test matters: the bottom bar's hint is the only words that
// tell a creator how the selection's handles work (which one moves, which
// turns, which sizes), so each kind must name exactly the handles it has:
// a pin offering a "dot to resize" it does not have, or a code offering a
// drag it refuses, sends the creator looking for what is not there.
describe("inspectorHint", () => {
  // Why: the inspector's lock is the only place a station is unlocked, so
  // it must read the page's lock - locked by default - and the hint must
  // not invite a drag the lock refuses.
  it("shows a station locked until it is unlocked, and hints at its radius alone", () => {
    expect(inspect("station:a")).toMatchObject({ locked: true });
    const open = buildInspector({
      selected: "station:a",
      stations: STATIONS,
      assets: [],
      codes: CODES,
      unlockedStations: ["a"],
    });
    expect(open).toMatchObject({ locked: false });
    expect(inspectorHint(inspect("station:a"))).toBe(
      "Market Square - a white dot for the radius; its position is locked (unlock it under Position to move or turn it)",
    );
    expect(inspectorHint(open)).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
  });

  it("names the handles each selection has, and how to select with none", () => {
    expect(inspectorHint(null)).toBe(
      "Click a station, an item or a code; drag to orbit, right-drag to pan, wheel to zoom; right-click the ground for a new station",
    );
    expect(inspectorHint(inspect("station:a", ["a"]))).toBe(
      "Market Square - drag the middle to move (its items follow), a white dot for the radius, the round arrow to turn",
    );
    // A pin faces the visitor, so its gizmo has no round arrow to name.
    expect(inspectorHint(inspect("pin-1"))).toBe(
      "Fountain, 1612 - drag the middle to move along the ground",
    );
    expect(inspectorHint(inspect("model-1"))).toBe(
      "3D model - drag the middle to move along the ground, the round arrow to turn, a white dot to resize",
    );
    // A picture's width has dots as a model's size does, and is typed
    // under its row's name.
    const photo = buildInspector({
      selected: "photo-1",
      stations: [
        {
          ...STATIONS[0]!,
          ...stationContent([
            {
              id: "photo-1",
              kind: "picture",
              view: "plane",
              image: "photo-1",
              widthM: 1.5,
              createdAtIso: AT,
              pose: { position: [1, 1, 0], rotation: [0, 0, 0, 1] },
            },
          ]),
        },
      ],
      assets: [],
      codes: CODES,
      unlockedStations: [],
    });
    expect(photo).toMatchObject({
      extent: { field: "widthM", label: "Width", value: 1.5, max: 50 },
    });
    expect(inspectorHint(photo)).toMatch(/, a white dot to resize$/);
    expect(inspectorHint(inspect("level-1"))).toBe(
      "Code 1 - read-only here; F frames it, Esc deselects",
    );
  });

  // Why: a free long text (its reading stand) read as a 3D model, so its
  // hint offered a resize dot a stand does not have.
  it("shows a reading stand as a text, with no resize dot", () => {
    const stand = {
      ...STATIONS[1],
      ...stationContent([
        {
          id: "stand-1",
          kind: "longText",
          view: "lectern",
          title: "The siege",
          body: "In 1632 the town was besieged.",
          createdAtIso: AT,
          pose: { position: [1, 0, 1], rotation: [0, 0, 0, 1] },
        },
      ]),
    } as unknown as TourStation;
    const model = buildInspector({
      selected: "stand-1",
      stations: [STATIONS[0]!, stand],
      assets: [],
      codes: CODES,
      unlockedStations: [],
    });
    expect(model).toMatchObject({ kind: "item", itemKind: "longText" });
    expect(inspectorHint(model)).toBe(
      "The siege - drag the middle to move along the ground, the round arrow to turn",
    );
    // Why: the long text writer edits this text: its block, view, body and
    // the words its sheet shows over the title come from here, so the
    // preview shows what a visitor reads.
    expect(model).toMatchObject({
      longText: {
        blockId: "stand-1",
        view: "lectern",
        title: "The siege",
        body: "In 1632 the town was besieged.",
        hasNarration: false,
        // No narration and no stamp given.
        narrationKey: "null|",
        pictures: [],
      },
    });
    if (model?.kind !== "item") throw new Error("not an item");
    // The visitor's own line: the station's name (here none) and number.
    expect(model.longText?.over).toBe("Station 2");
  });
});

describe("headingOfRotation", () => {
  // Why: a rotation turned by a known angle about up reads back as that
  // bearing (clockwise from north), within a hair, for every quarter and
  // in between; a rotation that is not a number reads as none.
  it("reads the bearing a turn about up gives", () => {
    for (const deg of [0, 45, 90, 135, 180, 270, 359]) {
      // A turn of -deg about up (counter-clockwise seen from above in
      // north-up-east) points north at a bearing of +deg.
      expect(headingOfRotation(turn(-deg))).toBeCloseTo(deg % 360, 6);
    }
    expect(headingOfRotation([Number.NaN, 0, 0, 1])).toBeNull();
  });

  // Why: an item tipped so that its forward points straight up or down
  // has no bearing at all; a number there would be the noise of a
  // near-zero atan2.
  it("gives no bearing for a forward turned straight up or down", () => {
    const s = Math.SQRT1_2;
    // A quarter turn about east turns north to up, and back to down.
    expect(headingOfRotation([0, 0, s, s])).toBeNull();
    expect(headingOfRotation([0, 0, -s, s])).toBeNull();
    // A hair short of straight up still has one.
    const a = (Math.PI / 2 - 1e-3) / 2;
    expect(headingOfRotation([0, 0, Math.sin(a), Math.cos(a)])).toBe(0);
  });
});

describe("buildInspector: the values the inspector edits", () => {
  const PHOTO_STATION = {
    id: "p",
    title: "Gate",
    image: "img-2",
    geo: { lat: 48.1371234, lon: 11.5754321, alt: 560, headingDeg: 0 },
    activateRadiusM: 20,
    foundRadiusM: 10,
    hint: "arrow",
    ...stationContent([
      {
        id: "photo-1",
        kind: "picture",
        view: "plane",
        image: "photo-1",
        widthM: 1,
        caption: "North face",
        createdAtIso: AT,
        pose: { position: [3, 1.5, 4], rotation: [0, 0, 0, 1] },
      },
      {
        id: "pin-far",
        kind: "shortText",
        view: "pin",
        caption: "Far pin",
        createdAtIso: AT,
        pose: { position: [12, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ]),
  } as unknown as TourStation;
  /** The photo's own image asset: a captured photo's file. */
  const PHOTO_ASSET = {
    id: "photo-1",
    path: "content/photo-1.jpg",
    kind: "image" as const,
    width: 4,
    height: 3,
  };
  const ASSETS = [
    PHOTO_ASSET,
    {
      id: "img-2",
      path: "content/img-2.png",
      kind: "image" as const,
      width: 4,
      height: 3,
    },
    {
      id: "horse",
      path: "content/horse.glb",
      kind: "model" as const,
    },
  ];
  const at = (
    selected: string,
    more: Partial<Parameters<typeof buildInspector>[0]> = {},
  ) =>
    buildInspector({
      selected,
      stations: [PHOTO_STATION, ...STATIONS],
      assets: ASSETS,
      codes: CODES,
      ...more,
    });

  // Why: the title box shows what the creator typed, never the stand-in
  // the tree shows for an untitled station - typing into "Station 2"
  // would otherwise save that stand-in as a real title.
  it("gives a station's own name to edit, empty for an untitled one", () => {
    expect(at("station:p")).toMatchObject({ name: "Gate", title: "Gate" });
    expect(at("station:b")).toMatchObject({ name: "", title: "Station 3" });
  });

  // Why: the card picture may be one of the station's photos or an image
  // of the tour; the picker must offer exactly those (no model, no photo
  // of another station) and mark the one the card shows now.
  it("offers the station's photos and the tour's images for the card, the one shown marked", () => {
    expect(at("station:p")).toMatchObject({
      images: [
        { id: "photo-1", path: "content/photo-1.jpg", label: "North face" },
        { id: "img-2", path: "content/img-2.png", label: "Tour image" },
      ],
      imageId: "img-2",
    });
    // No card picture named: the first photo is the card's.
    expect(
      buildInspector({
        selected: "station:p",
        stations: [
          { ...PHOTO_STATION, image: undefined } as unknown as TourStation,
        ],
        assets: [PHOTO_ASSET],
        codes: [],
      }),
    ).toMatchObject({
      images: [{ id: "photo-1" }],
      imageId: "photo-1",
    });
    expect(at("station:b")).toMatchObject({
      images: [{ id: "img-2" }],
      imageId: null,
    });
  });

  // Why (B2a review finding 3): a station's `image` names an ASSET. A
  // picture that shows one of the tour's images (not a captured photo of
  // its own) was offered under its BLOCK id, which no card can name -
  // choosing it did nothing - and its image was listed a second time as
  // a tour image. It is offered once, by its asset id.
  it("offers a picture showing a tour image by that image's asset, once", () => {
    const station = {
      ...PHOTO_STATION,
      image: undefined,
      ...withFreeBlocks(PHOTO_STATION, [
        {
          id: "view-1",
          kind: "picture",
          view: "plane",
          image: "img-2",
          widthM: 1,
          caption: "Old map",
          createdAtIso: AT,
          pose: { position: [1, 1.5, 1], rotation: [0, 0, 0, 1] },
        },
      ]),
    } as unknown as TourStation;
    const built = buildInspector({
      selected: "station:p",
      stations: [station],
      assets: ASSETS,
      codes: [],
    });
    expect(built).toMatchObject({
      images: [
        { id: "photo-1", label: "North face" },
        { id: "img-2", path: "content/img-2.png", label: "Old map" },
      ],
    });
    expect((built as unknown as { images: unknown[] }).images).toHaveLength(2);
  });

  // Why: a radius lowered under its items leaves them where they are; the
  // inspector is where the creator learns how many now stand outside.
  it("counts the items outside the circle", () => {
    expect(at("station:p")).toMatchObject({ outside: 1 });
    expect(
      at("station:p", {
        stations: [{ ...PHOTO_STATION, foundRadiusM: 4 }],
      }),
    ).toMatchObject({ outside: 2 });
    expect(at("station:b")).toMatchObject({ outside: 0 });
  });

  // Why: the 3D view's frame is fixed when it opens; after a station
  // moves, the mean of the stations moves too, so metres measured from it
  // would no longer be where the view draws the station.
  it("measures a position from the view's origin when it is given", () => {
    const origin = { lat: 48.1371234, lng: 11.5754321 };
    const station = at("station:p", { origin });
    if (station?.kind !== "station" || station.position === null) {
      throw new Error("no position");
    }
    expect(station.position.eastM).toBeCloseTo(0, 6);
    expect(station.position.northM).toBeCloseTo(0, 6);
  });

  // Why: "Put on the ground" and "Put items on the ground" are offered
  // only when something stands off the ground; with the ground not loaded
  // the inspector cannot know, and says so as null rather than 0.
  it("says how far the station and its items stand off the ground, or null before it has loaded", () => {
    const flat = (alt: number) => () => alt;
    expect(at("station:p", { groundAt: flat(560) })).toMatchObject({
      groundOffM: 0,
      offGround: 1,
    });
    expect(at("station:p", { groundAt: flat(559) })).toMatchObject({
      groundOffM: 1,
      offGround: 2,
    });
    expect(at("station:p")).toMatchObject({
      groundOffM: null,
      offGround: null,
    });
    const photo = at("photo-1", { groundAt: flat(560) });
    expect(photo).toMatchObject({ kind: "item", stationId: "p" });
    if (photo?.kind !== "item" || photo.groundOffM === null) {
      throw new Error("no ground");
    }
    expect(photo.groundOffM).toBeCloseTo(1.5, 3);
    expect(at("pin-far", { groundAt: flat(560) })).toMatchObject({
      groundOffM: expect.closeTo(0, 3),
    });
  });

  // Why: the readout draws the inspector again whenever its model
  // changes, and the ground under a station changes by centimetres while
  // finer tiles stream in. A model carrying the raw heights changed on
  // every tile, so the inspector was drawn again under a creator's
  // typing for differences it never shows: it shows tenths of a metre,
  // and "on the ground" within ON_GROUND_M.
  it("gives the heights off the ground as shown, so ground that changes by centimetres changes nothing (property)", () => {
    const tenth = (m: number) =>
      Math.abs(m) <= ON_GROUND_M ? 0 : Math.round(m * 10);
    // The height off the ground as the model computes it from `m`.
    const raw = (m: number) => 560 - (560 - m);
    fc.assert(
      fc.property(
        fc.double({ min: -40, max: 40, noNaN: true }),
        fc.double({ min: -0.004, max: 0.004, noNaN: true }),
        (offM, jitterM) => {
          const ground = (m: number) => () => 560 - m;
          const shown = at("station:p", { groundAt: ground(offM) });
          if (shown?.kind !== "station" || shown.groundOffM === null) {
            throw new Error("no ground");
          }
          const off = shown.groundOffM;
          expect(off).toBe(tenth(raw(offM)) / 10);
          expect(Math.abs(off - offM)).toBeLessThanOrEqual(0.05 + 1e-9);
          // A jitter that does not cross a shown tenth changes nothing;
          // one that does changes the model.
          const near = at("station:p", { groundAt: ground(offM + jitterM) });
          const crosses = tenth(raw(offM)) !== tenth(raw(offM + jitterM));
          expect(JSON.stringify(near) === JSON.stringify(shown)).toBe(!crosses);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Why: a pin's text is its label and edited here; a photo's or a
  // model's caption is not (the session edits pins' text only), so its
  // title is not offered as a field.
  it("offers a pin's text to edit, and no caption of a photo or a model", () => {
    expect(at("pin-1")).toMatchObject({ text: "Fountain, 1612" });
    expect(at("photo-1")).toMatchObject({ text: null });
    expect(at("model-1")).toMatchObject({ text: null });
  });
});

// Why: a folder chosen in the tree is moved, turned and scaled as one, so
// its inspector must show the same origin, heading and scale the gizmo
// moves: its pose in its station's frame and the factor its items are
// drawn at. A folder 10 m north and 2 m up, turned a quarter, scaled by 2.
describe("buildInspector: a plain folder", () => {
  const folder = {
    id: "f",
    kind: "folder",
    title: "Benches",
    pose: { position: [10, 2, 0], rotation: turn(90) },
    scale: 2,
    children: [
      {
        id: "deep",
        kind: "shortText",
        view: "pin",
        caption: "Deep",
        createdAtIso: AT,
        pose: { position: [5, 1, 0], rotation: [0, 0, 0, 1] },
      },
    ],
  };
  const station = {
    ...STATIONS[0]!,
    children: [folder],
  } as unknown as TourStation;
  const at = (selected: string, groundAt?: () => number) =>
    buildInspector({
      selected,
      stations: [station],
      assets: [],
      codes: CODES,
      ...(groundAt === undefined ? {} : { groundAt }),
    });

  it("shows its name, station and items, its scale, and its origin and heading in its station", () => {
    const shown = at("folder:f");
    expect(shown).toMatchObject({
      kind: "folder",
      folderId: "f",
      stationId: "a",
      title: "Benches",
      scale: { value: 2, min: 0.1, max: 10 },
      groundOffM: null,
    });
    if (shown?.kind !== "folder") return;
    expect(shown.sub).toMatch(/^Folder in .*Market Square, 1 item$/);
    expect(shown.offset.northM).toBeCloseTo(10, 9);
    expect(shown.offset.upM).toBeCloseTo(2, 9);
    expect(shown.offset.eastM).toBeCloseTo(0, 9);
    expect(shown.headingDeg).toBeCloseTo(270, 6);
    expect(inspectorHint(shown)).toBe(
      "Benches - drag the middle to move its items together, a white dot to scale them, the round arrow to turn",
    );
    // Its ground judged under its origin, 2 m over the anchor.
    expect(at("folder:f", () => 562.25)).toMatchObject({ groundOffM: 2 });
  });

  it("shows nothing for a folder the tour lacks", () => {
    expect(at("folder:nope")).toBeNull();
  });
});
