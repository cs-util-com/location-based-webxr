/**
 * Why this property matters: the film's states are driven by many hands
 * at once (the scroll, taps, the button, jumps, AR starting, frames), in
 * any order. Over generated sequences of all of them: a frame is pending
 * exactly while the film plays and never more than one, the position
 * stays inside the film, finished means at the end, and a user's pause is
 * only ever ended by the user.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createFilmPlayer } from "./film-player.js";
import { createTimeline } from "./film-timeline.js";

const TL = createTimeline(
  [
    { durS: 1, views: [{ atS: 0, view: "a" }] },
    { durS: 1.5, views: [{ atS: 0, view: "b" }] },
    { durS: 0.5, views: [{ atS: 0, view: "a" }] },
  ],
  { speed: 1.5, holdS: 0.3, camS: 0.4, settleS: 0.1 },
);

type Action =
  | { kind: "share"; v: number }
  | { kind: "tap" }
  | { kind: "toggle" }
  | { kind: "jump"; beat: number }
  | { kind: "release" }
  | { kind: "frame"; ms: number }
  | { kind: "redraw" };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant("share" as const),
    v: fc.double({ min: -0.2, max: 1.2 }),
  }),
  fc.constant({ kind: "tap" as const }),
  fc.constant({ kind: "toggle" as const }),
  fc.record({
    kind: fc.constant("jump" as const),
    beat: fc.integer({ min: 0, max: 2 }),
  }),
  fc.constant({ kind: "release" as const }),
  fc.record({
    kind: fc.constant("frame" as const),
    ms: fc.integer({ min: 0, max: 400 }),
  }),
  fc.constant({ kind: "redraw" as const }),
);

describe("film player: properties over generated sequences", () => {
  it("keeps frames, position and pauses consistent", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(actionArb, { maxLength: 80 }),
        (reducedMotion, actions) => {
          const pending = new Map<number, (now: number) => void>();
          let id = 0;
          let now = 0;
          const player = createFilmPlayer({
            timeline: TL,
            reducedMotion,
            startShare: 0.5,
            leaveShare: 0.1,
            requestFrame: (cb) => {
              pending.set(++id, cb);
              return id;
            },
            cancelFrame: (i) => {
              pending.delete(i);
            },
            render: () => undefined,
            onChange: () => undefined,
          });
          for (const a of actions) {
            const before = player.snapshot();
            const userAct =
              a.kind === "tap" || a.kind === "toggle" || a.kind === "jump";
            switch (a.kind) {
              case "share":
                player.setViewShare(a.v);
                break;
              case "tap":
                player.tap();
                break;
              case "toggle":
                player.toggle();
                break;
              case "jump":
                player.jumpTo(a.beat);
                break;
              case "release":
                player.release();
                break;
              case "redraw":
                player.redraw();
                break;
              case "frame": {
                now += a.ms;
                const first = [...pending.entries()][0];
                if (first) {
                  pending.delete(first[0]);
                  first[1](now);
                }
                break;
              }
            }
            const s = player.snapshot();
            expect(pending.size).toBe(s.status === "playing" ? 1 : 0);
            expect(s.t).toBeGreaterThanOrEqual(0);
            expect(s.t).toBeLessThanOrEqual(TL.totalS);
            // finished means at the end; playing means not yet there
            expect(s.status !== "finished" || s.t === TL.totalS).toBe(true);
            expect(s.status !== "playing" || s.t < TL.totalS).toBe(true);
            expect(s.pausedBy !== null).toBe(s.status === "paused");
            // a user pause holds until the user acts
            expect(
              before.pausedBy !== "user" || userAct || s.pausedBy === "user",
            ).toBe(true);
          }
        },
      ),
    );
  });
});
