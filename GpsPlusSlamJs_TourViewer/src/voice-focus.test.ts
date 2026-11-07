import { describe, expect, it } from "vitest";

import {
  createVoiceFocus,
  focusedPlayer,
  focusedSceneAudio,
  storyVideoVoice,
  type Voice,
} from "./voice-focus.js";
import type { NarrationPlayer } from "./narration-player.js";

/** A voice that logs what the focus does to it, as it would sound. */
function voice(name: string, log: string[], story = false): Voice {
  return {
    ...(story ? { story: true } : {}),
    hold: () => log.push(`${name} holds`),
    carryOn: () => log.push(`${name} carries on`),
    stop: () => log.push(`${name} stops`),
  };
}

function player(): NarrationPlayer & { readonly calls: string[] } {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  let wanted = false;
  let at = 0;
  return {
    calls: [],
    nowMs: () => at,
    durationMs: () => 1000,
    playing: () => wanted,
    play() {
      this.calls.push("play");
      wanted = true;
      notify();
    },
    pause() {
      this.calls.push("pause");
      wanted = false;
      notify();
    },
    seek(ms) {
      at = ms;
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      this.calls.push("dispose");
      listeners.clear();
    },
  };
}

describe("createVoiceFocus", () => {
  // Why: the owner's rule in one line - the active tap wins, what it paused
  // carries on afterwards, and nothing queues.
  it("a tap pauses the voice running, and that voice carries on when the tapped one ends", () => {
    const log: string[] = [];
    const focus = createVoiceFocus();
    const a = voice("a", log);
    const b = voice("b", log);
    focus.tapped(a);
    focus.tapped(b);
    expect(log).toEqual(["a holds"]);
    expect(focus.running()).toBe(b);
    focus.ended(b);
    expect(log).toEqual(["a holds", "a carries on"]);
    expect(focus.running()).toBe(a);
  });

  // Why: "remembered paused voices: one". A third tap replaces the second
  // voice, and the first is still what comes back.
  it("a tap during a tapped voice replaces it and keeps the first one paused", () => {
    const log: string[] = [];
    const focus = createVoiceFocus();
    const [a, b, c] = ["a", "b", "c"].map((n) => voice(n, log));
    focus.tapped(a!);
    focus.tapped(b!);
    focus.tapped(c!);
    expect(log).toEqual(["a holds", "b stops"]);
    focus.ended(c!);
    expect(log.at(-1)).toBe("a carries on");
  });

  // Why: a story's voice is never lost to a tap, only paused: its step
  // waits for its end, so a stopped one would hang the story.
  it("never stops a story's voice: the free one paused gives way instead", () => {
    const log: string[] = [];
    const focus = createVoiceFocus();
    const free = voice("free", log);
    const story = voice("story", log, true);
    const other = voice("other", log);
    focus.tapped(free);
    focus.tapped(story);
    focus.tapped(other);
    expect(log).toEqual(["free holds", "free stops", "story holds"]);
    focus.ended(other);
    expect(log.at(-1)).toBe("story carries on");
  });

  // Why: no waiting line and no muted start. A voice that would start by
  // itself finds another one running and simply does not start.
  it("a self start happens only while nothing runs", () => {
    const log: string[] = [];
    const focus = createVoiceFocus();
    const a = voice("a", log);
    const b = voice("b", log);
    expect(focus.selfStart(a)).toBe(true);
    expect(focus.selfStart(b)).toBe(false);
    expect(focus.running()).toBe(a);
    focus.ended(a);
    expect(focus.running()).toBeNull();
    expect(log).toEqual([]);
  });

  it("a paused voice that ends is dropped, and a tap on it takes it back", () => {
    const log: string[] = [];
    const focus = createVoiceFocus();
    const [a, b] = ["a", "b"].map((n) => voice(n, log));
    focus.tapped(a!);
    focus.tapped(b!);
    focus.ended(a!);
    focus.ended(b!);
    expect(focus.running()).toBeNull();
    expect(log).toEqual(["a holds"]);

    focus.tapped(a!);
    focus.tapped(b!);
    focus.tapped(a!);
    expect(focus.running()).toBe(a);
    focus.ended(a!);
    expect(log.at(-1)).toBe("b carries on");
  });
});

