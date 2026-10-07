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
