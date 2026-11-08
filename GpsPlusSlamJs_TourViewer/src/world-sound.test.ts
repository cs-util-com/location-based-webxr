import { describe, expect, it } from "vitest";

import {
  createSoundSetting,
  silencedFocus,
  whileShown,
} from "./sound-setting.js";
import { createVoiceFocus } from "./voice-focus.js";
import {
  createWorldSound,
  SILENT_SOUND,
  type BackgroundAudio,
} from "./world-sound.js";
import type { NarrationAudio } from "./narration-player.js";

/** An audio element that plays at once and can be ended by hand; with
 *  `refuse` its play() is refused as an autoplay block is, and it stays
 *  paused. */
function fakeAudio(refuse = false): NarrationAudio &
  BackgroundAudio & {
    end(): void;
    plays: number;
    removed: boolean;
    loaded: number;
  } {
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
    plays: 0,
    removed: false,
    play() {
      a.plays += 1;
      if (refuse) {
        return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      }
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
    removeAttribute(name: string) {
      if (name === "src") a.removed = true;
    },
    loaded: 0,
    load() {
      a.loaded += 1;
    },
    end() {
      a.paused = true;
      fire("ended");
    },
  };
  return a;
}

/** A page the sound can be hidden from: its document and its window. */
function fakePage() {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const win = new EventTarget();
  return {
    doc,
    win,
    hide() {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

/** The page's wiring: the real setting over the real focus, as main.ts
 *  makes them, behind a page that can be hidden. */
function setup(options: { soundOn?: boolean; refuse?: boolean } = {}) {
  const setting = createSoundSetting({ storage: undefined });
  if (options.soundOn === false) setting.set(false);
  const page = fakePage();
  const audible = whileShown(setting, page.doc, page.win);
  const focus = silencedFocus(createVoiceFocus(), audible);
  const made: ReturnType<typeof fakeAudio>[] = [];
  const errors: unknown[] = [];
  const sound = createWorldSound({
    focus,
    audio: () => {
      const a = fakeAudio(options.refuse === true);
      made.push(a);
      return a;
    },
    sound: audible,
    turnSoundOn: () => {
      setting.set(true);
    },
    onError: (e) => errors.push(e),
    createUrl: () => "blob:x",
    revokeUrl: () => undefined,
  });
  return {
    focus,
    made,
    sound,
    page,
    errors,
    setOn: (v: boolean) => {
      setting.set(v);
    },
    isOn: () => setting.on(),
  };
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

  it("a tap that plays with sound off turns the sound on", async () => {
    // Why: the page's sound button shows the setting. A tap plays the
    // voice even with sound off, so leaving the setting off would have the
    // button say "Sound off" while a voice is heard.
    const { sound, isOn } = setup({ soundOn: false });
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    expect(voice.playing()).toBe(true);
    expect(isOn()).toBe(true);
    // A pause is no ask for sound: turned off again, it stays off.
    const { sound: quiet, isOn: quietOn, setOn } = setup();
    const other = quiet.sound(LOAD, "voice");
    setOn(false);
    other.pause();
    other.hold();
    other.carryOn();
    expect(quietOn()).toBe(false);
  });
});

describe("a voice's clock", () => {
  it("tells where it is and how long it is, and seeks; the silent one says 0", async () => {
    // Why: the narration card shows the time and scrubs through the voice
    // by these three alone.
    const { sound, made } = setup();
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    made[0]!.currentTime = 12;
    expect(voice.timeMs()).toBe(12_000);
    expect(voice.durationMs()).toBe(60_000);
    voice.seek(30_000);
    expect(made[0]?.currentTime).toBe(30);
    const quiet = sound.sound(LOAD, "background");
    expect([quiet.timeMs(), quiet.durationMs()]).toEqual([0, 0]);
  });
});

describe("a background sound in the world", () => {
  it("loops at the level asked, lowered under a voice, paused when sound is off", async () => {
    // Why: ambient plays by itself at its distance's loudness, glides
    // down under a narration and is silenced by the global setting. Off
    // pauses it at once: sound off plays nothing, not a file at volume 0.
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
    expect(el?.paused).toBe(true);
    bg.level(0.8, 11);
    expect(el?.paused).toBe(true);
    setOn(true);
    bg.level(0.8, 12);
    expect(el?.paused).toBe(false);
    bg.level(0, 13);
    expect(el?.paused).toBe(true);
  });

  it("with sound off is neither read nor played until sound is on", async () => {
    // Why: sound off must not load a file and play it silently; the file
    // is read the first time it may be heard.
    const { sound, made, setOn } = setup({ soundOn: false });
    const bg = sound.sound(LOAD, "background");
    bg.level(0.8, 0);
    await flush();
    expect(made).toHaveLength(0);
    setOn(true);
    bg.level(0.8, 1);
    await flush();
    expect(made[0]?.paused).toBe(false);
  });

  it("a refused play is reported once, not each frame, and tried again after a return", async () => {
    // Why: level() runs every frame; a refused play (an autoplay block, a
    // file the browser cannot decode) left the element paused, so each
    // frame retried it and toasted and announced the error again.
    const { sound, made, errors } = setup({ refuse: true });
    const bg = sound.sound(LOAD, "background");
    bg.level(0.8, 0);
    await flush();
    for (let i = 1; i <= 5; i += 1) {
      bg.level(0.8, i);
      await flush();
    }
    expect(made[0]?.plays).toBe(1);
    expect(errors).toHaveLength(1);
    bg.level(0, 6);
    bg.level(0.8, 7);
    await flush();
    expect(made[0]?.plays).toBe(2);
    expect(errors).toHaveLength(2);
  });

  it("frees its element on dispose, and the silent handle does nothing", async () => {
    // Why: a station is freed as the visitor walks on; the editor's parts
    // ask the silent handle and must never sound. The source is removed
    // and the element reloaded, so the browser lets the file go (an empty
    // src would be read as this page's address).
    const { sound, made } = setup();
    const bg = sound.sound(LOAD, "background");
    bg.level(1, 0);
    await flush();
    bg.dispose();
    expect(made[0]?.paused).toBe(true);
    expect(made[0]?.removed).toBe(true);
    expect(made[0]?.loaded).toBe(1);
    SILENT_SOUND.play();
    SILENT_SOUND.level(1, 0);
    expect(SILENT_SOUND.playing()).toBe(false);
  });
});

describe("the world's sounds under the page's sound setting", () => {
  it("a voice queued behind the silenced one stays quiet when that one is freed", async () => {
    // Why: sound off holds the running voice; the voice waiting behind it
    // must not play aloud when the held one leaves or is freed - the
    // hand-over is a start the setting does not allow. Real voices, real
    // hand-over: nothing calls the focus by hand.
    const { sound, setOn, focus } = setup();
    const b = sound.sound(LOAD, "voice");
    const a = sound.sound(LOAD, "voice");
    b.play();
    await flush();
    a.play();
    await flush();
    expect(b.playing()).toBe(false);
    setOn(false);
    expect(a.playing()).toBe(false);
    a.dispose();
    await flush();
    expect(b.playing()).toBe(false);
    setOn(true);
    await flush();
    expect(b.playing()).toBe(true);
    expect(focus.running()).not.toBeNull();
  });

  it("off and on again carries the silenced voice on and frees the channel at its end", async () => {
    // Why: off then on left the held voice as the running one for good:
    // nothing started by itself until a tap and an ambient sound stayed
    // lowered under a voice nobody heard.
    const { sound, made, setOn, focus } = setup();
    const a = sound.sound(LOAD, "voice");
    const bg = sound.sound(LOAD, "background");
    a.play();
    await flush();
    setOn(false);
    expect(a.playing()).toBe(false);
    setOn(true);
    await flush();
    expect(a.playing()).toBe(true);
    made[0]?.end();
    await flush();
    expect(focus.running()).toBeNull();
    bg.level(1, 0);
    await flush();
    expect(made[1]?.volume).toBeCloseTo(1);
  });

  it("pauses everything while the page is hidden and follows the rules at return", async () => {
    // Why: a hidden page runs no frames, so nothing would pause a sound
    // left playing; the walk must fall silent with the page. Back on the
    // page, ambient plays by its level again and the voice it held
    // carries on, as sound back on does.
    const { sound, made, page } = setup();
    const bg = sound.sound(LOAD, "background");
    bg.level(0.5, 0);
    await flush();
    const voice = sound.sound(LOAD, "voice");
    voice.play();
    await flush();
    page.hide();
    expect(made[0]?.paused).toBe(true);
    expect(voice.playing()).toBe(false);
    page.show();
    await flush();
    expect(made[0]?.paused).toBe(false);
    expect(voice.playing()).toBe(true);
    page.win.dispatchEvent(new Event("pagehide"));
    expect(made[0]?.paused).toBe(true);
    expect(voice.playing()).toBe(false);
    page.win.dispatchEvent(new Event("pageshow"));
    await flush();
    expect(voice.playing()).toBe(true);
  });
});
