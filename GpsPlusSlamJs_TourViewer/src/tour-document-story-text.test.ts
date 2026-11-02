/**
 * Why these tests matter: the texts of a station's STORY blocks (a long
 * text's title and body, a video's or an audio's title and transcript, a
 * character's name and caption, a short text's caption and description)
 * are typed in the station's inspector as an edit of that station. Each
 * must be ONE undo step that counts as a change and reaches the saved tour
 * as the format reads it; anything the format would refuse (a cap broken,
 * a needed text emptied, a declared character's name, a free block, a
 * field the kind has not) must change nothing, since a refused value
 * written would make every later save fail. The property test types any
 * sequence of such edits and reads every save back through the format's
 * own parser.
 */
import fc from "fast-check";
import {
  TOUR_BLOCK_TEXT_RULES,
  tourTextCount,
  type TourTextRule,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import {
  changeCount,
  initialTourDocumentState,
  manifestToWrite,
  stationEditChange,
  tourDocumentActions as act,
  tourDocumentReducer as reduce,
  type StationStoryTextEdit,
  type TourDocumentState,
} from "./tour-document.js";

// Activates the library's gated math: the free block's place in the world
// is read through it.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const POSE = { position: [3, 0, 1], rotation: [0, 0, 0, 1] };

const show = (id: string, block: string) => ({
  id,
  action: { kind: "show", block },
  advance: { mode: "tap" },
});

/** A station "gate" whose story shows a long text, Wendel (a declared
 *  character), Sir Kay (one written in the block), a short text, a video
 *  and an audio; a free short text "sign" stands in the world. */
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
    {
      id: "kay",
      path: "content/kay.png",
      kind: "image",
      width: 512,
      height: 1024,
    },
    { id: "film", path: "content/film.webm", kind: "video" },
    { id: "bell", path: "content/bell.mp3", kind: "audio" },
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
        {
          id: "k1",
          kind: "character",
          view: "speak",
          name: "Sir Kay",
          image: "kay",
          caption: "Hold the gate.",
          pose: POSE,
        },
        {
          id: "note",
          kind: "shortText",
          view: "card",
          caption: "Look up",
          pose: POSE,
        },
        {
          id: "clip",
          kind: "video",
          view: "card",
          video: "film",
          transcript: "Horses.",
          pose: POSE,
        },
        {
          id: "ring",
          kind: "audio",
          view: "card",
          audio: "bell",
          title: "The bell",
          transcript: "Dong.",
          pose: POSE,
        },
        {
          id: "sign",
          kind: "shortText",
          view: "pin",
          caption: "Gate",
          pose: POSE,
        },
      ],
      steps: [
        show("s1", "intro"),
        show("s2", "w1"),
        show("s3", "k1"),
        show("s4", "note"),
        show("s5", "clip"),
        show("s6", "ring"),
      ],
    },
  ],
});

function open(): TourDocumentState {
  return reduce(initialTourDocumentState, act.opened({ manifest: OPENED }));
}

