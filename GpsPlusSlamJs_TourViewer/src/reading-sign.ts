/**
 * The reading sign (a long text's `reading` view, `tour.json` minor 4): a
 * short dark sign on a thin stem at the block's pose, naming the text and
 * how long it takes to read, that opens the whole text in the reading
 * sheet (`long-text-sheet.ts`) on a tap. Built as the narrated-text
 * prototype builds its sign (`public/prototypes/station-blocks-1-narrated-text/`,
 * `drawLabel`), without its voice: the format has no narration for a long
 * text yet, so the sign always says "READ".
 *
 * The plate turns about its upright axis to face the viewer each frame
 * (the prototype's rule), so it reads from any side; the stem and the ring
 * on the ground are round and need no turning.
 *
 * Mounted signs are kept in a registry (`mountedReadingSigns`), the
 * reading stands' pattern, so a tap finds them without walking the scene.
 *
 * @see reading-sign.ts.md
 */

import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from "three";

import { readMinutes, wordCount } from "./long-text-sheet.js";
import { shownIn } from "./model-visitor.js";

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
  sign: { readonly title: string; readonly minutes: number },
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
}

const toViewer = new Vector3();

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

/** The sign's geometry: its root on the ground, the plate showing `map`
 *  (turning to the viewer as it is drawn), the stem and the ring. A null
 *  map draws a blank plate (the tests). */
export function buildReadingSign(map: CanvasTexture | null): {
  root: Group;
  plate: Mesh;
  dispose(): void;
} {
  const S = READING_SIGN;
  const root = new Group();
  root.name = "reading-sign";
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
    const parent = plate.parent;
    if (parent === null) return;
    camera.getWorldPosition(toViewer);
    turnToward(plate, parent.worldToLocal(toViewer));
    plate.updateMatrixWorld();
  };
  root.add(plate);
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
  root.add(stem);
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
  root.add(ring);
  return {
    root,
    plate,
    dispose() {
      for (const geometry of [plateGeometry, stemGeometry, ringGeometry]) {
        geometry.dispose();
      }
      plateMaterial.dispose();
      stemMaterial.dispose();
      ringMaterial.dispose();
    },
  };
}

/** A long text as its sign and its sheet need it. */
export interface ReadingSignBlock {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** A mounted reading sign. */
export interface ReadingSignHandle {
  /** The block the sign stands for; its sheet shows this text. */
  readonly block: ReadingSignBlock;
  /** The sign: placed by the caller at the block's pose. */
  readonly object: Object3D;
  /** The plate: what a tap is cast against. */
  readonly plate: Object3D;
  dispose(): void;
}

const mounted = new Set<ReadingSignHandle>();

/** The signs mounted and not yet disposed, oldest first. */
function mountedReadingSigns(): ReadingSignHandle[] {
  return [...mounted];
}

/**
 * Build the reading sign for a long text: its title and its reading time
 * (the words of its body's plain text at 200 a minute, `readMinutes`).
 *
 * @throws when the page has no 2D canvas (a page without a DOM: the
 *   renderer's caller passes this builder only in a browser).
 */
export function mountReadingSign(block: ReadingSignBlock): ReadingSignHandle {
  const canvas = document.createElement("canvas");
  canvas.width = READING_SIGN.canvasWidthPx;
  canvas.height = READING_SIGN.canvasHeightPx;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("the reading sign needs a 2D canvas");
  drawReadingSign(g, {
    title: block.title,
    minutes: readMinutes(wordCount(block.body)),
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sign = buildReadingSign(texture);
  sign.root.userData["objectId"] = block.id;
  const handle: ReadingSignHandle = {
    block: { id: block.id, title: block.title, body: block.body },
    object: sign.root,
    plate: sign.plate,
    dispose() {
      if (!mounted.delete(handle)) return;
      sign.root.removeFromParent();
      sign.dispose();
      texture.dispose();
    },
  };
  mounted.add(handle);
  return handle;
}

/**
 * The sign whose plate is under the tap (`pick`, the page's
 * `pickObjectInView`) among `handles`, or null.
 */
export function readingSignUnderTap<T>(
  handles: readonly ReadingSignHandle[],
  pick: (targets: ReadonlyMap<string, Object3D>, tap: T) => string | null,
  tap: T,
): ReadingSignHandle | null {
  if (handles.length === 0) return null;
  const byId = new Map(handles.map((h) => [h.block.id, h]));
  const hit = pick(new Map(handles.map((h) => [h.block.id, h.plate])), tap);
  return hit === null ? null : (byId.get(hit) ?? null);
}

/**
 * The visitor's tap on the reading signs (`main.ts`): only the signs shown
 * under a station's content group of `scene` (`shownIn`) can take it, so a
 * hidden station's sign never opens; no scene, no sign.
 */
export function shownReadingSignUnderTap<T>(
  scene: Object3D | null,
  pick: (targets: ReadonlyMap<string, Object3D>, tap: T) => string | null,
  tap: T,
  handles: readonly ReadingSignHandle[] = mountedReadingSigns(),
): ReadingSignHandle | null {
  if (scene === null) return null;
  return readingSignUnderTap(
    handles.filter((h) => shownIn(h.object, scene)),
    pick,
    tap,
  );
}

/**
 * What the sheet shows for a sign's text: the line above the title names
 * the station and its place in the tour ("Old square · Station 1", the
 * prototype's line; "Station 2" for an untitled one), or is empty when
 * no station holds the block.
 */
export function readingSheetContent(
  stations: readonly {
    readonly title?: string;
    readonly blocks: readonly { readonly id: string }[];
  }[],
  block: ReadingSignBlock,
): { over: string; title: string; body: string } {
  const at = stations.findIndex((s) => s.blocks.some((b) => b.id === block.id));
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
