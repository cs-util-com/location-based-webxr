import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave } from "./autosave.js";

/**
 * Why these tests matter (M6 E2b-2, the E2b plan review #7 and #11, the
 * owner's sweep rule): a verdict at one delay is provisional. The page's
 * three promises - at most one save in flight, the last change always
 * saved, nothing started while a delete can be undone or a field is typed
 * in - must hold at EVERY delay from 0.5 s to 10 s and every max wait from
 * 15 s to 120 s, so they are checked over a grid of scripted creator
 * sessions and over random ones. The grid also counts the writes each
 * session costs, which is what picks the defaults (a sync client uploads
 * the whole tour on every write).
 */

/** The page's undo window for a delete (`edit-main.ts` `UNDO_MS`). */
const UNDO_MS = 8_000;

type Step =
  | { readonly at: number; readonly kind: "edit" }
  | { readonly at: number; readonly kind: "delete" }
  | { readonly at: number; readonly kind: "type"; readonly forMs: number }
  | { readonly at: number; readonly kind: "revert"; readonly forMs: number };

interface Outcome {
  readonly writes: number;
  readonly maxInFlight: number;
  /** Saves that started while a delete could be undone or a field was
   *  being typed in. */
  readonly startedWhileHeld: number;
  readonly lastSaved: boolean;
  /** When the save that carried the last change landed (ms from the
   *  start), or null. */
  readonly lastSavedAt: number | null;
}

/**
 * Play `steps` against the scheduler as the page wires it: an edit is a
 * committed change; a delete is one too, held for the undo window, with a
 * poke when the window ends; typing holds until it is committed (a change
 * and a poke); a field typed in and put back as it was (`revert`) holds
 * and then ends with no change and NO poke - the card has nothing to
 * commit (E2b-2 milestone review #4). Each save takes `saveMs` and writes
 * the version it snapshotted when it started.
 */
async function play(
  steps: readonly Step[],
  options: { delayMs: number; maxWaitMs: number; saveMs: number },
): Promise<Outcome> {
  let version = 0;
  let saved = 0;
  let undoUntil = -1;
  let typing = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let writes = 0;
  let startedWhileHeld = 0;
  let lastSavedAt: number | null = null;
  const now = (): number => Date.now();
  const held = (): boolean => typing > 0 || now() < undoUntil;
  const autosave = createAutosave({
    delayMs: options.delayMs,
    maxWaitMs: options.maxWaitMs,
    held,
    pending: () => version > saved,
    save: () => {
      writes += 1;
      if (held()) startedWhileHeld += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const snapshot = version;
      return new Promise<"saved">((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          saved = Math.max(saved, snapshot);
          if (saved === version) lastSavedAt ??= now() - start;
          resolve("saved");
        }, options.saveMs);
      });
    },
  });
  autosave.enable(true);
  const start = now();
  let end = 0;
  for (const step of steps) {
    end = Math.max(
      end,
      step.at +
        (step.kind === "type" || step.kind === "revert" ? step.forMs : 0),
    );
    setTimeout(() => {
      if (step.kind === "revert") {
        typing += 1;
        setTimeout(() => {
          typing -= 1;
        }, step.forMs);
        return;
      }
      if (step.kind === "type") {
        typing += 1;
        setTimeout(() => {
          typing -= 1;
          version += 1;
          autosave.changed();
          autosave.poke();
        }, step.forMs);
        return;
      }
      version += 1;
      autosave.changed();
      if (step.kind === "delete") {
        const until = now() + UNDO_MS;
        undoUntil = until;
        setTimeout(() => {
          if (undoUntil === until) autosave.poke();
        }, UNDO_MS);
      }
    }, step.at);
  }
  // Long enough for the last hold, delay, max wait and save to run out.
  await vi.advanceTimersByTimeAsync(
    end + UNDO_MS + options.maxWaitMs + options.saveMs * 4 + 1_000,
  );
  expect(now() - start).toBeGreaterThan(end);
  autosave.stop();
  return {
    writes,
    maxInFlight,
    startedWhileHeld,
    lastSaved: saved === version,
    lastSavedAt,
  };
}

/** A deterministic random source (mulberry32), so the scripted session is
 *  the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Ten minutes of a creator at work: bursts of quick moves and edits, texts
 * typed for a few seconds, a delete now and then, and pauses to read.
 */
function creatorSession(): Step[] {
  const random = seeded(2026_10_14);
  const steps: Step[] = [];
  let at = 1_000;
  while (at < 600_000) {
    const kind = random();
    if (kind < 0.6) {
      steps.push({ at, kind: "type", forMs: 2_000 + random() * 6_000 });
    } else if (kind < 0.9) {
      steps.push({ at, kind: "edit" });
    } else {
      steps.push({ at, kind: "delete" });
    }
    const gap = random();
    at +=
      gap < 0.6
        ? 500 + random() * 2_000
        : gap < 0.9
          ? 5_000 + random() * 10_000
          : 30_000 + random() * 60_000;
  }
  return steps;
}

