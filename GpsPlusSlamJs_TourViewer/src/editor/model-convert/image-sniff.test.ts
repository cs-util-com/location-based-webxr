/**
 * Why these tests matter: a picture a model names by file is put into the
 * `.glb` with the MIME type its first bytes say, never the one its file
 * name or the glTF claims: a mislabelled picture would otherwise reach a
 * decoder as the wrong type. Pictures a tour cannot show (TIFF, PSD, KTX2
 * and the like) must be recognised by name so the creator is told which
 * file was left out and why.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  jpegHeader,
  pngHeader,
} from "../asset-shelf/test-support/glb-fixtures.js";
import { sniffImage } from "./image-sniff.js";

const bytesOf = (text: string, length = 32) => {
  const out = new Uint8Array(length);
  out.set([...text].map((c) => c.charCodeAt(0)));
  return out;
};

describe("sniffImage", () => {
  it("names PNG and JPEG with their glTF MIME types and their size", () => {
    expect(sniffImage(pngHeader(64, 32))).toEqual({
      type: "png",
      mime: "image/png",
      embeddable: true,
      width: 64,
      height: 32,
    });
    expect(sniffImage(jpegHeader(8, 4))).toMatchObject({
      type: "jpeg",
      mime: "image/jpeg",
      embeddable: true,
      width: 8,
      height: 4,
    });
  });

  it("recognises the pictures a tour cannot show, without a size", () => {
    const cases: [Uint8Array, string][] = [
      [bytesOf("II*\0"), "tiff"],
      [bytesOf("MM\0*"), "tiff"],
      [bytesOf("8BPS"), "psd"],
      [bytesOf("DDS "), "dds"],
      [
        Uint8Array.of(
          0xab,
          0x4b,
          0x54,
          0x58,
          0x20,
          0x32,
          0x30,
          0xbb,
          13,
          10,
          26,
          10,
        ),
        "ktx2",
      ],
      [
        Uint8Array.of(
          0xab,
          0x4b,
          0x54,
          0x58,
          0x20,
          0x31,
          0x31,
          0xbb,
          13,
          10,
          26,
          10,
        ),
        "ktx",
      ],
      [Uint8Array.of(0x76, 0x2f, 0x31, 0x01, 0, 0, 0, 0), "exr"],
      [bytesOf("#?RADIANCE\n"), "hdr"],
      [bytesOf("BM"), "bmp"],
    ];
    for (const [bytes, type] of cases) {
      expect(sniffImage(bytes), type).toEqual({
        type,
        mime: null,
        embeddable: false,
      });
    }
  });

  it("answers null for bytes no picture starts with, and for a PNG whose header is cut", () => {
    expect(sniffImage(new Uint8Array(0))).toBeNull();
    expect(sniffImage(bytesOf("hello world"))).toBeNull();
    expect(sniffImage(pngHeader().subarray(0, 12))).toBeNull();
  });
});

describe("sniffImage, properties", () => {
  it("is total, and anything it calls embeddable has a MIME type and a positive size", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const result = sniffImage(bytes);
        const embedded = result?.embeddable === true ? result : null;
        expect(
          embedded === null ||
            (/^image\//.test(embedded.mime) &&
              embedded.width > 0 &&
              embedded.height > 0),
        ).toBe(true);
      }),
    );
  });

  it("reads any PNG header's size back exactly, whatever follows it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1 << 20 }),
        fc.integer({ min: 1, max: 1 << 20 }),
        fc.uint8Array({ maxLength: 32 }),
        (width, height, tail) => {
          const bytes = new Uint8Array([...pngHeader(width, height), ...tail]);
          expect(sniffImage(bytes)).toMatchObject({
            type: "png",
            width,
            height,
          });
        },
      ),
    );
  });
});
