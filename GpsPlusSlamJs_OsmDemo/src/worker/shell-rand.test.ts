/**
 * Why this test matters: the value this produces is invisible on its own — it
 * only shows as the phase of a pulse. Two failures would therefore look like
 * design choices rather than bugs: a value that is not stable across rebuilds
 * makes the city re-randomise its breathing whenever a tile lands, and a value
 * that clusters makes neighbouring buildings pulse in lockstep, which is the
 * exact effect the offset exists to prevent.
 */

import { describe, expect, it } from "vitest";

import { shellRandFor } from "./shell-rand.js";

const meshAt = (x: number, y: number, z: number) => ({
  positions: new Float32Array([x, y, z, x + 1, y, z, x, y + 1, z]),
});

describe("shellRandFor", () => {
  it("is stable for the same geometry", () => {
    // The property an index-derived value would NOT have, and the reason this
    // function exists at all.
    expect(shellRandFor(meshAt(12.5, 0, -8.25))).toBe(
      shellRandFor(meshAt(12.5, 0, -8.25)),
    );
  });

  it("always lands in [0, 1)", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [-1200.5, 40, 900.25],
      [1e5, -1e5, 5],
      [0.004, 0.004, 0.004],
    ]) {
      const v = shellRandFor(meshAt(x!, y!, z!));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("separates NEIGHBOURING buildings, not just distant ones", () => {
    // The failure that matters visually: a hash that is smooth in position
    // gives adjacent buildings near-identical phases, so a street pulses as one
    // unit and the desynchronisation buys nothing.
    const a = shellRandFor(meshAt(0, 0, 0));
    const b = shellRandFor(meshAt(8, 0, 0)); // one building along
    const c = shellRandFor(meshAt(0, 0, 8));
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
    expect(Math.abs(a - c)).toBeGreaterThan(0.05);
  });

  it("spreads reasonably over many inputs", () => {
    // Not a statistical test — just enough to catch a hash that collapses to a
    // handful of values, which would reintroduce lockstep for whole groups.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(Math.floor(shellRandFor(meshAt(i * 7.5, 0, i * 3.25)) * 10));
    }
    // All ten deciles should be represented by 200 samples.
    expect(seen.size).toBeGreaterThanOrEqual(8);
  });

  it("returns 0 rather than NaN for empty geometry", () => {
    // Such a mesh is dropped before it reaches a chunk, but NaN in a vertex
    // attribute takes the entire draw call with it.
    expect(shellRandFor({ positions: new Float32Array() })).toBe(0);
  });
});
