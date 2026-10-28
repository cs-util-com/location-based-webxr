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
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { textCounterLine, wireTextCounter } from "../pin-text.js";
import {
  blockFieldEdit,
  blockFieldPlaceholder,
  blockFields,
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
  view: "stage",
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
      ["transcript", 32_000, "codePoints", true, true],
    ]);
    expect(rows(AUDIO)).toEqual(rows(VIDEO));
    expect(rows(CHARACTER)).toEqual([
      ["name", 80, "codePoints", true, false],
      ["caption", 2000, "codePoints", true, true],
    ]);
    expect(blockFields(LONG)[1]?.value).toBe("In 1632 the town...");
    expect(blockFields(PIN)[0]?.unit).toBe("codePoints");
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
    expect(blockFieldEdit(PIN, "caption", "x")).toEqual({ kind: "unchanged" });
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
