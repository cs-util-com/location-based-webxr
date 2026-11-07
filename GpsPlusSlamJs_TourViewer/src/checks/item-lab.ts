/**
 * The item lab (`item-lab.html`): a kind from
 * `public/prototypes/item-kinds/<name>/` in both contexts, side by side, with
 * nothing of the app around it. Left, a two-step story in the real scene view;
 * right, a small three.js station in the real free host. Sound is faked on
 * both sides, so a page opens and plays without an autoplay rule, and the state
 * line says what would be heard. Linked from nothing. `window.__itemLab` drives
 * it for the e2e and for side-by-side screenshots.
 *
 * @see item-lab.ts.md
 */
import * as THREE from "three";

import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";

import type { CharacterVoice } from "../character-look.js";
import { createFreeItems, type FreeItems } from "../free-items.js";
import { pictureProblem } from "../image-cap.js";
import { createNarrationPlayer } from "../narration-player.js";
import { pickObject } from "../object-pick.js";
import { createSceneStage } from "../scene-stage.js";
import { createSceneView, type SceneViewDom } from "../scene-view.js";
import { decodeFigure } from "../station-prefetch.js";
import {
  createVoiceFocus,
  focusedSceneAudio,
  storyVideoVoice,
  type Voice,
} from "../voice-focus.js";
import {
  createSilentAudio,
  freeTour,
  kindAssets,
  kindNameOf,
  readItemKind,
  showWith,
  storyStation,
  type ItemKind,
  type SilentAudio,
} from "./item-lab-kind.js";

/** The visitor's eye in the station (NUE, m), a few steps from the item. */
const EYE = [0, 1.6, 4.8] as const;
/** Where the eye looks: the middle of a figure. */
const LOOK_AT_Y = 1;

/** What the page holds at this moment. */
export interface ItemLabState {
  readonly kind: string;
  readonly story: {
    readonly text: string;
    readonly status: string;
    readonly speaker: string;
    readonly imageShown: boolean;
    /** Times the host reported the story's end. */
    readonly ended: number;
    readonly stage: string;
  };
  readonly free: {
    readonly standing: boolean;
    readonly line: string;
    readonly voice: CharacterVoice;
    readonly failures: readonly string[];
  };
  readonly sound: {
    readonly story: "off" | "playing" | "held";
    readonly free: boolean;
    readonly second: "off" | "playing" | "held";
    /** Clips the story started. */
    readonly plays: number;
  };
  /** Object URLs not yet given back. */
  readonly urls: number;
  /** The assets read since the last start. */
  readonly reads: readonly string[];
  /** The assets `assets(block)` declares. */
  readonly declared: readonly string[];
}

/** The page's hook. */
export interface ItemLab {
  /** Both contexts from the start. */
  start(): void;
  /** The story's Continue. */
  next(): void;
  /** Both contexts stop, as a closing tour stops them. */
  stop(): void;
  /** A tap on the item in one context. */
  tap(where: "story" | "free"): void;
  /** Another voice takes the channel, or gives it back. */
  secondSound(): void;
  /** The sound playing runs out. */
  endSound(): void;
  /** The next read of this asset fails. */
  loseAsset(id: string, lost: boolean): void;
  /** Files wait instead of landing, until `releaseLoads`. */
  holdLoads(): void;
  releaseLoads(): void;
  /** The visitor walks away from the station, or back. */
  walk(away: boolean): void;
  /** Resolves when two frames were drawn. */
  settle(): Promise<void>;
  state(): ItemLabState;
}

declare global {
  interface Window {
    __itemLab?: ItemLab;
  }
}

/** The elements `item-lab.html` provides. */
function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`item-lab.html has no #${id}`);
  return element as T;
}

function storyDom(): SceneViewDom {
  return {
    panel: must("lab-panel"),
    title: must("lab-title"),
    description: must("lab-description"),
    speaker: must("lab-speaker"),
    text: must("lab-text"),
    status: must("lab-status"),
    image: must<HTMLImageElement>("lab-image"),
    stationImage: must<HTMLImageElement>("lab-station-image"),
    video: must<HTMLVideoElement>("lab-video"),
    choices: must("lab-choices"),
    continueButton: must("lab-continue"),
    playNext: must("lab-play-next"),
    surface: must("lab-surface"),
  };
}

