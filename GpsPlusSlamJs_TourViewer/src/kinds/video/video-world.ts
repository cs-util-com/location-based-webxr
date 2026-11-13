/**
 * A free video's part in the world (`screen`, `cutout`, `porthole`): its
 * look (`video-look.ts`) fed by a `<video>` element, and the rules of
 * `video-rules.ts` driven by the camera frame. The creator's trigger
 * starts it once (on entering, within a distance, when looked at, or on a
 * tap); leaving pauses it and coming back resumes it; a finished video
 * stays finished and a tap replays it. It starts with its sound when the
 * visitor's remembered choice, else the creator's, says so - and only
 * after the visitor has touched the page; a start the browser still
 * refuses is muted and said. While the visitor is there its card
 * (`video-card.ts`) is on the page's screen with play, the sound switch
 * (remembered for every video) and the hint; a porthole's tap opens the
 * clip large in that card. In the editor: the same look, still and
 * silent, its first frame or its poster.
 *
 * @see video-world.ts.md
 */

import type { TourVideoBlock } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  Group,
  Matrix4,
  SRGBColorSpace,
  Texture,
  Vector3,
  VideoTexture,
} from "three";

import { inheritedScaleOf } from "../../placement/place-scale.js";
import { clockText } from "../../read-along.js";
import {
  loadVisitorPrefs,
  saveVisitorPrefs,
  type PrefsStorage,
} from "../../visitor-prefs.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import { videoCard, type VideoCard } from "./video-card.js";
import {
  VIDEO_DEFAULT_ASPECT,
  videoLook,
  type VideoLook,
  type VideoWorldView,
} from "./video-look.js";
import {
  decideStartSound,
  lookDwell,
  startFires,
  VIDEO_SOUND_REFUSED_MS,
  videoHint,
  videoReachM,
  videoSoundChoice,
  videoStartOf,
  videoStep,
  videoThere,
  withVideoSound,
  type VideoAction,
  type VideoEvent,
  type VideoState,
} from "./video-rules.js";

/** What the part uses of a `<video>` element. */
export interface ClipPlayer {
  src: string;
  muted: boolean;
  currentTime: number;
  readonly paused: boolean;
  readonly duration: number;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
}

/** What the part needs of the page; the defaults are the browser's. */
export interface VideoDeps {
  /** A muted, inline player; null on a page with none (Node). */
  makePlayer(): ClipPlayer | null;
  /** The player's frames as a texture. */
  clipTexture(player: ClipPlayer): Texture;
  /** The poster file as a texture; null when it cannot be read. */
  posterTexture(blob: Blob): Promise<Texture | null>;
  url(blob: Blob): string;
  revoke(url: string): void;
  /** Whether the visitor has touched the page (sound may play). */
  activated(): boolean;
  /** Where the visitor's choices are kept; none: for the visit only. */
  storage(): PrefsStorage | undefined;
  /** The player as a page element, for a porthole's card; null: none. */
  element(player: ClipPlayer): HTMLElement | null;
}

/** The browser's: a `<video>`, its frames, `createImageBitmap`, object
 *  URLs, `navigator.userActivation` and `localStorage`. */
function browserVideoDeps(): VideoDeps {
  const g = globalThis as {
    document?: Document;
    navigator?: { userActivation?: { hasBeenActive?: boolean } };
    createImageBitmap?: typeof createImageBitmap;
    localStorage?: Storage;
  };
  return {
    makePlayer() {
      const video = g.document?.createElement("video");
      if (video === undefined) return null;
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.className = "video-card-clip";
      return video;
    },
    clipTexture(player) {
      const texture = new VideoTexture(player as HTMLVideoElement);
      texture.colorSpace = SRGBColorSpace;
      return texture;
    },
    async posterTexture(blob) {
      if (g.createImageBitmap === undefined) return null;
      try {
        const bitmap = await g.createImageBitmap(blob, {
          imageOrientation: "flipY",
        });
        const texture = new Texture(bitmap);
        texture.flipY = false;
        texture.colorSpace = SRGBColorSpace;
        texture.needsUpdate = true;
        return texture;
      } catch {
        return null;
      }
    },
    url: (blob) => URL.createObjectURL(blob),
    revoke: (url) => {
      URL.revokeObjectURL(url);
    },
    activated: () => g.navigator?.userActivation?.hasBeenActive === true,
    storage() {
      try {
        return g.localStorage;
      } catch {
        return undefined;
      }
    },
    element: (player) =>
      typeof HTMLElement !== "undefined" && player instanceof HTMLElement
        ? player
        : null,
  };
}

const WORLD_VIEWS: ReadonlySet<string> = new Set([
  "screen",
  "cutout",
  "porthole",
]);

/** Scratch for the viewer in a part's own frame. */
const toLocal = new Matrix4();
const viewerLocal = new Vector3();

