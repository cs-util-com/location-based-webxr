import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { walkDirection, type WalkDirection } from "./walk-direction";

/**
 * Why this sweep matters: the shipped 28° / 140° / 5° are the prototype's and the
 * defaults, and a verdict from one value is provisional. A visitor
 * turning slowly once around (10°/s, 60 ticks a second) with the camera
 * heading jittering sees the word change; the ideal is four changes a
 * turn (ahead, a side, behind, the other side). The sweep counts the
 * changes over the thresholds' ranges (ahead 20-35°, behind 120-150°),
 * the band (0-10°) and the jitter (0.5-3°, a still hand to a shaky
 * walk), and reports them (set WALK_DIRECTION_SWEEP_OUT to a file path to
 * keep the table); it asserts only what the band is for.
 */

const OUT = process.env["WALK_DIRECTION_SWEEP_OUT"];

/** A deterministic jitter (mulberry32): the sweep repeats exactly. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Word changes over one slow full turn with the jitter given. */
function changesPerTurn(
  aheadDeg: number,
  behindDeg: number,
  hysteresisDeg: number,
  jitterDeg: number,
  seed: number,
): number {
  const rand = prng(seed);
  const ticks = 36 * 60; // 360° at 10°/s, 60 ticks a second
  let word: WalkDirection | null = null;
  let changes = 0;
  for (let i = 0; i <= ticks; i += 1) {
    const heading = (i / ticks) * 360 + (rand() * 2 - 1) * jitterDeg;
    const next = walkDirection(-heading, word, {
      aheadDeg,
      behindDeg,
      hysteresisDeg,
    });
    if (word !== null && next !== word) changes += 1;
    word = next;
  }
  return changes;
}

describe("walk-direction sweep - word changes for a visitor turning slowly", () => {
  it("reports the changes per turn across the ranges; the shipped band holds four", () => {
    const report: string[] = [];
    for (const jitter of [0.5, 1.5, 3]) {
      for (const h of [0, 2, 5, 8, 10]) {
        const cells: string[] = [];
        for (const ahead of [20, 28, 35]) {
          for (const behind of [120, 140, 150]) {
            let worst = 0;
            for (let seed = 1; seed <= 5; seed += 1) {
              worst = Math.max(
                worst,
                changesPerTurn(ahead, behind, h, jitter, seed),
              );
            }
            cells.push(`${String(ahead)}/${String(behind)}:${String(worst)}`);
          }
        }
        report.push(
          `jitter ${String(jitter)}° h ${String(h)}° -> ${cells.join(" ")}`,
        );
      }
    }
    if (OUT !== undefined) {
      writeFileSync(
        OUT,
        ["walk-direction sweep (worst of 5 seeds)", ...report, ""].join("\n"),
      );
    }
    // What the band is for, at every threshold pair in the range: with a
    // band wider than the jitter's half-span the word changes exactly four
    // times a turn; with none it flickers at 1.5° of jitter.
    for (const ahead of [20, 28, 35]) {
      for (const behind of [120, 140, 150]) {
        for (let seed = 1; seed <= 5; seed += 1) {
          expect(changesPerTurn(ahead, behind, 5, 1.5, seed)).toBe(4);
          expect(changesPerTurn(ahead, behind, 5, 3, seed)).toBe(4);
        }
      }
    }
    expect(changesPerTurn(28, 140, 0, 1.5, 1)).toBeGreaterThan(4);
  });
});
