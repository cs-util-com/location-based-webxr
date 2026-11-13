/**
 * Why these tests matter (B2c of the station-blocks plan): the inspector
 * learns a field set per block kind - a short text's description, a
 * picture's title, caption and alt text, a model's title - each capped by
 * the format's own rule (`TOUR_BLOCK_TEXT_RULES`) and counted by the
 * format's own count (`tourTextCount`), so the counter beside a field, the
 * editor's refusal and the file's reader never disagree. A field emptied
 * leaves the block without it (they are all optional), and a field the
 * kind does not have writes nothing.
 */
import fc from "fast-check";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { textCounterLine, wireTextCounter } from "../pin-text.js";
import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";

import {
  blockFieldEdit,
  blockFieldPlaceholder,
  blockFields,
  storyBlockFields,
} from "./block-fields.js";

const GEO = { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 };
const AT = "2026-10-27T10:00:00.000Z";

const PIN = {
  id: "p1",
  kind: "shortText",
  view: "pin",
  caption: "Look up",
  createdAtIso: AT,
  geo: GEO,
} as unknown as TourObject;

const PICTURE = {
  id: "ph1",
  kind: "picture",
  view: "plane",
  image: "ph1",
  widthM: 1,
  caption: "The gate in 1870",
  createdAtIso: AT,
  geo: GEO,
} as unknown as TourObject;

const MODEL = {
  id: "m1",
  kind: "model",
  view: "placed",
  asset: "a1",
  sizeM: 2,
  createdAtIso: AT,
  geo: GEO,
} as unknown as TourObject;

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

const LONG = {
  id: "l1",
  kind: "longText",
  view: "card",
  pose: POSE,
  title: "The siege",
  body: "In 1632 the town...",
} as unknown as TourObject;

const VIDEO = {
  id: "v1",
  kind: "video",
  view: "card",
  pose: POSE,
  video: "clip",
  transcript: "The guide speaks.",
} as unknown as TourObject;

const AUDIO = {
  ...VIDEO,
  id: "a1",
  kind: "audio",
  audio: "sound",
} as unknown as TourObject;

const CHARACTER = {
  id: "c1",
  kind: "character",
  view: "speak",
  pose: POSE,
  name: "The watchman",
  image: "cut",
  caption: "Halt! Who goes there?",
} as unknown as TourObject;

describe("blockFields", () => {
  it("lists each kind's fields with the format's caps, in the inspector's order", () => {
    expect(
      blockFields(PIN).map((f) => [f.name, f.label, f.max, f.prose, f.value]),
    ).toEqual([["description", "Description", 160, true, ""]]);
    expect(
      blockFields(PICTURE).map((f) => [f.name, f.label, f.max, f.prose]),
    ).toEqual([
      ["title", "Title", 40, false],
      ["caption", "Caption", 1200, true],
      ["alt", "Alt text", 300, true],
    ]);
    expect(blockFields(PICTURE)[1]?.value).toBe("The gate in 1870");
    expect(blockFields(MODEL).map((f) => [f.name, f.max])).toEqual([
      ["title", 80],
    ]);
  });

  // Story blocks are typed in the inspector too: each field carries the
  // unit its cap counts in (the long text body in UTF-16 units, the rest
  // in characters) and whether the block needs it.
  it("lists the story kinds' fields with their unit and whether they are needed", () => {
    const rows = (b: TourObject) =>
      blockFields(b).map((f) => [f.name, f.max, f.unit, f.required, f.prose]);
    expect(rows(LONG)).toEqual([
      ["title", 80, "codePoints", true, false],
      ["body", 32_000, "utf16", true, true],
    ]);
    expect(rows(VIDEO)).toEqual([
      ["title", 40, "codePoints", false, false],
      ["transcript", 32_000, "codePoints", false, true],
    ]);
    expect(rows(AUDIO)).toEqual(rows(VIDEO));
    expect(rows(CHARACTER)).toEqual([
      ["name", 80, "codePoints", true, false],
      ["caption", 2000, "codePoints", false, true],
    ]);
    expect(blockFields(LONG)[1]?.value).toBe("In 1632 the town...");
    expect(blockFields(PIN)[0]?.unit).toBe("codePoints");
  });
});

