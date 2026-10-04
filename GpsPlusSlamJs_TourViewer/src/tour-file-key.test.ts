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

/**
 * Why these tests matter (K0 milestone review R7): the key is the draft's
 * namespace. Keyed on every entry, a Finish (a new `tour.json`, a new
 * `qr/<id>.json`, new photos) gave the tour a NEW key, so the creator's
 * draft - work placed after the Finish, and its storage - was orphaned on
 * every Finish and on any re-zip that wrapped the files in a folder.
 */
describe("tourFileKey - stable across a Finish and a re-zip", () => {
  const RECORDING: TourFileKeyEntry[] = [
    { filename: "session.json", uncompressedSize: 300, crc32: 11 },
    { filename: "actions/000001.json", uncompressedSize: 900, crc32: 12 },
    {
      filename: "images/frame-000001.jpg",
      uncompressedSize: 50_000,
      crc32: 13,
    },
  ];

  it("keeps its key when a Finish rewrites tour.json and adds a level and photos", async () => {
    const before = await tourFileKey([
      ...RECORDING,
      { filename: "tour.json", uncompressedSize: 40, crc32: 1 },
    ]);
    const after = await tourFileKey([
      ...RECORDING,
      { filename: "tour.json", uncompressedSize: 900, crc32: 2 },
      { filename: "qr/abc123def456.json", uncompressedSize: 500, crc32: 3 },
      { filename: "content/p1.jpg", uncompressedSize: 70_000, crc32: 4 },
    ]);
    expect(after).toBe(before);
  });

  it("keeps its key when the same files are re-zipped inside a folder", async () => {
    const flat = await tourFileKey(RECORDING);
    const wrapped = await tourFileKey(
      RECORDING.map((e) => ({ ...e, filename: `mytour/${e.filename}` })),
    );
    expect(wrapped).toBe(flat);
  });

  it("still tells two different recordings apart", async () => {
    const other = RECORDING.map((e, i) => (i === 1 ? { ...e, crc32: 99 } : e));
    expect(await tourFileKey(other)).not.toBe(await tourFileKey(RECORDING));
  });

  it("falls back to every entry for a tour that is ONLY the tour kit's files", async () => {
    // A hand-built tour: nothing else names it, so a Finish does change
    // its key (until K1's seriesId gives every tour an identity).
    const a = await tourFileKey([
      { filename: "tour.json", uncompressedSize: 40, crc32: 1 },
    ]);
    const b = await tourFileKey([
      { filename: "tour.json", uncompressedSize: 41, crc32: 1 },
    ]);
    expect(a).not.toBe(b);
  });
});
