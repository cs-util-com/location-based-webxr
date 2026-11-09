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
import { worldEnv, type WorldMode, type WorldPart } from "../world-part.js";
import {
  createSilentAudio,
  freeTour,
  kindAssets,
  kindNameOf,
  readItemKind,
  RECORD_NAMES,
  showWith,
  storyStation,
  type ItemKind,
  type ReadRecord,
  type RecordName,
  type SilentAudio,
} from "./item-lab-kind.js";
import { poseKey, worldCost, type WorldCost } from "./world-cost.js";

/** The visitor's eye in the station (NUE, m), a few steps from the item. */
const EYE = [0, 1.6, 4.8] as const;
/** Where the kind's world part stands (m): beside the free host's figure,
 *  which stands on the station's spot. */
const WORLD_AT = [-1.4, 0, 0] as const;
/** The two backdrops a part must look right on (AR shows the camera image
 *  behind it): a bright day and a dark evening. */
const BACKDROPS = {
  bright: { sky: 0xe4e9ee, ground: 0xc9cdd0 },
  dark: { sky: 0x1b2128, ground: 0x2e353c },
} as const;
/** Where the eye looks: the middle of a figure. */
const LOOK_AT_Y = 1;
/** The state line is for a person reading it: redrawn at most this often
 *  (ms). The hook's `state()` is read fresh. */
const STATE_LINE_MS = 250;

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
  /** The sample's record shown, and what the kind's `read` fixed in it. */
  readonly record: RecordName;
  readonly problems: readonly string[];
  /** The kind's world part (`world(block, env)`). */
  readonly world: {
    /** The kind has a `world`. */
    readonly has: boolean;
    readonly mode: WorldMode;
    readonly backdrop: keyof typeof BACKDROPS;
    /** A part stands in the scene. */
    readonly standing: boolean;
    /** Its objects moved between the last two frames. */
    readonly moving: boolean;
    /** Times a tap reached it. */
    readonly taps: number;
    /** What drawing it costs, counted from its objects. */
    readonly cost: WorldCost;
    /** Why `world` failed, or "". */
    readonly failure: string;
    /** Where its `tapTarget` stands on the canvas, in normalised device
     *  coordinates (-1..1, Y up), or null: so a test can tap it there. */
    readonly target: readonly [number, number] | null;
  };
}

/** What ten open and close rounds left behind in the renderer's memory. */
export interface LeftBehind {
  readonly geometries: number;
  readonly textures: number;
}

