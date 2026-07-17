/**
 * PackedKeyHash unit + property tests.
 *
 * Why this test matters (2026-07-17 perf loop, iteration 2): the smooth
 * mesher's hot loops (occupied-membership, dual-vertex welding) run on this
 * open-addressed hash instead of Map/Set. Its contract must be EXACTLY
 * "Map<number, number> for packed cell keys with values ≥ 0" — a probe-chain
 * or growth bug would silently corrupt mesh topology (wrong welds, phantom
 * or missing faces), which no downstream test could attribute back here.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PackedKeyHash } from './packed-key-hash';
import { packCellKey, CELL_KEY_LIMIT } from './cell-key';

describe('PackedKeyHash', () => {
  it('get returns -1 for absent keys, the stored value for present ones', () => {
    const h = new PackedKeyHash(4);
    expect(h.get(42)).toBe(-1);
    h.set(42, 7);
    expect(h.get(42)).toBe(7);
    expect(h.has(42)).toBe(true);
    expect(h.get(43)).toBe(-1);
    expect(h.has(43)).toBe(false);
  });

  it('set overwrites an existing key', () => {
    const h = new PackedKeyHash(4);
    h.set(9, 1);
    h.set(9, 2);
    expect(h.get(9)).toBe(2);
    expect(h.size).toBe(1);
  });

  it('accepts key 0 (the minimum packable cell key) distinctly from absence', () => {
    const h = new PackedKeyHash(4);
    expect(h.has(0)).toBe(false);
    h.set(0, 5);
    expect(h.get(0)).toBe(5);
  });

  it('grows transparently past its size hint (a full table must never spin)', () => {
    const h = new PackedKeyHash(2);
    const count = 10_000;
    for (let i = 0; i < count; i++) {
      h.set(i * 131_072 + 17, i);
    }
    expect(h.size).toBe(count);
    for (let i = 0; i < count; i++) {
      expect(h.get(i * 131_072 + 17)).toBe(i);
    }
  });

  // Packed keys along ONE axis differ by exactly 2^34 (x), 2^17 (y) or 1 (z)
  // — highly structured strides that defeat a single multiplicative mix (the
  // product's low index bits stay constant, collapsing e.g. a y-varying wall
  // into ONE probe chain and O(n) lookups; the original mixer did exactly
  // that and this suite's growth test timed out in CI). The vitest timeout is
  // the canary: with healthy mixing each 20k-key axis walk is milliseconds.
  it('stays fast for single-axis key walks (wall/floor/pillar structures)', () => {
    const count = 20_000;
    for (const axis of [0, 1, 2] as const) {
      const h = new PackedKeyHash(count);
      for (let i = -count / 2; i < count / 2; i++) {
        const cell: [number, number, number] = [3, -7, 11];
        cell[axis] = i;
        h.set(packCellKey(cell[0], cell[1], cell[2]), i + count);
      }
      expect(h.size).toBe(count);
      for (let i = -count / 2; i < count / 2; i++) {
        const cell: [number, number, number] = [3, -7, 11];
        cell[axis] = i;
        expect(h.get(packCellKey(cell[0], cell[1], cell[2]))).toBe(i + count);
      }
    }
  });

  it('throws on a negative value (would be indistinguishable from absence)', () => {
    const h = new PackedKeyHash(4);
    expect(() => h.set(1, -1)).toThrow(RangeError);
  });

  // The real workload: keys produced by packCellKey over the full coordinate
  // envelope, including adjacent/structured coordinates that stress the mixer.
  it('behaves exactly like Map<number, number> for any packed-key workload', () => {
    const coord = fc.integer({ min: -CELL_KEY_LIMIT, max: CELL_KEY_LIMIT });
    const arbOp = fc.record({
      cell: fc.tuple(coord, coord, coord),
      value: fc.integer({ min: 0, max: 2 ** 31 - 1 }),
      kind: fc.constantFrom<'set' | 'get'>('set', 'set', 'get'),
    });
    fc.assert(
      fc.property(
        fc.array(arbOp, { minLength: 1, maxLength: 400 }),
        fc.integer({ min: 0, max: 64 }),
        (ops, sizeHint) => {
          const h = new PackedKeyHash(sizeHint);
          const reference = new Map<number, number>();
          for (const op of ops) {
            const key = packCellKey(op.cell[0], op.cell[1], op.cell[2]);
            if (op.kind === 'set') {
              h.set(key, op.value);
              reference.set(key, op.value);
            }
            expect(h.get(key)).toBe(reference.get(key) ?? -1);
            expect(h.has(key)).toBe(reference.has(key));
          }
          expect(h.size).toBe(reference.size);
        }
      )
    );
  });
});
