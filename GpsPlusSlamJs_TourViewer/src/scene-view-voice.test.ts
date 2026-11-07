/**
 * Why this test matters: a story's clip plays through the page's `<video>`,
 * not the sound channel, so the voice channel hears of it only through the
 * view. A clip that starts must take the channel, a re-play after a hold
 * must not be swallowed by the step's own "already playing" guard, and
 * leaving the step must give the channel back, or a paused free voice would
 * never carry on.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it, vi } from "vitest";

import { createSceneView, type SceneViewDom } from "./scene-view.js";
import { stationContent, storyOf } from "./test-support/station-content.js";
import {
  createVoiceFocus,
  focusedSceneAudio,
  storyVideoVoice,
  type Voice,
} from "./voice-focus.js";

function element() {
  return { hidden: true, textContent: "", src: "", alt: "" };
}

function harness() {
  const video = {
    ...element(),
    poster: "",
    onended: null as (() => void) | null,
    onplay: null as (() => void) | null,
    onerror: null,
    pause: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  const dom = {
    panel: element(),
    title: element(),
    description: element(),
    speaker: element(),
    text: element(),
    status: element(),
    image: element(),
    stationImage: element(),
    video,
    choices: { replaceChildren: vi.fn() },
    continueButton: element(),
    playNext: element(),
  } as unknown as SceneViewDom;
  const videoVoice = { started: vi.fn(), ended: vi.fn() };
  const view = createSceneView({
    dom,
    assets: new Map([
      ["clip", { id: "clip", path: "clip.mp4", kind: "video" }],
    ]) as never,
    loadAsset: () => Promise.resolve(new Blob(["x"])),
    audio: { play: () => Promise.resolve(), stop: () => undefined },
    stage: {
      showCharacter: () => Promise.resolve(),
      showModel: () => Promise.resolve(),
      clear: () => undefined,
    },
    checkPicture: () => Promise.resolve(null),
    createChoiceButton: () => ({}) as Node,
    schedule: () => () => undefined,
    objectUrls: { create: () => "blob:x", revoke: () => undefined },
    onStoryEnd: () => undefined,
    videoVoice,
  });
  return { view, video, videoVoice };
}

const STATION = {
  id: "s",
  ...stationContent([
    storyOf("film", [
      {
        id: "clip-step",
        kind: "video",
        view: "card",
        video: "clip",
        transcript: "The gate opens at dawn.",
        pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      },
    ]),
  ]),
} as unknown as TourStation;

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a story's clip in the voice channel", () => {
  it("takes the channel each time it starts, and gives it back with the step", async () => {
    const { view, video, videoVoice } = harness();
    view.offer(STATION);
    await settle();
    videoVoice.ended.mockClear();
    video.onplay?.();
    video.onplay?.();
    expect(videoVoice.started).toHaveBeenCalledTimes(2);
    video.onended?.();
    expect(videoVoice.ended).toHaveBeenCalledTimes(1);
    view.continueTapped();
    expect(videoVoice.ended.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives the channel back when the clip cannot play", async () => {
    const { view, video, videoVoice } = harness();
    view.offer(STATION);
    await settle();
    videoVoice.ended.mockClear();
    (video as unknown as { onerror: () => void }).onerror();
    expect(videoVoice.ended).toHaveBeenCalledTimes(1);
  });
});

/** A story in the real voice channel, wired as the stations wire it. */
function channelHarness(step: Record<string, unknown>) {
  const focus = createVoiceFocus();
  const timers: { run(): void; ms: number; live: boolean }[] = [];
  const dom = {
    panel: element(),
    title: element(),
    description: element(),
    speaker: element(),
    text: element(),
    status: element(),
    image: element(),
    stationImage: element(),
    video: {
      ...element(),
      poster: "",
      paused: false,
      onended: null,
      onplay: null,
      onerror: null,
      pause() {
        this.paused = true;
      },
      play() {
        this.paused = false;
        return Promise.resolve();
      },
      removeAttribute: vi.fn(),
      load: vi.fn(),
    },
    choices: { replaceChildren: vi.fn() },
    continueButton: element(),
    playNext: element(),
  } as unknown as SceneViewDom;
  const calls: string[] = [];
  const sound = {
    play: () => {
      calls.push("play");
      return Promise.resolve();
    },
    stop: () => calls.push("stop"),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    durationMs: () => 2000,
    leftMs: () => 1500,
  };
  const voices: unknown[][] = [];
  const held = (hold: boolean): void => {
    view.holdVoice(hold);
  };
  const view = createSceneView({
    dom,
    assets: new Map([
      ["clip", { id: "clip", path: "clip.mp4", kind: "video" }],
      ["knight", { id: "knight", path: "knight.png", kind: "image" }],
      ["voice", { id: "voice", path: "voice.mp3", kind: "audio" }],
    ]) as never,
    loadAsset: () => Promise.resolve(new Blob(["x"])),
    audio: focusedSceneAudio(sound, focus, held),
    videoVoice: storyVideoVoice(dom.video, focus, held),
    stage: {
      showCharacter: () => Promise.resolve(),
      showModel: () => Promise.resolve(),
      clear: () => undefined,
      setVoice: (...args: unknown[]) => voices.push(args),
    },
    checkPicture: () => Promise.resolve(null),
    createChoiceButton: () => ({}) as Node,
    schedule: (run: () => void, ms: number) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    objectUrls: { create: () => "blob:x", revoke: () => undefined },
    onStoryEnd: () => undefined,
  });
  const free: Voice = {
    hold: () => calls.push("free holds"),
    carryOn: () => calls.push("free carries on"),
    stop: () => calls.push("free stops"),
  };
  const story = {
    id: "s",
    ...stationContent([
      storyOf("told", [
        {
          ...step,
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        } as never,
        {
          id: "after",
          kind: "shortText",
          view: "card",
          caption: "Later",
          pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        },
      ]),
    ]),
  } as unknown as TourStation;
  return {
    view,
    dom,
    focus,
    free,
    calls,
    voices,
    story,
    live: () => timers.filter((t) => t.live),
  };
}

