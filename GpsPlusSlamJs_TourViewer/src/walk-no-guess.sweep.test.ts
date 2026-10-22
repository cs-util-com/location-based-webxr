import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  gaussian,
  mulberry32,
} from "gps-plus-slam-app-framework/test-utils/integrated-slam-drift";
import { POSITION_PRECISION_CEILING_M } from "gps-plus-slam-app-framework/state/position-precision";

import {
  NO_GUESS_START,
  noGuessStep,
  WALK_NO_GUESS_HOLD_MS,
} from "./walk-no-guess";

/**
 * Why this sweep matters (visitor walk W4 build plan M4, §5 "R-2's hold"):
 * the hold trades a steady focus against the wait for a guess. It is
 * swept at 1, 3, 5 and 10 s over recorded-style precision streams - a
 * weak fix flickering around the 25 m ceiling (one fix a second), and a
 * code session dropping its pose for under a second now and then (a tick
 * per camera frame) - by the focus changes per minute (each R-2
 * transition moves the focus between a station and none) and the time to
 * a guess once the distance is stable. The table goes to
 * `WALK_NO_GUESS_SWEEP_OUT` when set.
 */

const HOLDS_MS = [1_000, 3_000, 5_000, 10_000];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** One tick of a stream: when, and whether a distance is shown. */
type Tick = readonly [number, boolean];

/** A fix a second for 10 min whose stated accuracy wanders around the
 *  ceiling (a slow swing of 6 m and 3 m of noise), then 2 min clear. */
function flickeringFix(seed: number): Tick[] {
  const rng = mulberry32(seed);
  const out: Tick[] = [];
  for (let s = 0; s < 720; s += 1) {
    const accuracy =
      s < 600
        ? POSITION_PRECISION_CEILING_M +
          6 * Math.sin(s / 45 + seed) +
          3 * gaussian(rng)
        : 8;
    out.push([s * 1000, accuracy <= POSITION_PRECISION_CEILING_M]);
  }
  return out;
}

/** A code session at 30 frames a second for 10 min, its pose dropped for
 *  0.2-0.9 s every 15-40 s, then 2 min without a drop. */
function codePoseDrops(seed: number): Tick[] {
  const rng = mulberry32(seed);
  const drops: [number, number][] = [];
  for (
    let t = 15_000 * (1 + rng());
    t < 600_000;
    t += 15_000 + 25_000 * rng()
  ) {
    drops.push([t, t + 200 + 700 * rng()]);
  }
  const out: Tick[] = [];
  for (let t = 0; t < 720_000; t += 1000 / 30) {
    out.push([t, !drops.some(([a, b]) => t >= a && t < b)]);
  }
  return out;
}

interface Result {
  readonly changesPerMin: number;
  readonly withoutGuessShare: number;
  /** From the first tick of the final clear stretch to the guess, s. */
  readonly toGuessS: number;
}