/** The story's sound seam: it plays nothing and remembers what it would. */
function fakeAudio() {
  let ending: (() => void) | null = null;
  let held = false;
  let plays = 0;
  return {
    play(_blob: Blob, onEnded: () => void) {
      plays += 1;
      ending = onEnded;
      held = false;
      return Promise.resolve();
    },
    stop() {
      ending = null;
      held = false;
    },
    pause() {
      held = true;
    },
    resume() {
      held = false;
    },
    /** It ran out; false when none was playing. */
    finish(): boolean {
      const end = ending;
      if (end === null || held) return false;
      ending = null;
      end();
      return true;
    },
    state(): { story: "off" | "playing" | "held"; plays: number } {
      if (ending === null) return { story: "off", plays };
      return { story: held ? "held" : "playing", plays };
    },
  };
}

/** The story's stage seam: it stands nothing and says what it would. */
function fakeStage(say: (line: string) => void) {
  let voice: CharacterVoice = "idle";
  let who = "";
  const tell = (): void => {
    say(who === "" ? "" : `On the stage: ${who}, voice ${voice}`);
  };
  return {
    showCharacter(
      _id: string,
      _blob: Blob,
      _wait?: () => void,
      look?: { readonly name: string; readonly view: string },
    ) {
      who = `${look?.name ?? "a figure"} (${look?.view ?? "stage"})`;
      tell();
      return Promise.resolve();
    },
    showModel() {
      who = "a model";
      tell();
      return Promise.resolve();
    },
    setVoice(next: CharacterVoice) {
      voice = next;
      tell();
    },
    toggleBubble: () => undefined,
    release() {
      who = "";
      tell();
    },
    clear() {
      who = "";
      tell();
    },
  };
}

async function loadKind(name: string, folder: URL): Promise<ItemKind> {
  const module: unknown = await import(
    /* @vite-ignore */ new URL("kind.js", folder).href
  );
  const response = await fetch(new URL("sample.json", folder));
  if (!response.ok) throw new Error(`no sample.json for "${name}"`);
  return readItemKind(name, module, await response.json());
}

