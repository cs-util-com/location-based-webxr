/**
 * The reading sign (a long text's `reading` view, `tour.json` minor 4): a
 * short dark sign on a thin stem at the block's pose, naming the text and
 * how long it takes to read, that opens the whole text in the reading
 * sheet (`long-text-sheet.ts`) on a tap. Built as the narrated-text
 * prototype builds its sign (`public/prototypes/station-blocks-1-narrated-text/`,
 * `drawLabel`). A text with a voice says so on the sign's face, in a chip
 * that follows the voice (`setVoiceState`, the travelling box
 * prototype's words: `public/prototypes/sign-speaks-r6-2-travelling-box/`).
 *
 * The plate turns about its upright axis to face the viewer each frame
 * (the prototype's rule), so it reads from any side; the stem and the ring
 * on the ground are round and need no turning.
 *
 * Under the sign a narrated text's words can hang on a plate of their own
 * (`attachWords`, the travelling box's plate: `travelling-box-rules.ts`).
 * It turns with the sign and is a sibling of the tap target, never its
 * child, so a tap on it never opens the sheet; while it hangs there the
 * sign grows with the distance, on its own group, never on the root the
 * renderer scales.
 *
 * A mounted sign is a world part in the one mounted set (`world-part.ts`),
 * so the visitor's tap finds it as it finds every part.
 *
 * @see reading-sign.ts.md
 */

import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { tourStationBlocks } from "gps-plus-slam-app-framework/ar/tour-story";
import {
  type Camera,
  type CanvasTexture,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  type Texture,
  Vector3,
  type Object3D,
} from "three";

import { readMinutes, wordCount } from "./long-text-sheet.js";
import { signGrowth, TRAVEL_PLATE } from "./travelling-box-rules.js";
import {
  mountWorldPart,
  canvasTexture,
  unmountWorldPart,
  type WorldPart,
} from "./world-part.js";

/** The sign's shape (m) and its canvas (px), the prototype's numbers. */
export const READING_SIGN = {
  canvasWidthPx: 1024,
  canvasHeightPx: 420,
  /** The plate's width; its height keeps the canvas's aspect. */
  widthM: 2.5,
  /** The plate's centre above the ground. */
  centreM: 2.05,
  stemRadiusM: 0.025,
  ringInnerM: 0.32,
  ringOuterM: 0.4,
} as const;

/** The plate's height (m). */
export const READING_SIGN_HEIGHT_M =
  (READING_SIGN.widthM * READING_SIGN.canvasHeightPx) /
  READING_SIGN.canvasWidthPx;

const INK = {
  plate: "rgba(17,18,21,0.93)",
  edge: "rgba(255,255,255,0.10)",
  amber: "#f2b45a",
  seal: "#1a1408",
  title: "#ffffff",
  hint: "#b9b2a5",
  stem: "#2a2b2f",
  voice: "#f9a8d4",
  voiceFill: "rgba(255,255,255,0.08)",
  voiceFillSpeaking: "rgba(249,168,212,0.22)",
  voiceWords: "#ffffff",
} as const;
const SERIF =
  '"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
const TITLE_MAX_PX = 760;

/** The line above the title: "READ  ·  4 MIN". */
export function readingSignOverLine(minutes: number): string {
  return `READ  ·  ${String(minutes)} MIN`;
}

/** The line under the title. */
export const READING_SIGN_HINT = "Tap to open the text";

/** Where the sign's voice is: not started, speaking, paused or heard. */
export type ReadingSignVoice = "idle" | "playing" | "paused" | "ended";

/** The chip's words for each voice state (the prototype's). */
export const READING_SIGN_VOICE_WORDS: Readonly<
  Record<ReadingSignVoice, string>
> = {
  idle: "Has a voice",
  playing: "Speaking",
  paused: "Paused",
  ended: "Heard to the end",
};

/** The 2D context calls the sign uses (a recording context in tests). */
export type SignContext = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "beginPath"
  | "roundRect"
  | "arc"
  | "fill"
  | "stroke"
  | "fillText"
  | "measureText"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "letterSpacing"
>;

/** Split `text` into lines no wider than `maxPx` (a word wider than the
 *  line stands alone on its own). */
