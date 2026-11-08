/**
 * The narration circle's look, kept behind this one function on purpose:
 * its final form waits for a look prototype, so `spot.ts` knows only the
 * shape returned here. Today it is minimal: a thin ring on the ground at
 * the radius, and a column of particles rising at the centre that marks
 * "go there", brighter while the visitor is inside. An invisible column is
 * what a tap is cast against.
 *
 * @see narration-look.ts.md
 */

import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  type Object3D,
} from "three";

export interface NarrationLook {
  readonly object: Object3D;
  /** What a tap is cast against. */
  readonly tapTarget: Object3D;
  /** The visitor stepped in (true) or out. */
  inside(inside: boolean): void;
  /** One frame at page time `seconds`; allocates nothing. */
  tick(seconds: number): void;
  dispose(): void;
}

const PARTICLES = 32;
/** How high a particle rises before it starts again (m). */
const RISE_M = 2.4;
/** How long one rise takes (s). */
const RISE_S = 4;
const TAP_RADIUS_M = 0.6;
const TAP_HEIGHT_M = 2.2;

/** A particle's fixed spot on the column: a seeded spread, so two circles
 *  look alike and a test is repeatable. */
function spread(i: number): readonly [number, number, number] {
  const a = i * 2.399963;
  const r = 0.15 + 0.35 * ((i * 0.618034) % 1);
  return [Math.cos(a) * r, Math.sin(a) * r, i / PARTICLES];
}

export function narrationLook(radiusM: number): NarrationLook {
  const object = new Group();
  const ringGeometry = new RingGeometry(
    Math.max(radiusM - 0.06, 0),
    radiusM,
    96,
  );
  const ringMaterial = new MeshBasicMaterial({
    color: 0xfff2c4,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;

  const positions = new Float32Array(PARTICLES * 3);
  const pointsGeometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  pointsGeometry.setAttribute("position", attribute);
  const pointsMaterial = new PointsMaterial({
    color: 0xffe08a,
    size: 0.08,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const points = new Points(pointsGeometry, pointsMaterial);
  points.frustumCulled = false;

  const tapGeometry = new CylinderGeometry(
    TAP_RADIUS_M,
    TAP_RADIUS_M,
    TAP_HEIGHT_M,
    12,
  );
  const tapMaterial = new MeshBasicMaterial({ visible: false });
  const tapTarget = new Mesh(tapGeometry, tapMaterial);
  tapTarget.position.y = TAP_HEIGHT_M / 2;

  object.add(ring, points, tapTarget);
  const look: NarrationLook = {
    object,
    tapTarget,
    inside(inside) {
      pointsMaterial.opacity = inside ? 0.9 : 0.5;
      ringMaterial.opacity = inside ? 0.8 : 0.45;
    },
    tick(seconds) {
      for (let i = 0; i < PARTICLES; i += 1) {
        const [x, z, phase] = spread(i);
        const t = (seconds / RISE_S + phase) % 1;
        positions[i * 3] = x;
        positions[i * 3 + 1] = t * RISE_M;
        positions[i * 3 + 2] = z;
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      ringGeometry.dispose();
      ringMaterial.dispose();
      pointsGeometry.dispose();
      pointsMaterial.dispose();
      tapGeometry.dispose();
      tapMaterial.dispose();
    },
  };
  look.tick(0);
  return look;
}
