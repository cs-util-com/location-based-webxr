import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  asciiJson,
  crc32,
  readChunks,
  readTextChunk,
  withTextChunk,
} from "./png-text.js";

function minimalPng(): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xae, 0x42, 0x60, 0x82];
  return Uint8Array.from([...sig, ...iend]);
}

describe("png-text properties", () => {
  // Why: whatever record the maker writes (any name, any description) must
  // come back from the file unchanged, or a character loses its name on the
  // way between devices.
  it("round-trips any JSON record through a text chunk", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = asciiJson(value);
        const out = withTextChunk(
          minimalPng(),
          "gps-plus-slam-character",
          text,
        );
        const back = readTextChunk(readChunks(out), "gps-plus-slam-character");
        expect(JSON.parse(back!)).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  // Why: the CRC is the table form of the standard; a bytewise reference
  // implementation must agree on any input.
  it("matches a bitwise CRC-32", () => {
    const slow = (b: Uint8Array): number => {
      let c = 0xffffffff;
      for (const byte of b) {
        c ^= byte;
        for (let k = 0; k < 8; k++)
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    };
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (b) => {
        expect(crc32(b)).toBe(slow(b));
      }),
    );
  });
});
