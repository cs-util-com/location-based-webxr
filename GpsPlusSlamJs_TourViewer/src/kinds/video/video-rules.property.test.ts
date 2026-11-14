import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  videoStep,
  videoThere,
  VIDEO_MARGIN_M,
  type VideoEvent,
  type VideoState,
} from "./video-rules.js";

const EVENTS: readonly VideoEvent[] = [
  "start",
  "leave",
  "return",
  "tap",
  "ended",
];

/** A player that does what the rule says, to check the rule's actions
 *  against what a real one would be doing. */
function run(events: readonly VideoEvent[]): {
  states: VideoState[];
  playing: boolean;
  startsFromZero: number;
} {
  let state: VideoState = "waiting";
  let playing = false;
  let startsFromZero = 0;
  const states: VideoState[] = [state];
  for (const event of events) {
    // The player only ends while it plays.
    if (event === "ended" && !playing) continue;
    const step = videoStep(state, event);
    if (step.action === "play" || step.action === "replay") {
      startsFromZero++;
      playing = true;
    }
    if (step.action === "resume") playing = true;
    if (step.action === "pause") playing = false;
    if (event === "ended") playing = false;
    state = step.state;
    states.push(state);
  }
  return { states, playing, startsFromZero };
}

describe("the playing rule over any sequence", () => {
  // Why: whatever the visitor does, the rule's state must say what the
  // player is doing - "playing" exactly when it plays - or a video would
  // run on behind a paused look, or a resume would start a stopped one.
  it("says playing exactly when the player plays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...EVENTS), { maxLength: 40 }),
        (events) => {
          const { states, playing } = run(events);
          expect(states.at(-1) === "playing").toBe(playing);
        },
      ),
      { numRuns: 500 },
    );
  });

  // Why: only the visitor's tap may play a finished video again; its
  // trigger, a leave or a return never does.
  it("plays from the start again only after a tap on a finished video", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...EVENTS), { maxLength: 40 }),
        (events) => {
          let state: VideoState = "waiting";
          const wrong: string[] = [];
          for (const event of events) {
            const step = videoStep(state, event);
            if (
              step.action === "replay" &&
              (state !== "finished" || event !== "tap")
            ) {
              wrong.push(`replay from ${state} on ${event}`);
            }
            if (
              state === "finished" &&
              event !== "tap" &&
              step.state !== "finished"
            ) {
              wrong.push(`left finished on ${event}`);
            }
            state = step.state;
          }
          expect(wrong).toEqual([]);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("whether the visitor is there, over any walk", () => {
  // Why: the margin must hold for every reach, so a visitor's noisy steps
  // inside it never flip the video; swept over the format's whole range of
  // distances (1 to 20 m) and the station's reach.
  it("never flips while the distance stays inside the margin band", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 25, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 1,
          maxLength: 30,
        }),
        (reachM, band) => {
          // Start there, then walk anywhere within reach .. reach + margin.
          let there = true;
          for (const f of band) {
            there = videoThere(reachM + f * VIDEO_MARGIN_M, reachM, there);
            expect(there).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
