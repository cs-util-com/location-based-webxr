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
import { blockFieldEdit, blockFields } from "./block-fields.js";

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

  it("writes nothing for a field the kind does not have", () => {
    expect(blockFieldEdit(MODEL, "caption", "x")).toEqual({
      kind: "unchanged",
    });
    expect(blockFieldEdit(PIN, "title", "x")).toEqual({ kind: "unchanged" });
    expect(blockFieldEdit(PIN, "caption", "x")).toEqual({ kind: "unchanged" });
  });
});

describe("the counter", () => {
  it('reads "count / cap" by the format\'s count, marked while over', () => {
    expect(textCounterLine("a  b ", 160)).toBe("3 / 160");
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
});