/** The lab around a read kind. */
function runItemLab(kind: ItemKind, folder: URL): ItemLab {
  const world = must("lab-world");
  const focus = createVoiceFocus();
  const assets = kindAssets(kind);
  const idOf = new Map([...assets.values()].map((a) => [a.path, a.id]));
  const lost = new Set<string>();
  const reads = new Set<string>();
  const liveUrls = new Set<string>();
  const failures: string[] = [];
  let waiting: (() => void)[] | null = null;

  function loadAsset(path: string): Promise<Blob> {
    const id = idOf.get(path) ?? path;
    reads.add(id);
    const land = async (): Promise<Blob> => {
      if (lost.has(id)) throw new Error(`${id} is lost`);
      const response = await fetch(new URL(path, folder));
      if (!response.ok) throw new Error(`${path} is missing`);
      return response.blob();
    };
    if (waiting === null) return land();
    const queue = waiting;
    return new Promise((resolve, reject) => {
      queue.push(() => {
        land().then(resolve, reject);
      });
    });
  }

  const createUrl = (blob: Blob): string => {
    const url = URL.createObjectURL(blob);
    liveUrls.add(url);
    return url;
  };
  const revokeUrl = (url: string): void => {
    URL.revokeObjectURL(url);
    liveUrls.delete(url);
  };

  // Left: the story, in the real scene view.
  const dom = storyDom();
  const audio = fakeAudio();
  const stageLine = must("lab-stage");
  let storyEnds = 0;
  const showItem = showWith(kind);
  const view = createSceneView({
    dom,
    assets,
    loadAsset,
    audio: focusedSceneAudio(audio, focus),
    videoVoice: storyVideoVoice(dom.video, focus),
    stage: fakeStage((line) => {
      stageLine.textContent = line;
    }),
    checkPicture: (blob) => pictureProblem(blob),
    createChoiceButton: (label, onClick) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    },
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    objectUrls: { create: createUrl, revoke: revokeUrl },
    onStoryEnd: () => {
      storyEnds += 1;
    },
    showItem,
  });
  // The scene view shows these on a tap step and on a waiting story.
  must("lab-continue").addEventListener("click", () => {
    view.continueTapped();
  });
  must("lab-play-next").addEventListener("click", () => {
    view.playNextNow();
  });

  // Right: the station, in the real free host.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  world.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4e9ee);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ab, 1.2));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: 0xc9cdd0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.position.set(...EYE);
  camera.lookAt(0, LOOK_AT_Y, 0);

  const frames = new Set<() => void>();
  const tour = freeTour(kind);
  const figure = {
    standing: false,
    line: "",
    voice: "idle" as CharacterVoice,
  };
  const sounds: SilentAudio[] = [];
  /** Where a pointer tapped the station (NDC); undefined for the hook's tap. */
  let tappedAt: { x: number; y: number } | undefined;
  let shown = false;

  /** The figure being stood; a release or clear makes an older one stale. */
  let standings = 0;

  function makeStage() {
    const stage = createSceneStage({
      getScene: () => scene,
      poseOf: () => ({
        positionNue: [0, 0, 0],
        rotationNue: [0, 0, 0, 1],
      }),
      decodeTexture: (blob) =>
        decodeFigure(blob, (b, divisor) =>
          decodeFrameTexture(b, divisor, { maxPixels: TOUR_MAX_IMAGE_PIXELS }),
        ),
      loadModel: () => Promise.reject(new Error("the lab stands no model")),
      registerFrame: (fn) => {
        frames.add(fn);
        return () => {
          frames.delete(fn);
        };
      },
      getCamera: () => camera,
    });
    return {
      ...stage,
      // Standing only once decoded and mounted, so a wait for it is a wait
      // for the figure in the scene.
      showCharacter: (async (id, blob, wait, look) => {
        const mine = ++standings;
        await stage.showCharacter(id, blob, wait, look);
        if (mine !== standings) return;
        figure.standing = true;
        figure.line = look?.line ?? "";
      }) as typeof stage.showCharacter,
      setVoice: ((voice, ms) => {
        figure.voice = voice;
        stage.setVoice(voice, ms);
      }) as typeof stage.setVoice,
      release() {
        standings += 1;
        figure.standing = false;
        stage.release();
      },
      clear() {
        standings += 1;
        figure.standing = false;
        stage.clear();
      },
    };
  }

  const failureLine = must("lab-free-status");
  const free: FreeItems = createFreeItems({
    tour: () => tour,
    characters: () => new Map(),
    assets: () => assets,
    loadAsset,
    makeStage,
    focus,
    checkPicture: (blob) => pictureProblem(blob),
    pick: (targets) =>
      tappedAt === undefined
        ? ([...targets.keys()][0] ?? null)
        : pickObject(camera, targets, { ndc: tappedAt }),
    sayFailure: (text) => {
      failures.push(text);
      failureLine.textContent = text;
    },
    makePlayer: (deps) =>
      createNarrationPlayer({
        ...deps,
        audio: () => {
          const sound = createSilentAudio();
          sounds.push(sound);
          return sound;
        },
        createUrl,
        revokeUrl,
      }),
    showItem,
  });

  renderer.domElement.addEventListener("click", (event) => {
    const box = renderer.domElement.getBoundingClientRect();
    tappedAt = {
      x: ((event.clientX - box.left) / box.width) * 2 - 1,
      y: 1 - ((event.clientY - box.top) / box.height) * 2,
    };
    free.tapped(null);
    tappedAt = undefined;
  });

  function resize(): void {
    const { clientWidth: w, clientHeight: h } = world;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // The second sound: another voice in the one channel.
  let second: "off" | "playing" | "held" = "off";
  const secondVoice: Voice = {
    hold() {
      second = "held";
    },
    carryOn() {
      second = "playing";
    },
    stop() {
      second = "off";
    },
  };

  const hook: ItemLab = {
    start() {
      hook.stop();
      reads.clear();
      failures.length = 0;
      failureLine.textContent = "";
      storyEnds = 0;
      shown = true;
      view.offer(storyStation(kind));
    },
    next() {
      view.continueTapped();
    },
    stop() {
      shown = false;
      view.stopAll();
      free.stop();
      if (second !== "off") {
        second = "off";
        focus.ended(secondVoice);
      }
      for (const sound of sounds) sound.pause();
      sounds.length = 0;
    },
    tap(where) {
      if (where === "story") view.characterTapped();
      else free.tapped(null);
    },
    secondSound() {
      if (second === "off") {
        second = "playing";
        focus.tapped(secondVoice);
      } else {
        second = "off";
        focus.ended(secondVoice);
      }
    },
    endSound() {
      if (audio.finish()) return;
      sounds.find((sound) => !sound.paused)?.finish();
    },
    loseAsset(id, gone) {
      if (gone) lost.add(id);
      else lost.delete(id);
    },
    holdLoads() {
      waiting ??= [];
    },
    releaseLoads() {
      const queue = waiting ?? [];
      waiting = null;
      for (const land of queue) land();
    },
    walk(away) {
      shown = !away;
    },
    settle() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
    },
    state() {
      return {
        kind: kind.name,
        story: {
          text: must("lab-text").textContent,
          status: must("lab-status").textContent,
          speaker: must("lab-speaker").hidden
            ? ""
            : must("lab-speaker").textContent,
          imageShown: !must("lab-image").hidden,
          ended: storyEnds,
          stage: stageLine.textContent,
        },
        free: { ...figure, failures: [...failures] },
        sound: {
          story: audio.state().story,
          free: sounds.some((sound) => !sound.paused),
          second,
          plays: audio.state().plays,
        },
        urls: liveUrls.size,
        reads: [...reads],
        declared: kind.assets(kind.sample.block),
      };
    },
  };

  const stateLine = must("lab-state");
  const loop = (): void => {
    free.follow(() => shown);
    free.faceVisitor(EYE);
    for (const frame of frames) frame();
    renderer.render(scene, camera);
    const text = JSON.stringify(hook.state(), null, 1);
    if (stateLine.textContent !== text) stateLine.textContent = text;
    requestAnimationFrame(loop);
  };

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
  return hook;
}