/** The note when the browser kept a wanted sound off. */
export const SOUND_REFUSED_NOTE = "The browser kept the sound off";

/**
 * `block`'s part: null in a view that stands nothing in the station (the
 * card) or with no width. Its `ready` settles once the clip's size is
 * known (or at once on a page with no player), and rejects when the clip
 * cannot be read or played.
 */
export function videoWorld(
  block: TourVideoBlock,
  env: WorldEnv,
  deps: VideoDeps = browserVideoDeps(),
): WorldPart | null {
  const widthM = block.widthM;
  if (!WORLD_VIEWS.has(block.view) || widthM === undefined) return null;
  const view = block.view as VideoWorldView;
  const play = env.mode === "play";
  const start = videoStartOf(block);
  const reachM = videoReachM(block);
  const object = new Group();
  const build = (aspect: number): VideoLook =>
    videoLook({
      view,
      widthM,
      aspect,
      stacked: block.alpha === "stacked",
      liftM: block.pose?.position[1] ?? 0,
      edit: !play,
      canvasTexture: (canvas) => env.canvasTexture(canvas),
    });
  let aspect = VIDEO_DEFAULT_ASPECT;
  let look = build(aspect);
  object.add(look.object);

  let gone = false;
  let player: ClipPlayer | null = null;
  let clip: Texture | null = null;
  let poster: Texture | null = null;
  let url: string | null = null;
  let hasFrame = false;
  let state: VideoState = "waiting";
  let there = false;
  let dwell = 0;
  let seconds = 0;
  let lastSeconds: number | null = null;
  let distanceM = Number.POSITIVE_INFINITY;
  /** The sound was wanted but the page was not touched yet. */
  let blocked = false;
  let soundDecided = false;
  let note: string | null = null;
  let playAskedAt: number | null = null;

  const startPlaying = (): void => {
    const p = player;
    if (p === null) return;
    playAskedAt = seconds;
    p.play().catch(() => {
      refused();
    });
  };
  /** The browser refused to play: with sound, muted and tried again. */
  const refused = (): void => {
    const p = player;
    if (gone || p === null || state !== "playing" || p.muted) return;
    p.muted = true;
    note = SOUND_REFUSED_NOTE;
    playAskedAt = null;
    p.play().catch(() => undefined);
  };
  const decideSound = (): void => {
    if (soundDecided || player === null) return;
    soundDecided = true;
    const decided = decideStartSound({
      chosen: videoSoundChoice(loadVisitorPrefs(deps.storage())),
      creator: block.sound,
      activated: deps.activated(),
    });
    player.muted = !decided.sound;
    blocked = decided.blocked;
  };
  const apply = (action: VideoAction): void => {
    const p = player;
    if (p === null) return;
    switch (action) {
      case "none":
        return;
      case "play":
      case "replay":
        p.currentTime = 0;
        decideSound();
        startPlaying();
        return;
      case "resume":
        startPlaying();
        return;
      case "pause":
        playAskedAt = null;
        p.pause();
        return;
    }
  };
  const event = (e: VideoEvent): void => {
    const step = videoStep(state, e);
    state = step.state;
    apply(step.action);
  };

  let card: VideoCard | null = null;
  let closeCard: (() => void) | null = null;
  let overlay = false;
  /** The visitor's tap on the video, or on the card's play. */
  const toggle = (): void => {
    const p = player;
    // A start that wanted sound before the page was touched: this tap
    // touches it, and turns the sound on rather than pausing.
    if (state === "playing" && blocked && p !== null && p.muted) {
      p.muted = false;
      blocked = false;
      note = null;
      return;
    }
    event("tap");
  };
  const toggleSound = (): void => {
    const p = player;
    if (p === null) return;
    const on = p.muted;
    p.muted = !on;
    blocked = false;
    const storage = deps.storage();
    const kept = saveVisitorPrefs(
      storage,
      withVideoSound(loadVisitorPrefs(storage), on ? "on" : "off"),
    );
    note = `Sound ${on ? "on" : "off"}${kept ? " for every video" : ""}`;
  };
  const openCard = (): void => {
    if (env.screen === undefined || closeCard !== null) return;
    const element = overlay && player !== null ? deps.element(player) : null;
    closeCard = env.screen.show((host) => {
      card = videoCard(
        host,
        block,
        {
          toggle,
          toggleSound,
          playing: () => state === "playing",
          sound: () => player !== null && !player.muted,
          timeMs: () => (player?.currentTime ?? 0) * 1000,
          durationMs: () => durationOf(player) * 1000,
          line: () => note ?? videoHint(start, state, distanceM, reachM),
        },
        element === null
          ? null
          : {
              element,
              onClose: () => {
                overlay = false;
                shutCard();
                if (there) openCard();
              },
            },
      );
      return () => {
        card?.dispose();
        card = null;
      };
    });
  };
  const shutCard = (): void => {
    const close = closeCard;
    closeCard = null;
    close?.();
  };

  const ready = env.loadAsset(block.video).then(async (blob) => {
    if (block.poster !== undefined) {
      const posterBlob = await env.loadAsset(block.poster).catch(() => null);
      const texture =
        posterBlob === null ? null : await deps.posterTexture(posterBlob);
      if (gone) texture?.dispose();
      else poster = texture;
    }
    if (gone) return;
    const p = deps.makePlayer();
    if (p === null) return;
    player = p;
    url = deps.url(blob);
    await new Promise<void>((resolve, reject) => {
      p.addEventListener("loadedmetadata", () => {
        resolve();
      });
      p.addEventListener("error", () => {
        reject(new Error(`the video "${block.video}" cannot be played here`));
      });
      p.src = url ?? "";
      p.load();
    });
    if (gone) return;
    p.addEventListener("loadeddata", () => {
      hasFrame = true;
    });
    p.addEventListener("playing", () => {
      playAskedAt = null;
      hasFrame = true;
    });
    p.addEventListener("ended", () => {
      event("ended");
    });
    clip = deps.clipTexture(p);
    // The clip's own shape (a stacked clip's picture is its upper half).
    const own =
      p.videoWidth > 0 && p.videoHeight > 0
        ? p.videoHeight / (block.alpha === "stacked" ? 2 : 1) / p.videoWidth
        : aspect;
    if (Math.abs(own - aspect) > 0.01) {
      aspect = own;
      look.dispose();
      look = build(aspect);
      object.add(look.object);
    }
    // A trigger that fired while the file was read starts it now.
    if (play && state === "playing") apply("play");
  });

  const showLook = (viewer: readonly [number, number, number] | null): void => {
    const p = player;
    const duration = durationOf(p);
    const time = p?.currentTime ?? 0;
    look.show({
      clip: hasFrame ? clip : null,
      poster,
      started: state !== "waiting",
      playing: state === "playing",
      progress: duration > 0 ? time / duration : 0,
      time: `${clockText(time * 1000)} / ${clockText(duration * 1000)}`,
      sound: p !== null && !p.muted,
      seconds,
      viewer,
    });
  };

  return {
    object,
    // The look in hand: one rebuilt to the clip's shape is the one tapped.
    get tapTarget() {
      return look.tapTarget;
    },
    ready,
    update(frame) {
      seconds = frame.seconds;
      const dt = lastSeconds === null ? 0 : seconds - lastSeconds;
      lastSeconds = seconds;
      if (!play) {
        showLook(null);
        return;
      }
      const [x, y, z] = frame.viewer;
      const { position } = object;
      // In its own metres: a folder that draws it larger widens its reach.
      distanceM =
        Math.hypot(x - position.x, z - position.z) / inheritedScaleOf(object);
      const now = videoThere(distanceM, reachM, there);
      if (now !== there) {
        there = now;
        if (there) openCard();
        else shutCard();
        event(there ? "return" : "leave");
      }
      if (start === "look" && frame.facing !== undefined) {
        const to = [position.x - x, position.y - y, position.z - z];
        const length = Math.hypot(to[0] ?? 0, to[1] ?? 0, to[2] ?? 0);
        const [fx, fy, fz] = frame.facing;
        const cos =
          length > 0
            ? ((to[0] ?? 0) * fx + (to[1] ?? 0) * fy + (to[2] ?? 0) * fz) /
              length
            : 1;
        const offDeg =
          (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
        dwell = lookDwell(dwell, offDeg, dt);
      }
      if (state === "waiting" && startFires(start, there, dwell)) {
        event("start");
      }
      // A start with sound that the browser has not played after a
      // second: muted, and said.
      if (
        playAskedAt !== null &&
        player !== null &&
        player.paused &&
        (seconds - playAskedAt) * 1000 >= VIDEO_SOUND_REFUSED_MS
      ) {
        refused();
      }
      // The look turns in its own frame: the viewer brought into it.
      object.updateMatrix();
      toLocal.copy(object.matrix).invert();
      viewerLocal.set(x, y, z).applyMatrix4(toLocal);
      showLook([viewerLocal.x, viewerLocal.y, viewerLocal.z]);
      card?.render();
    },
    tap() {
      if (!play) return;
      if (view === "porthole") {
        overlay = true;
        shutCard();
        openCard();
        if (state !== "playing") event("tap");
        return;
      }
      toggle();
      card?.render();
    },
    dispose() {
      gone = true;
      shutCard();
      const p = player;
      player = null;
      if (p !== null) {
        p.pause();
        p.removeAttribute("src");
        p.load();
      }
      if (url !== null) deps.revoke(url);
      url = null;
      clip?.dispose();
      poster?.dispose();
      look.dispose();
    },
  };
}

/** The player's length (s); 0 while unknown or endless. */
function durationOf(player: ClipPlayer | null): number {
  const d = player?.duration ?? 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}
