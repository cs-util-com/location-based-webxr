/**
 * Why these tests matter: a free video's behaviour in the world is the
 * creator's start rule, the visitor's sound choice and the leave / return
 * / replay rule, all driven by frames. These drive the part with a fake
 * player and a recorded screen and hold each path the brief names: every
 * trigger, a sound start that waits for the page to be touched, a start
 * the browser refuses (rejected and silent), the remembered choice, a
 * pause on leaving and a resume on return, a finished video replayed by a
 * tap, the porthole's large clip, and a silent editor.
 */
import type { TourVideoBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Texture } from "three";
import { describe, expect, it } from "vitest";

import {
  loadVisitorPrefs,
  saveVisitorPrefs,
  type PrefsStorage,
} from "../../visitor-prefs.js";
import type { WorldEnv, WorldMode } from "../../world-part.js";
import {
  VIDEO_AWAY_M,
  VIDEO_LOOK_DWELL_S,
  withVideoSound,
} from "./video-rules.js";
import {
  SOUND_REFUSED_NOTE,
  videoWorld,
  type ClipPlayer,
  type VideoDeps,
} from "./video-world.js";

/** A `<video>` that does what it is told, and says what it was told. */
class FakePlayer implements ClipPlayer {
  src = "";
  muted = true;
  currentTime = 0;
  paused = true;
  duration = 20;
  videoWidth = 1280;
  videoHeight = 720;
  calls: string[] = [];
  /** What the next `play()` does: start, or reject as a browser that
   *  refuses sound does. */
  refuse: "never" | "sound" | "always" = "never";
  private readonly listeners = new Map<string, (() => void)[]>();
  play(): Promise<void> {
    this.calls.push(this.muted ? "play muted" : "play sound");
    if (this.refuse === "always" || (this.refuse === "sound" && !this.muted)) {
      return Promise.reject(new Error("NotAllowedError"));
    }
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.calls.push("pause");
    this.paused = true;
  }
  load(): void {
    if (this.src !== "") queueMicrotask(() => this.fire("loadedmetadata"));
  }
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l();
  }
  end(): void {
    this.currentTime = this.duration;
    this.paused = true;
    this.fire("ended");
  }
}

function memoryStorage(): PrefsStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

interface Setup {
  readonly block?: Partial<TourVideoBlock>;
  readonly mode?: WorldMode;
  readonly activated?: boolean;
  readonly storage?: PrefsStorage;
  readonly refuse?: FakePlayer["refuse"];
}

async function video(setup: Setup = {}) {
  const player = new FakePlayer();
  player.refuse = setup.refuse ?? "never";
  const storage = setup.storage ?? memoryStorage();
  const shown: { host: HTMLElement | null; open: number } = {
    host: null,
    open: 0,
  };
  const env: WorldEnv = {
    mode: setup.mode ?? "play",
    loadAsset: () => Promise.resolve(new Blob(["clip"])),
    canvasTexture: () => {
      throw new Error("no canvas in node");
    },
    loadModel: () => Promise.reject(new Error("no model here")),
    enableClipping: () => undefined,
    sound: () => {
      throw new Error("a video plays its own sound");
    },
    screen: {
      show: () => {
        shown.open++;
        return () => {
          shown.open--;
        };
      },
    },
  };
  const deps: VideoDeps = {
    makePlayer: () => player,
    clipTexture: () => new Texture(),
    posterTexture: () => Promise.resolve(null),
    url: () => "blob:clip",
    revoke: () => undefined,
    activated: () => setup.activated ?? true,
    storage: () => storage,
    element: () => null,
  };
  const block = {
    id: "v",
    kind: "video",
    view: "screen",
    video: "clip",
    widthM: 1.6,
    ...setup.block,
  } as TourVideoBlock;
  const part = videoWorld(block, env, deps);
  if (part === null) throw new Error("no part");
  await part.ready;
  return { part, player, shown, storage };
}

/** A frame with the viewer `x` m east of the video, looking along
 *  `facing`. */
const at = (
  x: number,
  seconds: number,
  facing?: readonly [number, number, number],
) => ({
  seconds,
  viewer: [x, 0, 0] as const,
  ...(facing === undefined ? {} : { facing }),
});

