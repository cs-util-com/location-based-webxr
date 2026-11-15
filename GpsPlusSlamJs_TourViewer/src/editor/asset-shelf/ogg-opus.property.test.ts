/**
 * Why these properties matter: the writer meets packets of every size and
 * count a real encoder makes (and lengths that do not end on a frame), and
 * any of them must give a file a player reads back whole - every packet in
 * order, every page's checksum right, granule positions that never go
 * back, and the exact length in the last page.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { oggCrc32, oggOpusPages, opusPacketSamples } from "./ogg-opus.js";

/** A packet with a valid table-of-contents byte (codes 0-2) and a body. */
const packet = fc
  .record({
    config: fc.integer({ min: 0, max: 31 }),
    code: fc.integer({ min: 0, max: 2 }),
    body: fc.integer({ min: 0, max: 1275 }),
    fill: fc.integer({ min: 0, max: 255 }),
  })
  .map(({ config, code, body, fill }) => {
    const out = new Uint8Array(1 + body).fill(fill);
    out[0] = (config << 3) | code;
    return out;
  });

describe("the Ogg Opus writer, for any packets", () => {
  it("reads back whole: packets, checksums, granules and the exact length", () => {
    fc.assert(
      fc.property(
        fc.array(packet, { minLength: 1, maxLength: 250 }),
        fc.integer({ min: 0, max: 3840 }),
        fc.integer({ min: 0, max: 5000 }),
        fc.constantFrom(1, 2),
        (packets, preSkip, cut, channels) => {
          const sum = packets.reduce((n, p) => n + opusPacketSamples(p), 0);
          // Any length the last packet can end: trimmed by `cut` within it.
          const last = opusPacketSamples(packets[packets.length - 1]!);
          const total = sum - preSkip - Math.min(cut, last - 1);
          fc.pre(total > 0);
          const pages = oggOpusPages(
            {
              channels,
              preSkip,
              inputSampleRate: 44100,
              serial: 99,
              vendor: "v",
            },
            packets,
            total,
          );
          const back: Uint8Array[] = [];
          let granule = -1n;
          pages.forEach((bytes, index) => {
            const view = new DataView(bytes.buffer, bytes.byteOffset);
            const zeroed = bytes.slice();
            zeroed.fill(0, 22, 26);
            expect(view.getUint32(22, true)).toBe(oggCrc32(zeroed));
            expect(view.getUint32(18, true)).toBe(index);
            const g = view.getBigInt64(6, true);
            expect(g >= granule).toBe(true);
            granule = g;
            const segments = bytes[26]!;
            expect(segments).toBeLessThanOrEqual(255);
            let at = 27 + segments;
            let length = 0;
            for (const lace of bytes.subarray(27, 27 + segments)) {
              length += lace;
              if (lace < 255) {
                if (index >= 2) back.push(bytes.subarray(at, at + length));
                at += length;
                length = 0;
              }
            }
            expect(at).toBe(bytes.length);
          });
          expect(back).toEqual(packets);
          expect(granule).toBe(BigInt(preSkip + total));
          expect(pages[pages.length - 1]![5]).toBe(4);
        },
      ),
      { numRuns: 100 },
    );
  });
});
