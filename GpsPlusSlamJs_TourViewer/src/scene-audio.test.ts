import { describe, expect, it, vi } from "vitest";

import { createSceneAudio, silentWav } from "./scene-audio";

/**
 * Why these tests matter: a phone plays sound only from an element that
 * played inside a tap. The stories start minutes after "Start the tour",
 * with no tap of their own, so the ONE element unlocked by that tap must be
 * the one every clip plays through - a fresh element per clip would be
 * silent on the walk. A clip must also stop the previous one (one story at
 * a time) and give its memory back.
 */

/** The fake element: what the module drives, plus what the test reads. */
interface FakeElement {
  src: string;
  onended: (() => void) | null;
  plays: string[];
  paused: number;
  play(): Promise<void>;
  pause(): void;
}

function harness(play: () => Promise<void> = () => Promise.resolve()) {
  const elements: FakeElement[] = [];
  const urls = { created: 0, revoked: [] as string[] };
  const audio = createSceneAudio({
    createElement: () => {
      const el = {
        src: "",
        onended: null as (() => void) | null,
        plays: [] as string[],
        paused: 0,
        play() {
          el.plays.push(el.src);
          return play();
        },
        pause() {
          el.paused += 1;
        },
      };
      elements.push(el);
      return el;
    },
    objectUrls: {
      create: () => `blob:${String(urls.created++)}`,
      revoke: (u) => {
        urls.revoked.push(u);
      },
    },
  });
  return { audio, elements, urls };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("createSceneAudio", () => {
  // Why: a free voice tapped over a story pauses the story's clip, and the
  // story's step waits for that clip's end: the clip must keep its file and
  // its end through the pause, and a phone refusing to resume must end it,
  // or the story hangs for good.
  it("pauses a clip and resumes it, and a refused resume ends it", async () => {
    let refuse = false;
    const { audio, elements, urls } = harness(() =>
      refuse ? Promise.reject(new Error("no")) : Promise.resolve(),
    );
    const ended = vi.fn();
    await audio.play(new Blob(), ended);
    audio.pause();
    expect(elements[0]!.paused).toBeGreaterThan(0);
    expect(urls.revoked).toEqual([]);
    audio.resume();
    expect(elements[0]!.plays).toHaveLength(2);
    expect(ended).not.toHaveBeenCalled();
    refuse = true;
    audio.resume();
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(urls.revoked).toHaveLength(1);
  });

  // Why: a pause while a play() is still pending makes the browser reject
  // that play() with AbortError. That is not a refusal: the clip is held and
  // must carry on later, so ending it here would end a paused story's step.
  it("a resume cut short by the next pause does not end the clip", async () => {
    let abort = (): void => undefined;
    let pending = false;
    const { audio } = harness(() =>
      pending
        ? new Promise((_, reject) => {
            abort = () => {
              reject(new DOMException("paused", "AbortError"));
            };
          })
        : Promise.resolve(),
    );
    const ended = vi.fn();
    await audio.play(new Blob(), ended);
    audio.pause();
    pending = true;
    audio.resume();
    audio.pause();
    abort();
    await settle();
    expect(ended).not.toHaveBeenCalled();
  });

  // Why: only our own pause makes a resume's AbortError harmless. Without
  // one (the browser or the system paused the element) nothing will carry
  // the clip on, so a step waiting for its end would wait until a tap: the
  // clip ends instead, as any refused resume does.
  it("a resume aborted with no pause of ours ends the clip", async () => {
    let pending = false;
    const { audio } = harness(() =>
      pending
        ? Promise.reject(new DOMException("gone", "AbortError"))
        : Promise.resolve(),
    );
    const ended = vi.fn();
    await audio.play(new Blob(), ended);
    audio.pause();
    pending = true;
    audio.resume();
    await settle();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("resumes nothing once the clip has stopped", async () => {
    const { audio, elements } = harness();
    await audio.play(new Blob(), () => undefined);
    audio.stop();
    audio.resume();
    audio.pause();
    expect(elements[0]!.plays).toHaveLength(1);
  });

  // Why: the read-along stretches to the voice's real length, which the
  // element knows only once it has read the clip's metadata: before that
  // (NaN), for a stream (Infinity) or with no element, there is none.
  it("tells the playing clip's length in ms once the element knows it", async () => {
    const h = harness();
    expect(h.audio.durationMs?.()).toBeNull();
    await h.audio.play(new Blob(["v"]), () => undefined);
    const el = h.elements[0] as FakeElement & { duration?: number };
    for (const [s, ms] of [
      [Number.NaN, null],
      [Number.POSITIVE_INFINITY, null],
      [0, null],
      [2.5, 2500],
    ] as const) {
      el.duration = s;
      expect(h.audio.durationMs?.(), String(s)).toBe(ms);
    }
  });

  // Why: a held voice's look goes back to speaking when it carries on, and
  // its speech reel must run for what is left, not for the whole clip.
  it("tells what is left of the clip, and nothing while it knows no length", async () => {
    const h = harness();
    expect(h.audio.leftMs?.()).toBeNull();
    await h.audio.play(new Blob(["v"]), () => undefined);
    const el = h.elements[0] as FakeElement & {
      duration?: number;
      currentTime?: number;
    };
    el.currentTime = 1;
    expect(h.audio.leftMs?.()).toBeNull();
    el.duration = 2.5;
    expect(h.audio.leftMs?.()).toBe(1500);
    el.currentTime = 9;
    expect(h.audio.leftMs?.()).toBe(0);
    el.currentTime = Number.NaN;
    expect(h.audio.leftMs?.()).toBeNull();
  });

  it("plays every clip through the one element the tap unlocked", async () => {
    const h = harness();
    h.audio.unlock();
    await h.audio.play(new Blob(["a"]), () => undefined);
    await h.audio.play(new Blob(["b"]), () => undefined);
    expect(h.elements).toHaveLength(1);
    expect(h.elements[0]!.plays).toEqual(["blob:0", "blob:1", "blob:2"]);
  });

  it("unlocks once, with a silent clip whose URL is released", async () => {
    const h = harness();
    h.audio.unlock();
    h.audio.unlock();
    await settle();
    expect(h.elements[0]!.plays).toHaveLength(1);
    expect(h.urls.revoked).toEqual(["blob:0"]);
  });

  it("a new clip stops the previous one and releases its URL; the end calls back once", async () => {
    const h = harness();
    const ended = vi.fn();
    await h.audio.play(new Blob(["a"]), ended);
    await h.audio.play(new Blob(["b"]), ended);
    expect(h.elements[0]!.paused).toBeGreaterThanOrEqual(2);
    expect(h.urls.revoked).toContain("blob:0");
    h.elements[0]!.onended?.();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(h.urls.revoked).toContain("blob:1");
    h.audio.stop();
    expect(h.elements[0]!.onended).toBeNull();
  });

  it("passes a refusal on, so the story can say the sound did not play", async () => {
    const h = harness(() => Promise.reject(new Error("NotAllowedError")));
    h.audio.unlock(); // a refused unlock is swallowed
    await expect(
      h.audio.play(new Blob(["a"]), () => undefined),
    ).rejects.toThrow(/NotAllowed/);
  });

  it("the silent clip is a well-formed WAV: RIFF/WAVE, PCM mono 8 kHz, one silent sample", () => {
    const wav = silentWav();
    const text = (from: number, to: number) =>
      String.fromCharCode(...wav.slice(from, to));
    const view = new DataView(wav.buffer);
    expect(text(0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(8, 16)).toBe("WAVEfmt ");
    expect([
      view.getUint16(20, true),
      view.getUint16(22, true),
      view.getUint32(24, true),
    ]).toEqual([1, 1, 8000]);
    expect(text(36, 40)).toBe("data");
    expect(view.getUint32(40, true)).toBe(wav.length - 44);
    expect(wav[44]).toBe(128);
  });
});