// Why: in the station's inspector no head types a story short text's
// caption, so its fields carry it; a declared character's name is his
// declaration's (written over on every read), so it is offered nowhere.
describe("storyBlockFields", () => {
  it("adds a short text's caption, drops a declared character's name, and keeps the rest", () => {
    const rows = (b: TourObject) =>
      storyBlockFields(b as unknown as TourBlock).map((f) => [
        f.name,
        f.max,
        f.required,
      ]);
    expect(rows(PIN)).toEqual([
      ["caption", 40, true],
      ["description", 160, false],
    ]);
    expect(rows(CHARACTER).map((r) => r[0])).toEqual(["name", "caption"]);
    expect(
      rows({ ...CHARACTER, character: "wendel" } as unknown as TourObject).map(
        (r) => r[0],
      ),
    ).toEqual(["caption"]);
    expect(rows(LONG).map((r) => r[0])).toEqual(["title", "body"]);
  });

  it("lets blockFieldEdit write and cap a short text's caption", () => {
    expect(blockFieldEdit(PIN, "caption", "x".repeat(41))).toEqual({
      kind: "refused",
      reason: "A caption takes at most 40 characters.",
    });
    expect(blockFieldEdit(PIN, "caption", " ")).toEqual({
      kind: "refused",
      reason: "A caption cannot be empty.",
    });
    expect(blockFieldEdit(PIN, "caption", " Door ")).toMatchObject({
      kind: "edited",
      after: { caption: "Door" },
    });
  });
});

describe("blockFieldEdit", () => {
  it("writes a field, trimmed at its ends and keeping its lines", () => {
    expect(
      blockFieldEdit(PIN, "description", "  Look up\nat the arch "),
    ).toEqual({
      kind: "edited",
      after: { ...PIN, description: "Look up\nat the arch" },
    });
    expect(blockFieldEdit(PICTURE, "alt", "A stone gate")).toEqual({
      kind: "edited",
      after: { ...PICTURE, alt: "A stone gate" },
    });
  });

  it("removes a field that is emptied, and changes nothing for the same text", () => {
    const edited = blockFieldEdit(PICTURE, "caption", "   ");
    expect(edited.kind).toBe("edited");
    expect(edited.kind === "edited" && "caption" in edited.after).toBe(false);
    expect(blockFieldEdit(PICTURE, "caption", " The gate in 1870 ")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(PIN, "description", "")).toEqual({
      kind: "unchanged",
    });
  });

  it("refuses a text over its cap in words, counted as the reader counts", () => {
    // 40 code points with an emoji (two UTF-16 units) passes; 41 does not.
    const forty = `${"a".repeat(39)}\u{1F600}`;
    expect(blockFieldEdit(PICTURE, "title", forty).kind).toBe("edited");
    expect(blockFieldEdit(PICTURE, "title", `${forty}b`)).toEqual({
      kind: "refused",
      reason: "A title takes at most 40 characters.",
    });
    // Whitespace runs count as one, as the format counts them.
    expect(
      blockFieldEdit(PIN, "description", `${"a ".repeat(80)}`.trim()).kind,
    ).toBe("edited");
  });

  it("counts a long text's body in UTF-16 units, as the reader does", () => {
    // 16 000 emoji are 16 000 characters but 32 000 UTF-16 units: the cap.
    const full = "😀".repeat(16_000);
    expect(blockFieldEdit(LONG, "body", full).kind).toBe("edited");
    expect(blockFieldEdit(LONG, "body", `${full}a`)).toEqual({
      kind: "refused",
      reason: "A body takes at most 32000 UTF-16 units.",
    });
  });

  // Why: the refusal named "characters" where the cap counts UTF-16 units,
  // so 16 001 emoji were refused as more than 32 000 "characters". The
  // unit's word comes from the rule, as the count does.
  it("names the unit its cap counts in, never characters for UTF-16 units", () => {
    const refused = blockFieldEdit(LONG, "body", "😀".repeat(16_001));
    expect(refused.kind === "refused" && refused.reason).toMatch(
      /UTF-16 units\.$/,
    );
    expect(refused.kind === "refused" && refused.reason).not.toMatch(
      /characters/,
    );
  });

  it("refuses to empty a field the block needs", () => {
    expect(blockFieldEdit(LONG, "body", "  ")).toEqual({
      kind: "refused",
      reason: "A body cannot be empty.",
    });
    expect(blockFieldEdit(CHARACTER, "name", "")).toEqual({
      kind: "refused",
      reason: "A name cannot be empty.",
    });
    const cleared = blockFieldEdit(VIDEO, "title", "Intro");
    expect(cleared.kind).toBe("edited");
  });

  it("writes nothing for a field the kind does not have", () => {
    expect(blockFieldEdit(MODEL, "caption", "x")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(PIN, "title", "x")).toEqual({ kind: "unchanged" });
    // A short text's caption is one of its fields: the station's inspector
    // types it for a story one (`storyBlockFields`).
  });
});

