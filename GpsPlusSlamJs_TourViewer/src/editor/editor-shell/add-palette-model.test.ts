/**
 * Why these tests matter: Ctrl+K adds by kind and place in one query, so
 * what Enter adds is the first row. A query that names a station must
 * put that station's rows first even when another is selected; a query
 * that names only a kind must add it to the selection; a word that
 * matches nothing must list nothing rather than add somewhere else. Every
 * kind that adds at a station is offered, the ones made from a file among
 * them; a video is not (it plays only in a story, and the palette adds at
 * stations), nor a character (it is still to come).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  highlightParts,
  NEW_STATION_PLACE,
  PALETTE_KINDS,
  PALETTE_MAX_ROWS,
  paletteRows,
  type PaletteStation,
} from "./add-palette-model.js";

const STATIONS: readonly PaletteStation[] = [
  { id: "column", number: 1, title: "The Marian column" },
  { id: "gate", number: 2, title: "The old gate" },
  { id: "steps", number: 3, title: "The town hall steps" },
];

const short = (rows: ReturnType<typeof paletteRows>) =>
  rows.map((r) =>
    r.add.kind === "station" ? "station" : `${r.add.kind}@${r.add.stationId}`,
  );

describe("paletteRows", () => {
  it("lists what adds to the selected station for an empty query, then a new station", () => {
    expect(short(paletteRows("", STATIONS, "gate"))).toEqual([
      "shortText@gate",
      "longText@gate",
      "picture@gate",
      "audio@gate",
      "model@gate",
      "station",
    ]);
    const first = paletteRows("", STATIONS, "gate")[0];
    expect(first?.label).toBe("Short text");
    expect(first?.place).toBe("in 2 The old gate");
    expect(paletteRows("", STATIONS, "gate")[5]?.place).toBe(NEW_STATION_PLACE);
  });

  it("defaults to the first station with none selected, or one that is gone", () => {
    expect(short(paletteRows("", STATIONS, null))[0]).toBe("shortText@column");
    expect(short(paletteRows("", STATIONS, "gone"))[0]).toBe(
      "shortText@column",
    );
  });

  it("finds the kind and the place in one query, the place's station first", () => {
    expect(short(paletteRows("long steps", STATIONS, "gate"))).toEqual([
      "longText@steps",
    ]);
    expect(short(paletteRows("pin 3", STATIONS, "gate"))).toEqual([
      "shortText@steps",
    ]);
    // A kind alone: every station's, the selection's first.
    expect(short(paletteRows("long", STATIONS, "gate"))).toEqual([
      "longText@gate",
      "longText@column",
      "longText@steps",
    ]);
  });

  it("adds to the station whose number the query names exactly, over the selection whose number contains it", () => {
    // Why: places match by substring, so "1" is found in "in 11 ..."
    // too, and the selection's default bonus once won: "long 1" with
    // station 11 selected added to 11, not 1.
    const twelve: PaletteStation[] = Array.from({ length: 12 }, (_, i) => ({
      id: `s${String(i + 1)}`,
      number: i + 1,
      title: `Stop ${String(i + 1)}`,
    }));
    expect(short(paletteRows("long 1", twelve, "s11"))[0]).toBe("longText@s1");
    expect(short(paletteRows("short 2", twelve, "s12"))[0]).toBe(
      "shortText@s2",
    );
    // A number that only some places contain still lists them all.
    expect(short(paletteRows("long 1", twelve, "s11"))).toContain(
      "longText@s11",
    );
    // The selection still wins a kind named alone.
    expect(short(paletteRows("long", twelve, "s11"))[0]).toBe("longText@s11");
  });

  it("matches a query typed in another Unicode form (NFC)", () => {
    const cafe: PaletteStation[] = [
      { id: "cafe", number: 1, title: "Caf\u00e9 corner" },
    ];
    // "e" + combining acute against the title's precomposed letter.
    expect(short(paletteRows("long cafe\u0301", cafe, null))).toEqual([
      "longText@cafe",
    ]);
  });

  it("puts the kind named by its label over one matched by another word", () => {
    // "text" starts both labels' second word; "short" only the pin's label.
    expect(short(paletteRows("short", STATIONS, "gate"))[0]).toBe(
      "shortText@gate",
    );
    expect(short(paletteRows("sta", STATIONS, "gate"))[0]).toBe("station");
  });

  it("lists nothing for a word that matches nothing, nor a video or a character", () => {
    expect(paletteRows("zebra", STATIONS, "gate")).toEqual([]);
    expect(paletteRows("video", STATIONS, "gate")).toEqual([]);
    expect(paletteRows("film gate", STATIONS, "gate")).toEqual([]);
    expect(paletteRows("character", STATIONS, "gate")).toEqual([]);
  });

  // Why: a picture, a sound and a 3D model add from the palette as from
  // the menu, found by the words a creator would type for them.
  it("finds the kinds made from a file by their words", () => {
    expect(short(paletteRows("photo gate", STATIONS, "column"))).toEqual([
      "picture@gate",
    ]);
    expect(short(paletteRows("music", STATIONS, "gate"))[0]).toBe("audio@gate");
    expect(short(paletteRows("glb steps", STATIONS, "gate"))).toEqual([
      "model@steps",
    ]);
  });

  it("offers only a new station in a tour without stations", () => {
    expect(short(paletteRows("", [], null))).toEqual(["station"]);
    expect(short(paletteRows("text", [], null))).toEqual([]);
  });

  it("is case-blind and ignores the spaces around and between words", () => {
    expect(paletteRows("  LONG   Gate ", STATIONS, null)).toEqual(
      paletteRows("long gate", STATIONS, null),
    );
  });

  it("lists each row once, at most the cap, the first at the default when the query names only a kind (property)", () => {
    const many: PaletteStation[] = Array.from({ length: 30 }, (_, i) => ({
      id: `s${String(i)}`,
      number: i + 1,
      title: `Station ${String(i + 1)}`,
    }));
    fc.assert(
      fc.property(
        fc.constantFrom("", "text", "long", "short", "pin", "new", "1", "s"),
        fc.integer({ min: 0, max: 29 }),
        (query, at) => {
          const selected = `s${String(at)}`;
          const rows = paletteRows(query, many, selected);
          expect(rows.length).toBeLessThanOrEqual(PALETTE_MAX_ROWS);
          // Each kind and place once: no row is listed twice.
          expect(new Set(short(rows)).size).toBe(rows.length);
        },
      ),
    );
    // A number matches the place only; a kind alone starts at the
    // selection.
    fc.assert(
      fc.property(
        fc.constantFrom("text", "long", "short"),
        fc.integer({ min: 0, max: 29 }),
        (query, at) => {
          const selected = `s${String(at)}`;
          const first = paletteRows(query, many, selected)[0]?.add;
          expect(first?.kind === "station" ? null : first?.stationId).toBe(
            selected,
          );
          expect(
            paletteRows("1", many, selected).every((r) =>
              r.place.includes("1"),
            ),
          ).toBe(true);
        },
      ),
    );
  });
});

describe("paletteRows with a kind chip", () => {
  // Why: a chip narrows to one kind without typing, on a phone above all,
  // and it must narrow what the words found, never widen it.
  it("keeps only that kind, at the default place for an empty query", () => {
    expect(short(paletteRows("", STATIONS, "gate", "longText"))).toEqual([
      "longText@gate",
    ]);
    expect(short(paletteRows("", STATIONS, "gate", "station"))).toEqual([
      "station",
    ]);
  });

  it("narrows what the words found, and can find nothing", () => {
    expect(short(paletteRows("steps", STATIONS, "gate", "shortText"))).toEqual([
      "shortText@steps",
    ]);
    expect(paletteRows("long", STATIONS, "gate", "shortText")).toEqual([]);
  });

  it("lists every kind with no chip on", () => {
    expect(short(paletteRows("", STATIONS, "gate", null))).toEqual(
      short(paletteRows("", STATIONS, "gate")),
    );
  });

  it("offers a chip per kind that adds at a station, a station last", () => {
    expect(PALETTE_KINDS.map((k) => k.kind)).toEqual([
      "shortText",
      "longText",
      "picture",
      "audio",
      "model",
      "station",
    ]);
    expect(PALETTE_KINDS.map((k) => k.label)).toEqual([
      "Short text",
      "Long text",
      "Picture",
      "Sound",
      "3D model",
      "Station",
    ]);
  });
});

describe("highlightParts", () => {
  const marks = (text: string, query: string) =>
    highlightParts(text, query)
      .filter((p) => p.hit)
      .map((p) => p.text);

  // Why: the highlight shows why a row is listed, so it must find what the
  // match found (case blind), keep every character of the text, and leave
  // a one-letter word alone, which would light up half of a row.
  it("marks each word, whatever its case, wherever it stands", () => {
    expect(highlightParts("in 2 The old gate", "OLD")).toEqual([
      { text: "in 2 The ", hit: false },
      { text: "old", hit: true },
      { text: " gate", hit: false },
    ]);
    expect(marks("Gate to the gates", "gate")).toEqual(["Gate", "gate"]);
    expect(marks("Long text", "long te")).toEqual(["Long", "te"]);
  });

  it("marks nothing for an empty query or a one-letter word", () => {
    expect(highlightParts("The old gate", "")).toEqual([
      { text: "The old gate", hit: false },
    ]);
    expect(marks("The old gate", "o t")).toEqual([]);
  });

  it("takes the query as text, never as a pattern", () => {
    expect(marks("a.b axb", "a.b")).toEqual(["a.b"]);
    expect(marks("(gate)", "(g")).toEqual(["(g"]);
    expect(highlightParts("The gate", "[[")).toEqual([
      { text: "The gate", hit: false },
    ]);
  });

  it("merges words that overlap into one mark", () => {
    expect(marks("gateway", "gate way")).toEqual(["gateway"]);
    expect(marks("gateway", "gatew tewa")).toEqual(["gatewa"]);
  });

  it("finds a word typed in the other Unicode form", () => {
    expect(marks("Café Mozart", "café")).toEqual(["Café"]);
  });

  it("gives back the text whole, marked or not", () => {
    // Why: a mark drawn by slicing must never drop or repeat a character.
    fc.assert(
      fc.property(fc.string(), fc.string(), (text, query) => {
        expect(
          highlightParts(text, query)
            .map((p) => p.text)
            .join(""),
        ).toBe(text.normalize("NFC"));
      }),
    );
  });
});
