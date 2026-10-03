import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  isTourFileKey,
  tourFileKey,
  type TourFileKeyEntry,
} from "./tour-file-key.js";

/**
 * Why these tests matter (tour kit plan K0): a tour opened from a file has
 * no link, and its draft, its open-tour identity and its scan comparisons
 * hang on this key instead. A creator who downloads the same tour again
 * (new modification time, "tour (1).zip") must find their draft; a
 * different tour must never pick up someone else's.
 */

const ENTRIES: TourFileKeyEntry[] = [
  { filename: "tour.json", uncompressedSize: 40, crc32: 1234 },
  { filename: "content/p1.jpg", uncompressedSize: 9000, crc32: 99 },
  { filename: "content/", directory: true, uncompressedSize: 0 },
];

describe("tourFileKey", () => {
  it("is a prefixed 128-bit hex key, recognisable as a file key", async () => {
    const key = await tourFileKey(ENTRIES);
    expect(key).toMatch(/^local-file:[0-9a-f]{32}$/);
    expect(isTourFileKey(key)).toBe(true);
    expect(isTourFileKey("https://host.example/local-file:x.zip")).toBe(false);
  });

  it("is the same for the same content in another order, without folder entries", async () => {
    const reordered = [ENTRIES[1]!, ENTRIES[0]!];
    expect(await tourFileKey(reordered)).toBe(await tourFileKey(ENTRIES));
  });

  it("changes when any file's content, size or name changes", async () => {
    const base = await tourFileKey(ENTRIES);
    const edits: TourFileKeyEntry[][] = [
      [{ ...ENTRIES[0]!, crc32: 1235 }, ENTRIES[1]!],
      [{ ...ENTRIES[0]!, uncompressedSize: 41 }, ENTRIES[1]!],
      [{ ...ENTRIES[0]!, filename: "tour2.json" }, ENTRIES[1]!],
      [ENTRIES[0]!],
    ];
    for (const edit of edits) {
      expect(await tourFileKey(edit)).not.toBe(base);
    }
  });

  it("tells apart any two files that differ only in size (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.nat(),
        fc.nat(),
        async (name, size, crc) => {
          const a = await tourFileKey([
            { filename: name, uncompressedSize: size, crc32: crc },
          ]);
          const b = await tourFileKey([
            { filename: name, uncompressedSize: size + 1, crc32: crc },
          ]);
          expect(a).not.toBe(b);
        },
      ),
      { numRuns: 50 },
    );
  });
});