describe("focusedPlayer", () => {
  // Why: a voice the focus paused is still wanted: it comes back by itself
  // and reads as wanted when the visitor walks off meanwhile.
  it("a voice paused by a tap carries on when the tapped one ends", () => {
    const focus = createVoiceFocus();
    const innerA = player();
    const innerB = player();
    const a = focusedPlayer(innerA, focus);
    const b = focusedPlayer(innerB, focus);
    a.play();
    b.play();
    expect(innerA.playing()).toBe(false);
    expect(a.playing()).toBe(false);
    expect(a.wanted()).toBe(true);
    b.pause();
    expect(innerA.playing()).toBe(true);
    expect(a.wanted()).toBe(true);
    expect(b.wanted()).toBe(false);
  });

  // Why: the end of the file reaches the player, not the page: it is the
  // player's own change that must hand the sound back.
  it("a voice that runs out hands the sound back", () => {
    const focus = createVoiceFocus();
    const innerA = player();
    const innerB = player();
    const a = focusedPlayer(innerA, focus);
    const b = focusedPlayer(innerB, focus);
    a.play();
    b.play();
    innerB.pause();
    expect(innerA.playing()).toBe(true);
    expect(focus.running()).not.toBeNull();
    a.pause();
    expect(focus.running()).toBeNull();
  });

  it("carryOn plays only while nothing runs, and stays tappable otherwise", () => {
    const focus = createVoiceFocus();
    const innerA = player();
    const innerB = player();
    const a = focusedPlayer(innerA, focus);
    const b = focusedPlayer(innerB, focus);
    a.play();
    expect(b.carryOn()).toBe(false);
    expect(innerB.playing()).toBe(false);
    a.pause();
    expect(b.carryOn()).toBe(true);
    expect(innerB.playing()).toBe(true);
  });

  // Why: "a stopped free sound stays off until tapped": it starts from its
  // beginning on the next tap, and nothing it paused is left waiting.
  it("stopping a voice rewinds it and gives the sound back", () => {
    const focus = createVoiceFocus();
    const innerA = player();
    const innerB = player();
    const a = focusedPlayer(innerA, focus);
    const b = focusedPlayer(innerB, focus);
    a.play();
    b.play();
    innerB.seek(500);
    b.stop();
    expect(innerB.nowMs()).toBe(0);
    expect(innerA.playing()).toBe(true);
  });

  it("a disposed player leaves the focus", () => {
    const focus = createVoiceFocus();
    const inner = player();
    const a = focusedPlayer(inner, focus);
    a.play();
    a.dispose();
    expect(focus.running()).toBeNull();
    expect(inner.calls).toContain("dispose");
  });
});

describe("focusedSceneAudio", () => {
  function sceneAudio() {
    const calls: string[] = [];
    let ended: (() => void) | null = null;
    let refuse = false;
    return {
      calls,
      refuse: () => {
        refuse = true;
      },
      finish: () => ended?.(),
      unlock: () => calls.push("unlock"),
      play(_blob: Blob, onEnded: () => void): Promise<void> {
        calls.push("play");
        ended = onEnded;
        return refuse ? Promise.reject(new Error("no")) : Promise.resolve();
      },
      stop: () => calls.push("stop"),
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
      durationMs: () => 5,
    };
  }

  // Why: the story's step waits for this clip's end, so a free voice tapped
  // over it pauses it instead of stopping it, and it carries on after.
  it("a free voice tapped over a story's clip pauses it, and it carries on", async () => {
    const focus = createVoiceFocus();
    const inner = sceneAudio();
    const audio = focusedSceneAudio(inner, focus);
    let ended = 0;
    await audio.play(new Blob(), () => (ended += 1));
    const free = focusedPlayer(player(), focus);
    free.play();
    expect(inner.calls).toEqual(["play", "pause"]);
    free.pause();
    expect(inner.calls).toEqual(["play", "pause", "resume"]);
    inner.finish();
    expect(ended).toBe(1);
    expect(focus.running()).toBeNull();
  });

  it("a story's clip starting pauses a free voice, which carries on after it", async () => {
    const focus = createVoiceFocus();
    const inner = sceneAudio();
    const audio = focusedSceneAudio(inner, focus);
    const free = player();
    focusedPlayer(free, focus).play();
    await audio.play(new Blob(), () => undefined);
    expect(free.playing()).toBe(false);
    inner.finish();
    expect(free.playing()).toBe(true);
  });

  it("a stopped or refused clip gives the sound back", async () => {
    const focus = createVoiceFocus();
    const inner = sceneAudio();
    const audio = focusedSceneAudio(inner, focus);
    await audio.play(new Blob(), () => undefined);
    audio.stop();
    expect(focus.running()).toBeNull();
    inner.refuse();
    await expect(audio.play(new Blob(), () => undefined)).rejects.toThrow("no");
    expect(focus.running()).toBeNull();
  });
});

describe("storyVideoVoice", () => {
  function video(paused = false, muted = false) {
    const calls: string[] = [];
    return {
      calls,
      paused,
      muted,
      pause() {
        calls.push("pause");
        this.paused = true;
      },
      play() {
        calls.push("play");
        this.paused = false;
        return Promise.resolve();
      },
    };
  }

  // Why: a story's clip is a voice like any other: a free voice tapped
  // over it pauses it, and it carries on.
  it("a free voice tapped over a story's video pauses it, and it carries on", () => {
    const focus = createVoiceFocus();
    const clip = video();
    const voiced = storyVideoVoice(clip, focus);
    voiced.started();
    const free = focusedPlayer(player(), focus);
    free.play();
    expect(clip.calls).toEqual(["pause"]);
    free.pause();
    expect(clip.calls).toEqual(["pause", "play"]);
    // The element's own play event, from that carry-on: nothing changes.
    voiced.started();
    expect(clip.calls).toEqual(["pause", "play"]);
    voiced.ended();
    expect(focus.running()).toBeNull();
  });

  // Why: a video the visitor paused himself must not start on its own when
  // a free voice ends; and a muted clip makes no sound to clash with.
  it("leaves a clip the visitor paused alone, and a muted one out of the focus", () => {
    const focus = createVoiceFocus();
    const clip = video();
    const voiced = storyVideoVoice(clip, focus);
    voiced.started();
    clip.paused = true;
    const free = focusedPlayer(player(), focus);
    free.play();
    free.pause();
    expect(clip.calls).toEqual(["pause"]);

    const quiet = createVoiceFocus();
    storyVideoVoice(video(false, true), quiet).started();
    expect(quiet.running()).toBeNull();
  });
});