/** A control of the bar. */
function addButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  must("lab-controls").appendChild(button);
  return button;
}

function mountControls(lab: ItemLab, kind: ItemKind): void {
  addButton("Start again", () => {
    lab.start();
  });
  addButton("Stop", () => {
    lab.stop();
  });
  addButton("Tap in the story", () => {
    lab.tap("story");
  });
  addButton("Tap in the station", () => {
    lab.tap("free");
  });
  addButton("Second sound", () => {
    lab.secondSound();
  });
  addButton("End the sound", () => {
    lab.endSound();
  });
  let away = false;
  const walk = addButton("Walk away", () => {
    away = !away;
    lab.walk(away);
    walk.textContent = away ? "Come back" : "Walk away";
  });
  let holding = false;
  const hold = addButton("Hold the files", () => {
    holding = !holding;
    if (holding) lab.holdLoads();
    else lab.releaseLoads();
    hold.textContent = holding ? "Let the files land" : "Hold the files";
  });
  for (const { id } of kind.sample.assets) {
    let lost = false;
    const lose = addButton(`Lose ${id}`, () => {
      lost = !lost;
      lab.loseAsset(id, lost);
      lose.textContent = `${lost ? "Bring back" : "Lose"} ${id}`;
      lose.setAttribute("aria-pressed", String(lost));
      lab.start();
    });
  }
}

/** Reads the kind the address names and runs the page; a kind that cannot be
 *  read says why on the page. */
export async function startItemLab(): Promise<void> {
  const name = kindNameOf(location.search);
  const title = must("lab-kind");
  const error = must("lab-error");
  if (name === null) {
    error.textContent = "That is not the name of a kind.";
    return;
  }
  title.textContent = name;
  const folder = new URL(`prototypes/item-kinds/${name}/`, location.href);
  try {
    const kind = await loadKind(name, folder);
    const lab = runItemLab(kind, folder);
    mountControls(lab, kind);
    window.__itemLab = lab;
    lab.start();
  } catch (failure) {
    error.textContent = `The kind "${name}" could not be read. ${
      failure instanceof Error ? failure.message : String(failure)
    }`;
  }
}
