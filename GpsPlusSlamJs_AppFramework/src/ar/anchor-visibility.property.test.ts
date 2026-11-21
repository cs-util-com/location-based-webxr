/**
 * Property tests for the subtree visibility predicate.
 *
 * Why these tests matter: the predicate's one promise is "never a false
 * out": if any triangle of a counted renderable is drawn in a view, the
 * anchor is reported in view, so a re-placement can never be seen. The
 * oracle here is independent of the predicate's spheres: it clips every
 * drawn triangle (as three would place it: skinning through
 * `getVertexPosition`, instances through their matrices, sprite quads
 * through the sprite shader's corner formula) against each exact view
 * frustum (margin 0). Scenes mix boxes under sheared hierarchies, sprites
 * (world-scaled and constant-size, any `center`), instanced meshes,
 * skinned meshes with posed, scaled and morphed bones, merged model roots,
 * hidden and opted-out parts and layers, seen through one user camera or
 * one or two XR sub-cameras with random (also off-axis) projections.
 */

import fc from 'fast-check';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createAnchorBoundsCache,
  createAnchorView,
  ignoreForAnchorVisibility,
  isAnchorInView,
  mergeForAnchorBounds,
  updateAnchorView,
  type AnchorBoundsCache,
  type XrCameraSource,
} from './anchor-visibility';

// ---------------------------------------------------------------------------
// Generators

const num = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const vec3 = (r: number) => fc.tuple(num(-r, r), num(-r, r), num(-r, r));
const euler = vec3(Math.PI);
const scale3 = fc.tuple(num(0.3, 3), num(0.3, 3), num(0.3, 3));
const layer = fc.constantFrom(0, 0, 0, 0, 1, 2);
const visible = fc.constantFrom(true, true, true, true, true, true, false);
const ignored = fc.constantFrom(
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  true
);

const viewArb = fc.record({
  pos: vec3(25),
  rot: euler,
  fovDeg: num(30, 110),
  aspect: num(0.5, 2),
  near: num(0.05, 1),
  far: num(5, 300),
  // Off-axis skew of the side planes, as a fraction of the half-width.
  skew: fc.tuple(num(-0.4, 0.4), num(-0.4, 0.4)),
  layers: fc.constantFrom(1, 0b011, 0b101, 0b111),
});

const common = { visible, ignored, layer, groupVisible: visible };

const partArb = fc.oneof(
  fc.record({
    kind: fc.constant('box' as const),
    size: fc.tuple(num(0.05, 6), num(0.05, 6), num(0.05, 6)),
    offset: vec3(3),
    pos: vec3(30),
    rot: euler,
    scale: scale3,
    groupRot: euler,
    groupScale: scale3,
    // Optional morph targets, raised after the build: several at once and
    // outside [0, 1], relative or absolute.
    morph: fc.option(
      fc.record({
        seed: fc.integer({ min: 1, max: 1e6 }),
        size: num(0, 12),
        influences: fc.tuple(num(-1, 2.5), num(-1, 2.5)),
        relative: fc.boolean(),
      }),
      { nil: null }
    ),
    ...common,
  }),
  fc.record({
    kind: fc.constant('sprite' as const),
    pos: vec3(30),
    scale: fc.tuple(num(0.02, 5), num(0.02, 5)),
    center: fc.tuple(num(0, 1), num(0, 1)),
    rotation: num(-Math.PI, Math.PI),
    attenuation: fc.boolean(),
    groupRot: euler,
    groupScale: scale3,
    ...common,
  }),
  fc.record({
    kind: fc.constant('instanced' as const),
    pos: vec3(20),
    instances: fc.array(
      fc.record({ pos: vec3(15), rot: euler, scale: scale3 }),
      { minLength: 1, maxLength: 4 }
    ),
    moved: fc.array(fc.record({ pos: vec3(15), rot: euler, scale: scale3 }), {
      minLength: 4,
      maxLength: 4,
    }),
    groupRot: euler,
    groupScale: scale3,
    ...common,
  }),
  fc.record({
    kind: fc.constant('skinned' as const),
    pos: vec3(25),
    size: fc.tuple(num(0.2, 3), num(0.5, 6), num(0.2, 3)),
    bones: fc.array(
      fc.record({
        pos: vec3(1.5),
        rot: euler,
        scale: fc.tuple(num(0.4, 3), num(0.4, 3), num(0.4, 3)),
      }),
      {
        minLength: 3,
        maxLength: 3,
      }
    ),
    morph: fc.record({
      seed: fc.integer({ min: 1, max: 1e6 }),
      size: num(0, 2),
      influence: num(0, 1),
    }),
    groupRot: euler,
    groupScale: scale3,
    ...common,
  }),
  fc.record({
    kind: fc.constant('mergeRoot' as const),
    pos: vec3(25),
    rot: euler,
    movedPos: vec3(25),
    boxes: fc.array(
      fc.record({
        size: vec3(2).map((v) => v.map((x) => Math.abs(x) + 0.05)),
        pos: vec3(4),
        rot: euler,
      }),
      {
        minLength: 1,
        maxLength: 4,
      }
    ),
    groupRot: euler,
    groupScale: fc.constant([1, 1, 1] as [number, number, number]),
    ...common,
  })
);