function edit(
  state: TourDocumentState,
  storyText: StationStoryTextEdit,
): TourDocumentState {
  return reduce(
    state,
    act.stationEdited({
      stationId: "gate",
      edit: { storyText },
      what: "the text of a story block",
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

function blockOf(manifest: TourManifest, id: string): Record<string, unknown> {
  const gate = manifest.stations.find((s) => s.id === "gate");
  const block = gate?.blocks.find((b) => b.id === id);
  if (block === undefined) throw new Error(`no block ${id}`);
  return block as unknown as Record<string, unknown>;
}

describe("stationEdited: a text of a block the station's story shows", () => {
  it.each([
    ["intro", "title", "The long siege"],
    ["intro", "body", "In 1632 the gate held.\n\nThen it fell."],
    ["clip", "title", "Riders"],
    ["clip", "transcript", "Horses, then a bell."],
    ["ring", "transcript", "Dong. Dong."],
    ["k1", "name", "Sir Kay the Steward"],
    ["k1", "caption", "Hold the gate, all of you."],
    ["w1", "caption", "Good evening."],
    ["note", "caption", "Look down"],
    ["note", "description", "The old stones are under your feet."],
  ])(
    "sets %s's %s as one step that counts as a change, and the save reads it back",
    (block, field, value) => {
      const before = open();
      const after = edit(before, { block, field, value });
      expect(changeCount(after)).toBe(1);
      expect(after.past.length).toBe(before.past.length + 1);
      expect(reduce(after, act.undone()).stations).toEqual(before.stations);
      expect(blockOf(readBack(after), block)[field]).toBe(value);
    },
  );

  it("trims the ends and keeps the lines; a blank optional text is removed", () => {
    const trimmed = edit(open(), {
      block: "clip",
      field: "title",
      value: "  Riders \n",
    });
    expect(blockOf(readBack(trimmed), "clip")["title"]).toBe("Riders");
    const cleared = edit(open(), {
      block: "ring",
      field: "title",
      value: "   ",
    });
    expect(blockOf(readBack(cleared), "ring")).not.toHaveProperty("title");
  });

  it("refuses what the format would refuse, and changes nothing", () => {
    const state = open();
    const refused: StationStoryTextEdit[] = [
      // Over the cap, at one past it.
      { block: "intro", field: "title", value: "x".repeat(81) },
      { block: "clip", field: "title", value: "x".repeat(41) },
      { block: "note", field: "caption", value: "x".repeat(41) },
      { block: "note", field: "description", value: "x".repeat(161) },
      { block: "k1", field: "caption", value: "x".repeat(2001) },
      // A text the block needs, emptied.
      { block: "intro", field: "body", value: " " },
      { block: "clip", field: "transcript", value: "" },
      { block: "k1", field: "name", value: "" },
      // A declared character's name is his declaration's.
      { block: "w1", field: "name", value: "Wendelin" },
      // A field the kind has not, and a non-text field.
      { block: "clip", field: "caption", value: "Riders" },
      { block: "clip", field: "video", value: "bell" },
      // A free block, and no block at all.
      { block: "sign", field: "caption", value: "Door" },
      { block: "nobody", field: "title", value: "Door" },
    ];
    for (const storyText of refused) {
      expect(stationEditChange(state, "gate", { storyText })).toEqual({
        kind: "refused",
        reason: "storyText",
      });
      expect(edit(state, storyText)).toBe(state);
    }
  });

  it("takes a text at its cap exactly", () => {
    const after = edit(open(), {
      block: "note",
      field: "caption",
      value: "x".repeat(40),
    });
    expect(blockOf(readBack(after), "note")["caption"]).toBe("x".repeat(40));
  });

  it("finds nothing to change in the text a block has", () => {
    expect(
      stationEditChange(open(), "gate", {
        storyText: { block: "k1", field: "caption", value: "Hold the gate." },
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("property: any sequence of such edits keeps every save readable, every cap held and the free block in the world", () => {
    const STORY = [
      "intro",
      "w1",
      "k1",
      "note",
      "clip",
      "ring",
      "sign",
      "nobody",
    ];
    const FIELDS = [
      "title",
      "body",
      "name",
      "caption",
      "description",
      "transcript",
      "video",
    ];
    const text = fc.oneof(
      fc.string({ maxLength: 50 }),
      fc.constantFrom(
        "",
        "   ",
        "x".repeat(40),
        "x".repeat(41),
        "x".repeat(161),
      ),
      fc.nat({ max: 2100 }).map((n) => "y".repeat(n)),
    );
    const step = fc.record({
      block: fc.constantFrom(...STORY),
      field: fc.constantFrom(...FIELDS),
      value: text,
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 12 }), (steps) => {
        let state = open();
        for (const s of steps) state = edit(state, s);
        // A declared character's name stays his declaration's - asked of
        // the document before any read-back, since a read writes the
        // declaration's name over whatever the block carries.
        const written = manifestToWrite(state);
        if (written === null) return false;
        expect(blockOf(written, "w1")["name"]).toBe("Wendel");
        const saved = readBack(state);
        const gate = saved.stations.find((s) => s.id === "gate");
        if (gate === undefined) return false;
        for (const block of gate.blocks) {
          const rules = TOUR_BLOCK_TEXT_RULES[block.kind] as Readonly<
            Record<string, TourTextRule>
          >;
          const record = block as unknown as Record<string, unknown>;
          for (const [name, rule] of Object.entries(rules)) {
            const value = record[name];
            if (value === undefined) {
              if (rule.required) return false;
              continue;
            }
            if (typeof value !== "string") return false;
            if (tourTextCount(value, rule.unit) > rule.max) return false;
          }
        }
        // The free short text keeps its world view and its text.
        expect(blockOf(saved, "sign")).toMatchObject({
          view: "pin",
          caption: "Gate",
        });
        return true;
      }),
      { numRuns: 150 },
    );
  });
});
