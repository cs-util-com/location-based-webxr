/**
 * A short text as a sign: its plate (`plate.ts`) on a board with an edge,
 * on one post or two, standing on the ground at its pose. The board's
 * bottom rises with the reading distance, so a sign read from far clears
 * a crowd. Both faces carry the words.
 *
 * It turns by its `orientation`: `world` (and none) keeps its pose's turn;
 * `upright` and `face` turn the whole sign about its posts toward the
 * visitor, eased (a standing sign never tilts). A sign that points
 * somewhere (`pointsTo`) shows a turning glyph in place of its role icon:
 * an arrow that points, as seen across the board, to that point.
 *
 * @see sign.ts.md
 */

import {
  shortTextLetterHeightM,
  type TourShortTextPoint,
} from "gps-plus-slam-app-framework/ar/tour-short-text";
import type { TourBlockOfKind } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";

import { smoothingAlpha } from "../../surface-smoothing.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import {
  glyphCanvas,
  PLATE_PX_PER_EM,
  SHORT_TEXT_ACCENT,
  SHORT_TEXT_DEFAULT_ROLE,
  signPlate,
} from "./plate.js";

type TourShortTextBlock = TourBlockOfKind["shortText"];

/** A short text's reading distance where it names none (m). */
export const SHORT_TEXT_DEFAULT_READ_AT_M = 4;

/** The sign's build, in metres. */
export const SIGN = {
  /** The board's bottom: this, plus `bottomPerReadM` per metre read. */
  bottomM: 0.95,
  bottomPerReadM: 0.04,
  /** Board and post colour. */
  wood: "#2a3038",
  /** Two posts on a board wider than this, else one. */
  twoPostsOverM: 0.9,
  /** How fast it turns toward the visitor, and the glyph to its point
   *  (1/s). */
  turnRate: 7,
  glyphRate: 8,
} as const;

/** The sign's measures for a letter height `em` and a board of
 *  `boardW` x `boardH` m, as the prototype built it. */
export function signMeasures(
  readAtM: number,
  boardW: number,
): {
  readonly bottom: number;
  readonly thickness: number;
  readonly postR: number;
  readonly postXs: readonly number[];
} {
  const em = shortTextLetterHeightM(readAtM);
  const inset = Math.max(0.12, boardW * 0.14);
  return {
    bottom: SIGN.bottomM + SIGN.bottomPerReadM * readAtM,
    thickness: Math.max(0.035, em * 0.25),
    postR: Math.max(0.025, em * 0.16),
    postXs:
      boardW > SIGN.twoPostsOverM
        ? [-boardW / 2 + inset, boardW / 2 - inset]
        : [0],
  };
}

/** `a` and `b` the short way round, `a` moved toward `b` by `k`. */
function easeAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

const local = new Vector3();
const inverse = new Matrix4();

