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
    forget: () => log.push(`${name} is let go`),
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

  it("carryOn plays only while nothing runs, and waits behind what does", () => {
    const focus = createVoiceFocus();
    const innerA = player();
    const innerB = player();
    const a = focusedPlayer(innerA, focus);
    const b = focusedPlayer(innerB, focus);
    a.play();
    expect(b.carryOn()).toBe(false);
    expect(innerB.playing()).toBe(false);
    a.pause();
    expect(innerB.playing()).toBe(true);
    b.pause();
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

describe("a voice behind the running one", () => {
  // Why: there is no waiting line, but two voices can come back at once:
  // the one heard last plays and one stays held behind it, carrying on when
  // that one ends.
  it("carries on when the running one ends", () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const a = voice("a", log);
    const b = voice("b", log);
    focus.tapped(a);
    expect(focus.behind(b)).toBe(true);
    focus.ended(a);
    expect(log).toEqual(["b carries on"]);
    expect(focus.running()).toBe(b);
  });

  // Why: one place behind the running voice and no more; with nothing
  // running there is nothing to stand behind.
  it("is refused with nothing running and when the place is taken", () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const a = voice("a", log);
    const b = voice("b", log);
    const c = voice("c", log);
    expect(focus.behind(a)).toBe(false);
    focus.tapped(a);
    expect(focus.behind(a)).toBe(false);
    expect(focus.behind(b)).toBe(true);
    expect(focus.behind(c)).toBe(false);
  });

  // Why: a player that cannot play at return stands behind the one that
  // does, wanted still, so its next pause and its next tap see it held.
  it("a player's refused carryOn stands it behind the running voice", () => {
    const focus = createVoiceFocus();
    const a = player();
    const b = player();
    const first = focusedPlayer(a, focus);
    const second = focusedPlayer(b, focus);
    first.play();
    expect(second.carryOn()).toBe(false);
    expect(second.wanted()).toBe(true);
    first.pause();
    expect(b.calls).toEqual(["play"]);
    expect(second.playing()).toBe(true);
  });
});

