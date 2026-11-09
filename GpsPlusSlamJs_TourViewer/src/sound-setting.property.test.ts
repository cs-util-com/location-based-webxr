import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createSoundSetting, silencedFocus } from "./sound-setting.js";
import { createVoiceFocus, type Voice } from "./voice-focus.js";

describe("silencedFocus (properties)", () => {
  // Why: sound off must hold whatever path a start takes - a tap aside,
  // no voice carries on while off, a hand-over included - and sound back
  // on must never leave the channel to a voice that is not sounding.
  it("starts nothing by itself while off and leaves no silent voice running when on", () => {
    const event = fc.record({
      who: fc.integer({ min: 0, max: 2 }),
      what: fc.constantFrom(
        "tapped",
        "selfStart",
        "behind",
        "ended",
        "off",
        "on",
      ),
    });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        const setting = createSoundSetting({ storage: undefined });
        const sounding = new Set<number>();
        let carriedWhileOff = 0;
        const voices = [0, 1, 2].map((i): Voice => ({
          ...(i === 0 ? { story: true } : {}),
          hold: () => sounding.delete(i),
          carryOn: () => {
            if (!setting.on()) carriedWhileOff += 1;
            sounding.add(i);
          },
          stop: () => sounding.delete(i),
        }));
        const focus = silencedFocus(createVoiceFocus(), setting);
        for (const { who, what } of events) {
          const v = voices[who]!;
          if (what === "off" || what === "on") {
            setting.set(what === "on");
          } else if (what === "tapped") {
            focus.tapped(v);
            sounding.add(who);
          } else if (what === "selfStart") {
            if (focus.selfStart(v)) sounding.add(who);
          } else if (what === "behind") {
            if (!sounding.has(who) && focus.behind(v)) sounding.delete(who);
          } else {
            sounding.delete(who);
            focus.ended(v);
          }
          expect(carriedWhileOff).toBe(0);
          const running = focus.running();
          const silentRunning =
            setting.on() &&
            running !== null &&
            !sounding.has(voices.indexOf(running));
          expect(silentRunning).toBe(false);
        }
      }),
    );
  });
});