/** Lets a rejected `play()` reach its catch. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a free video's part", () => {
  it("stands nothing for a story's card or a video with no width", () => {
    const env = {} as WorldEnv;
    const card = { kind: "video", view: "card", video: "c" } as TourVideoBlock;
    expect(videoWorld(card, env)).toBeNull();
    const noWidth = { ...card, view: "screen" } as TourVideoBlock;
    expect(videoWorld(noWidth, env)).toBeNull();
  });

  it("starts on arrival once the visitor is there, muted by default", async () => {
    const { part, player, shown } = await video();
    part.update?.(at(VIDEO_AWAY_M + 10, 0));
    expect(player.calls).toEqual([]);
    expect(shown.open).toBe(0);
    part.update?.(at(VIDEO_AWAY_M - 1, 1));
    expect(player.calls).toEqual(["play muted"]);
    expect(shown.open).toBe(1);
  });

  it("starts within its own distance, not before", async () => {
    const { part, player } = await video({
      block: { start: "near", withinM: 4 },
    });
    part.update?.(at(5, 0));
    expect(player.calls).toEqual([]);
    part.update?.(at(3.9, 1));
    expect(player.calls).toEqual(["play muted"]);
  });

  it("starts once looked at long enough, and not by a glance", async () => {
    // The video stands at the origin; the viewer at x = 3 looks back
    // along -x to see it, along +z away from it.
    const { part, player } = await video({ block: { start: "look" } });
    const toward = [-1, 0, 0] as const;
    const away = [0, 0, 1] as const;
    part.update?.(at(3, 0, toward));
    part.update?.(at(3, VIDEO_LOOK_DWELL_S / 2, toward));
    part.update?.(at(3, VIDEO_LOOK_DWELL_S, away));
    expect(player.calls).toEqual([]);
    part.update?.(at(3, VIDEO_LOOK_DWELL_S + 0.1, toward));
    part.update?.(at(3, 2 * VIDEO_LOOK_DWELL_S + 0.2, toward));
    expect(player.calls).toEqual(["play muted"]);
  });

  it("waits for a tap when the creator says so", async () => {
    const { part, player } = await video({ block: { start: "tap" } });
    part.update?.(at(1, 0));
    part.update?.(at(1, 5));
    expect(player.calls).toEqual([]);
    part.tap?.();
    expect(player.calls).toEqual(["play muted"]);
  });

  it("starts with sound when the creator says so and the page was touched", async () => {
    const { part, player } = await video({ block: { sound: "on" } });
    part.update?.(at(1, 0));
    expect(player.calls).toEqual(["play sound"]);
  });

  it("starts muted before the page is touched, and the first tap turns the sound on", async () => {
    // Why: a browser refuses sound before a touch; the tap that is the
    // touch must give the sound rather than pause the video.
    const { part, player } = await video({
      block: { sound: "on" },
      activated: false,
    });
    part.update?.(at(1, 0));
    expect(player.calls).toEqual(["play muted"]);
    part.tap?.();
    expect(player.muted).toBe(false);
    expect(player.calls).toEqual(["play muted"]);
  });

  it("mutes and says so when the browser refuses a start with sound", async () => {
    const { part, player } = await video({
      block: { sound: "on" },
      refuse: "sound",
    });
    part.update?.(at(1, 0));
    await settle();
    expect(player.calls).toEqual(["play sound", "play muted"]);
    expect(player.muted).toBe(true);
    expect(SOUND_REFUSED_NOTE).toMatch(/kept the sound off/);
  });

  it("follows the visitor's remembered choice over the creator's", async () => {
    // Why: the visitor chose sound for every video; this one's creator
    // said off, and the visitor wins.
    const storage = memoryStorage();
    saveVisitorPrefs(storage, withVideoSound(loadVisitorPrefs(storage), "on"));
    const second = await video({ storage, block: { sound: "off" } });
    second.part.update?.(at(1, 0));
    expect(second.player.calls).toEqual(["play sound"]);
  });

  it("pauses on leaving beyond the margin and resumes on coming back", async () => {
    const { part, player, shown } = await video({
      block: { start: "near", withinM: 4 },
    });
    part.update?.(at(1, 0));
    part.update?.(at(5.5, 1));
    expect(player.calls).toEqual(["play muted"]);
    part.update?.(at(6.5, 2));
    expect(player.calls).toEqual(["play muted", "pause"]);
    expect(shown.open).toBe(0);
    part.update?.(at(3, 3));
    expect(player.calls).toEqual(["play muted", "pause", "play muted"]);
    expect(player.currentTime).toBe(0);
  });

  it("stays finished after its end, and a tap plays it from the start", async () => {
    const { part, player } = await video();
    part.update?.(at(1, 0));
    player.currentTime = 12;
    player.end();
    part.update?.(at(VIDEO_AWAY_M + 10, 1));
    part.update?.(at(1, 2));
    expect(player.calls).toEqual(["play muted"]);
    part.tap?.();
    expect(player.currentTime).toBe(0);
    expect(player.calls).toEqual(["play muted", "play muted"]);
  });

  it("opens a porthole's clip large on a tap, and plays it", async () => {
    const { part, player, shown } = await video({
      block: { view: "porthole", start: "tap" },
    });
    part.update?.(at(1, 0));
    expect(shown.open).toBe(1);
    part.tap?.();
    expect(shown.open).toBe(1);
    expect(player.calls).toEqual(["play muted"]);
    // A second tap on a playing porthole does not pause it behind the card.
    part.tap?.();
    expect(player.calls).toEqual(["play muted"]);
  });

  it("stays still and silent in the editor", async () => {
    const { part, player, shown } = await video({ mode: "edit" });
    part.update?.(at(1, 0));
    part.update?.(at(1, 5));
    part.tap?.();
    expect(player.calls).toEqual([]);
    expect(shown.open).toBe(0);
  });

  it("turns a posed cutout by where the viewer stands relative to it", async () => {
    // Why: the frame gives the viewer in the part's parent frame, and the
    // look turns in its own; a cutout posed away from the origin with the
    // viewer straight in front of it must not turn to its limit.
    const { part } = await video({ block: { view: "cutout" } });
    part.object.position.set(10, 0, 0);
    for (let s = 0; s < 20; s++) {
      part.update?.({ seconds: s, viewer: [10, 1.5, 6] });
    }
    let most = 0;
    part.object.traverse((c) => {
      most = Math.max(most, Math.abs(c.rotation.y));
    });
    expect(most).toBeLessThan(1e-6);
  });

  it("lets its file go on dispose", async () => {
    const { part, player, shown } = await video();
    part.update?.(at(1, 0));
    part.dispose();
    expect(player.src).toBe("");
    expect(player.paused).toBe(true);
    expect(shown.open).toBe(0);
  });
});
