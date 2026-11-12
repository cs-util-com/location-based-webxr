import { describe, expect, it } from "vitest";

import {
  checkSheetPixels,
  exchangeBytes,
  exchangeFileName,
  ImportRefusal,
  inspectExchange,
  TEXT_KEY,
} from "./character-exchange.js";
import { crc32, readChunks, readTextChunk } from "./png-text.js";
import { blankImage, type RgbaImage } from "./rgba-image.js";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function png(
  w: number,
  h: number,
  colorType = 6,
  extra: Uint8Array[] = [],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IEND", new Uint8Array(0)),
  ]);
}
const text = (json: string): Uint8Array =>
  chunk("tEXt", new TextEncoder().encode(`${TEXT_KEY}\0${json}`));

function refusal(fn: () => unknown): ImportRefusal {
  try {
    fn();
  } catch (e) {
    if (e instanceof ImportRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

describe("character-exchange", () => {
  describe("the file's header", () => {
    // Why: a messenger turns the sheet into a JPEG and fills the
    // see-through background; the import says so instead of guessing.
    it("refuses a JPEG as having lost its transparency", () => {
      const r = refusal(() =>
        inspectExchange(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"),
      );
      expect(r.title).toBe("This copy lost its transparency");
    });

    it("refuses a PNG without alpha", () => {
      expect(
        refusal(() => inspectExchange(png(2048, 1024, 2), "image/png")).title,
      ).toBe("This copy lost its transparency");
    });

    // Why: a resized copy has the right shape but the wrong size, and gets
    // its own words; any other shape is not a sheet.
    it("refuses the wrong shape or size", () => {
      expect(
        refusal(() => inspectExchange(png(1536, 1024), "image/png")).title,
      ).toBe("This is not a character sheet");
      const small = refusal(() => inspectExchange(png(1024, 512), "image/png"));
      expect(small.title).toBe("This is not a character sheet");
      expect(small.words).toContain("made smaller on the way");
    });

    it("refuses what is no picture, and a damaged PNG", () => {
      expect(
        refusal(() => inspectExchange(new Uint8Array([1, 2, 3]), "text/plain"))
          .title,
      ).toBe("This file is not a picture");
      const whole = png(2048, 1024);
      expect(
        refusal(() =>
          inspectExchange(whole.subarray(0, whole.length - 5), "image/png"),
        ).title,
      ).toBe("This file is damaged");
    });

    // Why: the record's format gates the reader.
    it("refuses a record from a newer version", () => {
      const f = png(2048, 1024, 6, [text('{"format":2,"name":"Pip"}')]);
      expect(refusal(() => inspectExchange(f, "image/png")).title).toBe(
        "This character was made by a newer version",
      );
    });

    // Why: a sheet without its record is accepted; the name is asked for.
    it("accepts a sheet without a record, or with one that does not read", () => {
      expect(inspectExchange(png(2048, 1024), "image/png")).toEqual({
        name: "",
        steady: false,
        describedAs: "",
        note: "",
      });
      expect(
        inspectExchange(png(2048, 1024, 6, [text("{nope")]), "image/png").note,
      ).toBe("Its name could not be read.");
    });

    it("reads the record's name", () => {
      const f = png(2048, 1024, 6, [
        text('{"format":1,"name":"Pip","steady":true}'),
      ]);
      expect(inspectExchange(f, "image/png")).toMatchObject({
        name: "Pip",
        steady: true,
      });
    });
  });

  describe("the pixels", () => {
    function sheet(fillCell: (k: number, img: RgbaImage) => void): RgbaImage {
      const img = blankImage(2048, 1024);
      for (let k = 0; k < 4; k++) fillCell(k, img);
      return img;
    }
    function box(
      img: RgbaImage,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ): void {
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++)
          img.data[(y * img.width + x) * 4 + 3] = 255;
    }

    it("accepts one figure per cell on transparency", () => {
      expect(() =>
        checkSheetPixels(
          sheet((k, img) => box(img, k * 512 + 180, 300, k * 512 + 330, 980)),
        ),
      ).not.toThrow();
    });

    // Why: an opaque sheet (a flattened copy saved as PNG) lost its
    // transparency even though its header still says alpha.
    it("refuses a fully opaque sheet", () => {
      expect(
        refusal(() =>
          checkSheetPixels(
            sheet((k, img) => box(img, k * 512, 0, k * 512 + 512, 1024)),
          ),
        ).title,
      ).toBe("This copy lost its transparency");
    });

    // Why: an empty cell, or a figure running over the cell's edge, is not
    // a sheet the maker made.
    it("refuses an empty cell or a figure across the cell edge", () => {
      expect(
        refusal(() =>
          checkSheetPixels(
            sheet(
              (k, img) =>
                k !== 2 && box(img, k * 512 + 180, 300, k * 512 + 330, 980),
            ),
          ),
        ).title,
      ).toBe("This is not a character sheet");
      expect(
        refusal(() =>
          checkSheetPixels(
            sheet((k, img) =>
              box(img, k * 512 + (k === 1 ? 0 : 180), 300, k * 512 + 330, 980),
            ),
          ),
        ).title,
      ).toBe("This is not a character sheet");
    });
  });

  describe("writing the file", () => {
    // Why: the exchange file is the sheet with the record inside; the
    // library id names a folder on one device only and is left out.
    it("puts the record, without its library id, into the sheet", () => {
      const out = exchangeBytes(png(2048, 1024), {
        format: 1,
        libraryId: "c1",
        name: "Grüne Füchsin",
        autoName: false,
        createdAtIso: "2026-11-10T08:00:00.000Z",
        steady: true,
        describedAs: "a fox",
        tool: "character maker",
      });
      const rec = JSON.parse(
        readTextChunk(readChunks(out), TEXT_KEY)!,
      ) as Record<string, unknown>;
      expect(rec.libraryId).toBeUndefined();
      expect(rec.name).toBe("Grüne Füchsin");
      expect(inspectExchange(out, "image/png")).toMatchObject({
        name: "Grüne Füchsin",
        steady: true,
      });
    });

    it("names the file after the character", () => {
      expect(exchangeFileName("Ranger Rita!")).toBe("Ranger Rita.png");
      expect(exchangeFileName("???")).toBe("character.png");
    });
  });
});