const KNIGHT = {
  id: "k",
  kind: "character",
  name: "Sir Kay",
  image: "knight",
  caption: "Welcome, traveller.",
  voice: "voice",
};

describe("a story's voice held in the channel", () => {
  // Why: the rule is that the story does not advance while its clip is
  // held. Nothing told the step's timer, so an auto step went on under a
  // free voice and its own voice was lost for good.
  it("stops an auto step's timer until its voice carries on", async () => {
    const t = channelHarness({
      ...KNIGHT,
      view: "stage",
      advance: { mode: "auto", afterS: 4 },
    });
    t.view.offer(t.story);
    await settle();
    expect(t.live().map((timer) => timer.ms)).toEqual([4000]);
    t.focus.tapped(t.free);
    expect(t.live()).toEqual([]);
    expect(t.view.progress()?.autoMs).toBeNull();
    t.focus.ended(t.free);
    expect(t.live().map((timer) => timer.ms)).toEqual([4000]);
    expect(t.calls).toContain("resume");
  });

  // Why: the same rule for the other kind of clip, which plays through the
  // page's video element and not the sound channel.
  it("stops an auto step's timer while its video is held", async () => {
    const t = channelHarness({
      id: "film",
      kind: "video",
      view: "card",
      video: "clip",
      transcript: "The gate opens at dawn.",
      advance: { mode: "auto", afterS: 4 },
    });
    t.view.offer(t.story);
    await settle();
    (t.dom.video as unknown as { onplay: () => void }).onplay();
    expect(t.live()).toHaveLength(1);
    t.focus.tapped(t.free);
    expect(t.live()).toEqual([]);
    t.focus.ended(t.free);
    expect(t.live()).toHaveLength(1);
  });

  // Why: the hold is the channel's and the step's walk-away hold is the
  // guide's: neither may lift the other.
  it("keeps the timer off until both holds are gone", async () => {
    const t = channelHarness({
      ...KNIGHT,
      view: "stage",
      advance: { mode: "auto", afterS: 4 },
    });
    t.view.offer(t.story);
    await settle();
    t.focus.tapped(t.free);
    t.view.holdStep(true);
    t.view.holdStep(false);
    expect(t.live()).toEqual([]);
    t.view.holdStep(true);
    t.focus.ended(t.free);
    expect(t.live()).toEqual([]);
    t.view.holdStep(false);
    expect(t.live()).toHaveLength(1);
  });

  // Why: a tap on a figure whose voice the channel holds is an active tap
  // on that voice: it continues it. It used to stop the voice.
  it("a tap on a held figure continues his voice and holds the other", async () => {
    const t = channelHarness({
      ...KNIGHT,
      view: "speak",
      advance: { mode: "tap" },
    });
    t.view.offer(t.story);
    await settle();
    expect(t.view.characterTapped()).toBe(true);
    await settle();
    t.focus.tapped(t.free);
    t.calls.length = 0;
    expect(t.view.characterTapped()).toBe(true);
    expect(t.calls).toEqual(["free holds", "resume"]);
    t.calls.length = 0;
    expect(t.view.characterTapped()).toBe(true);
    expect(t.calls).toContain("stop");
    expect(t.calls).toContain("free carries on");
  });

  // Why: "speaking" means he is heard. Held, he is silent, and his look
  // must say so until his voice is back.
  it("his look goes quiet while held and speaks again with what is left", async () => {
    const t = channelHarness({
      ...KNIGHT,
      view: "speak",
      advance: { mode: "tap" },
    });
    t.view.offer(t.story);
    await settle();
    t.view.characterTapped();
    await settle();
    expect(t.voices.at(-1)).toEqual(["speaking", 2000]);
    t.focus.tapped(t.free);
    expect(t.voices.at(-1)).toEqual(["idle"]);
    t.focus.ended(t.free);
    expect(t.voices.at(-1)).toEqual(["speaking", 1500]);
  });

  // Why: moving on from a held step is the visitor's own tap; the next
  // step must not inherit the hold and wait for good.
  it("does not carry the hold into the next step", async () => {
    const t = channelHarness({
      ...KNIGHT,
      view: "stage",
      advance: { mode: "tap" },
    });
    const next = {
      ...t.story,
      ...stationContent([
        storyOf("told", [
          {
            ...KNIGHT,
            view: "stage",
            advance: { mode: "tap" },
            pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          } as never,
          {
            id: "after",
            kind: "shortText",
            view: "card",
            caption: "Later",
            advance: { mode: "auto", afterS: 3 },
            pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
          } as never,
        ]),
      ]),
    };
    t.view.offer(next);
    await settle();
    t.focus.tapped(t.free);
    t.view.continueTapped();
    await settle();
    expect(t.live().map((timer) => timer.ms)).toEqual([3000]);
  });
});
