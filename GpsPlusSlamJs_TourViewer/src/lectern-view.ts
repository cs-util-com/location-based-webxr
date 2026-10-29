/**
 * The reading stand (a long text's `lectern` view, `tour.json` minor 3):
 * a tilted board on two legs at the block's pose, its page a canvas
 * texture showing nine lines of the current paragraph with the current
 * sentence highlighted, turned by a tap (`lecternTurn`). Built as the
 * prototype builds it (`public/prototypes/station-blocks-1-narrated-text/`,
 * the lectern), without its voice: the page follows a voice only once a
 * long text carries a narration, which the format does not have yet.
 *
 * The stand keeps its pose - it does not turn to the visitor - and faces
 * its local +z (the photo planes' rule: a creator's "face me" rotation
 * turns the page toward them). Up is local +y.
 *
 * Mounted stands are kept in a registry (`mountedLecterns`), the model
 * views' pattern, so a tap finds them without walking the scene.
 *
 * @see lectern-view.ts.md
 */

import {
  parseTourMarkdown,
  plainTextOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
} from "three";

import {
  analyzeLecternText,
  LECTERN_PAGE,
  LECTERN_FIRST_PLACE,
  lecternPlaceStart,
  lecternTurn,
  wrapLecternParagraph,
  type LecternPlace,
  type LecternText,
} from "./lectern-page.js";
import { shownIn } from "./model-visitor.js";

/** The stand's shape (m), the prototype's numbers. */
export const LECTERN_STAND = {
  /** The page's width and height. */
  pageWidthM: 1.2,
  pageHeightM: 0.9,
  /** The board leans back by this much from upright. */
  tiltDeg: 16,
  /** The page's centre above the ground. */
  pageCentreM: 1.32,
  legOffsetM: 0.42,
  color: "#2b2d31",
} as const;

/** The page's colours and type, the prototype's. */
const INK = {
  paper: "#16171a",
  header: "#f2b45a",
  title: "#ffffff",
  rule: "rgba(255,255,255,0.1)",
  highlight: "rgba(242,180,90,0.17)",
  current: "#fdfaf3",
  before: "#7f7a71",
  after: "#c4beb2",
  track: "rgba(255,255,255,0.12)",
  footer: "#a49e92",
} as const;
const SERIF =
  '"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
const BODY_FONT = `400 38px ${SERIF}`;

/** What the page shows: the block's title and text, the sentence, and
 *  the window's first line when a turn moved it inside that sentence
 *  (absent or null: the window the sentence opens). */
export interface LecternPageState {
  readonly title: string;
  readonly text: LecternText;
  readonly sentence: number;
  readonly start?: number | null;
}

/** The page texture's anisotropy: the prototype asks for the renderer's
 *  maximum, and three clamps a texture's to that maximum when it uploads
 *  it, so the largest any WebGL device reports (16) asks for the same. */
export const LECTERN_PAGE_ANISOTROPY = 16;

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function setSpacing(g: CanvasRenderingContext2D, px: number): void {
  // Not in every engine's canvas; the page reads without it.
  if ("letterSpacing" in g) g.letterSpacing = `${String(px)}px`;
}