describe("blockFieldPlaceholder", () => {
  // Why: every field said "Optional", a long text's needed title and body
  // too, which the editor then refuses to empty.
  it("says Required for a field the block needs, else Optional", () => {
    const [title, body] = blockFields(LONG);
    expect(title && blockFieldPlaceholder(title)).toBe("Required");
    expect(body && blockFieldPlaceholder(body)).toBe("Required");
    const [pictureTitle] = blockFields(PICTURE);
    expect(pictureTitle && blockFieldPlaceholder(pictureTitle)).toBe(
      "Optional",
    );
  });
});

describe("the counter", () => {
  // Why: the field is written trimmed, but the counter counted the text as
  // typed: a trailing newline at a UTF-16 cap read 32001 / 32000, marked
  // over, for a text the editor takes.
  it("counts the text as it will be written, trimmed at its ends", () => {
    expect(textCounterLine("abc\n", 3, "utf16")).toBe("3 / 3");
    expect(textCounterLine("  abc ", 3, "utf16")).toBe("3 / 3");
    const marks: [string, boolean][] = [];
    wireTextCounter(
      { value: "ab\n", addEventListener: () => undefined },
      {
        textContent: null,
        toggleAttribute(name: string, force: boolean) {
          marks.push([name, force]);
          return force;
        },
        setAttribute: () => undefined,
      },
      2,
      "utf16",
    );
    expect(marks.at(-1)).toEqual(["data-over", false]);
  });

  it('reads "count / cap" by the format\'s count, marked while over', () => {
    expect(textCounterLine("a  b ", 160)).toBe("3 / 160");
    // A long text's body counts UTF-16 units as written: an emoji is two.
    expect(textCounterLine("a 😀", 32_000, "utf16")).toBe("4 / 32000");
    const field = {
      value: "abc",
      handlers: [] as (() => void)[],
      addEventListener(_: "input", h: () => void) {
        this.handlers.push(h);
      },
    };
    const marks: [string, boolean][] = [];
    const out = {
      textContent: null as string | null,
      toggleAttribute(name: string, force: boolean) {
        marks.push([name, force]);
        return force;
      },
      setAttribute: () => undefined,
    };
    wireTextCounter(field, out, 3);
    expect(out.textContent).toBe("3 / 3");
    field.value = "abcd";
    for (const h of field.handlers) h();
    expect(out.textContent).toBe("4 / 3");
    expect(marks.at(-1)).toEqual(["data-over", true]);
  });

  it("counts and marks in the field's unit", () => {
    const field = {
      value: "ab",
      addEventListener: () => undefined,
    };
    const marks: [string, boolean][] = [];
    const out = {
      textContent: null as string | null,
      toggleAttribute(name: string, force: boolean) {
        marks.push([name, force]);
        return force;
      },
      setAttribute: () => undefined,
    };
    field.value = "a😀";
    wireTextCounter(field, out, 2, "utf16");
    expect(out.textContent).toBe("3 / 2");
    expect(marks.at(-1)).toEqual(["data-over", true]);
  });
});

