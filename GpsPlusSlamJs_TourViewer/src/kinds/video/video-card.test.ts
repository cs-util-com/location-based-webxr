/**
 * Why these tests matter: the card is where the visitor plays, pauses and
 * switches the sound (the 3D bar is drawn for show only), so its words
 * must say what the video is doing, its buttons must reach the part, a
 * screen reader must hear the sound switch's state, and a porthole's clip
 * must come and go with the card.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

import { videoCard, type VideoControls } from "./video-card.js";

function controls(over: Partial<VideoControls> = {}) {
  const state = { playing: false, sound: false, time: 0, line: null };
  const c: VideoControls = {
    toggle: vi.fn(() => {
      state.playing = !state.playing;
    }),
    toggleSound: vi.fn(() => {
      state.sound = !state.sound;
    }),
    playing: () => state.playing,
    sound: () => state.sound,
    timeMs: () => state.time,
    durationMs: () => 12_000,
    line: () => state.line,
    ...over,
  };
  return { c, state };
}

const q = (host: HTMLElement, s: string) =>
  host.querySelector<HTMLElement>(s) as HTMLElement;

describe("a free video's card", () => {
  it("says its state and plays or pauses on its button", () => {
    const host = document.createElement("div");
    const { c } = controls();
    videoCard(host, { title: "Welcome" }, c);
    expect(
      q(host, '[data-testid="video-card"]').getAttribute("aria-label"),
    ).toBe("Video: Welcome");
    expect(q(host, ".narration-card-state").textContent).toBe("Ready");
    q(host, ".narration-card-play").click();
    expect(c.toggle).toHaveBeenCalledTimes(1);
    expect(q(host, ".narration-card-state").textContent).toBe("Playing");
    expect(q(host, ".narration-card-play").textContent).toBe("Pause");
  });

  it("offers a replay once watched", () => {
    const host = document.createElement("div");
    const { c, state } = controls();
    state.time = 12_000;
    videoCard(host, {}, c);
    expect(q(host, ".narration-card-state").textContent).toBe(
      "Watched. Play again?",
    );
    expect(q(host, ".narration-card-play").textContent).toBe("Play again");
  });

  it("switches the sound and says its state to a screen reader", () => {
    const host = document.createElement("div");
    const { c } = controls();
    videoCard(host, {}, c);
    const sound = q(host, ".video-card-sound");
    expect(sound.textContent).toBe("Tap for sound");
    expect(sound.getAttribute("aria-pressed")).toBe("false");
    sound.click();
    expect(c.toggleSound).toHaveBeenCalledTimes(1);
    expect(sound.textContent).toBe("Sound on");
    expect(sound.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a hint or a note only while there is one", () => {
    const host = document.createElement("div");
    let line: string | null = null;
    const card = videoCard(host, {}, controls({ line: () => line }).c);
    const p = q(host, ".narration-card-line");
    expect(p.hidden).toBe(true);
    line = "Walk closer to start · 4 m";
    card.render();
    expect(p.hidden).toBe(false);
    expect(p.textContent).toBe("Walk closer to start · 4 m");
  });

  it("holds a porthole's clip until closed, and lets it go with the card", () => {
    const host = document.createElement("div");
    const clip = document.createElement("video");
    const onClose = vi.fn();
    const card = videoCard(host, {}, controls().c, { element: clip, onClose });
    expect(q(host, ".video-card-player").contains(clip)).toBe(true);
    q(host, ".video-card-close").click();
    expect(onClose).toHaveBeenCalledTimes(1);
    card.dispose();
    expect(clip.isConnected).toBe(false);
    expect(host.children).toHaveLength(0);
  });
});