/** `text` cut with an ellipsis until it is at most `maxW` wide. */
function fitted(
  g: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string {
  let t = text;
  while (g.measureText(t).width > maxW && t.length > 4) {
    t = `${t.slice(0, -2).trimEnd()}…`;
  }
  return t;
}

/**
 * Draw the page onto `g` (a `LECTERN_PAGE` sized canvas): the paragraph
 * header, the title, a rule, nine lines of the current sentence's
 * paragraph (the sentence highlighted, what came before dimmer), the
 * footer's track and "tap the page to turn" with the sentence's number.
 */
export function drawLecternPage(
  g: CanvasRenderingContext2D,
  page: LecternPageState,
): void {
  const { widthPx: W, heightPx: H, marginPx: M } = LECTERN_PAGE;
  const { text } = page;
  const count = text.sentences.length;
  const s = count === 0 ? 0 : Math.min(Math.max(0, page.sentence), count - 1);
  const sentence = text.sentences[s];
  const p = sentence?.p ?? 0;
  g.clearRect(0, 0, W, H);
  g.fillStyle = INK.paper;
  g.fillRect(0, 0, W, H);
  g.fillStyle = INK.header;
  g.font = `700 22px ${SANS}`;
  setSpacing(g, 3);
  g.fillText(
    `PARAGRAPH ${String(p + 1)} OF ${String(Math.max(1, text.paragraphs.length))}`,
    M,
    70,
  );
  setSpacing(g, 0);
  g.fillStyle = INK.title;
  g.font = `600 40px ${SERIF}`;
  g.fillText(fitted(g, page.title, LECTERN_PAGE.lineWidthPx), 60, 122);
  g.fillStyle = INK.rule;
  g.fillRect(M, 148, LECTERN_PAGE.lineWidthPx, 2);

  g.font = BODY_FONT;
  if (sentence !== undefined) {
    const lines = wrapLecternParagraph(text, p, (w) => g.measureText(w).width);
    const start = lecternPlaceStart(lines, sentence.from, page.start ?? null);
    for (let r = 0; r < LECTERN_PAGE.rows; r += 1) {
      const line = lines[start + r];
      if (line === undefined) break;
      const y = LECTERN_PAGE.firstBaselinePx + r * LECTERN_PAGE.lineStepPx;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const tk of line) {
        if (tk.from < sentence.to && tk.to > sentence.from) {
          x0 = Math.min(x0, tk.x);
          x1 = Math.max(x1, tk.x + tk.w);
        }
      }
      if (x1 > x0) {
        g.fillStyle = INK.highlight;
        roundRect(g, M + x0 - 8, y - 38, x1 - x0 + 16, 52, 8);
        g.fill();
      }
      for (const tk of line) {
        const inside = tk.from < sentence.to && tk.to > sentence.from;
        g.fillStyle = inside
          ? INK.current
          : tk.to <= sentence.from
            ? INK.before
            : INK.after;
        g.fillText(tk.text, M + tk.x, y);
      }
    }
  }

  g.fillStyle = INK.track;
  roundRect(g, M, 690, LECTERN_PAGE.lineWidthPx, 6, 3);
  g.fill();
  g.font = `500 22px ${SANS}`;
  g.fillStyle = INK.footer;
  g.fillText(
    `tap the page to turn  ·  ${String(count === 0 ? 0 : s + 1)} / ${String(count)}`,
    M,
    738,
  );
}

/** The page's texture: sRGB, and as sharp seen at a slant from the
 *  square as the renderer allows (`LECTERN_PAGE_ANISOTROPY`). */
export function lecternPageTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = LECTERN_PAGE_ANISOTROPY;
  return texture;
}

/** The stand's geometry: the board (its back, the page plane showing
 *  `pageMap`, and the lip) on two legs and feet, its root on the ground.
 *  A null map draws a blank page (a page with no canvas, and the tests). */
export function buildLecternStand(pageMap: CanvasTexture | null): {
  root: Group;
  page: Mesh;
  dispose(): void;
} {
  const S = LECTERN_STAND;
  const tilt = MathUtils.degToRad(S.tiltDeg);
  const dark = new MeshLambertMaterial({ color: S.color });
  const paper = new MeshBasicMaterial({ map: pageMap, toneMapped: false });
  const geometries: (BoxGeometry | PlaneGeometry)[] = [];
  const box = (w: number, h: number, d: number): BoxGeometry => {
    const g = new BoxGeometry(w, h, d);
    geometries.push(g);
    return g;
  };
  const root = new Group();
  root.name = "lectern";
  const board = new Group();
  board.position.y = S.pageCentreM;
  board.rotation.x = -tilt;
  root.add(board);
  const back = new Mesh(
    box(S.pageWidthM + 0.08, S.pageHeightM + 0.08, 0.04),
    dark,
  );
  back.position.z = -0.025;
  board.add(back);
  const plane = new PlaneGeometry(S.pageWidthM, S.pageHeightM);
  geometries.push(plane);
  const page = new Mesh(plane, paper);
  page.name = "lectern-page";
  board.add(page);
  const lip = new Mesh(box(S.pageWidthM + 0.08, 0.04, 0.07), dark);
  lip.position.set(0, -S.pageHeightM / 2 - 0.04, 0.03);
  board.add(lip);
  const bottom = S.pageCentreM - (Math.cos(tilt) * S.pageHeightM) / 2;
  for (const lx of [-S.legOffsetM, S.legOffsetM]) {
    const leg = new Mesh(box(0.05, bottom, 0.05), dark);
    leg.position.set(lx, bottom / 2, -0.05);
    root.add(leg);
    const foot = new Mesh(box(0.07, 0.04, 0.5), dark);
    foot.position.set(lx, 0.02, -0.05);
    root.add(foot);
  }
  return {
    root,
    page,
    dispose() {
      for (const g of geometries) g.dispose();
      dark.dispose();
      paper.dispose();
    },
  };
}