/** `block` as a sign. */
export function signPart(block: TourShortTextBlock, env: WorldEnv): WorldPart {
  const role = block.role ?? SHORT_TEXT_DEFAULT_ROLE;
  const readAtM = block.readAtM ?? SHORT_TEXT_DEFAULT_READ_AT_M;
  const em = shortTextLetterHeightM(readAtM);
  const s = em / PLATE_PX_PER_EM;
  const points: TourShortTextPoint | undefined = block.pointsTo;
  const plate = signPlate(block.caption, block.description, role, {
    icon: points === undefined,
  });
  const lay = plate.layout;
  const boardW = lay.bodyW * s;
  const boardH = lay.bodyH * s;
  const m = signMeasures(readAtM, boardW);

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const basic = (
    params: ConstructorParameters<typeof MeshBasicMaterial>[0],
  ) => {
    const material = new MeshBasicMaterial({ toneMapped: false, ...params });
    materials.push(material);
    return material;
  };
  const geometry = <G extends BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };

  const object = new Group();
  object.name = "short-text-sign";
  const turn = new Group();
  object.add(turn);
  const board = new Group();
  board.position.y = m.bottom + boardH / 2;
  turn.add(board);

  const wood = basic({ color: SIGN.wood });
  const edge = new Mesh(
    geometry(new BoxGeometry(boardW * 0.985, boardH * 0.97, m.thickness)),
    wood,
  );
  board.add(edge);

  // The plate's canvas holds a margin round the board for its shadow: the
  // plane is the canvas, shifted so the board's centre is the origin.
  const plateGeometry = geometry(
    new PlaneGeometry(lay.canvasW * s, lay.canvasH * s),
  );
  plateGeometry.translate(
    (lay.canvasW / 2 - (lay.margin + lay.bodyW / 2)) * s,
    (lay.margin + lay.bodyH / 2 - lay.canvasH / 2) * s,
    0,
  );
  const map = plate.canvas === null ? null : env.canvasTexture(plate.canvas);
  if (map !== null) textures.push(map);
  const plateMaterial = basic(
    map === null
      ? { color: "#11151b" }
      : { map, transparent: true, depthWrite: false },
  );
  const front = new Mesh(plateGeometry, plateMaterial);
  front.position.z = m.thickness / 2 + 0.002;
  front.renderOrder = 5;
  const back = new Mesh(plateGeometry, plateMaterial);
  back.rotation.y = Math.PI;
  back.position.z = -m.thickness / 2 - 0.002;
  back.renderOrder = 5;
  board.add(front, back);

  for (const x of m.postXs) {
    const postH = m.bottom + 0.03;
    const post = new Mesh(
      geometry(new CylinderGeometry(m.postR, m.postR * 1.1, postH, 12)),
      wood,
    );
    post.position.set(x, postH / 2, 0);
    const foot = new Mesh(
      geometry(new CylinderGeometry(m.postR * 2.2, m.postR * 2.4, 0.06, 16)),
      wood,
    );
    foot.position.set(x, 0.03, 0);
    turn.add(post, foot);
  }

  // The turning glyph, on both faces where the role icon would be.
  const glyphs: Mesh[] = [];
  if (points !== undefined) {
    const canvas = glyphCanvas(role);
    const glyphMap = canvas === null ? null : env.canvasTexture(canvas);
    if (glyphMap !== null) textures.push(glyphMap);
    const glyphMaterial = basic(
      glyphMap === null
        ? { color: SHORT_TEXT_ACCENT[role], side: DoubleSide }
        : { map: glyphMap, transparent: true, depthWrite: false },
    );
    const size = 0.86 * em;
    const glyphGeometry = geometry(new PlaneGeometry(size, size));
    const x = (lay.iconX - (lay.margin + lay.bodyW / 2)) * s;
    const y = (lay.margin + lay.bodyH / 2 - lay.iconY) * s;
    for (const side of [front, back]) {
      const glyph = new Mesh(glyphGeometry, glyphMaterial);
      glyph.position.set(x, y, 0.003);
      glyph.renderOrder = 6;
      side.add(glyph);
      glyphs.push(glyph);
    }
  }

  const turns = block.orientation === "upright" || block.orientation === "face";
  let lastSeconds: number | null = null;
  let yaw: number | null = null;
  const glyphAngles = new Map<Mesh, number>();

  return {
    object,
    tapTarget: board,
    update(frame) {
      const dt =
        lastSeconds === null
          ? Number.POSITIVE_INFINITY
          : Math.min(0.1, frame.seconds - lastSeconds);
      lastSeconds = frame.seconds;
      if (turns) {
        // The viewer in the sign's own frame: the yaw that faces it.
        object.updateMatrix();
        inverse.copy(object.matrix).invert();
        local.set(...frame.viewer).applyMatrix4(inverse);
        const target = Math.atan2(local.x, local.z);
        yaw =
          yaw === null
            ? target
            : easeAngle(yaw, target, smoothingAlpha(1 / SIGN.turnRate, dt));
        turn.rotation.y = yaw;
      }
      if (points === undefined || object.parent === null) return;
      // Its point is in the frame its part stands in (its parent's).
      object.parent.updateWorldMatrix(true, false);
      object.updateWorldMatrix(false, true);
      for (const glyph of glyphs) {
        const side = glyph.parent;
        if (side === null) continue;
        local.set(...points);
        object.parent.localToWorld(local);
        side.worldToLocal(local);
        const target = -Math.atan2(local.x - glyph.position.x, -local.z);
        const was = glyphAngles.get(glyph);
        const angle =
          was === undefined
            ? target
            : easeAngle(was, target, smoothingAlpha(1 / SIGN.glyphRate, dt));
        glyphAngles.set(glyph, angle);
        glyph.rotation.z = angle;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
