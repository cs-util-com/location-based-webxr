/**
 * Why these tests matter: Ctrl+K adds by kind and place in one query, so
 * what Enter adds is the first row. A query that names a station must
 * put that station's rows first even when another is selected; a query
 * that names only a kind must add it to the selection; a word that
 * matches nothing must list nothing rather than add somewhere else. The
 * picture is never offered: it adds nothing from the editor.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  NEW_STATION_PLACE,
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
      "pin@gate",
      "longText@gate",
      "station",
    ]);
    const first = paletteRows("", STATIONS, "gate")[0];
    expect(first?.label).toBe("Short text");
    expect(first?.place).toBe("in 2 The old gate");
    expect(paletteRows("", STATIONS, "gate")[2]?.place).toBe(NEW_STATION_PLACE);
  });

  it("defaults to the first station with none selected, or one that is gone", () => {
    expect(short(paletteRows("", STATIONS, null))[0]).toBe("pin@column");
    expect(short(paletteRows("", STATIONS, "gone"))[0]).toBe("pin@column");
  });

  it("finds the kind and the place in one query, the place's station first", () => {
    expect(short(paletteRows("long steps", STATIONS, "gate"))).toEqual([
      "longText@steps",
    ]);
    expect(short(paletteRows("pin 3", STATIONS, "gate"))).toEqual([
      "pin@steps",
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
    expect(short(paletteRows("short 2", twelve, "s12"))[0]).toBe("pin@s2");
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
    expect(short(paletteRows("short", STATIONS, "gate"))[0]).toBe("pin@gate");
    expect(short(paletteRows("sta", STATIONS, "gate"))[0]).toBe("station");
  });

  it("lists nothing for a word that matches nothing, and never a picture", () => {
    expect(paletteRows("zebra", STATIONS, "gate")).toEqual([]);
    expect(paletteRows("picture", STATIONS, "gate")).toEqual([]);
    expect(paletteRows("photo gate", STATIONS, "gate")).toEqual([]);
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
