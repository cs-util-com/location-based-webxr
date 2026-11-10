import { describe, expect, it } from "vitest";

import {
  asciiJson,
  crc32,
  isJpeg,
  isPng,
  pngHeader,
  PngDamaged,
  readChunks,
  readTextChunk,
  withTextChunk,
} from "./png-text.js";

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A header-only PNG (no pixels): enough for every check that reads chunks. */
function png(
  w: number,
  h: number,
  colorType: number,
  extra: Uint8Array[] = [],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [
    Uint8Array.from(SIG),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", new Uint8Array([1, 2, 3])),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe("png-text", () => {
  // Why: the CRC is what makes a written chunk valid for every PNG reader;
  // the IEND chunk's CRC is a published constant, so this pins the table.
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  // Why: the import refuses a messenger's JPEG with its own words, so the
  // two signatures must be told apart from the first bytes alone.
  it("tells a PNG and a JPEG by their first bytes", () => {
    expect(isPng(png(4, 2, 6))).toBe(true);
    expect(isJpeg(png(4, 2, 6))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  // Why: the sheet check reads size and alpha from the header before any
  // pixel is decoded.
  it("reads the header's size and whether it has alpha", () => {
    expect(pngHeader(readChunks(png(2048, 1024, 6)))).toEqual({
      width: 2048,
      height: 1024,
      hasAlpha: true,
    });
    expect(pngHeader(readChunks(png(2048, 1024, 2)))?.hasAlpha).toBe(false);
    // grey with alpha carries transparency too; plain grey does not
    expect(pngHeader(readChunks(png(2048, 1024, 4)))?.hasAlpha).toBe(true);
    expect(pngHeader(readChunks(png(2048, 1024, 0)))?.hasAlpha).toBe(false);
    const trns = chunk("tRNS", new Uint8Array([0, 0, 0, 0, 0, 0]));
    expect(pngHeader(readChunks(png(2048, 1024, 2, [trns])))?.hasAlpha).toBe(
      true,
    );
    expect(pngHeader([])).toBeNull();
  });

  // Why: a file cut off in transit must be refused as damaged, never read
  // past its end.
  it("refuses a cut-off file as damaged", () => {
    const whole = png(8, 4, 6);
    expect(() => readChunks(whole.subarray(0, whole.length - 6))).toThrow(
      PngDamaged,
    );
  });

  // Why: the record rides in a text chunk; a file changed in transit
  // (one flipped byte in that chunk) must be refused as damaged, never
  // read as a different record.
  it("refuses a text chunk whose checksum does not match", () => {
    const out = withTextChunk(png(8, 4, 6), "k", '{"name":"Rita"}');
    const text = readChunks(out).find((c) => c.type === "tEXt")!;
    const bad = out.slice();
    const at = text.start + 8 + 3;
    bad[at] = (bad[at] ?? 0) ^ 0x01;
    expect(() => readChunks(bad)).toThrow(PngDamaged);
    expect(() => readChunks(bad)).toThrow(/tEXt chunk's checksum/);
  });

  // Why: the exchange file carries the record in a text chunk; it must be
  // read back exactly, and the picture's own chunks must stay in order with
  // IEND last.
  it("writes a text chunk before IEND and reads it back", () => {
    const out = withTextChunk(
      png(8, 4, 6),
      "gps-plus-slam-character",
      '{"a":1}',
    );
    const chunks = readChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "tEXt", "IEND"]);
    expect(readTextChunk(chunks, "gps-plus-slam-character")).toBe('{"a":1}');
    expect(readTextChunk(chunks, "other")).toBeNull();
    // the written chunk's CRC is valid
    const t = chunks[2]!;
    const dv = new DataView(out.buffer, out.byteOffset);
    const stored = dv.getUint32(t.start + 8 + t.data.length);
    expect(stored).toBe(
      crc32(out.subarray(t.start + 4, t.start + 8 + t.data.length)),
    );
  });

  // Why: tEXt is Latin-1; a name with any letter (an umlaut, an emoji) must
  // survive as ASCII-escaped JSON and parse back unchanged.
  it("keeps any name through ASCII-only JSON", () => {
    const value = { name: "Grüne Füchsin 🦊", n: 2 };
    const text = asciiJson(value);
    expect(/^[\x20-\x7e]*$/.test(text)).toBe(true);
    const chunks = readChunks(withTextChunk(png(8, 4, 6), "k", text));
    expect(JSON.parse(readTextChunk(chunks, "k")!)).toEqual(value);
  });

  // Why: a key that is not plain Latin-1 would write an unreadable chunk.
  it("refuses a key or text outside printable ASCII", () => {
    expect(() => withTextChunk(png(8, 4, 6), "", "x")).toThrow(RangeError);
    expect(() => withTextChunk(png(8, 4, 6), "k", "ü")).toThrow(RangeError);
  });
});