type PartSpec = typeof partArb extends fc.Arbitrary<infer T> ? T : never;

const sceneArb = (maxParts: number) =>
  fc.record({
    worldPos: vec3(1000),
    worldRot: euler,
    parentPos: vec3(40),
    parentRot: euler,
    anchorPos: vec3(20),
    anchorRot: euler,
    originPos: vec3(10),
    originRot: euler,
    xr: fc.constantFrom(0, 1, 2),
    views: fc.array(viewArb, { minLength: 2, maxLength: 2 }),
    parts: fc.array(partArb, { minLength: 1, maxLength: maxParts }),
  });

type SceneSpec = typeof sceneArb extends (n: number) => fc.Arbitrary<infer T>
  ? T
  : never;

// ---------------------------------------------------------------------------
// Scene building

interface BuiltScene {
  scene: THREE.Scene;
  world: THREE.Group;
  anchor: THREE.Group;
  camera: THREE.PerspectiveCamera;
  xr: XrCameraSource | null;
  /** Post-build changes the predicate's cache follows live (bones, morphs, visibility). */
  mutateLive: () => void;
  /** Post-build changes only a fresh traversal sees (moved instances, moved model roots). */
  mutateStructure: () => void;
}

function applyTRS(
  o: THREE.Object3D,
  pos: number[],
  rot: number[],
  scale?: number[]
): void {
  o.position.set(pos[0]!, pos[1]!, pos[2]);
  o.rotation.set(rot[0]!, rot[1]!, rot[2]!);
  if (scale) o.scale.set(scale[0]!, scale[1]!, scale[2]);
}

function projectionFor(v: SceneSpec['views'][number]): THREE.Matrix4 {
  const halfH = v.near * Math.tan(THREE.MathUtils.degToRad(v.fovDeg) / 2);
  const halfW = halfH * v.aspect;
  const dx = v.skew[0] * halfW;
  const dy = v.skew[1] * halfH;
  return new THREE.Matrix4().makePerspective(
    -halfW + dx,
    halfW + dx,
    halfH + dy,
    -halfH + dy,
    v.near,
    v.far
  );
}