/** A mounted reading stand. */
export interface LecternHandle {
  readonly blockId: string;
  /** The stand: placed by the caller at the block's pose. */
  readonly object: Object3D;
  /** The page plane: what a tap is cast against. */
  readonly page: Object3D;
  /** The sentence the page is on. */
  sentence(): number;
  /** Turn the page (a tap): seven lines on (inside a long sentence too),
   *  the next paragraph, or back to the first. */
  turn(): void;
  dispose(): void;
}

const mounted = new Set<LecternHandle>();

/** The stands mounted and not yet disposed, oldest first. */
export function mountedLecterns(): LecternHandle[] {
  return [...mounted];
}

/**
 * Build the reading stand for a long text: `body` is Markdown, read as its
 * plain text (`plainTextOf`), so the page shows words and no markup. The
 * page is drawn once and again on each turn.
 *
 * @throws when the page has no 2D canvas (a page without a DOM: the
 *   renderer's caller passes this builder only in a browser).
 */
export function mountLectern(block: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}): LecternHandle {
  const canvas = document.createElement("canvas");
  canvas.width = LECTERN_PAGE.widthPx;
  canvas.height = LECTERN_PAGE.heightPx;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("the reading stand needs a 2D canvas");
  const texture = lecternPageTexture(canvas);
  const text = analyzeLecternText(
    plainTextOf(parseTourMarkdown(block.body)).text,
  );
  const stand = buildLecternStand(texture);
  let place: LecternPlace = LECTERN_FIRST_PLACE;
  const draw = (): void => {
    drawLecternPage(g, { title: block.title, text, ...place });
    texture.needsUpdate = true;
  };
  draw();
  stand.root.userData["objectId"] = block.id;
  const handle: LecternHandle = {
    blockId: block.id,
    object: stand.root,
    page: stand.page,
    sentence: () => place.sentence,
    turn() {
      g.font = BODY_FONT;
      place = lecternTurn(text, place, (w) => g.measureText(w).width);
      draw();
    },
    dispose() {
      if (!mounted.delete(handle)) return;
      stand.root.removeFromParent();
      stand.dispose();
      texture.dispose();
    },
  };
  mounted.add(handle);
  return handle;
}

/**
 * A visitor's tap on a reading stand: the stand whose page is under the
 * tap (`pick`, the page's `pickObjectInView`) among `handles` turns its
 * page. True when one did.
 */
export function turnLecternUnderTap<T>(
  handles: readonly LecternHandle[],
  pick: (targets: ReadonlyMap<string, Object3D>, tap: T) => string | null,
  tap: T,
): boolean {
  if (handles.length === 0) return false;
  const byId = new Map(handles.map((h) => [h.blockId, h]));
  const hit = pick(new Map(handles.map((h) => [h.blockId, h.page])), tap);
  const handle = hit === null ? undefined : byId.get(hit);
  if (handle === undefined) return false;
  handle.turn();
  return true;
}

/**
 * The visitor's tap on the reading stands (`main.ts`): only the stands
 * shown under a station's content group of `scene` (`shownIn`, the model
 * views' rule) can turn, so a hidden station's stand never takes a tap;
 * no scene, no turn. True when one turned.
 */
export function turnShownLecternUnderTap<T>(
  scene: Object3D | null,
  pick: (targets: ReadonlyMap<string, Object3D>, tap: T) => string | null,
  tap: T,
  handles: readonly LecternHandle[] = mountedLecterns(),
): boolean {
  if (scene === null) return false;
  return turnLecternUnderTap(
    handles.filter((h) => shownIn(h.object, scene)),
    pick,
    tap,
  );
}
