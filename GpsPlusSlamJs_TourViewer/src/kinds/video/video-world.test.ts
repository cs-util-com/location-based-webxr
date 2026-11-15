/**
 * Why these tests matter: a free video's behaviour in the world is the
 * creator's start rule, the visitor's sound choice and the leave / return
 * / replay rule, all driven by frames. These drive the part with a fake
 * player and a recorded screen and hold each path the brief names: every
 * trigger, a sound start that waits for the page to be touched, a start
 * the browser refuses (rejected and silent), the remembered choice, a
 * pause on leaving and a resume on return, a finished video replayed by a
 * tap, the porthole's large clip, a loop, the captions strip, and a
 * silent editor.
 *
 * @vitest-environment jsdom
 */
import type { TourVideoBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Texture, Vector3, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";

import {
  loadVisitorPrefs,
  saveVisitorPrefs,
  type PrefsStorage,
} from "../../visitor-prefs.js";
import { drawAtExtent, drawInherited } from "../../placement/place-scale.js";
import type { WorldEnv, WorldMode, WorldPart } from "../../world-part.js";
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
  loop = false;
  currentTime = 0;
  paused = true;
  duration = 20;
  videoWidth = 1280;
  videoHeight = 720;
  calls: string[] = [];
  /** What the next `play()` does: start, or reject as a browser that
   *  refuses sound does. */
  refuse: "never" | "sound" | "always" | "hang" = "never";
  private readonly listeners = new Map<string, (() => void)[]>();
  play(): Promise<void> {
    this.calls.push(this.muted ? "play muted" : "play sound");
    // A clip still loading: the promise neither settles nor plays yet.
    if (this.refuse === "hang") return new Promise<void>(() => undefined);
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
  /** Done to the part before its clip's size is known. */
  readonly beforeReady?: (part: WorldPart) => void;
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
      // The card is drawn into a fresh host, kept for the test to read.
      show: (draw) => {
        shown.open++;
        const host = document.createElement("div");
        shown.host = host;
        const close = draw(host);
        return () => {
          shown.open--;
          close();
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
  setup.beforeReady?.(part);
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

  it("stops counting as playing when the browser refuses even a muted start, and a tap tries again", async () => {
    // Why: a refused muted play() used to leave the part "playing" while
    // nothing played - the card said Pause over a still frame and a tap
    // paused nothing. A refusal with no sound to drop is a stop the
    // visitor is told about, and his tap is the next try.
    const { part, player } = await video({ refuse: "always" });
    part.update?.(at(1, 0));
    await settle();
    part.update?.(at(1, 3));
    expect(player.calls).toEqual(["play muted"]);
    player.refuse = "never";
    part.tap?.();
    expect(player.calls).toEqual(["play muted", "play muted"]);
    expect(player.paused).toBe(false);
  });

  it("leaves a muted start that is only slow to load counted as playing", async () => {
    // Why: the one-second check is for a start with sound; a muted clip
    // still loading after a second must not be taken for a refusal, or it
    // would start playing later behind a card that says it is paused.
    const { part, player } = await video({ refuse: "hang" });
    part.update?.(at(1, 0));
    part.update?.(at(1, 3));
    await settle();
    part.tap?.();
    expect(player.calls).toEqual(["play muted", "pause"]);
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

  // Why: a loop is the creator's, and the element's own loop is what
  // plays it again without a gap or an "ended" that would finish it.
  it("loops on the player itself when the creator says so", async () => {
    expect((await video()).player.loop).toBe(false);
    expect((await video({ block: { loop: "on" } })).player.loop).toBe(true);
  });

  // Why: the strip is how a muted start is followed; it must show the cue
  // at the clip's time, go with the CC switch, and not be offered for a
  // video without readable captions.
  it("shows its captions at the clip's time, switched by CC", async () => {
    const captions = "WEBVTT\n\n00:01.000 --> 00:03.000\nThe gate";
    const { part, player, shown } = await video({ block: { captions } });
    part.update?.(at(1, 0));
    const host = shown.host as HTMLElement;
    const strip = host.querySelector<HTMLElement>(".video-card-caption");
    expect(strip?.hidden).toBe(true);
    player.currentTime = 2;
    part.update?.(at(1, 1));
    expect(strip?.textContent).toBe("The gate");
    host.querySelector<HTMLElement>(".video-card-cc")?.click();
    expect(strip?.hidden).toBe(true);
    for (const none of [undefined, "no header"]) {
      const plain = await video(
        none === undefined ? {} : { block: { captions: none } },
      );
      plain.part.update?.(at(1, 0));
      expect(plain.shown.host?.querySelector(".video-card-cc")).toBeNull();
    }
  });

  // Why: a visitor who turned captions off (or on) for one video wants
  // the same for every video of every tour, as with the sound switch; a
  // page whose storage is missing or throws still switches this one.
  it("remembers the CC choice for every video, and still switches without storage", async () => {
    const captions = "WEBVTT\n\n00:01.000 --> 00:03.000\nThe gate";
    const lineOf = (host: HTMLElement) =>
      host.querySelector(".narration-card-line")?.textContent;
    const storage = memoryStorage();
    const first = await video({ storage, block: { captions } });
    first.part.update?.(at(1, 0));
    const firstHost = first.shown.host as HTMLElement;
    firstHost.querySelector<HTMLElement>(".video-card-cc")?.click();
    expect(lineOf(firstHost)).toBe("Captions off for every video");
    expect(loadVisitorPrefs(storage)).toEqual({ videoCaptions: "off" });
    const second = await video({ storage, block: { captions } });
    second.part.update?.(at(1, 0));
    second.player.currentTime = 2;
    second.part.update?.(at(1, 1));
    const host = second.shown.host as HTMLElement;
    const cc = host.querySelector<HTMLElement>(".video-card-cc");
    expect(cc?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector<HTMLElement>(".video-card-caption")?.hidden).toBe(
      true,
    );
    const broken: PrefsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const lone = await video({ storage: broken, block: { captions } });
    lone.part.update?.(at(1, 0));
    const loneHost = lone.shown.host as HTMLElement;
    const loneCc = loneHost.querySelector<HTMLElement>(".video-card-cc");
    expect(loneCc?.getAttribute("aria-pressed")).toBe("true");
    loneCc?.click();
    expect(loneCc?.getAttribute("aria-pressed")).toBe("false");
    expect(lineOf(loneHost)).toBe("Captions off");
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

/** The world heights of `part`'s ground shadows (the meshes lying flat). */
function shadowHeights(object: Object3D): number[] {
  object.updateMatrixWorld(true);
  const heights: number[] = [];
  object.traverse((o) => {
    if ((o as Mesh).isMesh && Math.abs(o.rotation.x + Math.PI / 2) < 1e-9) {
      heights.push(o.getWorldPosition(new Vector3()).y);
    }
  });
  return heights;
}

/** What of `object`'s shadows is off the station's ground (none: all
 *  on it). A shadow sits 0.012 above its ground in the look's own
 *  (reference) metres, so in the world that gap is 0.012 times
 *  everything the look is drawn larger by (`drawnScale`). The 1e-6 is float noise: every misplacement seen so
 *  far was a metre or more, and a fixed tolerance instead (0.05 was used)
 *  fails a correct ground above a drawn scale of about 4.2. */
function offGround(object: Object3D, drawnScale: number): string[] {
  const heights = shadowHeights(object);
  if (heights.length === 0) return ["no shadow drawn"];
  const want = 0.012 * drawnScale;
  return heights
    .filter((y) => Math.abs(y - want) >= 1e-6)
    .map((y) => `a shadow at ${String(y)} m, not ${String(want)} m`);
}

describe("a free video's ground", () => {
  // Why: the renderer stands a part at its pose in the station's frame
  // and then draws it as much larger as its folders scale it
  // (`drawInherited`). The shadow under a screen and the foot of a
  // cutout must still lie on the station's ground, not the lift times
  // the folder's scale below the part. Swept over a few scales and
  // lifts, either side of 1, up to the format's largest scale (10).
  for (const view of ["screen", "cutout"] as const) {
    for (const [scale, liftM] of [
      [1, 2],
      [2, 2],
      [0.5, 3],
      [3, 0.4],
      [10, 2],
    ] as const) {
      it(`a ${view} lifted ${String(liftM)} m in a folder of scale ${String(scale)} lies on the ground`, async () => {
        const { part } = await video({
          mode: "edit",
          block: {
            view,
            pose: { position: [0, liftM, 0], rotation: [0, 0, 0, 1] },
          },
        });
        part.object.position.set(0, liftM, 0);
        drawInherited(part.object, scale);
        part.update?.(at(0, 0));
        expect(offGround(part.object, scale), `scale ${String(scale)}`).toEqual(
          [],
        );
      });
    }

    // Why: while a folder's scale is dragged the renderer moves the part
    // to its new composed height and draws it at the new scale, but the
    // part keeps the pose it was built with (at the old scale). Its
    // ground must follow what is drawn, not that pose, and the look must
    // not be rebuilt per frame of the drag (new canvases each frame): the
    // tap target is the same object throughout. Back at scale 1 the
    // ground is where it was.
    it(`a ${view} 2 m up in a folder on the ground keeps its ground while the folder's scale is dragged`, async () => {
      const { part } = await video({
        mode: "edit",
        block: {
          view,
          pose: { position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        },
      });
      part.object.position.set(0, 2, 0);
      part.update?.(at(0, 0));
      const tap = part.tapTarget;
      for (const scale of [3, 3, 0.5, 2, 1]) {
        part.object.position.set(0, 2 * scale, 0);
        drawInherited(part.object, scale);
        part.update?.(at(0, 0));
        expect(offGround(part.object, scale), `scale ${String(scale)}`).toEqual(
          [],
        );
        expect(part.tapTarget, `scale ${String(scale)}`).toBe(tap);
      }
    });

    // Why: the editor's width drag rescales the look in place
    // (`drawAtExtent`) and does not rebuild it, so the part keeps the
    // width it was built with (1.6 m here). The ground must follow the
    // width drawn, not the built one: dividing the lift by the built
    // width's scale put a screen's shadow 2 m under the ground at twice
    // the width and 1 m in the air at half of it. Swept over widths
    // either side of the built one, at folder scales 1 and 3 (a drag
    // inside a scaled folder, where the two scales multiply).
    for (const folder of [1, 3]) {
      it(`a ${view} 2 m up in a folder of scale ${String(folder)} keeps its ground while its width is dragged`, async () => {
        const { part } = await video({
          mode: "edit",
          block: {
            view,
            pose: { position: [0, 2, 0], rotation: [0, 0, 0, 1] },
          },
        });
        part.object.position.set(0, 2 * folder, 0);
        drawInherited(part.object, folder);
        part.update?.(at(0, 0));
        const tap = part.tapTarget;
        for (const widthM of [3.2, 0.8, 6, 0.1, 1.6]) {
          drawAtExtent(part.object, widthM);
          part.update?.(at(0, 0));
          expect(
            offGround(part.object, (folder * widthM) / 1.6),
            `width ${String(widthM)}`,
          ).toEqual([]);
          expect(part.tapTarget, `width ${String(widthM)}`).toBe(tap);
        }
      });
    }

    // Why: the look is rebuilt once the clip's own shape is known (the
    // fake clip is 16:9, the look is first built at the default shape).
    // A part its folders already draw larger by then must have its ground
    // right at once, not only from its next frame's `update()`. The
    // folder stands 3 m up, so the part is drawn at 3 + 2 * 3 = 9 m and
    // its own lift (9 / 3 = 3 m) is not its pose's 2 m: a rebuild from
    // the pose alone put the ground 3 m above the station's.
    it(`a ${view} rebuilt to its clip's shape in a raised folder of scale 3 lies on the ground before its next frame`, async () => {
      const { part } = await video({
        mode: "edit",
        block: {
          view,
          pose: { position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        },
        beforeReady: (p) => {
          p.object.position.set(0, 9, 0);
          drawInherited(p.object, 3);
        },
      });
      expect(offGround(part.object, 3), "before a frame").toEqual([]);
    });
  }
});

/** Frames from `from` to `to` seconds at 30 a second, the viewer `x` m
 *  east of the video looking along `facing`. */
function walk(
  part: WorldPart,
  x: number,
  from: number,
  to: number,
  facing: readonly [number, number, number] = [-1, 0, 0],
): void {
  for (let s = from; s <= to + 1e-9; s += 1 / 30)
    part.update?.(at(x, s, facing));
}

describe("a video in a window", () => {
  // Why: a window is a screen in a wall: the creator's start rule holds
  // as it does for a screen, and a tap toggles it.
  it("starts by the creator's trigger, and a tap toggles it", async () => {
    const { part, player } = await video({
      block: { view: "window", start: "tap" },
    });
    walk(part, 2, 0, 2);
    expect(player.calls).toEqual([]);
    part.tap?.();
    expect(player.calls).toEqual(["play muted"]);
    part.tap?.();
    expect(player.calls).toEqual(["play muted", "pause"]);
  });
});

describe("a stand-here video", () => {
  // Why: standing on its footprints and facing it is the whole start of
  // this view: far off or turned away it must not play whatever the
  // creator's trigger says, on the spot facing it it must, and the card
  // must say where to go until it has developed. Its spot is 6 m east of
  // the video, the way a first viewpoint stands.
  const viewpoint = {
    position: [6, 1.6, 0],
    rotation: [0, 0, 0, 1],
    hfovDeg: 56,
    distanceM: 6,
  } as const;
  const line = (host: HTMLElement | null): string | null =>
    host?.querySelector(".narration-card-line")?.textContent ?? null;

  it("plays only once the visitor stands on the spot facing it, whatever its trigger", async () => {
    for (const start of ["enter", "tap", "look"] as const) {
      const { part, player, shown } = await video({
        block: { view: "standHere", viewpoint, start },
      });
      walk(part, 12, 0, 3);
      expect(player.calls, start).toEqual([]);
      expect(line(shown.host), start).toBe("Stand on the footprints · 6 m");
      // On the spot, turned away: still a ghost.
      walk(part, 6, 3, 6, [0, 0, 1]);
      expect(player.calls, start).toEqual([]);
      expect(line(shown.host), start).toBe("Face the video");
      walk(part, 6, 6, 7.5);
      expect(player.calls, start).toEqual(["play muted"]);
      expect(line(shown.host), start).toBe("");
    }
  });

  it("develops at once without a viewpoint, and says nothing", async () => {
    const { part, player, shown } = await video({
      block: { view: "standHere", start: "tap" },
    });
    walk(part, 12, 0, 1.5, [0, 0, 1]);
    expect(player.calls).toEqual(["play muted"]);
    expect(line(shown.host)).toBe("");
  });

  it("shows its captions only once developed", async () => {
    const captions = "WEBVTT\n\n00:00.000 --> 00:30.000\nThe gate";
    const { part, player, shown } = await video({
      block: { view: "standHere", viewpoint, captions },
    });
    walk(part, 12, 0, 1);
    player.currentTime = 1;
    walk(part, 12, 1, 2);
    const strip = shown.host?.querySelector<HTMLElement>(".video-card-caption");
    expect(strip?.textContent ?? "").toBe("");
    walk(part, 6, 2, 4);
    expect(strip?.textContent).toBe("The gate");
  });

  it("stands its footprints at the viewpoint in the station's frame, wherever it is posed", async () => {
    // Why: the viewpoint is the station's, so moving or turning the
    // video's pose must never move where the visitor is asked to stand.
    for (const mode of ["play", "edit"] as const) {
      const { part } = await video({
        mode,
        block: { view: "standHere", viewpoint },
      });
      part.object.position.set(3, 2, -4);
      part.object.rotation.y = 1.1;
      part.object.scale.setScalar(2);
      part.update?.(at(20, 0));
      part.object.updateMatrixWorld(true);
      let spot: Object3D | undefined;
      part.object.traverse((c) => {
        if (c.name === "video-stand-here-spot") spot = c;
      });
      const p = spot?.getWorldPosition(new Vector3());
      expect(p?.x, mode).toBeCloseTo(6, 6);
      expect(p?.y, mode).toBeCloseTo(0.014, 6);
      expect(p?.z, mode).toBeCloseTo(0, 6);
    }
  });

  it("stays still and silent in the editor, on its spot or not", async () => {
    const { part, player } = await video({
      mode: "edit",
      block: { view: "standHere", viewpoint },
    });
    walk(part, 6, 0, 3);
    expect(player.calls).toEqual([]);
  });
});

describe("the hint before a video starts", () => {
  /** Every line the card says while the visitor walks in from 30 m to the
   *  video, out again and back, by 0.25 m steps. */
  async function linesOnTheWay(
    block: Partial<TourVideoBlock>,
  ): Promise<string[]> {
    const { part, shown } = await video({ block });
    const lines = new Set<string>();
    let t = 0;
    const step = (x: number): void => {
      t += 0.1;
      part.update?.(at(x, t));
      const line = shown.host?.querySelector(".narration-card-line");
      if (line?.textContent) lines.add(line.textContent);
    };
    for (let x = 30; x >= 0; x -= 0.25) step(x);
    for (let x = 0; x <= 30; x += 0.25) step(x);
    for (let x = 30; x >= 0; x -= 0.25) step(x);
    return [...lines];
  }

  // Why: the control for the case below. It proves this walk reads the
  // card's line at all, so the case below fails for its own reason.
  it("a tap start says to tap it", async () => {
    expect(await linesOnTheWay({ start: "tap" })).toContain(
      "Tap the video to play",
    );
  });

  // Why: a known defect, kept as executable documentation. The rules say a
  // near start tells the visitor how far to come ("Walk closer to start ·
  // N m"), but the card only opens once the visitor is there, and for a
  // near start "there" and the start share one reach: by the time the
  // card can say it, the clip already plays. The open question is whether
  // to remove that hint or give it a place outside the card. This test
  // asserts the designed behaviour and is expected to fail today; when it
  // turns red, the hint reaches visitors, and `it.fails` becomes `it`.
  it.fails.each([1, 6, 20])(
    "a near start within %i m says to walk closer before it starts",
    async (withinM) => {
      const lines = await linesOnTheWay({ start: "near", withinM });
      expect(lines.some((l) => l.startsWith("Walk closer to start"))).toBe(
        true,
      );
    },
  );
});