/** Deterministic pseudo-random numbers in [-1, 1] for morph deltas. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

function skinnedPart(spec: Extract<PartSpec, { kind: 'skinned' }>): {
  mesh: THREE.SkinnedMesh;
  pose: () => void;
} {
  const [w, h, d] = spec.size;
  const geometry = new THREE.BoxGeometry(w, h, d, 1, 4, 1);
  const position = geometry.getAttribute('position');
  const count = position.count;
  const indices: number[] = [];
  const weights: number[] = [];
  const boneY = [-h / 2, 0, h / 2];
  for (let i = 0; i < count; i += 1) {
    const y = position.getY(i);
    const t = (y + h / 2) / h; // 0..1 along the chain
    const lo = t < 0.5 ? 0 : 1;
    const f = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
    indices.push(lo, lo + 1, 0, 0);
    weights.push(1 - f, f, 0, 0);
  }
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(indices, 4)
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(weights, 4)
  );
  const rnd = lcg(spec.morph.seed);
  const deltas = new Float32Array(count * 3).map(() => rnd() * spec.morph.size);
  geometry.morphAttributes.position = [new THREE.BufferAttribute(deltas, 3)];
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.SkinnedMesh(geometry);
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[0]!.position.set(0, boneY[0]!, 0);
  bones[1]!.position.set(0, boneY[1]! - boneY[0]!, 0);
  bones[2]!.position.set(0, boneY[2]! - boneY[1]!, 0);
  bones[0]!.add(bones[1]!);
  bones[1]!.add(bones[2]!);
  mesh.add(bones[0]!);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.morphTargetInfluences![0] = 0;
  const pose = () => {
    spec.bones.forEach((b, i) => {
      const bone = bones[i]!;
      bone.position
        .set(0, i === 0 ? boneY[0]! : boneY[i]! - boneY[i - 1]!, 0)
        .add(new THREE.Vector3(...b.pos));
      bone.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
      bone.scale.set(b.scale[0], b.scale[1], b.scale[2]);
    });
    mesh.morphTargetInfluences![0] = spec.morph.influence;
  };
  return { mesh, pose };
}

/** One generated part, with its live and structural mutations registered. */
function buildPart(
  part: PartSpec,
  live: (() => void)[],
  structural: (() => void)[]
): THREE.Object3D {
  let object: THREE.Object3D;
  if (part.kind === 'box') {
    const geometry = new THREE.BoxGeometry(...part.size).translate(
      ...part.offset
    );
    const morph = part.morph;
    if (morph) {
      const position = geometry.getAttribute('position');
      const rnd = lcg(morph.seed);
      geometry.morphAttributes.position = morph.influences.map(() => {
        const values = new Float32Array(position.count * 3).map(
          () => rnd() * morph.size
        );
        if (!morph.relative) {
          for (let i = 0; i < values.length; i += 1) {
            values[i] = values[i]! + (position.array[i] as number);
          }
        }
        return new THREE.BufferAttribute(values, 3);
      });
      geometry.morphTargetsRelative = morph.relative;
    }
    const mesh = new THREE.Mesh(geometry);
    applyTRS(mesh, part.pos, part.rot, part.scale);
    if (morph) {
      live.push(() =>
        morph.influences.forEach((w, i) => {
          mesh.morphTargetInfluences![i] = w;
        })
      );
    }
    object = mesh;
  } else if (part.kind === 'sprite') {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        sizeAttenuation: part.attenuation,
        rotation: part.rotation,
      })
    );
    sprite.position.set(...part.pos);
    sprite.scale.set(part.scale[0], part.scale[1], 1);
    sprite.center.set(part.center[0], part.center[1]);
    object = sprite;
  } else if (part.kind === 'instanced') {
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      undefined,
      part.instances.length
    );
    const m = new THREE.Matrix4();
    const setAll = (list: typeof part.instances) =>
      part.instances.forEach((_, i) => {
        const t = list[i]!;
        m.compose(
          new THREE.Vector3(...t.pos),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...t.rot)),
          new THREE.Vector3(...t.scale)
        );
        mesh.setMatrixAt(i, m);
      });
    setAll(part.instances);
    mesh.position.set(...part.pos);
    structural.push(() => setAll(part.moved));
    object = mesh;
  } else if (part.kind === 'skinned') {
    const { mesh, pose } = skinnedPart(part);
    mesh.position.set(...part.pos);
    live.push(pose);
    object = mesh;
  } else {
    const root = new THREE.Group();
    applyTRS(root, part.pos, part.rot);
    for (const box of part.boxes) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2])
      );
      applyTRS(mesh, box.pos, box.rot);
      mesh.layers.set(part.layer);
      root.add(mesh);
    }
    mergeForAnchorBounds(root);
    structural.push(() => root.position.set(...part.movedPos));
    object = root;
  }
  return object;
}

function buildScene(spec: SceneSpec): BuiltScene {
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);
  const parent = new THREE.Group();
  applyTRS(parent, spec.parentPos, spec.parentRot);
  world.add(parent);
  const anchor = new THREE.Group();
  applyTRS(anchor, spec.anchorPos, spec.anchorRot);
  parent.add(anchor);

  const origin = new THREE.Group();
  applyTRS(origin, spec.originPos, spec.originRot);
  world.add(origin);
  const camera = new THREE.PerspectiveCamera();
  const v0 = spec.views[0]!;
  applyTRS(camera, v0.pos, v0.rot);
  camera.projectionMatrix.copy(projectionFor(v0));
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.layers.mask = v0.layers;
  origin.add(camera);

  let xr: XrCameraSource | null = null;
  if (spec.xr > 0) {
    const subs = spec.views.slice(0, spec.xr).map((v) => {
      const sub = new THREE.PerspectiveCamera();
      applyTRS(sub, v.pos, v.rot);
      sub.updateMatrix();
      sub.projectionMatrix.copy(projectionFor(v));
      sub.layers.mask = v.layers;
      return sub;
    });
    xr = { isPresenting: true, getCamera: () => ({ cameras: subs }) };
  }

  const live: (() => void)[] = [];
  const structural: (() => void)[] = [];
  for (const part of spec.parts) {
    const group = new THREE.Group();
    group.rotation.set(part.groupRot[0], part.groupRot[1], part.groupRot[2]);
    group.scale.set(part.groupScale[0], part.groupScale[1], part.groupScale[2]);
    anchor.add(group);
    const object = buildPart(part, live, structural);
    object.layers.set(part.layer);
    if (part.ignored) ignoreForAnchorVisibility(object);
    group.add(object);
    // Visibility flips happen after the build: the cache reads them live.
    live.push(() => {
      object.visible = part.visible;
      group.visible = part.groupVisible;
    });
  }
  applyTRS(world, spec.worldPos, spec.worldRot);
  scene.updateMatrixWorld(true);
  return {
    scene,
    world,
    anchor,
    camera,
    xr,
    mutateLive: () => live.forEach((f) => f()),
    mutateStructure: () => structural.forEach((f) => f()),
  };
}

