/**
 * The gizmo's drawing in the 3D view (the design's): a ring round an item
 * (a station's own circle is the tour's), four white dots on it for a
 * station's found radius or a model's size, a turn knob on a stalk along
 * the heading, and a move arrow lying on the ground in the middle. One set
 * for the scene, placed on the selection each frame from its layout
 * (`gizmo-maths.ts`); the knob and the dots keep their on-screen size at
 * any zoom (sprites without size attenuation), and the handle under the
 * pointer, or held, is drawn larger. Drawn over everything else, so a
 * handle behind a house can still be grabbed.
 *
 * The pictures are canvases (`drawGizmoPictures`); the tests hand plain
 * textures (Node has no canvas).
 *
 * @see editor3d-gizmo.ts.md
 */
import * as THREE from "three";

import {
  GIZMO,
  type GizmoHandle,
  type GizmoLayout,
  type GroundSpot,
} from "./gizmo-maths.js";

/** The handles' pictures. */
export interface GizmoPictures {
  readonly dot: THREE.Texture;
  readonly knob: THREE.Texture;
  readonly move: THREE.Texture;
}

/** What the gizmo is drawn from in a frame. */
export interface GizmoFrame {
  readonly layout: GizmoLayout;
  /** A sprite's scale per screen pixel (2 tan(fov / 2) / the view's
   *  height in px). */
  readonly spritePerPx: number;
  /** The drawn ground's height under a spot (the centre's where none has
   *  loaded). */
  groundY(spot: GroundSpot): number;
  /** The handle under the pointer, or held. */
  readonly hovered: GizmoHandle | null;
}

/** The selection's colour (the design's amber). */
const AMBER = "#e9a23b";
const AMBER_HEX = 0xe9a23b;
const DEG = Math.PI / 180;
/** How far over the ground the parts lie (m): the ring and the disc just
 *  over it, the dots and the knob a little higher. */
const RING_LIFT_M = 0.15;
const DISC_LIFT_M = 0.16;
const DOT_LIFT_M = 0.3;
const KNOB_LIFT_M = 0.35;