/** The page's hook. */
export interface ItemLab {
  /** Both contexts from the start. */
  start(): void;
  /** The story's Continue. */
  next(): void;
  /** Both contexts stop, as a closing tour stops them. */
  stop(): void;
  /** A tap on the item in one context, or on its world part. */
  tap(where: "story" | "free" | "world"): void;
  /** Shows another of the sample's records, from the start. */
  record(name: RecordName): void;
  /** Builds the world part again for a visitor or for the editor. */
  mode(mode: WorldMode): void;
  backdrop(name: keyof typeof BACKDROPS): void;
  /** Builds, draws and frees the world part `n` times; what the renderer
   *  still holds afterwards that it did not before. */
  rounds(n: number): LeftBehind;
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

/** Points the bare `three` of a kind's folder at the lab's own three
 *  (`lab-three.ts`), once, before the first kind is imported. */
async function mapThree(): Promise<void> {
  if (document.querySelector("script[data-lab-three]") !== null) return;
  const { LAB_THREE_URL } = await import("./lab-three.js");
  const map = document.createElement("script");
  map.type = "importmap";
  map.dataset["labThree"] = "";
  map.textContent = JSON.stringify({ imports: { three: LAB_THREE_URL } });
  document.head.append(map);
}

async function loadKind(name: string, folder: URL): Promise<ItemKind> {
  await mapThree();
  const module: unknown = await import(
    /* @vite-ignore */ new URL("kind.js", folder).href
  );
  const response = await fetch(new URL("sample.json", folder));
  if (!response.ok) throw new Error(`no sample.json for "${name}"`);
  return readItemKind(name, module, await response.json());
}

/** The lab around a read kind. */
function runItemLab(kind: ItemKind, folder: URL): ItemLab {
  // The kind's untyped code runs once per record, before anything is
  // built: a kind whose `assets` throws fails the page's load and says why.
  const declaredOf = new Map(
    RECORD_NAMES.map((name) => [
      name,
      [...kind.assets(kind.recordOf(name).block)],
    ]),
  );
  let recordName: RecordName = "normal";
  let shownRecord: ReadRecord = kind.recordOf(recordName);
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
  const textLine = must("lab-text");
  const statusLine = must("lab-status");
  const speakerLine = must("lab-speaker");
  const image = must("lab-image");
  const audio = fakeAudio();
  const stageLine = must("lab-stage");
  let storyEnds = 0;
  const showItem = showWith(kind, () => shownRecord.block);
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
  const sky = new THREE.Color(BACKDROPS.bright.sky);
  scene.background = sky;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ab, 1.2));
  const groundMaterial = new THREE.MeshLambertMaterial({
    color: BACKDROPS.bright.ground,
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.position.set(...EYE);
  camera.lookAt(0, LOOK_AT_Y, 0);

  // The kind's world part, built through the same environment a station
  // gives one: its files by id, a canvas as a texture, play or edit.
  let backdrop: keyof typeof BACKDROPS = "bright";
  let worldMode: WorldMode = "play";
  let part: WorldPart | null = null;
  let worldTaps = 0;
  let worldFailure = "";
  let moving = false;
  let lastPose = "";
  const viewerLocal = new THREE.Vector3();
  const envOf = (mode: WorldMode) =>
    worldEnv(mode, [...assets.values()], loadAsset);
  /** A fresh part of the shown record, or null (none, or `world` threw:
   *  the failure is kept and shown). */
  function makePart(): WorldPart | null {
    if (kind.world === undefined) return null;
    try {
      return kind.world(shownRecord.block, envOf(worldMode));
    } catch (failure) {
      worldFailure = `world(block, env) failed: ${
        failure instanceof Error ? failure.message : String(failure)
      }`;
      return null;
    }
  }
  function freePart(): void {
    if (part === null) return;
    scene.remove(part.object);
    part.dispose();
    part = null;
  }
  function standPart(): void {
    freePart();
    worldFailure = "";
    part = makePart();
    if (part === null) return;
    part.object.position.set(...WORLD_AT);
    scene.add(part.object);
    lastPose = poseKey(part.object);
    moving = false;
  }
  const targetAt = new THREE.Vector3();
  const targetBox = new THREE.Box3();
  function targetOnCanvas(): readonly [number, number] | null {
    const target = part?.tapTarget;
    if (target === undefined) return null;
    targetBox.setFromObject(target).getCenter(targetAt).project(camera);
    return [targetAt.x, targetAt.y];
  }
  /** The visitor's tap on the part's `tapTarget`; true when it took it. */
  function tapPart(at: { x: number; y: number } | undefined): boolean {
    const target = part?.tapTarget;
    if (part?.tap === undefined || target === undefined) return false;
    if (
      at !== undefined &&
      pickObject(camera, new Map([["part", target]]), { ndc: at }) === null
    ) {
      return false;
    }
    worldTaps += 1;
    part.tap();
    return true;
  }

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
    if (!tapPart(tappedAt)) free.tapped(null);
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
      worldTaps = 0;
      shown = true;
      view.offer(storyStation(kind));
      standPart();
    },
    next() {
      view.continueTapped();
    },
    stop() {
      shown = false;
      view.stopAll();
      free.stop();
      freePart();
      if (second !== "off") {
        second = "off";
        focus.ended(secondVoice);
      }
      for (const sound of sounds) sound.pause();
      sounds.length = 0;
    },
    tap(where) {
      if (where === "story") view.characterTapped();
      else if (where === "world") tapPart(undefined);
      else free.tapped(null);
    },
    record(name) {
      recordName = name;
      shownRecord = kind.recordOf(name);
      hook.start();
    },
    mode(mode) {
      worldMode = mode;
      if (part !== null || worldFailure !== "") standPart();
    },
    backdrop(name) {
      backdrop = name;
      sky.setHex(BACKDROPS[name].sky);
      groundMaterial.color.setHex(BACKDROPS[name].ground);
    },
    rounds(n) {
      const memory = renderer.info.memory;
      renderer.render(scene, camera);
      const before = {
        geometries: memory.geometries,
        textures: memory.textures,
      };
      for (let i = 0; i < n; i += 1) {
        const round = makePart();
        if (round === null) break;
        round.object.position.set(...WORLD_AT);
        scene.add(round.object);
        renderer.render(scene, camera);
        scene.remove(round.object);
        round.dispose();
      }
      renderer.render(scene, camera);
      return {
        geometries: memory.geometries - before.geometries,
        textures: memory.textures - before.textures,
      };
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
          text: textLine.textContent,
          status: statusLine.textContent,
          speaker: speakerLine.hidden ? "" : speakerLine.textContent,
          imageShown: !image.hidden,
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
        declared: declaredOf.get(recordName) ?? [],
        record: recordName,
        problems: shownRecord.problems,
        world: {
          has: kind.world !== undefined,
          mode: worldMode,
          backdrop,
          standing: part !== null,
          moving,
          taps: worldTaps,
          cost:
            part === null ? { calls: 0, triangles: 0 } : worldCost(part.object),
          failure: worldFailure,
          target: targetOnCanvas(),
        },
      };
    },
  };

  const stateLine = must("lab-state");
  const costLine = must("lab-cost");
  const problemsLine = must("lab-problems");
  let stateDrawnAt = -Infinity;
  const loop = (now: number): void => {
    free.follow(() => shown);
    free.faceVisitor(EYE);
    for (const frame of frames) frame();
    if (part !== null) {
      part.object.visible = shown;
      camera.getWorldPosition(viewerLocal);
      part.object.parent?.worldToLocal(viewerLocal);
      part.update?.({
        seconds: now / 1000,
        viewer: [viewerLocal.x, viewerLocal.y, viewerLocal.z],
      });
      const pose = poseKey(part.object);
      moving = pose !== lastPose;
      lastPose = pose;
    }
    renderer.render(scene, camera);
    if (now - stateDrawnAt >= STATE_LINE_MS) {
      stateDrawnAt = now;
      const state = hook.state();
      const text = JSON.stringify(state, null, 1);
      if (stateLine.textContent !== text) stateLine.textContent = text;
      const cost = costText(state.world);
      if (costLine.textContent !== cost) costLine.textContent = cost;
      const problems =
        state.problems.length === 0
          ? ""
          : `The ${state.record} record: ${state.problems.join("; ")}.`;
      if (problemsLine.textContent !== problems) {
        problemsLine.textContent = problems;
      }
    }
    requestAnimationFrame(loop);
  };

  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(loop);
  return hook;
}

