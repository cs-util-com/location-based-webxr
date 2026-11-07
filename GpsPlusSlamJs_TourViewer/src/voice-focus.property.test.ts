import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createVoiceFocus, type Voice } from "./voice-focus.js";

describe("createVoiceFocus (properties)", () => {
  // Why: the invariant that makes "one audible" true whatever the visitor
  // taps: after any sequence, at most one voice sounds, at most one waits,
  // a stopped voice is out for good, and a story's voice is never stopped.
  it("holds one voice running and one paused through any sequence", () => {
    const event = fc.record({
      who: fc.integer({ min: 0, max: 3 }),
      what: fc.constantFrom("tapped", "selfStart", "ended"),
    });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        const sounding = new Set<number>();
        const stopped: number[] = [];
        const voices = [0, 1, 2, 3].map((i): Voice => ({
          ...(i === 0 ? { story: true } : {}),
          hold: () => sounding.delete(i),
          carryOn: () => sounding.add(i),
          stop: () => {
            sounding.delete(i);
            stopped.push(i);
          },
        }));
        const focus = createVoiceFocus();
        for (const { who, what } of events) {
          const v = voices[who]!;
          if (what === "tapped") {
            focus.tapped(v);
            sounding.add(who);
          } else if (what === "selfStart") {
            if (focus.selfStart(v)) sounding.add(who);
          } else {
            focus.ended(v);
            sounding.delete(who);
          }
          expect(sounding.size).toBeLessThanOrEqual(1);
          const running = focus.running();
          expect([...sounding]).toEqual(
            running === null ? [] : [voices.indexOf(running)],
          );
        }
        expect(stopped).not.toContain(0);
      }),
    );
  });
});