function picture(
  size: number,
  draw: (g: CanvasRenderingContext2D, n: number) => void,
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (g === null) throw new Error("no 2D canvas for the gizmo's pictures");
  draw(g, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The handles' pictures (the design's: each with a transparent margin,
 *  so the grip is larger than the drawn dot). */
export function drawGizmoPictures(): GizmoPictures {
  const dot = picture(64, (g, n) => {
    g.beginPath();
    g.arc(n / 2, n / 2, n * 0.27, 0, 7);
    g.fillStyle = "rgba(0,0,0,.35)";
    g.fill();
    g.beginPath();
    g.arc(n / 2, n / 2, n * 0.22, 0, 7);
    g.fillStyle = "#fff";
    g.fill();
    g.lineWidth = n * 0.06;
    g.strokeStyle = AMBER;
    g.stroke();
  });
  const knob = picture(96, (g, n) => {
    const c = n / 2;
    g.beginPath();
    g.arc(c, c, n * 0.33, 0, 7);
    g.fillStyle = "#1f2023";
    g.fill();
    g.lineWidth = n * 0.05;
    g.strokeStyle = AMBER;
    g.stroke();
    g.strokeStyle = "#fff";
    g.lineWidth = n * 0.055;
    g.lineCap = "round";
    g.beginPath();
    g.arc(c, c, n * 0.17, -2.5, 1.2);
    g.stroke();
    const a = 1.2;
    const ex = c + n * 0.17 * Math.cos(a);
    const ey = c + n * 0.17 * Math.sin(a);
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(ex + n * 0.1, ey - n * 0.03);
    g.lineTo(ex - n * 0.08, ey + n * 0.09);
    g.lineTo(ex - n * 0.06, ey - n * 0.11);
    g.closePath();
    g.fill();
  });
  const move = picture(256, (g, n) => {
    const c = n / 2;
    const k = n / 256;
    g.beginPath();
    g.arc(c, c, 124 * k, 0, 7);
    g.fillStyle = "rgba(233,162,59,.22)";
    g.fill();
    g.lineWidth = 6 * k;
    g.strokeStyle = "rgba(255,255,255,.95)";
    g.stroke();
    g.fillStyle = "rgba(255,255,255,.95)";
    g.lineWidth = 9 * k;
    g.lineCap = "round";
    for (let q = 0; q < 4; q++) {
      g.save();
      g.translate(c, c);
      g.rotate((q * Math.PI) / 2);
      g.beginPath();
      g.moveTo(0, 22 * k);
      g.lineTo(0, 72 * k);
      g.stroke();
      g.beginPath();
      g.moveTo(0, 96 * k);
      g.lineTo(-17 * k, 70 * k);
      g.lineTo(17 * k, 70 * k);
      g.closePath();
      g.fill();
      g.restore();
    }
  });
  return { dot, knob, move };
}

/**
 * The gizmo, its parts added to `parent` and hidden until `update` is
 * handed a frame. `parts` are the drawn objects (the scene's hit test reads
 * the disc; the page's checks read the rest).
 */
export function createGizmo(parent: THREE.Object3D, pictures: GizmoPictures) {
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: AMBER_HEX,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  });
  const moveMaterial = new THREE.MeshBasicMaterial({
    map: pictures.move,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(GIZMO.ringInner, 1, 96).rotateX(-Math.PI / 2),
    lineMaterial,
  );
  ring.renderOrder = 22;
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
    moveMaterial,
  );
  disc.renderOrder = 21;
  // One metre long from its origin toward -z (north at no turn).
  const bar = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
    lineMaterial,
  );
  bar.renderOrder = 22;
  const sprite = (map: THREE.Texture) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        sizeAttenuation: false,
      }),
    );
    s.renderOrder = 25;
    return s;
  };
  const knob = sprite(pictures.knob);
  const dots = [0, 1, 2, 3].map(() => sprite(pictures.dot));
  const all: THREE.Object3D[] = [ring, disc, bar, knob, ...dots];
  for (const part of all) {
    part.visible = false;
    parent.add(part);
  }

  return {
    parts: { ring, disc, bar, knob, dots },
    /** Place the gizmo for a frame, or hide it (null: no selection with
     *  handles). */
    update(frame: GizmoFrame | null) {
      for (const part of all) part.visible = false;
      if (frame === null) return;
      const { layout, spritePerPx, hovered } = frame;
      const { x, y, z } = layout.centre;
      const big = (handle: GizmoHandle) =>
        hovered === handle ? GIZMO.hoverScale : 1;
      if (layout.ringM !== null) {
        ring.visible = true;
        ring.position.set(x, y + RING_LIFT_M, z);
        ring.scale.set(layout.ringM, 1, layout.ringM);
      }
      disc.visible = true;
      disc.position.set(x, y + DISC_LIFT_M, z);
      disc.scale.set(layout.moveM, 1, layout.moveM);
      moveMaterial.opacity = hovered === "move" ? 1 : 0.85;
      layout.dots.forEach((spot, i) => {
        const dot = dots[i];
        if (dot === undefined) return;
        dot.visible = true;
        dot.position.set(spot.x, frame.groundY(spot) + DOT_LIFT_M, spot.z);
        dot.scale.setScalar(GIZMO.dotPx * spritePerPx * big("dot"));
      });
      knob.visible = true;
      knob.position.set(
        layout.knob.x,
        frame.groundY(layout.knob) + KNOB_LIFT_M,
        layout.knob.z,
      );
      knob.scale.setScalar(GIZMO.knobPx * spritePerPx * big("turn"));
      const h = layout.headingDeg * DEG;
      bar.visible = true;
      bar.position.set(
        x + Math.sin(h) * layout.bar.fromM,
        y + DISC_LIFT_M,
        z - Math.cos(h) * layout.bar.fromM,
      );
      bar.rotation.set(0, -h, 0);
      bar.scale.set(layout.bar.widthM, 1, layout.bar.lengthM);
    },
    dispose() {
      for (const part of all) part.removeFromParent();
      ring.geometry.dispose();
      disc.geometry.dispose();
      bar.geometry.dispose();
      lineMaterial.dispose();
      moveMaterial.dispose();
      for (const s of [knob, ...dots]) s.material.dispose();
      pictures.dot.dispose();
      pictures.knob.dispose();
      pictures.move.dispose();
    },
  };
}