// Why: a sound's reach is typed in the inspector before it gets a 3D
// handle. Each number field shows only in the view that reads it (a
// narration circle's radius in `spot`, a zone's reach, calm and volume in
// `zone`), is held to the format's bounds (`tour-kinds.ts`), and may not
// be emptied where the reader needs it; a zone's calm stays inside its
// reach. A text card shows none of them.
describe("number fields", () => {
  const SPOT = {
    ...AUDIO,
    view: "spot",
    radiusM: 6,
  } as unknown as TourObject;
  const ZONE = {
    ...AUDIO,
    view: "zone",
    maxM: 20,
    volume: 0.5,
  } as unknown as TourObject;
  const numbers = (b: TourObject) =>
    blockFields(b)
      .filter((f) => f.number !== undefined)
      .map((f) => [f.name, f.value, f.required, f.number?.unit]);

  it("shows each number in the view that reads it, with its unit", () => {
    expect(numbers(AUDIO)).toEqual([]);
    expect(numbers(SPOT)).toEqual([["radiusM", "6", true, "m"]]);
    expect(numbers(ZONE)).toEqual([
      ["maxM", "20", true, "m"],
      ["minM", "", false, "m"],
      ["volume", "0.5", true, ""],
    ]);
  });

  // Why: `max` and `unit` mean a text's character cap; a number field
  // carrying its numeric bound there would read as a cap of a few
  // characters. A number's bounds are the format's, refused on the write.
  it("carries no character cap on a number field", () => {
    for (const field of blockFields(ZONE).filter((f) => f.number)) {
      expect(field, field.name).not.toHaveProperty("max");
      expect(field, field.name).not.toHaveProperty("unit");
    }
  });

  it("writes a typed decimal as a number, a comma as its point", () => {
    expect(blockFieldEdit(SPOT, "radiusM", " 7,5 ")).toEqual({
      kind: "edited",
      after: { ...SPOT, radiusM: 7.5 },
    });
    expect(blockFieldEdit(SPOT, "radiusM", "6.0")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(ZONE, "minM", "4")).toMatchObject({
      after: { minM: 4 },
    });
  });

  it("refuses what the reader would refuse, in words", () => {
    expect(blockFieldEdit(SPOT, "radiusM", "60")).toEqual({
      kind: "refused",
      reason: "Radius takes a number from 1 to 50 m.",
    });
    expect(blockFieldEdit(SPOT, "radiusM", "abc")).toEqual({
      kind: "refused",
      reason: "Radius takes a number from 1 to 50 m.",
    });
    expect(blockFieldEdit(SPOT, "radiusM", " ")).toEqual({
      kind: "refused",
      reason: "Radius cannot be empty.",
    });
    expect(blockFieldEdit(ZONE, "volume", "1.5")).toEqual({
      kind: "refused",
      reason: "Volume takes a number from 0 to 1.",
    });
    expect(blockFieldEdit(ZONE, "minM", "20")).toEqual({
      kind: "refused",
      reason: "Full volume within must be less than the reach.",
    });
    expect(blockFieldEdit(ZONE, "maxM", "3")).toMatchObject({
      kind: "edited",
    });
  });

  it("removes an optional number emptied, and writes none outside its view", () => {
    const calm = { ...ZONE, minM: 4 } as unknown as TourObject;
    const cleared = blockFieldEdit(calm, "minM", "");
    expect(cleared).toEqual({ kind: "edited", after: ZONE });
    expect(blockFieldEdit(AUDIO, "radiusM", "6")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(SPOT, "maxM", "6")).toEqual({ kind: "unchanged" });
  });

  // Why a property: whatever is typed, a written number is one the format
  // reads - inside its bounds, a zone's calm inside its reach.
  it("never writes a number the format would refuse", () => {
    const typedText = fc.oneof(
      fc.string(),
      fc.double({ min: -10, max: 300, noNaN: true }).map(String),
      fc.integer({ min: -5, max: 250 }).map(String),
    );
    fc.assert(
      fc.property(
        fc.constantFrom("maxM", "minM", "volume"),
        typedText,
        (name, text) => {
          const r = blockFieldEdit(ZONE, name, text);
          if (r.kind !== "edited") return;
          const z = r.after as unknown as Record<string, number | undefined>;
          const { maxM = 0, minM, volume = -1 } = z;
          expect(maxM >= 1 && maxM <= 200).toBe(true);
          expect(volume >= 0 && volume <= 1).toBe(true);
          expect(minM === undefined || (minM >= 1 && minM < maxM)).toBe(true);
        },
      ),
    );
  });
});

