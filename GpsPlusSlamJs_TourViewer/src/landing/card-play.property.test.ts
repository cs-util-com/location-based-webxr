/**
 * The card controller under any order of scrolls, taps, "Show again"s,
 * film starts and waits.
 *
 * Why these properties matter: the example tests pin each rule alone, but
 * the page sees them interleaved (a tap during a settle delay, a scroll
 * while the film starts, a "Show again" on a paused card). Whatever the
 * order: at most one picture moves at a time; a picture's pause follows
 * the reader's own taps and nothing else; while the film plays, or under
 * reduced motion, nothing moves that the reader did not ask for; a picture
 * moving by itself is one enough in view; and the renderer hears only real
 * changes.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { manualTimer } from "../test-support/manual-timer.js";
import { createCardPlay, START_SHARE, type CardState } from "./card-play.js";

const DURATIONS = [2000, 2600, 3300, 2600, 2600];

type Op =
  | { kind: "seen"; index: number; share: number }
  | { kind: "tap"; index: number }
  | { kind: "again"; index: number }
  | { kind: "block"; on: boolean }
  | { kind: "wait"; ms: number };

const index = fc.integer({ min: 0, max: DURATIONS.length - 1 });
const op: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant("seen" as const),
      index,
      share: fc.oneof(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(0, START_SHARE, 1),
      ),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({ kind: fc.constant("tap" as const), index }),
    weight: 1,
  },
  {
    arbitrary: fc.record({ kind: fc.constant("again" as const), index }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant("block" as const),
      on: fc.boolean(),
    }),
    weight: 1,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant("wait" as const),
      ms: fc.integer({ min: 0, max: 7000 }),
    }),
    weight: 3,
  },
);

const moving = (s: CardState): boolean => s.phase !== "still" && !s.paused;

describe("createCardPlay - properties", () => {
  it("keeps every rule under any sequence of inputs (property)", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(op, { maxLength: 60 }),
        (reducedMotion, ops) => {
          const timer = manualTimer();
          const last: CardState[] = DURATIONS.map(() => ({
            phase: "still",
            paused: false,
            run: 0,
          }));
          const play = createCardPlay({
            durationsMs: DURATIONS,
            reducedMotion,
            timer,
            render: (i, state) => {
              // Only real changes reach the renderer.
              expect(state).not.toEqual(last[i]);
              last[i] = state;
            },
          });
          const paused = DURATIONS.map(() => false);
          const shares = DURATIONS.map(() => 0);
          let blocked = false;
          /** The card of the last "Show again" and when it was pressed. */
          let asked: { index: number; at: number } | null = null;

          for (const step of ops) {
            switch (step.kind) {
              case "seen":
                shares[step.index] = step.share;
                play.seen(step.index, step.share);
                break;
              case "tap":
                paused[step.index] = !paused[step.index];
                if (asked?.index === step.index) asked = null;
                play.tap(step.index);
                break;
              case "again":
                paused[step.index] = false;
                asked = { index: step.index, at: timer.now() };
                play.showAgain(step.index);
                break;
              case "block":
                blocked = step.on;
                play.setBlocked(step.on);
                break;
              case "wait":
                timer.advance(step.ms);
                break;
            }
            const states = DURATIONS.map((_, i) => play.state(i));
            expect(states.filter(moving).length).toBeLessThanOrEqual(1);
            states.forEach((state, i) => {
              expect(state.paused, `card ${String(i)}'s pause`).toBe(paused[i]);
              if (!moving(state)) return;
              // A run the reader asked for may move whatever else holds;
              // it lasts at most its own duration (and, once its leader
              // rule lets it, keeps looping as an ordinary card).
              const askedRun =
                asked?.index === i &&
                timer.now() - asked.at <= (DURATIONS[i] ?? 0);
              if (askedRun) return;
              expect(reducedMotion, `card ${String(i)} moves by itself`).toBe(
                false,
              );
              expect(blocked, `card ${String(i)} moves over the film`).toBe(
                false,
              );
              expect(shares[i]).toBeGreaterThanOrEqual(START_SHARE - 0.001);
            });
          }
          play.destroy();
          expect(timer.pending()).toBe(0);
        },
      ),
    );
  });
});