function run(stream: readonly Tick[], holdMs: number): Result {
  let c = NO_GUESS_START;
  let changes = 0;
  let without = 0;
  let stableFrom = 0;
  let blind = true;
  let guessAt: number | null = null;
  let prevT = stream[0]![0];
  for (const [t, shown] of stream) {
    if (c.noGuess) without += t - prevT;
    prevT = t;
    const next = noGuessStep(c, shown, t, holdMs);
    if (next.noGuess !== c.noGuess) {
      changes += 1;
      if (!next.noGuess) guessAt = t;
    }
    if (!shown) {
      blind = true;
      guessAt = null;
    } else if (blind) {
      blind = false;
      stableFrom = t;
    }
    c = next;
  }
  const span = stream.at(-1)![0] - stream[0]![0];
  return {
    changesPerMin: changes / (span / 60_000),
    withoutGuessShare: without / span,
    toGuessS: guessAt === null ? Infinity : (guessAt - stableFrom) / 1000,
  };
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe("the no-guess hold, swept over precision streams", () => {
  it("3 s halves the flips of 1 s on a flickering fix, and waits a hold for a guess once the distance is stable", () => {
    const table: Record<
      string,
      Record<
        number,
        { changesPerMin: number; without: number; toGuessS: number }
      >
    > = {};
    for (const [name, make] of [
      ["flickering fix", flickeringFix],
      ["code pose drops", codePoseDrops],
    ] as const) {
      const streams = SEEDS.map((seed) => make(seed));
      table[name] = {};
      for (const hold of HOLDS_MS) {
        const results = streams.map((s) => run(s, hold));
        table[name][hold] = {
          changesPerMin: mean(results.map((r) => r.changesPerMin)),
          without: mean(results.map((r) => r.withoutGuessShare)),
          toGuessS: mean(results.map((r) => r.toGuessS)),
        };
      }
    }
    const out = process.env["WALK_NO_GUESS_SWEEP_OUT"];
    if (out !== undefined && out !== "") {
      const lines = Object.entries(table).flatMap(([name, rows]) => [
        name,
        ...Object.entries(rows).map(
          ([hold, r]) =>
            `  hold ${String(Number(hold) / 1000)} s: ${r.changesPerMin.toFixed(2)} focus changes/min, ${(100 * r.without).toFixed(1)} % without a guess, ${r.toGuessS.toFixed(1)} s to a guess`,
        ),
      ]);
      writeFileSync(out, `${lines.join("\n")}\n`);
    }
    for (const rows of Object.values(table)) {
      // A longer hold never flips more, and waits longer for its guess.
      for (let i = 1; i < HOLDS_MS.length; i += 1) {
        const a = rows[HOLDS_MS[i - 1]!]!;
        const b = rows[HOLDS_MS[i]!]!;
        expect(b.changesPerMin).toBeLessThanOrEqual(a.changesPerMin);
        expect(b.toGuessS).toBeGreaterThan(a.toGuessS);
      }
      // The guess comes back one hold after the distance is stable.
      expect(rows[3_000]!.toGuessS).toBeCloseTo(3, 0);
    }
    const fix = table["flickering fix"]!;
    expect(fix[3_000]!.changesPerMin).toBeLessThan(
      0.75 * fix[1_000]!.changesPerMin,
    );
    // A pose drop under a second costs one enter and one leave whatever
    // the hold: the hold decides only how long no station is guessed.
    const drops = table["code pose drops"]!;
    expect(drops[3_000]!.without).toBeLessThan(0.15);
  });
});

/**
 * Why this second sweep matters: the hold alone does nothing against a
 * code session's pose drops under a second - each drop still takes the
 * guess away and the hold keeps it away for 3 s after. Two remedies are
 * swept over both streams: an entry grace (the guess stays for G ms
 * without a distance before it goes: 0, 0.5, 1, 2 s) and skipping the
 * hold when the distance comes back as a code's (a code's distance does
 * not flicker around a ceiling; GPS's does). Measured beside the focus
 * changes and the share without a guess: the share of time a station is
 * named while NO distance is shown - what the grace costs, since the
 * guide's rule is to name none then.
 */
interface KindTick {
  readonly t: number;
  /** The distance's source this tick, or null for none shown. */
  readonly kind: "code" | "gps" | null;
}

function withKind(stream: readonly Tick[], kind: "code" | "gps"): KindTick[] {
  return stream.map(([t, shown]) => ({ t, kind: shown ? kind : null }));
}

interface RemedyResult {
  readonly changesPerMin: number;
  readonly withoutGuessShare: number;
  /** A station named while no distance is shown. */
  readonly namedBlindShare: number;
}

function runRemedy(
  stream: readonly KindTick[],
  graceMs: number,
  codeSkipsHold: boolean,
): RemedyResult {
  let c = NO_GUESS_START;
  let changes = 0;
  let without = 0;
  let namedBlind = 0;
  let lastShownAt: number | null = null;
  let prev = stream[0]!;
  for (const tick of stream) {
    const dt = tick.t - prev.t;
    if (c.noGuess) without += dt;
    else if (prev.kind === null) namedBlind += dt;
    prev = tick;
    if (tick.kind !== null) lastShownAt = tick.t;
    // The grace: a distance gone for less than G still counts as shown.
    const inGrace =
      tick.kind === null &&
      lastShownAt !== null &&
      tick.t - lastShownAt < graceMs;
    const shown = tick.kind !== null || inGrace;
    const next = noGuessStep(
      c,
      shown,
      tick.t,
      WALK_NO_GUESS_HOLD_MS,
      codeSkipsHold && tick.kind === "code",
    );
    if (next.noGuess !== c.noGuess) changes += 1;
    c = next;
  }
  const span = stream.at(-1)!.t - stream[0]!.t;
  return {
    changesPerMin: changes / (span / 60_000),
    withoutGuessShare: without / span,
    namedBlindShare: namedBlind / span,
  };
}

describe("the entry grace and a code's return, swept", () => {
  it("a code's return skipping the hold cuts a code session's time without a guess to its drops, naming nothing blind; a grace of 1 s would also stop its flips but names stations blind", () => {
    const GRACES = [0, 500, 1_000, 2_000];
    const streams = {
      "flickering fix": SEEDS.map((s) => withKind(flickeringFix(s), "gps")),
      "code pose drops": SEEDS.map((s) => withKind(codePoseDrops(s), "code")),
    };
    const table: Record<string, Record<string, RemedyResult>> = {};
    for (const [name, list] of Object.entries(streams)) {
      table[name] = {};
      for (const skip of [false, true]) {
        for (const grace of GRACES) {
          const rs = list.map((s) => runRemedy(s, grace, skip));
          table[name][
            `grace ${String(grace / 1000)} s, code ${skip ? "skips" : "holds"}`
          ] = {
            changesPerMin: mean(rs.map((r) => r.changesPerMin)),
            withoutGuessShare: mean(rs.map((r) => r.withoutGuessShare)),
            namedBlindShare: mean(rs.map((r) => r.namedBlindShare)),
          };
        }
      }
    }
    const out = process.env["WALK_NO_GUESS_REMEDY_OUT"];
    if (out !== undefined && out !== "") {
      writeFileSync(
        out,
        `${Object.entries(table)
          .flatMap(([name, rows]) => [
            name,
            ...Object.entries(rows).map(
              ([k, r]) =>
                `  ${k}: ${r.changesPerMin.toFixed(2)} focus changes/min, ${(100 * r.withoutGuessShare).toFixed(1)} % without a guess, ${(100 * r.namedBlindShare).toFixed(1)} % naming a station blind`,
            ),
          ])
          .join("\n")}\n`,
      );
    }
    const code = table["code pose drops"]!;
    const fix = table["flickering fix"]!;
    const shipped = "grace 0 s, code skips";
    const before = "grace 0 s, code holds";
    // The shipped remedy: a code session's time without a guess falls to
    // its drops alone, and it never names a station without a distance.
    expect(code[shipped]!.withoutGuessShare).toBeLessThan(
      0.4 * code[before]!.withoutGuessShare,
    );
    expect(code[shipped]!.namedBlindShare).toBe(0);
    // ... and changes nothing for GPS, whose return keeps the hold.
    expect(fix[shipped]).toEqual(fix[before]);
    // The grace's trade, for the record: at 1 s and more a code session's
    // sub-second drops no longer flip the focus, but a station is named
    // while no distance is shown, under GPS too.
    expect(code["grace 1 s, code skips"]!.changesPerMin).toBeLessThan(
      code[shipped]!.changesPerMin,
    );
    expect(code["grace 1 s, code skips"]!.namedBlindShare).toBeGreaterThan(0);
    expect(fix["grace 2 s, code holds"]!.namedBlindShare).toBeGreaterThan(0);
  });
});