describe("choice fields", () => {
  // Why: a short text's role and turn are chosen on chips, never typed;
  // the edit must write only a choice of the kind's row, so a file the
  // editor saves always reads back with them, and a blank one returns
  // to the reader's default rather than writing an empty word.
  it("are not boxes to type in", () => {
    const names = blockFields(PIN).map((f) => f.name);
    expect(names).not.toContain("role");
    expect(names).not.toContain("orientation");
  });

  it("write a choice, refuse anything else, and clear on a blank", () => {
    const chose = blockFieldEdit(PIN, "role", "warning");
    expect(chose).toMatchObject({ kind: "edited", after: { role: "warning" } });
    if (chose.kind !== "edited") throw new Error("not edited");
    expect(blockFieldEdit(chose.after, "role", "warning")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(PIN, "role", "shout")).toMatchObject({
      kind: "refused",
    });
    const cleared = blockFieldEdit(chose.after, "role", "");
    expect(cleared.kind).toBe("edited");
    if (cleared.kind !== "edited") throw new Error("not edited");
    expect("role" in cleared.after).toBe(false);
    expect(blockFieldEdit(PIN, "orientation", "")).toEqual({
      kind: "unchanged",
    });
  });
});

describe("a ground arrow's own fields", () => {
  const GROUND = {
    ...(PIN as unknown as Record<string, unknown>),
    view: "ground",
  } as unknown as TourObject;

  it("types its bend as a number within the format's bounds, and nothing it picks on the panel", () => {
    // Why: the bend is a number the dock types; its style, placement,
    // caption switch and colours are the panel's (chips, a box, colour
    // wells), so the dock must not draw a text box for them too.
    const names = blockFields(GROUND).map((f) => f.name);
    expect(names).toContain("bendDeg");
    expect(names).toContain("readAtM");
    for (const own of [
      "style",
      "floorPlacement",
      "captionOnArrow",
      "color",
      "darkColor",
    ]) {
      expect(names).not.toContain(own);
    }
    expect(blockFieldEdit(GROUND, "bendDeg", "-30")).toEqual({
      kind: "edited",
      after: { ...GROUND, bendDeg: -30 },
    });
    expect(blockFieldEdit(GROUND, "bendDeg", "61").kind).toBe("refused");
  });

  it("writes the caption switch as true or leaves it out, never as a text", () => {
    // Why: the format reads `captionOnArrow` as a boolean; the text "true"
    // would be refused by the reader and lose the block's look.
    const on = blockFieldEdit(GROUND, "captionOnArrow", "true");
    expect(on).toEqual({
      kind: "edited",
      after: { ...GROUND, captionOnArrow: true },
    });
    const after = on.kind === "edited" ? on.after : GROUND;
    expect(blockFieldEdit(after, "captionOnArrow", "")).toEqual({
      kind: "edited",
      after: GROUND,
    });
    expect(blockFieldEdit(GROUND, "captionOnArrow", "")).toEqual({
      kind: "unchanged",
    });
  });

  it("takes a colour as #rrggbb only, and leaves it out when cleared", () => {
    // Why: the reader takes six hex digits; anything else would be
    // refused when the tour is read back.
    expect(blockFieldEdit(GROUND, "color", "#5fe3c9")).toEqual({
      kind: "edited",
      after: { ...GROUND, color: "#5fe3c9" },
    });
    expect(blockFieldEdit(GROUND, "darkColor", "red").kind).toBe("refused");
    expect(blockFieldEdit(GROUND, "color", "")).toEqual({ kind: "unchanged" });
    const set = {
      ...(GROUND as unknown as Record<string, unknown>),
      color: "#5fe3c9",
    } as unknown as TourObject;
    expect(blockFieldEdit(set, "color", "")).toEqual({
      kind: "edited",
      after: GROUND,
    });
  });
});