describe("a voice set aside", () => {
  // Why: a pause nobody asked for (the page silencing a text whose words
  // nobody sees any more) must not hand the channel to a free voice held
  // behind it: that one would start by itself, with no visitor action. It
  // is let go instead, so no later voice's end wakes it either.
  it("wakes no free voice held behind it, and lets it go for good", () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const [a, b, c] = ["a", "b", "c"].map((n) => voice(n, log));
    focus.tapped(a!);
    focus.tapped(b!);
    focus.aside(b!);
    expect(log).toEqual(["a holds", "a is let go"]);
    expect(focus.running()).toBeNull();
    expect(focus.selfStart(c!)).toBe(true);
    focus.ended(c!);
    expect(log).toEqual(["a holds", "a is let go"]);
    expect(focus.running()).toBeNull();
  });

  // Why: a story's step waits for its held voice's end (its timer is off,
  // its character tap refused), so a story voice left held with nobody
  // running would freeze the story. It carries on, as the channel promises
  // for what a tap held.
  it("carries on a story's voice held behind it", () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const story = voice("story", log, true);
    const free = voice("free", log);
    focus.tapped(story);
    focus.tapped(free);
    focus.aside(free);
    expect(log).toEqual(["story holds", "story carries on"]);
    expect(focus.running()).toBe(story);
  });

  // Why: a held voice set aside is out of the channel, as one that ended:
  // it must not carry on after the running one.
  it("drops a held voice, and leaves the running one alone", () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const [a, b, c] = ["a", "b", "c"].map((n) => voice(n, log));
    focus.tapped(a!);
    focus.tapped(b!);
    focus.aside(a!);
    focus.aside(c!);
    expect(focus.running()).toBe(b);
    focus.ended(b!);
    expect(log).toEqual(["a holds"]);
    expect(focus.running()).toBeNull();
  });

  // Why: the player's own pause hands the channel on; its aside pauses
  // the sound the same way but leaves the player held behind it silent,
  // and no longer wanted: a later voice's end does not wake it, and the
  // station's leaving does not keep it to carry on at the return. A tap
  // on it goes on from where it stood.
  it("a player set aside pauses, and lets the player held behind it go", () => {
    const focus = createVoiceFocus();
    const a = player();
    const b = player();
    const held = focusedPlayer(a, focus);
    const shown = focusedPlayer(b, focus);
    held.play();
    held.seek(400);
    shown.play();
    shown.aside();
    expect(b.calls).toEqual(["play", "pause"]);
    expect(shown.playing()).toBe(false);
    expect(shown.wanted()).toBe(false);
    expect(a.calls).toEqual(["play", "pause"]);
    expect(held.playing()).toBe(false);
    expect(held.wanted()).toBe(false);
    const later = focusedPlayer(player(), focus);
    later.play();
    later.pause();
    expect(held.playing()).toBe(false);
    held.play();
    expect(held.playing()).toBe(true);
    expect(held.nowMs()).toBe(400);
  });

  // Why: the story path end to end through the wrappers. The box's play
  // tapped over a story's narrator sound holds the clip (its step waits);
  // a text switch sets the box's voice aside, and the clip must resume and
  // tell its step it is no longer held.
  it("a player set aside over a story's clip resumes the clip", async () => {
    const focus = createVoiceFocus();
    const calls: string[] = [];
    const heldStates: boolean[] = [];
    const audio = focusedSceneAudio(
      {
        unlock: () => undefined,
        play: () => {
          calls.push("play");
          return Promise.resolve();
        },
        stop: () => calls.push("stop"),
        pause: () => calls.push("pause"),
        resume: () => calls.push("resume"),
        durationMs: () => 5,
      },
      focus,
      (held) => heldStates.push(held),
    );
    await audio.play(new Blob(), () => undefined);
    const shown = focusedPlayer(player(), focus);
    shown.play();
    expect(calls).toEqual(["play", "pause"]);
    expect(heldStates.at(-1)).toBe(true);
    shown.aside();
    expect(calls).toEqual(["play", "pause", "resume"]);
    expect(heldStates.at(-1)).toBe(false);
    expect(focus.running()).not.toBeNull();
    expect(shown.running()).toBe(false);
  });
});