/** A creator who never stops: an edit every 2 s for 3 minutes. */
function steadySession(): Step[] {
  return Array.from({ length: 90 }, (_, i) => ({
    at: 1_000 + i * 2_000,
    kind: "edit" as const,
  }));
}

/** When the reverted field's hold ends in `revertedSession`. */
const REVERT_ENDS_MS = 1_500 + 9_000;

/** One edit, then a field typed in for 9 s and put back as it was: the
 *  hold ends with no change and no poke (E2b-2 milestone review #4). */
function revertedSession(): Step[] {
  return [
    { at: 1_000, kind: "edit" },
    { at: 1_500, kind: "revert", forMs: 9_000 },
  ];
}

const DELAYS_MS = [500, 1_000, 2_000, 3_000, 5_000, 10_000];
const MAX_WAITS_MS = [15_000, 30_000, 60_000, 120_000];
const SAVE_MS = [200, 2_000];

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("autosave across delays and max waits (the sweep)", () => {
  const creator = creatorSession();
  const steady = steadySession();
  const reverted = revertedSession();
  /** Writes per session, for the design doc (printed with
   *  `AUTOSAVE_SWEEP_REPORT=1`; stdout, since the runner's reporter keeps
   *  `console` output of passing tests to itself). */
  const report: string[] = [];

  for (const delayMs of DELAYS_MS) {
    for (const maxWaitMs of MAX_WAITS_MS) {
      for (const saveMs of SAVE_MS) {
        it(`delay ${String(delayMs)} ms, max wait ${String(maxWaitMs)} ms, a save of ${String(saveMs)} ms: one at a time, the last change saved, nothing in a hold`, async () => {
          const options = { delayMs, maxWaitMs, saveMs };
          const a = await play(creator, options);
          const b = await play(steady, options);
          for (const outcome of [a, b]) {
            expect(outcome.maxInFlight).toBe(1);
            expect(outcome.startedWhileHeld).toBe(0);
            expect(outcome.lastSaved).toBe(true);
          }
          // Never starved: the steady creator is saved at least once per
          // max wait (plus the save and one gap of slack), whatever the
          // delay.
          expect(b.writes).toBeGreaterThanOrEqual(
            Math.floor(180_000 / (maxWaitMs + saveMs + 2_000)),
          );
          // Never more writes than changes.
          expect(a.writes).toBeLessThanOrEqual(creator.length);
          // A hold that ends with no poke still saves the change that fell
          // due in it, within one delay of the hold's end (and so within
          // the max wait, which is never shorter).
          const c = await play(reverted, options);
          expect(c.lastSaved).toBe(true);
          expect(c.maxInFlight).toBe(1);
          expect(c.startedWhileHeld).toBe(0);
          expect(c.lastSavedAt).not.toBeNull();
          expect(c.lastSavedAt!).toBeLessThanOrEqual(
            Math.max(REVERT_ENDS_MS, 1_000 + delayMs) + delayMs + saveMs,
          );
          report.push(
            `${String(delayMs)}\t${String(maxWaitMs)}\t${String(saveMs)}\t${String(a.writes)}\t${String(b.writes)}`,
          );
        });
      }
    }
  }

  it("reports the writes per session", () => {
    expect(report).toHaveLength(
      DELAYS_MS.length * MAX_WAITS_MS.length * SAVE_MS.length,
    );
    if (process.env["AUTOSAVE_SWEEP_REPORT"] === "1") {
      process.stdout.write(
        [
          `creator session: ${String(creator.length)} changes in 10 min; steady: 90 in 3 min`,
          "delayMs\tmaxWaitMs\tsaveMs\tcreator\tsteady",
          ...report,
          "",
        ].join("\n"),
      );
    }
  });
});

describe("autosave on random sessions (property)", () => {
  const step: fc.Arbitrary<{ gap: number; step: Omit<Step, "at"> }> = fc.record(
    {
      gap: fc.integer({ min: 0, max: 20_000 }),
      step: fc.oneof(
        fc.constant({ kind: "edit" as const }),
        fc.constant({ kind: "delete" as const }),
        fc.record({
          kind: fc.constant("type" as const),
          forMs: fc.integer({ min: 100, max: 10_000 }),
        }),
        fc.record({
          kind: fc.constant("revert" as const),
          forMs: fc.integer({ min: 100, max: 10_000 }),
        }),
      ),
    },
  );

  it("holds the three promises for any delay, max wait, save time and session", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 500, max: 10_000 }),
        fc.integer({ min: 15_000, max: 120_000 }),
        fc.integer({ min: 1, max: 6_000 }),
        fc.array(step, { minLength: 1, maxLength: 30 }),
        async (delayMs, maxWaitMs, saveMs, drawn) => {
          let at = 0;
          const steps = drawn.map(({ gap, step: s }) => {
            at += gap;
            return { ...s, at } as Step;
          });
          const outcome = await play(steps, { delayMs, maxWaitMs, saveMs });
          expect(outcome.maxInFlight).toBeLessThanOrEqual(1);
          expect(outcome.startedWhileHeld).toBe(0);
          expect(outcome.lastSaved).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });
});