// ---------------------------------------------------------------------------
// Oracle: clip every drawn triangle against each exact view frustum

interface OracleView {
  frustum: THREE.Frustum;
  worldToView: THREE.Matrix4;
  layers: number;
}

function oracleViews(built: BuiltScene): OracleView[] {
  const cams: {
    worldFromView: THREE.Matrix4;
    projection: THREE.Matrix4;
    layers: number;
  }[] = [];
  if (built.xr) {
    for (const sub of built.xr.getCamera().cameras) {
      cams.push({
        worldFromView: new THREE.Matrix4().multiplyMatrices(
          built.camera.parent!.matrixWorld,
          sub.matrix
        ),
        projection: sub.projectionMatrix,
        layers: sub.layers.mask,
      });
    }
  } else {
    cams.push({
      worldFromView: built.camera.matrixWorld.clone(),
      projection: built.camera.projectionMatrix,
      layers: built.camera.layers.mask,
    });
  }
  return cams.map((c) => ({
    frustum: new THREE.Frustum().setFromProjectionMatrix(c.projection),
    worldToView: c.worldFromView.clone().invert(),
    layers: c.layers,
  }));
}

const CLIP_EPS = 1e-6;

/** Whether the triangle (view space) keeps any part inside the frustum shrunk by CLIP_EPS. */
function triangleInside(
  frustum: THREE.Frustum,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3
): boolean {
  let poly = [a, b, c];
  for (const plane of frustum.planes) {
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const dp = plane.distanceToPoint(p) - CLIP_EPS;
      const dq = plane.distanceToPoint(q) - CLIP_EPS;
      if (dp >= 0) next.push(p);
      if (dp >= 0 !== dq >= 0) next.push(p.clone().lerp(q, dp / (dp - dq)));
    }
    poly = next;
    if (poly.length === 0) return false;
  }
  return true;
}

function drawnChain(object: THREE.Object3D, anchor: THREE.Object3D): boolean {
  let insideAnchor = true;
  for (let n: THREE.Object3D | null = object; n; n = n.parent) {
    if (!n.visible) return false;
    if (insideAnchor && n.userData.anchorVisibility === 'ignore') return false;
    if (n === anchor) insideAnchor = false;
  }
  return true;
}

function meshTriangles(
  mesh: THREE.Mesh,
  emit: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => boolean
): boolean {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position').count;
  const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh
    ? (mesh as THREE.InstancedMesh)
    : null;
  const instanceCount = instanced ? instanced.count : 1;
  const im = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const at = (i: number): number => (index ? index.getX(i) : i);
  const corner = (vi: number) => {
    const v = new THREE.Vector3();
    mesh.getVertexPosition(vi, v); // morphs and skinning, as three draws them
    return v.applyMatrix4(world);
  };
  for (let k = 0; k < instanceCount; k += 1) {
    if (instanced) {
      instanced.getMatrixAt(k, im);
      world.multiplyMatrices(mesh.matrixWorld, im);
    } else world.copy(mesh.matrixWorld);
    for (let t = 0; t + 2 < count; t += 3) {
      if (emit(corner(at(t)), corner(at(t + 1)), corner(at(t + 2)))) {
        return true;
      }
    }
  }
  return false;
}

function spriteDrawn(sprite: THREE.Sprite, view: OracleView): boolean {
  // three's sprite vertex shader, corner by corner.
  const mv = new THREE.Matrix4().multiplyMatrices(
    view.worldToView,
    sprite.matrixWorld
  );
  const mvPos = new THREE.Vector3().setFromMatrixPosition(mv);
  const e = sprite.matrixWorld.elements;
  let sx = Math.hypot(e[0], e[1], e[2]);
  let sy = Math.hypot(e[4], e[5], e[6]);
  const material = sprite.material;
  if (!material.sizeAttenuation) {
    sx *= -mvPos.z;
    sy *= -mvPos.z;
  }
  const cos = Math.cos(material.rotation);
  const sin = Math.sin(material.rotation);
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([px, py]) => {
    const ax = (px! - (sprite.center.x - 0.5)) * sx;
    const ay = (py! - (sprite.center.y - 0.5)) * sy;
    return new THREE.Vector3(
      mvPos.x + cos * ax - sin * ay,
      mvPos.y + sin * ax + cos * ay,
      mvPos.z
    );
  });
  return (
    triangleInside(view.frustum, corners[0]!, corners[1]!, corners[2]!) ||
    triangleInside(view.frustum, corners[0]!, corners[2]!, corners[3]!)
  );
}