describe("a superseded or refused clip", () => {
  // Why: the first clip's AbortError lands tens of ms after the second
  // started; it must not end the voice object the new clip runs on, or the
  // channel reads free and a second voice plays over it.
  it("a replaced clip's refusal does not end the new clip", async () => {
    const focus = createVoiceFocus();
    const refusals: ((e: Error) => void)[] = [];
    const audio = focusedSceneAudio(
      {
        play: () =>
          new Promise((_, reject) => {
            refusals.push(reject);
          }),
        stop: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
      },
      focus,
    );
    const blob = new Blob(["x"]);
    const first = audio.play(blob, () => undefined).catch(() => "refused");
    void audio.play(blob, () => undefined).catch(() => undefined);
    refusals[0]!(new Error("AbortError"));
    await expect(first).resolves.toBe("refused");
    expect(focus.running()).not.toBeNull();
  });

  // Why: a hold pauses the clip, and a pause while its play() is pending
  // rejects that play() with AbortError. The clip is held, not refused: it
  // keeps its place and carries on when the tapped voice ends.
  it("a play cut short by a hold is no refusal", async () => {
    const focus = createVoiceFocus();
    const log: string[] = [];
    const refusals: ((e: Error) => void)[] = [];
    const audio = focusedSceneAudio(
      {
        play: () =>
          new Promise((_, reject) => {
            refusals.push(reject);
          }),
        stop: () => undefined,
        pause: () => undefined,
        resume: () => {
          log.push("resume");
        },
      },
      focus,
    );
    const played = audio.play(new Blob(["x"]), () => undefined);
    const tap = voice("tap", []);
    focus.tapped(tap);
    refusals[0]!(new DOMException("paused", "AbortError"));
    await expect(played).resolves.toBe(undefined);
    focus.ended(tap);
    expect(log).toEqual(["resume"]);
  });

  // Why: only a hold makes an AbortError harmless. Without a hold (the
  // element was torn down, a load aborted) it is a real refusal: the caller
  // hears it and the channel is given back.
  it("an AbortError with no hold still surfaces and frees the channel", async () => {
    const focus = createVoiceFocus();
    const audio = focusedSceneAudio(
      {
        play: () => Promise.reject(new DOMException("gone", "AbortError")),
        stop: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
      },
      focus,
    );
    await expect(
      audio.play(new Blob(["x"]), () => undefined),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(focus.running()).toBeNull();
  });

  // Why: a hold belongs to the clip it paused. A later clip's AbortError,
  // with no hold of its own, is still a refusal.
  it("a hold of an earlier clip does not excuse a later clip's AbortError", async () => {
    const focus = createVoiceFocus();
    const refusals: ((e: Error) => void)[] = [];
    const audio = focusedSceneAudio(
      {
        play: () =>
          new Promise((_, reject) => {
            refusals.push(reject);
          }),
        stop: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
      },
      focus,
    );
    const blob = new Blob(["x"]);
    void audio.play(blob, () => undefined);
    const tap = voice("tap", []);
    focus.tapped(tap);
    focus.ended(tap);
    const second = audio.play(blob, () => undefined);
    refusals[1]!(new DOMException("gone", "AbortError"));
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(focus.running()).toBeNull();
  });

  // Why: a phone may refuse the clip's way back; nobody hears it then, so
  // the channel must not stay taken by a silent video.
  it("a refused video gives the channel back when it should carry on", async () => {
    const focus = createVoiceFocus();
    const clip = {
      paused: false,
      muted: false,
      pause() {
        this.paused = true;
      },
      play: () => Promise.reject(new Error("NotAllowedError")),
    };
    const story = storyVideoVoice(clip, focus);
    const free = voice("free", []);
    story.started();
    focus.tapped(free);
    focus.ended(free);
    await Promise.resolve();
    await Promise.resolve();
    expect(focus.running()).toBeNull();
  });

  // Why: the same for a clip the visitor had paused: it does not come back
  // by itself, so it does not keep the channel either.
  it("a clip the visitor paused gives the channel back after the hold", () => {
    const focus = createVoiceFocus();
    const clip = {
      paused: true,
      muted: false,
      pause: () => undefined,
      play: () => Promise.resolve(),
    };
    const story = storyVideoVoice(clip, focus);
    const free = voice("free", []);
    story.started();
    focus.tapped(free);
    focus.ended(free);
    expect(focus.running()).toBeNull();
  });
});

describe("a story's clip the channel stops", () => {
  // Why: a story's sound held behind the story's video is the one held
  // voice; a free voice tapped then stops it to keep the video. Its step
  // waits for the clip's end, and a stopped clip has no end of its own, so
  // the stop must end it for the step, or a lineEnd step waits for good.
  // Both orders: the clip's play() already settled, and still pending when
  // the hold's pause cut it short (its AbortError lands after the stop).
  it.each([
    ["settled", false],
    ["pending", true],
  ])("ends for its step once, its play() %s", async (_, pending) => {
    const focus = createVoiceFocus();
    const refusals: ((e: Error) => void)[] = [];
    const calls: string[] = [];
    const audio = focusedSceneAudio(
      {
        play: () =>
          pending
            ? new Promise<void>((_, reject) => {
                refusals.push(reject);
              })
            : Promise.resolve(),
        stop: () => calls.push("stop"),
        pause: () => calls.push("pause"),
        resume: () => calls.push("resume"),
      },
      focus,
    );
    let ended = 0;
    const played = audio.play(new Blob(["x"]), () => (ended += 1));
    const clip = {
      paused: false,
      muted: false,
      pause() {
        this.paused = true;
      },
      play: () => Promise.resolve(),
    };
    storyVideoVoice(clip, focus).started();
    focus.tapped(voice("free", []));
    expect(calls).toEqual(["pause", "stop"]);
    refusals[0]?.(new DOMException("paused", "AbortError"));
    await expect(played).resolves.toBe(undefined);
    expect(ended).toBe(1);
  });
});