/** A provisional per-item budget for the world view; no phone measurement
 *  stands behind it yet, so going over it is said, never refused. */
const WORLD_BUDGET = { calls: 30, triangles: 50_000 } as const;

/** The cost line under the station: what the world view draws, against the
 *  budget, or why there is none. */
function costText(world: ItemLabState["world"]): string {
  if (!world.has) return "This kind has no world view.";
  if (world.failure !== "") return world.failure;
  if (!world.standing) return "The world view is not standing.";
  const { calls, triangles } = world.cost;
  const over =
    calls > WORLD_BUDGET.calls || triangles > WORLD_BUDGET.triangles
      ? " - over the budget"
      : "";
  return `World view (${world.mode}): ${String(calls)} draw calls, ${String(triangles)} triangles${over}.`;
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
  for (const name of RECORD_NAMES) {
    addButton(`The ${name} record`, () => {
      lab.record(name);
    });
  }
  if (kind.world !== undefined) {
    let editing = false;
    const mode = addButton("Edit mode", () => {
      editing = !editing;
      lab.mode(editing ? "edit" : "play");
      mode.textContent = editing ? "Play mode" : "Edit mode";
    });
    addButton("Tap in the world", () => {
      lab.tap("world");
    });
    addButton("Ten rounds", () => {
      const left = lab.rounds(10);
      must("lab-free-status").textContent =
        `Ten rounds left ${String(left.geometries)} geometries and ${String(left.textures)} textures behind.`;
    });
  }
  let dark = false;
  const backdrop = addButton("Dark backdrop", () => {
    dark = !dark;
    lab.backdrop(dark ? "dark" : "bright");
    backdrop.textContent = dark ? "Bright backdrop" : "Dark backdrop";
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