function wrapWords(g: SignContext, text: string, maxPx: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter((w) => w !== "")) {
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && g.measureText(next).width > maxPx) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * Draw the sign: the dark rounded plate, the amber seal with four text
 * lines, the over-line, the title (at most two lines, 64 px serif) and the
 * hint, at the prototype's positions on a 1024 x 420 canvas.
 */
export function drawReadingSign(
  g: SignContext,
  sign: {
    readonly title: string;
    readonly minutes: number;
    /** The voice's state for the chip; absent or null draws none. */
    readonly voice?: ReadingSignVoice | null;
  },
): void {
  const W = READING_SIGN.canvasWidthPx;
  const H = READING_SIGN.canvasHeightPx;
  g.clearRect(0, 0, W, H);
  g.beginPath();
  g.roundRect(6, 6, W - 12, H - 12, 46);
  g.fillStyle = INK.plate;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK.edge;
  g.stroke();
  g.fillStyle = INK.amber;
  g.beginPath();
  g.arc(122, 210, 64, 0, 2 * Math.PI);
  g.fill();
  g.fillStyle = INK.seal;
  for (const [y, w] of [
    [182, 70],
    [204, 70],
    [226, 70],
    [248, 44],
  ] as const) {
    g.beginPath();
    g.roundRect(87, y - 5, w, 10, 5);
    g.fill();
  }
  g.fillStyle = INK.amber;
  g.font = `700 29px ${SANS}`;
  g.letterSpacing = "4px";
  g.fillText(readingSignOverLine(sign.minutes), 218, 112);
  g.letterSpacing = "0px";
  g.fillStyle = INK.title;
  g.font = `600 64px ${SERIF}`;
  const title = sign.title.trim() === "" ? "Untitled" : sign.title;
  const lines = wrapWords(g, title, TITLE_MAX_PX).slice(0, 2);
  const top = lines.length === 1 ? 210 : 188;
  lines.forEach((line, i) => {
    g.fillText(line, 216, top + i * 74);
  });
  g.fillStyle = INK.hint;
  g.font = `500 29px ${SANS}`;
  g.fillText(READING_SIGN_HINT, 218, 352);
  if (sign.voice !== undefined && sign.voice !== null) {
    drawVoiceChip(g, sign.voice);
  }
}

/** The chip at the bottom right: a dot and the voice's state, its right
 *  edge 60 px in, at the prototype's size. */
function drawVoiceChip(g: SignContext, voice: ReadingSignVoice): void {
  const words = READING_SIGN_VOICE_WORDS[voice];
  g.font = `700 30px ${SANS}`;
  const width = g.measureText(words).width + 82;
  const x = READING_SIGN.canvasWidthPx - 60 - width;
  g.beginPath();
  g.roundRect(x, 326, width, 64, 32);
  g.fillStyle = voice === "playing" ? INK.voiceFillSpeaking : INK.voiceFill;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK.voice;
  g.stroke();
  g.beginPath();
  g.arc(x + 34, 358, 10, 0, 2 * Math.PI);
  g.fillStyle = INK.voice;
  g.fill();
  g.fillStyle = INK.voiceWords;
  g.fillText(words, x + 56, 369);
}

const toViewer = new Vector3();
const viewerAt = new Vector3();
const toGrow = new Matrix4();

/** Turn `plate` about its parent's upright axis to face `viewerLocal` (a
 *  point in the parent's frame). The prototype's facing rule. */
export function turnToward(plate: Object3D, viewerLocal: Vector3): void {
  plate.rotation.set(
    0,
    Math.atan2(
      viewerLocal.x - plate.position.x,
      viewerLocal.z - plate.position.z,
    ),
    0,
  );
}

/** The words plate's size on the sign (m): `plateSizeM` of the box. */
interface WordsPlateSize {
  readonly widthM: number;
  readonly heightM: number;
}

/** A built sign: the groups, the two plates and what moves them. */
export interface ReadingSignParts {
  /** The renderer's: its pose and a scaled folder's scale. */
  readonly root: Group;
  /** The growth while words hang under the sign, else 1. */
  readonly grow: Group;
  /** Turned about up to the viewer; holds the sign and the words plate. */
  readonly turn: Group;
  /** The sign plate, the tap target. */
  readonly plate: Mesh;
  /** The words plate, a sibling of the sign plate while attached. */
  readonly words: Mesh;
  /** Hangs `texture` under the sign at `size` (replacing what hung). */
  attachWords(texture: Texture, size: WordsPlateSize): void;
  detachWords(): void;
  /** One frame: the viewer in the root's parent frame. */
  update(frame: { readonly viewer: readonly [number, number, number] }): void;
  dispose(): void;
}