function oracleInView(built: BuiltScene): boolean {
  built.scene.updateMatrixWorld(true);
  const views = oracleViews(built);
  let drawn = false;
  built.anchor.traverse((o) => {
    if (drawn) return;
    const r = o as THREE.Mesh & { isSprite?: boolean };
    if (!r.isMesh && !r.isSprite) return;
    if (!drawnChain(o, built.anchor)) return;
    drawn = views.some((view) => drawnInView(r, view));
  });
  return drawn;
}

function drawnInView(
  r: THREE.Mesh & { isSprite?: boolean },
  view: OracleView
): boolean {
  if ((r.layers.mask & view.layers) === 0) return false;
  if (r.isSprite) return spriteDrawn(r as unknown as THREE.Sprite, view);
  return meshTriangles(r, (a, b, c) =>
    triangleInside(
      view.frustum,
      a.applyMatrix4(view.worldToView),
      b.applyMatrix4(view.worldToView),
      c.applyMatrix4(view.worldToView)
    )
  );
}

function predicate(
  built: BuiltScene,
  cache: AnchorBoundsCache,
  fresh: boolean
): boolean {
  built.scene.updateMatrixWorld(true);
  const view = updateAnchorView(createAnchorView(), built.camera, built.xr);
  return isAnchorInView(view, built.anchor, {
    marginDeg: 0,
    cache,
    fresh,
    nowMs: 0,
  });
}

// ---------------------------------------------------------------------------

/** Smallest share of generated scenes that must draw something (see the measurement below). */
const NON_VACUOUS_SHARE = 0.1;

describe('anchor-visibility properties', () => {
  it('never a false "out" on a fresh traversal, whatever changed since the cache was built', () => {
    let drawn = 0;
    let runs = 0;
    fc.assert(
      fc.property(sceneArb(48), (spec) => {
        const built = buildScene(spec);
        const cache = createAnchorBoundsCache();
        predicate(built, cache, false); // build at the bind pose
        built.mutateLive();
        built.mutateStructure();
        runs += 1;
        const truth = oracleInView(built);
        if (truth) drawn += 1;
        const said = predicate(built, cache, true);
        expect(truth && !said, 'a drawn subtree tested out').toBe(false);
      }),
      { numRuns: 150 }
    );
    // Not vacuous: a fair share of the scenes draw something. Measured over
    // 24 random seeds: 26-50 of 150 drawn (mean 37, sd about 5); the floor
    // of 10 % sits 4 sd below the mean and still fails a generator that has
    // stopped drawing.
    expect(drawn).toBeGreaterThan(runs * NON_VACUOUS_SHARE);
  });

  it('never a false "out" from the cache, across the changes it follows live', () => {
    let drawn = 0;
    let runs = 0;
    // Bones posed and scaled, morph influences, visibility toggled: all
    // after the build, none announced. At most 24 parts, so no merging.
    fc.assert(
      fc.property(sceneArb(24), (spec) => {
        const built = buildScene(spec);
        const cache = createAnchorBoundsCache();
        predicate(built, cache, false);
        built.mutateLive();
        runs += 1;
        const truth = oracleInView(built);
        if (truth) drawn += 1;
        const said = predicate(built, cache, false);
        expect(truth && !said, 'a drawn subtree tested out').toBe(false);
      }),
      { numRuns: 150 }
    );
    expect(drawn).toBeGreaterThan(runs * NON_VACUOUS_SHARE);
  });

  it('a rigid move of everything above the anchor parent and the camera leaves the answer unchanged', () => {
    fc.assert(
      fc.property(sceneArb(12), vec3(5000), euler, (spec, pos, rot) => {
        const built = buildScene(spec);
        built.mutateLive();
        const before = predicate(built, createAnchorBoundsCache(), false);
        applyTRS(built.world, pos, rot);
        expect(predicate(built, createAnchorBoundsCache(), false)).toBe(before);
      }),
      { numRuns: 100 }
    );
  });
});
