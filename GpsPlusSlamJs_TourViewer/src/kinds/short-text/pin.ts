/**
 * A short text as a pin: a dark head carrying its words (`plate.ts`, the
 * pin's style: a rounded tag with a pointer) on a thin stem, over a ring on
 * the ground that pulses slowly. It says "here" without covering anything,
 * and the stem ties the words to a spot on the ground.
 *
 * Its reading distance sets both the letter height and how high the head
 * floats (1.7 m plus 10 cm per metre read), so a pin read from far clears
 * a crowd. Its head turns by its `orientation`: `world` keeps its pose's
 * turn, `upright` (and none, `PIN_DEFAULT_ORIENTATION`) turns about the
 * stem toward the visitor, and `face` also tilts it to the visitor's
 * eyes. A pin that points somewhere
 * (`pointsTo`) shows the sign's turning arrow in place of its role icon,
 * on both faces of the head.
 *
 * @see pin.ts.md
 */

import {
  shortTextLetterHeightM,
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
  type TourShortTextPoint,
} from "gps-plus-slam-app-framework/ar/tour-short-text";
import type { TourBlockOfKind } from "gps-plus-slam-app-framework/ar/tour-kinds";
import {
  CircleGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from "three";

import { easeAngle } from "../../angle-easing.js";
import { smoothingAlpha } from "../../surface-smoothing.js";
import type { WorldEnv, WorldPart } from "../../world-part.js";
import {
  glyphCanvas,
  makeCanvas,
  paintedPlate,
  PIN_PLATE,
  PLATE_PX_PER_EM,
  SHORT_TEXT_ACCENT,
  SHORT_TEXT_DEFAULT_READ_AT_M,
  SHORT_TEXT_DEFAULT_ROLE,
} from "./plate.js";

type TourShortTextBlock = TourBlockOfKind["shortText"];

/** The pin's build, as the chosen prototype measured it. */
export const PIN = {
  /** The head's height: this, plus `liftPerReadM` per metre read (m). */
  liftM: 1.7,
  liftPerReadM: 0.1,
  /** The stem: its radius in letter heights, at least `stemMinM`. */
  stemPerEm: 0.07,
  stemMinM: 0.011,
  stemInk: "#20262e",
  stemOpacity: 0.92,
  /** The ground mark's size: letter heights, at least `groundMinM`. */
  groundPerEm: 2.4,
  groundMinM: 0.22,
  discInk: "#14181e",
  discOpacity: 0.5,
  ringOpacity: 0.95,
  /** The pulse: one swell every `pulsePeriodS`, from 0.7 to 2.2 times
   *  its size, fading from `pulseOpacity` to nothing. */
  pulsePeriodS: 2.8,
  pulseOpacity: 0.55,
  /** How fast the head turns toward the visitor, and the arrow to its
   *  point (1/s). */
  turnRate: 7,
  glyphRate: 8,
} as const;

/** How a pin without an `orientation` turns: upright toward the
 *  visitor, since a flat head kept still is seen edge-on from the side
 *  (the editor's chip shows the same, `kinds/edit-kinds.ts`). */
export const PIN_DEFAULT_ORIENTATION = "upright";

/** A pin's measures for a reading distance (clamped to the format's). */
export function pinMeasures(readAtM: number): {
  readonly em: number;
  readonly liftM: number;
  readonly stemR: number;
  readonly groundM: number;
} {
  const read = Math.min(
    TOUR_SHORT_TEXT_MAX_READ_AT_M,
    Math.max(TOUR_SHORT_TEXT_MIN_READ_AT_M, readAtM),
  );
  const em = shortTextLetterHeightM(read);
  return {
    em,
    liftM: PIN.liftM + PIN.liftPerReadM * read,
    stemR: Math.max(PIN.stemMinM, em * PIN.stemPerEm),
    groundM: Math.max(PIN.groundMinM, em * PIN.groundPerEm),
  };
}

/** A soft ring of light, white on a canvas (tinted by its material), or
 *  null on a page with none. */
function haloCanvas(): HTMLCanvasElement | null {
  const made = makeCanvas(256, 256);
  if (made === null) return null;
  const { canvas, g } = made;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, "rgba(255,255,255,0.10)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.16)");
  grd.addColorStop(0.74, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.8, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.9, "rgba(255,255,255,0.18)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return canvas;
}

const local = new Vector3();
const inverse = new Matrix4();

/** `block` as a pin. */
export function pinPart(block: TourShortTextBlock, env: WorldEnv): WorldPart {
  const role = block.role ?? SHORT_TEXT_DEFAULT_ROLE;
  const accent = SHORT_TEXT_ACCENT[role];
  const m = pinMeasures(block.readAtM ?? SHORT_TEXT_DEFAULT_READ_AT_M);
  const s = m.em / PLATE_PX_PER_EM;
  const points: TourShortTextPoint | undefined = block.pointsTo;
  const plate = paintedPlate(
    PIN_PLATE,
    block.caption,
    block.description,
    role,
    { icon: points === undefined },
  );
  const lay = plate.layout;

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const basic = (
    params: ConstructorParameters<typeof MeshBasicMaterial>[0],
  ) => {
    const material = new MeshBasicMaterial({
      toneMapped: false,
      transparent: true,
      depthWrite: false,
      ...params,
    });
    materials.push(material);
    return material;
  };
  const geometry = <G extends BufferGeometry>(g: G): G => {
    geometries.push(g);
    return g;
  };
  const texture = (canvas: HTMLCanvasElement | null): Texture | null => {
    const map = canvas === null ? null : env.canvasTexture(canvas);
    if (map !== null) textures.push(map);
    return map;
  };

  const object = new Group();
  object.name = "short-text-pin";

  // The head: its pointer's tip at the top of the stem, the board above.
  const head = new Group();
  head.name = "pin-head";
  head.rotation.order = "YXZ";
  head.position.y = m.liftM;
  object.add(head);
  const tipX = lay.margin + lay.bodyW / 2;
  const tipY = lay.margin + lay.bodyH + lay.pointer;
  const plateGeometry = geometry(
    new PlaneGeometry(lay.canvasW * s, lay.canvasH * s),
  );
  plateGeometry.translate(
    (lay.canvasW / 2 - tipX) * s,
    (tipY - lay.canvasH / 2) * s,
    0,
  );
  const map = texture(plate.canvas);
  const plateMaterial = basic(map === null ? { color: "#11151b" } : { map });
  const front = new Mesh(plateGeometry, plateMaterial);
  front.renderOrder = 5;
  const back = new Mesh(plateGeometry, plateMaterial);
  back.rotation.y = Math.PI;
  back.renderOrder = 5;
  head.add(front, back);

  const stem = new Mesh(
    geometry(new CylinderGeometry(m.stemR, m.stemR, m.liftM, 10)),
    basic({ color: PIN.stemInk, opacity: PIN.stemOpacity }),
  );
  stem.name = "pin-stem";
  stem.position.y = m.liftM / 2;
  stem.renderOrder = 4;
  object.add(stem);

  // The mark on the ground: a dark disc, the role's ring, the pulse.
  const flat = (mesh: Mesh, y: number, order: number): Mesh => {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.renderOrder = order;
    object.add(mesh);
    return mesh;
  };
  const gs = m.groundM;
  flat(
    new Mesh(
      geometry(new CircleGeometry(gs * 0.55, 40)),
      basic({ color: PIN.discInk, opacity: PIN.discOpacity }),
    ),
    0.02,
    2,
  ).name = "pin-disc";
  flat(
    new Mesh(
      geometry(new RingGeometry(gs * 0.38, gs * 0.5, 48)),
      basic({ color: accent, opacity: PIN.ringOpacity }),
    ),
    0.022,
    3,
  ).name = "pin-ring";
  const halo = texture(haloCanvas());
  const pulseMaterial = basic({
    color: accent,
    opacity: PIN.pulseOpacity,
    ...(halo === null ? {} : { map: halo }),
  });
  const pulse = flat(
    new Mesh(geometry(new PlaneGeometry(gs * 1.2, gs * 1.2)), pulseMaterial),
    0.021,
    2,
  );
  pulse.name = "pin-pulse";

  // The turning arrow, on both faces where the role icon would be.
  const glyphs: Mesh[] = [];
  if (points !== undefined) {
    const glyphMap = texture(glyphCanvas(role));
    const glyphMaterial = basic(
      glyphMap === null ? { color: accent } : { map: glyphMap },
    );
    const size = 0.86 * m.em;
    const glyphGeometry = geometry(new PlaneGeometry(size, size));
    const x = (lay.iconX - tipX) * s;
    const y = (tipY - lay.iconY) * s;
    for (const side of [front, back]) {
      const glyph = new Mesh(glyphGeometry, glyphMaterial);
      glyph.name = "pin-arrow";
      glyph.position.set(x, y, 0.003);
      glyph.renderOrder = 6;
      side.add(glyph);
      glyphs.push(glyph);
    }
  }

  const orientation = block.orientation ?? PIN_DEFAULT_ORIENTATION;
  const turns = orientation !== "world";
  const tilts = orientation === "face";
  // Asked each frame: a visitor may switch reduced motion on mid-walk.
  const moves = () => env.mode === "play" && env.reduceMotion?.() !== true;
  let lastSeconds: number | null = null;
  let yaw: number | null = null;
  let pitch: number | null = null;
  const glyphAngles = new Map<Mesh, number>();

  return {
    object,
    tapTarget: head,
    update(frame) {
      const dt =
        lastSeconds === null
          ? Number.POSITIVE_INFINITY
          : Math.min(0.1, frame.seconds - lastSeconds);
      lastSeconds = frame.seconds;
      const phase = moves()
        ? (frame.seconds % PIN.pulsePeriodS) / PIN.pulsePeriodS
        : 0.35;
      pulse.scale.setScalar(0.7 + phase * 1.5);
      pulseMaterial.opacity = PIN.pulseOpacity * (1 - phase);
      if (turns) {
        // The viewer in the pin's own frame: the yaw that faces it, and
        // for `face` the tilt down (or up) to its eyes.
        object.updateMatrix();
        inverse.copy(object.matrix).invert();
        local.set(...frame.viewer).applyMatrix4(inverse);
        const alpha = smoothingAlpha(1 / PIN.turnRate, dt);
        const targetYaw = Math.atan2(local.x, local.z);
        yaw = yaw === null ? targetYaw : easeAngle(yaw, targetYaw, alpha);
        head.rotation.y = yaw;
        if (tilts) {
          const targetPitch = Math.atan2(
            m.liftM - local.y,
            Math.hypot(local.x, local.z),
          );
          pitch =
            pitch === null ? targetPitch : easeAngle(pitch, targetPitch, alpha);
          head.rotation.x = pitch;
        }
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
        // Up is past the head, right and left are turns, down is behind.
        const target = -Math.atan2(local.x - glyph.position.x, -local.z);
        const was = glyphAngles.get(glyph);
        const angle =
          was === undefined
            ? target
            : easeAngle(was, target, smoothingAlpha(1 / PIN.glyphRate, dt));
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
