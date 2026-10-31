/**
 * Why this test matters: the voice is one file per text, possibly
 * megabytes; it must be fetched only when the visitor first presses play,
 * the button must answer at once while it is fetched, a failed fetch must
 * reach the page's error channel and put the button back, and closing the
 * tour must let the file's memory go. The sheet and the captions strip
 * share this clock, so its place must hold before the file is there too.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createNarrationPlayer,
  type NarrationAudio,
} from "./narration-player.js";

class FakeAudio implements NarrationAudio {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  preload = "";
  readonly handlers = new Map<string, (() => void)[]>();
  readonly play = vi.fn(() => {
    this.paused = false;
    this.fire("play");
    return Promise.resolve();
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly load = vi.fn();
  readonly removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
  addEventListener(type: string, l: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), l]);
  }
  fire(type: string): void {
    for (const l of this.handlers.get(type) ?? []) l();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function make(load = () => Promise.resolve(new Blob(["x"]))) {
  const audio = new FakeAudio();
  const loadSpy = vi.fn(load);
  const onError = vi.fn();
  const revoked: string[] = [];
  const player = createNarrationPlayer({
    load: loadSpy,
    durationMs: 61_000,
    onError,
    audio: () => audio,
    createUrl: () => "blob:voice",
    revokeUrl: (u) => revoked.push(u),
  });
  return { audio, player, loadSpy, onError, revoked };
}

describe("createNarrationPlayer", () => {
  it("fetches nothing until play, and answers play at once", async () => {
    const { audio, player, loadSpy } = make();
    expect(loadSpy).not.toHaveBeenCalled();
    expect(player.durationMs()).toBe(61_000);
    const changes = vi.fn();
    player.onChange(changes);
    player.play();
    expect(player.playing()).toBe(true);
    expect(changes).toHaveBeenCalled();
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("blob:voice");
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("keeps a place sought before the file is there, clamped to the voice", async () => {
    const { audio, player } = make();
    player.seek(90_000);
    expect(player.nowMs()).toBe(61_000);
    player.seek(-3);
    expect(player.nowMs()).toBe(0);
    player.seek(12_000);
    player.play();
    await flush();
    expect(audio.currentTime).toBe(12);
    audio.duration = 30;
    expect(player.durationMs()).toBe(30_000);
  });

  it("puts the button back and tells the page when the voice cannot be fetched", async () => {
    const { player, onError, loadSpy } = make(() =>
      Promise.reject(new Error("no file")),
    );
    player.play();
    await flush();
    expect(player.playing()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    // A later press tries again.
    player.play();
    await flush();
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  it("stops at the end and on pause", async () => {
    const { audio, player } = make();
    player.play();
    await flush();
    audio.fire("ended");
    expect(player.playing()).toBe(false);
    player.play();
    await flush();
    player.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(player.playing()).toBe(false);
  });

  it("lets the file go on dispose and plays no more", async () => {
    const { audio, player, revoked } = make();
    player.play();
    await flush();
    player.dispose();
    expect(revoked).toEqual(["blob:voice"]);
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    player.play();
    expect(player.playing()).toBe(false);
  });
});