/** The sign's geometry: its root on the ground, the plate showing `map`
 *  (turning to the viewer as it is drawn), the stem and the ring, and the
 *  words plate to hang under it. A null map draws a blank plate (the
 *  tests). */
export function buildReadingSign(map: CanvasTexture | null): ReadingSignParts {
  const S = READING_SIGN;
  const root = new Group();
  root.name = "reading-sign";
  const grow = new Group();
  grow.name = "reading-sign-grow";
  root.add(grow);
  const turn = new Group();
  turn.name = "reading-sign-turn";
  grow.add(turn);
  /** Turns the sign to this frame's camera, whichever plate draws first
   *  (the camera's XR pose is set only inside the render). */
  const faceCamera = (camera: Camera): void => {
    camera.getWorldPosition(toViewer);
    turnToward(turn, grow.worldToLocal(toViewer));
    turn.updateMatrixWorld();
  };
  const plateGeometry = new PlaneGeometry(S.widthM, READING_SIGN_HEIGHT_M);
  const plateMaterial = new MeshBasicMaterial({
    map,
    toneMapped: false,
    transparent: true,
    depthWrite: false,
  });
  const plate = new Mesh(plateGeometry, plateMaterial);
  plate.name = "reading-sign-plate";
  plate.position.y = S.centreM;
  plate.renderOrder = 2;
  plate.onBeforeRender = (_renderer, _scene, camera) => {
    faceCamera(camera);
  };
  turn.add(plate);
  const wordsGeometry = new PlaneGeometry(1, 1);
  const wordsMaterial = new MeshBasicMaterial({
    toneMapped: false,
    transparent: true,
    depthWrite: false,
  });
  const words = new Mesh(wordsGeometry, wordsMaterial);
  words.name = "reading-sign-words";
  words.renderOrder = 3;
  // Belt and braces: a sibling of the tap target is never picked as it,
  // and the plate takes no ray of its own either.
  words.raycast = () => undefined;
  words.onBeforeRender = (_renderer, _scene, camera) => {
    faceCamera(camera);
  };
  let attached = false;
  const stemHeight = S.centreM - READING_SIGN_HEIGHT_M / 2;
  const stemGeometry = new CylinderGeometry(
    S.stemRadiusM,
    S.stemRadiusM,
    stemHeight,
    8,
  );
  const stemMaterial = new MeshLambertMaterial({
    color: INK.stem,
    transparent: true,
    opacity: 0.85,
  });
  const stem = new Mesh(stemGeometry, stemMaterial);
  stem.position.y = stemHeight / 2;
  grow.add(stem);
  const ringGeometry = new RingGeometry(S.ringInnerM, S.ringOuterM, 48);
  const ringMaterial = new MeshBasicMaterial({
    color: INK.amber,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  grow.add(ring);
  return {
    root,
    grow,
    turn,
    plate,
    words,
    attachWords(texture, size) {
      for (const v of [size.widthM, size.heightM]) {
        if (!Number.isFinite(v) || v <= 0) {
          throw new RangeError(
            `a words plate needs a positive size, got ${String(v)}`,
          );
        }
      }
      if (wordsMaterial.map !== texture) {
        wordsMaterial.map = texture;
        wordsMaterial.needsUpdate = true;
      }
      words.scale.set(size.widthM, size.heightM, 1);
      words.position.set(
        0,
        S.centreM -
          READING_SIGN_HEIGHT_M / 2 -
          TRAVEL_PLATE.gapM -
          size.heightM / 2,
        TRAVEL_PLATE.frontM,
      );
      if (!attached) turn.add(words);
      attached = true;
    },
    detachWords() {
      if (!attached) return;
      turn.remove(words);
      attached = false;
      grow.scale.setScalar(1);
    },
    update(frame) {
      viewerAt.set(frame.viewer[0], frame.viewer[1], frame.viewer[2]);
      const d = Math.hypot(
        viewerAt.x - root.position.x,
        viewerAt.z - root.position.z,
      );
      grow.scale.setScalar(attached ? signGrowth(d) : 1);
      root.updateMatrix();
      grow.updateMatrix();
      toGrow.multiplyMatrices(root.matrix, grow.matrix).invert();
      turnToward(turn, viewerAt.applyMatrix4(toGrow));
    },
    dispose() {
      for (const geometry of [
        plateGeometry,
        stemGeometry,
        ringGeometry,
        wordsGeometry,
      ]) {
        geometry.dispose();
      }
      plateMaterial.dispose();
      stemMaterial.dispose();
      ringMaterial.dispose();
      wordsMaterial.dispose();
    },
  };
}

/** A long text as its sign and its sheet need it. */
export interface ReadingSignBlock {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** A mounted reading sign: a world part whose plate takes the tap. */
export interface ReadingSignHandle extends WorldPart {
  /** The block the sign stands for; its sheet shows this text. */
  readonly block: ReadingSignBlock;
  /** The plate. */
  readonly tapTarget: Object3D;
  /** The words plate (hung by `attachWords`). */
  readonly wordsPlate: Object3D;
  /** Turns the sign, and grows it while words hang under it. */
  update(frame: { readonly viewer: readonly [number, number, number] }): void;
  /** Hangs the words' texture under the sign (the caller owns it). */
  attachWords(texture: Texture, size: WordsPlateSize): void;
  detachWords(): void;
  /** The chip on the face; null for none. Repaints only on a change. */
  setVoiceState(state: ReadingSignVoice | null): void;
}

/**
 * Build the reading sign for a long text: its title and its reading time
 * (the words of its body's plain text at 200 a minute, `readMinutes`).
 * A tap on its plate opens the text by `open` (the visitor's reading
 * sheet); without it the sign takes no tap (the 3D editor's).
 *
 * @throws when the page has no 2D canvas (a page without a DOM: the
 *   renderer's caller passes this builder only in a browser).
 */
export function mountReadingSign(
  block: ReadingSignBlock,
  open?: (block: ReadingSignBlock) => void,
): ReadingSignHandle {
  const canvas = document.createElement("canvas");
  canvas.width = READING_SIGN.canvasWidthPx;
  canvas.height = READING_SIGN.canvasHeightPx;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("the reading sign needs a 2D canvas");
  const minutes = readMinutes(wordCount(block.body));
  let voice: ReadingSignVoice | null = null;
  drawReadingSign(g, { title: block.title, minutes, voice });
  const texture = canvasTexture(canvas);
  const sign = buildReadingSign(texture);
  sign.root.userData["objectId"] = block.id;
  const shown = { id: block.id, title: block.title, body: block.body };
  const handle: ReadingSignHandle = {
    block: shown,
    object: sign.root,
    tapTarget: sign.plate,
    wordsPlate: sign.words,
    update: (frame) => {
      sign.update(frame);
    },
    attachWords: (words, size) => {
      sign.attachWords(words, size);
    },
    detachWords: () => {
      sign.detachWords();
    },
    setVoiceState(state) {
      if (state === voice) return;
      voice = state;
      drawReadingSign(g, { title: block.title, minutes, voice });
      texture.needsUpdate = true;
    },
    ...(open === undefined
      ? {}
      : {
          tap() {
            open(shown);
          },
        }),
    dispose() {
      if (!unmountWorldPart(handle)) return;
      sign.root.removeFromParent();
      sign.dispose();
      texture.dispose();
    },
  };
  mountWorldPart(handle);
  return handle;
}

/**
 * What the sheet shows for a sign's text: the line above the title names
 * the station and its place in the tour ("Old square · Station 1", the
 * prototype's line; "Station 2" for an untitled one), or is empty when
 * no station holds the block.
 */
export function readingSheetContent(
  stations: readonly Pick<TourStation, "title" | "children">[],
  block: ReadingSignBlock,
): { over: string; title: string; body: string } {
  const at = stations.findIndex((s) =>
    tourStationBlocks(s).some((b) => b.id === block.id),
  );
  const station = stations[at];
  return {
    over: station === undefined ? "" : stationLine(station.title, at + 1),
    title: block.title,
    body: block.body,
  };
}

function stationLine(title: string | undefined, number: number): string {
  const name = title?.trim() ?? "";
  const place = `Station ${String(number)}`;
  return name === "" ? place : `${name} · ${place}`;
}
