import { describe, expect, it } from "vitest";

import {
  audioBlock,
  recordingEnv,
} from "../../test-support/audio-world-env.js";
import { NARRATION_MARGIN_M } from "./sound-reach.js";
import { spotPart } from "./spot.js";

const at = (x: number, seconds = 0) => ({
  seconds,
  viewer: [x, 1.5, 0] as const,
});

function circle(radiusM = 6) {
  const { env, sounds } = recordingEnv();
  const part = spotPart(audioBlock("spot", { radiusM }), env);
  const voice = () => sounds[0];
  return { part, voice, sounds };
}

describe("a narration circle in the world", () => {
  it("plays only on a tap inside its circle, through the voice channel", () => {
    // Why: a narration is never started by walking in; a tap from outside
    // the circle would play a voice whose player is closed.
    const { part, voice } = circle();
    expect(part.tapTarget).toBeDefined();
    part.update?.(at(10));
    part.tap?.();
    expect(voice()?.calls ?? []).not.toContain("play");
    part.update?.(at(3, 1));
    expect(voice()?.calls ?? []).not.toContain("play");
    part.tap?.();
    expect(voice()?.channel).toBe("voice");
    expect(voice()?.calls).toEqual(["play"]);
  });

  it("pauses on leaving beyond the margin and carries on at return", () => {
    // Why: the circle's rule; the margin keeps the edge from flickering.
    const { part, voice } = circle(6);
    part.update?.(at(0));
    part.tap?.();
    part.update?.(at(6 + NARRATION_MARGIN_M - 0.1, 1));
    expect(voice()?.calls).toEqual(["play"]);
    part.update?.(at(6 + NARRATION_MARGIN_M + 0.1, 2));
    expect(voice()?.calls).toEqual(["play", "hold"]);
    part.update?.(at(6.5, 3));
    expect(voice()?.calls).toEqual(["play", "hold"]);
    part.update?.(at(5.9, 4));
    expect(voice()?.calls).toEqual(["play", "hold", "carryOn"]);
  });

  it("a second tap is the visitor's pause: it stays off until tapped again", () => {
    // Why: once stopped it stays off; walking out and back does not
    // restart it.
    const { part, voice } = circle();
    part.update?.(at(0));
    part.tap?.();
    part.tap?.();
    expect(voice()?.calls).toEqual(["play", "pause"]);
    expect(voice()?.wanted()).toBe(false);
    part.update?.(at(20, 1));
    part.update?.(at(0, 2));
    expect(voice()?.playing()).toBe(false);
    part.tap?.();
    expect(voice()?.calls).toEqual([
      "play",
      "pause",
      "hold",
      "carryOn",
      "play",
    ]);
  });

  it("says when the visitor is inside, for its look and its card", () => {
    // Why: the player card opens only inside the circle; the look may mark
    // it. Both read this one state.
    const { part } = circle();
    const seen: boolean[] = [];
    const off = part.onInside?.((inside) => seen.push(inside));
    part.update?.(at(0));
    part.update?.(at(20, 1));
    off?.();
    part.update?.(at(0, 2));
    expect(seen).toEqual([true, false]);
  });

  it("in the editor stands still and silent", () => {
    // Why: the same object in the editor, never a sound.
    const { env, sounds } = recordingEnv("edit");
    const part = spotPart(audioBlock("spot", { radiusM: 6 }), env);
    part.update?.(at(0));
    part.tap?.();
    expect(sounds).toHaveLength(0);
    part.dispose();
  });

  it("frees its voice and its look", () => {
    const { part, voice } = circle();
    part.update?.(at(0));
    part.tap?.();
    part.dispose();
    expect(voice()?.calls.at(-1)).toBe("dispose");
  });
});
