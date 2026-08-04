/**
 * WHY THESE TESTS MATTER (round 10 §3).
 *
 * The cell array is the largest thing that crosses the worker boundary as plain
 * objects, and structured-cloning it measures 35 ms at the 488-chunk cap
 * (`refresh-payload.test.ts`). Packing it into typed arrays lets it be
 * TRANSFERRED instead of copied — the pattern the mesh already uses.
 *
 * The whole correctness burden of that change is the ROUND TRIP. A packer that
 * loses a category, truncates an H3 id, or misaligns the contributor offsets
 * produces a map that is subtly wrong rather than obviously broken — wrong
 * colours on the right hexagons, or a popup crediting the wrong feature. So the
 * central test is not "does it pack" but "is unpack(pack(x)) === x", including
 * over generated input.
 *
 * @see cell-payload.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  packCells,
  unpackCells,
  cellPayloadBuffers,
  decodeCellId,
} from "./cell-payload.js";
import type { CellScore } from "gps-plus-slam-osm";

/** A real H3 res-13 index, so the id encoding is exercised on real shapes. */
const H3_IDS = [
  "8d1fb46622d4b3f",
  "8d1fb46622d4b7f",
  "8d1fb46622d5b3f",
  "8f2a1072b59ffff",
];

const cell = (
  id: string,
  scores: Record<string, number>,
  contributors: Record<string, Record<string, number>> = {},
): CellScore => ({ cell: id, scores, contributors });

describe("packCells / unpackCells", () => {
  it("round-trips ids, scores and contributors", () => {
    const cells = [
      cell(
        H3_IDS[0] ?? "",
        { walkable: 3.5, scenic: 2 },
        { walkable: { leisure_park: 3, highway_footway: 1.5 } },
      ),
      cell(H3_IDS[1] ?? "", { walkable: 1, scenic: 4.25 }, {}),
    ];

    const packed = packCells(cells);
    expect(unpackCells(packed)).toEqual(cells);
  });

  it("preserves real H3 ids through the 64-bit encoding", () => {
    // WHAT THIS ACTUALLY PROVES, stated honestly after a mutation check. It
    // covers the BigInt encode/decode round trip -- it does NOT cover the
    // zero-padding, because every valid H3 cell index sets mode bits 59-56 to
    // 1, so it is always `0x8...` and always 15 hex characters. Deleting the
    // `padStart` leaves this test green.
    //
    // Originally named "including its leading digit", which claimed exactly the
    // coverage it did not have. The padding is exercised by the test below.
    const packed = packCells(H3_IDS.map((id) => cell(id, { walkable: 1 })));
    expect(unpackCells(packed).map((entry) => entry.cell)).toEqual(H3_IDS);
  });

  it("pads a decoded id back to width when the value has leading zeros", () => {
    // THE GUARD THAT NO REAL INPUT REACHES, tested directly because that is the
    // only way it can be. `BigInt.toString(16)` drops leading zeros, so an id
    // one character short would silently be a DIFFERENT cell. H3 never produces
    // such a value today -- but `decodeCellId` is a general decoder, and a guard
    // that is never executed is indistinguishable from a broken one.
    expect(decodeCellId(0x8d1fb46622d4b3fn)).toBe("8d1fb46622d4b3f");
    expect(decodeCellId(0x1fb46622d4b3fn)).toBe("001fb46622d4b3f");
    expect(decodeCellId(0n)).toBe("000000000000000");
    // And the width is honoured rather than hard-coded, since it is a property
    // of the H3 resolution rather than of this module.
    expect(decodeCellId(0xffn, 4)).toBe("00ff");
  });

  it("keeps an empty cell list empty rather than producing a phantom row", () => {
    const packed = packCells([]);
    expect(unpackCells(packed)).toEqual([]);
  });

  it("handles a cell with no contributors next to one with several", () => {
    // THE OFF-BY-ONE THE OFFSETS INVITE. Contributors are stored compactly with
    // a per-cell offset, so an empty run between two non-empty ones is exactly
    // where a mis-built offset array shows up -- and it shows up as one cell
    // being credited with its NEIGHBOUR's features, which reads as a scoring
    // bug rather than an encoding one.
    const cells = [
      cell(H3_IDS[0] ?? "", { walkable: 2 }, { walkable: { a: 2 } }),
      cell(H3_IDS[1] ?? "", { walkable: 1 }, {}),
      cell(
        H3_IDS[2] ?? "",
        { walkable: 6 },
        { walkable: { b: 2, c: 3 }, scenic: { d: 4 } },
      ),
    ];

    expect(unpackCells(packCells(cells))).toEqual(cells);
  });

  it("gives every buffer to the transfer list", () => {
    // A BUFFER LEFT OUT IS SILENTLY COPIED rather than moved -- invisible except
    // as the cost this whole change exists to remove. `transferablesOf` in the
    // worker has the same hazard and says so; this is the same guard for cells.
    const packed = packCells([
      cell(H3_IDS[0] ?? "", { walkable: 2 }, { walkable: { a: 2 } }),
    ]);
    const buffers = cellPayloadBuffers(packed);

    const typedArrayFields = Object.values(packed).filter(
      (value): value is ArrayBufferView => ArrayBuffer.isView(value),
    );
    expect(typedArrayFields.length).toBeGreaterThan(0);
    for (const view of typedArrayFields) {
      expect(buffers).toContain(view.buffer);
    }
  });

  it("round-trips arbitrary cells (property)", () => {
    // The generated version of the first test. Hand-written fixtures encode the
    // shapes the author thought of; the offsets and the score matrix are where
    // a case nobody thought of lives.
    const scoreArb = fc.dictionary(
      fc.constantFrom("walkable", "scenic", "battleArea"),
      fc.float({ min: 0.5, max: 9, noNaN: true, noDefaultInfinity: true }),
      { maxKeys: 3 },
    );

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...H3_IDS), {
          maxLength: H3_IDS.length,
        }),
        scoreArb,
        (ids, scores) => {
          const cells = ids.map((id) =>
            cell(id, scores, { walkable: { leisure_park: 2 } }),
          );
          expect(unpackCells(packCells(cells))).toEqual(cells);
        },
      ),
    );
  });
});
