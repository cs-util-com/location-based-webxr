import { describe, expect, it } from "vitest";

import { createVoiceFocus } from "./voice-focus.js";
import {
  createWorldSound,
  SILENT_SOUND,
  type BackgroundAudio,
} from "./world-sound.js";
import type { NarrationAudio } from "./narration-player.js";

/** An audio element that plays at once and can be ended by hand. */
function fakeAudio(): NarrationAudio & BackgroundAudio & { end(): void } {
  const listeners = new Map<string, (() => void)[]>();
  const fire = (type: string) => {
    for (const fn of listeners.get(type) ?? []) fn();
  };
  const a = {
    src: "",
    currentTime: 0,
    duration: 60,
    paused: true,
    preload: "",
    loop: false,
    volume: 1,
    play() {
      a.paused = false;
      fire("play");
      return Promise.resolve();
    },
    pause() {
      a.paused = true;
      fire("pause");
    },
    addEventListener(type: string, fn: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeAttribute() {
      a.src = "";
    },
    load() {},
    end() {
      a.paused = true;
      fire("ended");
    },
  };
  return a;
}

function setup(soundOn = true) {
  const focus = createVoiceFocus();
  const made: ReturnType<typeof fakeAudio>[] = [];
  let on = soundOn;
  const sound = createWorldSound({
    focus,
    audio: () => {
      const a = fakeAudio();
      made.push(a);
      return a;
    },
    soundOn: () => on,
    createUrl: () => "blob:x",
    revokeUrl: () => undefined,
  });
  return { focus, made, sound, setOn: (v: boolean) => (on = v) };
}

const LOAD = () => Promise.resolve(new Blob(["x"]));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("a voice in the world", () => {
  it("plays on a tap, holds on leaving, carries on at return", async () => {
    // Why: the narration circle's rules, one level below the circle: the
    // place is kept and the voice channel handed back while away.
    const { focus, sound } = setup();
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    expect(voice.playing()).toBe(true);
    voice.hold();
    expect(voice.playing()).toBe(false);
    expect(voice.wanted()).toBe(true);
    expect(focus.running()).toBeNull();
    voice.carryOn();
    await flush();
    expect(voice.playing()).toBe(true);
  });

  it("paused by the visitor stays off at return", async () => {
    // Why: a stopped sound stays off until tapped.
    const { sound } = setup();
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    voice.pause();
    expect(voice.wanted()).toBe(false);
    voice.carryOn();
    await flush();
    expect(voice.playing()).toBe(false);
  });

  it("a tap on a second voice holds the first, which carries on after", async () => {
    // Why: one voice at a time, a tap wins, the paused one carries on.
    const { sound, made } = setup();
    const a = sound.sound(LOAD, "voice");
    const b = sound.sound(LOAD, "voice");
    a.play();
    await flush();
    b.play();
    await flush();
    expect(a.playing()).toBe(false);
    expect(a.wanted()).toBe(true);
    made[1]?.end();
    await flush();
    expect(a.playing()).toBe(true);
  });

  it("with sound off plays on a tap only, never on a return", async () => {
    // Why: sound off holds the voice; a tap is the visitor's own ask and
    // plays, but walking back into the circle must not start it again.
    const { sound, setOn } = setup();
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    voice.hold();
    setOn(false);
    voice.carryOn();
    await flush();
    expect(voice.playing()).toBe(false);
    voice.play();
    await flush();
    expect(voice.playing()).toBe(true);
  });
});

describe("a background sound in the world", () => {
  it("loops at the level asked, lowered under a voice, silent when sound is off", async () => {
    // Why: ambient plays by itself at its distance's loudness, glides
    // down under a narration and is silenced by the global setting.
    const { sound, made, setOn } = setup();
    const bg = sound.sound(LOAD, "background");
    bg.level(0.8, 0);
    await flush();
    const el = made[0];
    expect(el?.loop).toBe(true);
    expect(el?.paused).toBe(false);
    expect(el?.volume).toBeCloseTo(0.8);
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    bg.level(0.8, 10);
    expect(el?.volume).toBeCloseTo(0.8 * 0.3);
    setOn(false);
    bg.level(0.8, 11);
    expect(el?.volume).toBe(0);
    bg.level(0, 12);
    expect(el?.paused).toBe(true);
  });

  it("frees its element on dispose, and the silent handle does nothing", async () => {
    // Why: a station is freed as the visitor walks on; the editor's parts
    // ask the silent handle and must never sound.
    const { sound, made } = setup();
    const bg = sound.sound(LOAD, "background");
    bg.level(1, 0);
    await flush();
    bg.dispose();
    expect(made[0]?.paused).toBe(true);
    expect(made[0]?.src).toBe("");
    SILENT_SOUND.play();
    SILENT_SOUND.level(1, 0);
    expect(SILENT_SOUND.playing()).toBe(false);
  });
});
