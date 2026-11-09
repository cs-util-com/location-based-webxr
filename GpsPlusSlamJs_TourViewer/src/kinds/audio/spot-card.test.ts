// @vitest-environment jsdom
/**
 * Why these tests matter: a narration circle's player card is how the
 * visitor plays, pauses and follows the voice. It must open only inside
 * the circle (the same change `onInside` reports) and close on leaving,
 * its button must follow the circle's tap rule, and the editor - which
 * builds the same part, still and silent - must never open one.
 */
import { type BufferGeometry, Mesh, Points } from "three";
import { describe, expect, it } from "vitest";

import {
  audioBlock,
  recordingEnv,
} from "../../test-support/audio-world-env.js";
import { screenIn } from "../../world-part.js";
import { spotPart } from "./spot.js";

const at = (x: number, seconds = 0) => ({
  seconds,
  viewer: [x, 1.5, 0] as const,
});

function circleWithScreen(mode: "play" | "edit" = "play") {
  const host = document.createElement("div");
  const { env, sounds } = recordingEnv(mode);
  const part = spotPart(
    audioBlock("spot", {
      radiusM: 6,
      title: "The column",
      transcript: "One. Two.",
    }),
    { ...env, screen: screenIn(host) },
  );
  const card = () => host.querySelector("[data-testid=narration-card]");
  return { host, part, sounds, card };
}

describe("a narration circle's card", () => {
  it("opens inside the circle and closes on leaving, as onInside says", () => {
    const { part, card } = circleWithScreen();
    const heard: boolean[] = [];
    part.onInside((inside) => heard.push(inside));
    part.update?.(at(10));
    expect(card()).toBeNull();
    part.update?.(at(2));
    expect(card()?.getAttribute("aria-label")).toBe("Narration: The column");
    part.update?.(at(20));
    expect(card()).toBeNull();
    expect(heard).toEqual([true, false]);
  });

  it("plays and pauses the voice from its button, as a tap does", () => {
    const { host, part, sounds } = circleWithScreen();
    part.update?.(at(0));
    host.querySelector("button")?.click();
    expect(sounds[0]?.channel).toBe("voice");
    expect(sounds[0]?.calls).toEqual(["play"]);
    part.update?.(at(0, 1));
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Pause",
    );
    host.querySelector("button")?.click();
    expect(sounds[0]?.calls).toEqual(["play", "pause"]);
  });

  it("plays a heard narration again from its start", () => {
    const { host, part, sounds } = circleWithScreen();
    part.update?.(at(0));
    host.querySelector("button")?.click();
    const voice = sounds[0]!;
    voice.calls.length = 0;
    voice.pause();
    voice.calls.length = 0;
    voice.time = voice.duration;
    host.querySelector("button")?.click();
    expect(voice.calls).toEqual(["seek:0", "play"]);
  });

  // Why: one screen shows one card at a time, so a second circle that
  // overlaps the first takes the screen. Leaving the second while still
  // standing in the first must bring the first one's card back: its
  // circle reports no new change, so nothing else would reopen it.
  it("shows the first circle's card again after leaving an overlapping one", () => {
    const host = document.createElement("div");
    const screen = screenIn(host);
    const circle = (title: string, x: number) => {
      const { env } = recordingEnv("play");
      const part = spotPart(audioBlock("spot", { radiusM: 6, title }), {
        ...env,
        screen,
      });
      part.object.position.x = x;
      return part;
    };
    const a = circle("A", 0);
    const b = circle("B", 8);
    const walk = (x: number) => {
      a.update?.(at(x));
      b.update?.(at(x));
    };
    const shown = () =>
      [...host.querySelectorAll("[data-testid=narration-card]")].map((c) =>
        c.getAttribute("aria-label"),
      );
    walk(-1);
    expect(shown()).toEqual(["Narration: A"]);
    walk(4);
    expect(shown()).toEqual(["Narration: B"]);
    walk(-1);
    expect(shown()).toEqual(["Narration: A"]);
    // And again, both ways, then out of both.
    walk(4);
    expect(shown()).toEqual(["Narration: B"]);
    walk(12);
    expect(shown()).toEqual(["Narration: B"]);
    walk(30);
    expect(shown()).toEqual([]);
    a.dispose();
    b.dispose();
  });

  // Why: closing this circle's card builds the panel it pushed aside again.
  // A throw from that rebuild belongs to the other panel; it must not
  // escape the close and skip the rest of this part's dispose, or the
  // voice keeps its element and file and the circle its geometry. It is
  // told once, through the screen's error channel.
  it("frees its voice and look even when the panel it pushed aside fails to rebuild", () => {
    const host = document.createElement("div");
    const errors: unknown[] = [];
    const screen = screenIn(host, { onError: (e) => errors.push(e) });
    let builds = 0;
    screen.show(() => {
      builds += 1;
      if (builds > 1) throw new Error("no rebuild");
      return () => undefined;
    });
    const { env, sounds } = recordingEnv("play");
    const part = spotPart(audioBlock("spot", { radiusM: 6 }), {
      ...env,
      screen,
    });
    part.update?.(at(0));
    part.tap?.();
    expect(host.querySelector("[data-testid=narration-card]")).not.toBeNull();
    let geometriesFreed = 0;
    part.object.traverse((o) => {
      if (o instanceof Mesh || o instanceof Points) {
        (o.geometry as BufferGeometry).addEventListener(
          "dispose",
          () => (geometriesFreed += 1),
        );
      }
    });
    expect(() => part.dispose()).not.toThrow();
    expect(sounds[0]?.calls.at(-1)).toBe("dispose");
    expect(geometriesFreed).toBeGreaterThan(0);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("no rebuild");
    expect(host.childElementCount).toBe(0);
  });

  it("goes with the part, and never opens in the editor", () => {
    const playing = circleWithScreen();
    playing.part.update?.(at(0));
    playing.part.dispose();
    expect(playing.card()).toBeNull();
    const editing = circleWithScreen("edit");
    editing.part.update?.(at(0));
    expect(editing.card()).toBeNull();
  });
});
