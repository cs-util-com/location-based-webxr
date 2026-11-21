import * as THREE from 'three';

/**
 * Subtree visibility for content anchors: "could any part of this subtree be
 * drawn in the current view, at its current pose or at a given target
 * pose?". A content anchor uses it to re-place its subtree only while none
 * of it is in view. The answer errs on one side only: a subtree that draws a
 * pixel is never reported out of view, while a subtree reported in view may
 * still draw nothing (a bound is larger than its content). The one exception
 * is a CSS3D object, which counts as the point at its origin (sidecar, Known
 * limits).
 *
 * Everything is computed in the anchor's PARENT frame: the view is carried
 * into that frame through the camera's ancestor chain, and the subtree's
 * spheres are placed by the anchor's local matrix (or the target local
 * matrix). Sidecar: `anchor-visibility.ts.md`.
 */

/** Hysteresis margin, degrees, by which each side plane of a view widens. */
export const ANCHOR_VIEW_MARGIN_DEG = 5;

/**
 * Most spheres one anchor's cache keeps; more are merged, nearest first.
 * Skinned, morphed and constant-screen-size sprite entries are never merged,
 * so with more than ANCHOR_SPHERE_CAP - 1 of them the cache holds them all
 * plus one merged sphere.
 */
export const ANCHOR_SPHERE_CAP = 32;

/** Age, ms, after which a cache that keeps answering "in" asks for a fresh traversal. */
export const ANCHOR_BOUNDS_REFRESH_MS = 1000;

const FLAG_KEY = 'anchorVisibility';
const FLAG_IGNORE = 'ignore';
const FLAG_MERGE = 'merge';

/** The steepest side plane a widened view may reach, radians (just under 90 deg). */
const MAX_SIDE_ANGLE_RAD = THREE.MathUtils.degToRad(89.5);

/**
 * Exclude `object` and its subtree from anchor visibility (a screen-placed
 * hint that is drawn by the camera rather than by the anchor's pose).
 */
export function ignoreForAnchorVisibility(object: THREE.Object3D): void {
  assertObject3D(object, 'ignoreForAnchorVisibility');
  object.userData[FLAG_KEY] = FLAG_IGNORE;
}

/**
 * Bound `root`'s subtree by ONE sphere, computed when the anchor's bounds
 * are (re)built after a structural change and then moved by the root's
 * current matrix. For model roots whose subtree does not move internally
 * (no animation); a fresh traversal reuses that sphere too.
 */
export function mergeForAnchorBounds(root: THREE.Object3D): void {
  assertObject3D(root, 'mergeForAnchorBounds');
  root.userData[FLAG_KEY] = FLAG_MERGE;
}

/** The part of a WebXR manager this module reads (three's `renderer.xr`). */
export interface XrCameraSource {
  readonly isPresenting: boolean;
  getCamera(): { readonly cameras: readonly THREE.Camera[] };
}

/** Operation counts, for budgets that must not depend on wall time. */
export interface AnchorVisibilityCounters {
  /** Sphere-against-one-view tests. */
  sphereTests: number;
  /** Bounds traversals (cache builds, refreshes, confirmations). */
  traversals: number;
}

interface ViewSlot {
  readonly worldFromView: THREE.Matrix4;
  readonly projection: THREE.Matrix4;
  layersMask: number;
  coordinateSystem: THREE.CoordinateSystem;
  reversedDepth: boolean;
  isPerspective: boolean;
}

interface FrustumSet {
  parent: THREE.Object3D | null;
  marginDeg: number;
  frusta: THREE.Frustum[];
  /** Each view's eye in the parent frame. */
  eyes: THREE.Vector3[];
  /** Largest stretch of the parent's world matrix and of its inverse, for eye-scaled sprites. */
  parentStretch: number;
  parentInvStretch: number;
}

/**
 * This frame's view(s), read once per frame with {@link updateAnchorView}.
 * Frusta are derived from it lazily per parent and margin, and reused for
 * every anchor tested this frame. Treat it as opaque.
 */
export interface AnchorView {
  readonly slots: ViewSlot[];
  viewCount: number;
  readonly sets: FrustumSet[];
  setCount: number;
}

/** A fresh, empty view; fill it with {@link updateAnchorView} each frame. */
export function createAnchorView(): AnchorView {
  return { slots: [], viewCount: 0, sets: [], setCount: 0 };
}

/**
 * Read this frame's view(s) into `view`. While `xr` is presenting, each XR
 * sub-camera counts: its local `matrix` (the view pose, which three sets at
 * the start of the XR frame, before the app's frame callback) carried into
 * the world by the user camera's parent, its own `projectionMatrix` (near
 * and far as the session set them) and its own `layers`. Otherwise the user
 * camera's world matrix, projection and layers are used.
 *
 * The frusta derived from it are carried into an anchor's parent frame on
 * the first test against that parent and reused for the rest of the frame:
 * call this again after moving a parent between two tests of one frame.
 */
export function updateAnchorView(
  view: AnchorView,
  camera: THREE.Camera,
  xr?: XrCameraSource | null
): AnchorView {
  assertObject3D(camera, 'updateAnchorView');
  view.setCount = 0;
  view.viewCount = 0;
  const subCameras =
    xr && xr.isPresenting ? (xr.getCamera().cameras ?? []) : [];
  if (subCameras.length > 0) {
    const parent = camera.parent;
    if (parent) parent.updateWorldMatrix(true, false);
    for (const sub of subCameras) {
      const slot = nextSlot(view);
      if (parent)
        slot.worldFromView.multiplyMatrices(parent.matrixWorld, sub.matrix);
      else slot.worldFromView.copy(sub.matrix);
      fillSlotFromCamera(slot, sub);
    }
  } else {
    camera.updateWorldMatrix(true, false);
    const slot = nextSlot(view);
    slot.worldFromView.copy(camera.matrixWorld);
    fillSlotFromCamera(slot, camera);
  }
  return view;
}

function nextSlot(view: AnchorView): ViewSlot {
  let slot = view.slots[view.viewCount];
  if (!slot) {
    slot = {
      worldFromView: new THREE.Matrix4(),
      projection: new THREE.Matrix4(),
      layersMask: 1,
      coordinateSystem: THREE.WebGLCoordinateSystem,
      reversedDepth: false,
      isPerspective: true,
    };
    view.slots.push(slot);
  }
  view.viewCount += 1;
  return slot;
}

function fillSlotFromCamera(slot: ViewSlot, camera: THREE.Camera): void {
  slot.projection.copy(camera.projectionMatrix);
  slot.layersMask = camera.layers.mask;
  slot.coordinateSystem =
    camera.coordinateSystem ?? THREE.WebGLCoordinateSystem;
  slot.reversedDepth = camera.reversedDepth === true;
  // A perspective projection has -1 in its w row's z column.
  slot.isPerspective = camera.projectionMatrix.elements[11] === -1;
}

interface NodeEntry {
  readonly kind: 'node';
  readonly object: THREE.Object3D;
  /** Sphere centre in the object's own frame. */
  readonly centre: THREE.Vector3;
  /** Sphere radius in the object's own units (geometry and instance bounds). */
  readonly radius: number;
  /** Sprite bounds are read from the live matrix and material. */
  readonly sprite: boolean;
  /** For a merge root: the OR of its renderables' layer masks; otherwise null (read live). */
  readonly layerMask: number | null;
  /** Per morph target: largest displacement of a vertex (read with the live influences). */
  readonly morphReach: Float64Array | null;
}

interface MergedEntry {
  readonly kind: 'merged';
  /** Sphere in the anchor's own frame, fixed when the cache was built. */
  readonly centre: THREE.Vector3;
  readonly radius: number;
  readonly members: NodeEntry[];
}

interface SkinnedEntry {
  readonly kind: 'skinned';
  readonly mesh: THREE.SkinnedMesh;
  readonly bound: SkinBound;
}

type BoundEntry = NodeEntry | MergedEntry | SkinnedEntry;

interface MergeRootSphere {
  readonly centre: THREE.Vector3;
  readonly radius: number;
  readonly layerMask: number;
  /** Constant-screen-size sprites under the root, bounded live as their own entries. */
  readonly loose: readonly THREE.Object3D[];
}

/**
 * One anchor's cached spheres. Rebuilt by the first test, after
 * {@link markAnchorBoundsChanged}, and by every test with `fresh: true`.
 * Treat it as opaque.
 */
export interface AnchorBoundsCache {
  valid: boolean;
  builtAtMs: number;
  /** The anchor the entries were built for; testing another one rebuilds. */
  anchor: THREE.Object3D | null;
  entries: BoundEntry[];
  /** Merge-root spheres, kept across fresh traversals until the bounds change. */
  readonly mergeRoots: Map<THREE.Object3D, MergeRootSphere>;
  /** Bind-time data of skinned and morphed parts, kept while its inputs are unchanged. */
  readonly bindData: Map<THREE.Object3D, BindRecord>;
}

/** An empty cache for one anchor. */
export function createAnchorBoundsCache(): AnchorBoundsCache {
  return {
    valid: false,
    builtAtMs: 0,
    anchor: null,
    entries: [],
    mergeRoots: new Map(),
    bindData: new Map(),
  };
}

/** Call on a structural change of the anchor's subtree (a part mounted, unmounted or ready). */
export function markAnchorBoundsChanged(cache: AnchorBoundsCache): void {
  cache.valid = false;
  cache.mergeRoots.clear();
  cache.bindData.clear();
}

/**
 * Whether the cache is missing or older than {@link ANCHOR_BOUNDS_REFRESH_MS}.
 * A caller whose cached test keeps saying "in" while it waits asks this, and
 * on true runs its next test with `fresh: true`, so a stale "in" (a moved
 * instance, an animated node) delays it by about that age at most.
 */
export function anchorBoundsNeedRefresh(
  cache: AnchorBoundsCache,
  nowMs: number
): boolean {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('anchorBoundsNeedRefresh: nowMs must be finite');
  }
  return !cache.valid || nowMs - cache.builtAtMs >= ANCHOR_BOUNDS_REFRESH_MS;
}

export interface AnchorInViewOptions {
  /**
   * The anchor's local matrix to test at (a target pose, in the parent's
   * frame). Omitted: the anchor's current local matrix.
   */
  readonly atLocal?: THREE.Matrix4;
  /** Side-plane widening, degrees, in [0, 90). */
  readonly marginDeg: number;
  readonly cache: AnchorBoundsCache;
  /** Traverse the subtree now and replace the cache before testing (a confirmation or a refresh). */
  readonly fresh?: boolean;
  /** Timestamp recorded on a cache build, ms. Defaults to `performance.now()`. */
  readonly nowMs?: number;
  readonly counters?: AnchorVisibilityCounters;
}

/**
 * Whether any counted renderable of `anchor`'s subtree, placed at
 * `atLocal` (or the anchor's current local matrix), intersects any of this
 * frame's views widened by `marginDeg`. Counted: descendants (and the anchor
 * itself) that are meshes, points, lines, sprites, instanced or skinned
 * meshes, and CSS3D objects, which are not hidden (`visible === false` on
 * them or an ancestor up to the anchor) and not opted out
 * ({@link ignoreForAnchorVisibility}), both read live, and whose layers
 * match the view's. An anchor with nothing counted is out of view.
 *
 * World matrices are read as they are (three refreshes them when it
 * renders); a cache build refreshes the subtree's own.
 */
export function isAnchorInView(
  view: AnchorView,
  anchor: THREE.Object3D,
  options: AnchorInViewOptions
): boolean {
  assertInViewInputs(anchor, options);
  if (view.viewCount === 0) return false;
  const cache = options.cache;
  ensureBounds(cache, anchor, options);
  if (cache.entries.length === 0) return false;

  const set = frustumSetFor(view, anchor.parent, options.marginDeg);
  if (anchor.matrixAutoUpdate) anchor.updateMatrix();
  const pose = options.atLocal ?? anchor.matrix;
  const poseStretch = maxStretch(pose);
  scratchInvAnchor.copy(anchor.matrixWorld).invert();
  const invStretch = maxStretch(scratchInvAnchor);
  for (const entry of cache.entries) {
    const mask = entrySphereInAnchor(entry, anchor, invStretch);
    if (mask === 0) continue;
    scratchCentre.applyMatrix4(pose);
    const radius = scratchRadius * poseStretch;
    if (sphereInAnyView(view, set, entry, mask, radius, options.counters)) {
      return true;
    }
  }
  return false;
}

function assertInViewInputs(
  anchor: THREE.Object3D,
  options: AnchorInViewOptions
): void {
  assertObject3D(anchor, 'isAnchorInView');
  const { atLocal, marginDeg, cache } = options;
  if (!Number.isFinite(marginDeg) || marginDeg < 0 || marginDeg >= 90) {
    throw new RangeError('isAnchorInView: marginDeg must be in [0, 90)');
  }
  if (atLocal !== undefined && !(atLocal instanceof THREE.Matrix4)) {
    throw new TypeError('isAnchorInView: atLocal must be a THREE.Matrix4');
  }
  if (!cache || !Array.isArray(cache.entries)) {
    throw new TypeError(
      'isAnchorInView: cache must come from createAnchorBoundsCache'
    );
  }
  if (options.nowMs !== undefined && !Number.isFinite(options.nowMs)) {
    throw new RangeError('isAnchorInView: nowMs must be finite');
  }
}

function ensureBounds(
  cache: AnchorBoundsCache,
  anchor: THREE.Object3D,
  options: AnchorInViewOptions
): void {
  if (cache.valid && cache.anchor === anchor && options.fresh !== true) return;
  buildBounds(cache, anchor, options.nowMs ?? performance.now());
  if (options.counters) options.counters.traversals += 1;
}

/**
 * Writes the entry's sphere, in the anchor's frame, into scratchCentre /
 * scratchRadius and returns the layer mask it counts for (0: not counted).
 */
function entrySphereInAnchor(
  entry: BoundEntry,
  anchor: THREE.Object3D,
  invStretch: number
): number {
  if (entry.kind === 'merged') {
    let mask = 0;
    for (const member of entry.members) {
      if (isCounted(member.object, anchor)) mask |= memberMask(member);
    }
    scratchCentre.copy(entry.centre);
    scratchRadius = entry.radius;
    return mask;
  }
  if (entry.kind === 'node') {
    if (!isCounted(entry.object, anchor)) return 0;
    nodeSphereInAnchor(entry, invStretch);
    return memberMask(entry);
  }
  if (!isCounted(entry.mesh, anchor)) return 0;
  skinnedSphereInAnchor(entry, invStretch);
  return entry.mesh.layers.mask;
}

/** Tests the sphere at scratchCentre (parent frame) against every view whose layers meet the mask. */
function sphereInAnyView(
  view: AnchorView,
  set: FrustumSet,
  entry: BoundEntry,
  mask: number,
  radius: number,
  counters: AnchorVisibilityCounters | undefined
): boolean {
  const perDistance =
    entry.kind === 'node' && entry.sprite
      ? nonAttenuatedSpriteSlope(entry.object as THREE.Sprite)
      : 0;
  for (let k = 0; k < view.viewCount; k += 1) {
    const slot = view.slots[k]!;
    if ((slot.layersMask & mask) === 0) continue;
    if (counters) counters.sphereTests += 1;
    scratchSphere.center.copy(scratchCentre);
    scratchSphere.radius =
      radius + constantSizeWidening(slot, set, k, perDistance);
    if (set.frusta[k]!.intersectsSphere(scratchSphere)) return true;
  }
  return false;
}

/** The extra radius of a constant-screen-size sprite in view k (0 for anything else). */
function constantSizeWidening(
  slot: ViewSlot,
  set: FrustumSet,
  k: number,
  perDistance: number
): number {
  if (perDistance <= 0) return 0;
  return slot.isPerspective
    ? perDistance *
        scratchCentre.distanceTo(set.eyes[k]!) *
        set.parentStretch *
        set.parentInvStretch
    : perDistance * set.parentInvStretch;
}

const scratchInvAnchor = new THREE.Matrix4();
const scratchRel = new THREE.Matrix4();
const scratchCentre = new THREE.Vector3();
let scratchRadius = 0;
const scratchSphere = new THREE.Sphere();
const scratchVec = new THREE.Vector3();

function memberMask(entry: NodeEntry): number {
  return entry.layerMask ?? entry.object.layers.mask;
}

/** Live check: not hidden and not opted out, on the object or any ancestor up to the anchor. */
function isCounted(object: THREE.Object3D, anchor: THREE.Object3D): boolean {
  let node: THREE.Object3D | null = object;
  while (node) {
    if (node.visible === false || node.userData[FLAG_KEY] === FLAG_IGNORE)
      return false;
    if (node === anchor) return true;
    node = node.parent;
  }
  // Detached from the anchor since the cache was built: it no longer draws there.
  return false;
}

/** Writes the node's sphere, in the anchor's frame, into scratchCentre / scratchRadius. */
function nodeSphereInAnchor(entry: NodeEntry, invStretch: number): void {
  const object = entry.object;
  if (entry.sprite) {
    // World centre and world-unit radius from the live world matrix; for a
    // sizeAttenuation:false sprite the eye-scaled part is added per view.
    scratchCentre
      .setFromMatrixPosition(object.matrixWorld)
      .applyMatrix4(scratchInvAnchor);
    const sprite = object as THREE.Sprite;
    scratchRadius = isNonAttenuatedSprite(sprite)
      ? 0
      : spriteWorldRadius(sprite) * invStretch;
    return;
  }
  scratchRel.multiplyMatrices(scratchInvAnchor, object.matrixWorld);
  scratchCentre.copy(entry.centre).applyMatrix4(scratchRel);
  const radius = entry.morphReach
    ? entry.radius + morphTerm(object, entry.morphReach)
    : entry.radius;
  scratchRadius = radius * maxStretch(scratchRel);
}

/** Sum over targets of |influence| times the target's largest displacement. */
function morphTerm(r: Renderable, reach: Float64Array): number {
  const influences = r.morphTargetInfluences ?? [];
  let d = 0;
  for (let t = 0; t < reach.length; t += 1) {
    d += Math.abs(influences[t] ?? 0) * reach[t]!;
  }
  return d;
}

/**
 * A plain renderable with position morph targets, bounded about its origin:
 * the largest vertex distance plus, per target, the largest displacement.
 * three draws `v + sum_k w_k * d_k` (an absolute target's `d_k` is its
 * position minus the base), so the bound holds for any influences, several
 * at once or outside [0, 1], which three's geometry sphere (each target
 * alone at 1) does not cover. Instanced and batched meshes are not handled
 * here (see the sidecar).
 */
function morphBound(r: Renderable, bind: BindLookup | null): MorphBound | null {
  if (r.isInstancedMesh || r.isBatchedMesh || !r.morphTargetInfluences) {
    return null;
  }
  const geometry = r.geometry;
  const targets = geometry?.morphAttributes.position;
  const position = geometry?.getAttribute('position');
  if (!geometry || !targets || targets.length === 0 || !position) return null;
  return keptBind(bind, r, 'morph', geometry, null, () =>
    morphReachOf(position, targets, geometry.morphTargetsRelative)
  );
}

interface MorphBound {
  readonly base: number;
  readonly reach: Float64Array;
}

function morphReachOf(
  position: Attribute,
  targets: readonly Attribute[],
  relative: boolean
): MorphBound | null {
  const v = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const reach = new Float64Array(targets.length);
  let base = 0;
  for (let vi = 0; vi < position.count; vi += 1) {
    v.fromBufferAttribute(position, vi);
    base = Math.max(base, v.length());
    for (let t = 0; t < targets.length; t += 1) {
      delta.fromBufferAttribute(targets[t]!, vi);
      if (!relative) delta.sub(v);
      reach[t] = Math.max(reach[t]!, delta.length());
    }
  }
  return Number.isFinite(base) ? { base, reach } : null;
}

function isNonAttenuatedSprite(sprite: THREE.Sprite): boolean {
  return (
    (sprite.material as THREE.SpriteMaterial | undefined)?.sizeAttenuation ===
    false
  );
}

/**
 * Largest distance of a sprite's quad corner from its origin, in units of
 * its world scale: three's sprite shader offsets a corner by
 * `(position.xy - (center - 0.5)) * scale`, with `position.xy` in
 * [-0.5, 0.5]; rotation keeps the length.
 */
function spriteSpread(sprite: THREE.Sprite): number {
  const e = sprite.matrixWorld.elements;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const center = sprite.center;
  const hx = sx * (0.5 + Math.abs(center.x - 0.5));
  const hy = sy * (0.5 + Math.abs(center.y - 0.5));
  return Math.hypot(hx, hy);
}

function spriteWorldRadius(sprite: THREE.Sprite): number {
  return spriteSpread(sprite);
}

/**
 * For a sizeAttenuation:false sprite: radius per unit of eye distance
 * (perspective). three offsets its corners in view units; they are taken as
 * world units here, which holds for a camera chain without scale.
 */
function nonAttenuatedSpriteSlope(sprite: THREE.Sprite): number {
  return isNonAttenuatedSprite(sprite) ? spriteSpread(sprite) : 0;
}

function skinnedSphereInAnchor(entry: SkinnedEntry, invStretch: number): void {
  skinnedWorldSphere(entry.mesh, entry.bound, scratchCentre);
  scratchCentre.applyMatrix4(scratchInvAnchor);
  scratchRadius *= invStretch;
}

/**
 * Upper bound of the largest stretch (spectral norm) of `m`'s linear part:
 * the square root of the Gershgorin bound of its Gram matrix. Exact when the
 * columns are orthogonal (no shear); never below the true value, unlike the
 * largest column length, which a sheared matrix exceeds.
 */
function maxStretch(m: THREE.Matrix4): number {
  const e = m.elements;
  const g00 = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
  const g11 = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
  const g22 = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
  const g01 = Math.abs(e[0] * e[4] + e[1] * e[5] + e[2] * e[6]);
  const g02 = Math.abs(e[0] * e[8] + e[1] * e[9] + e[2] * e[10]);
  const g12 = Math.abs(e[4] * e[8] + e[5] * e[9] + e[6] * e[10]);
  return Math.sqrt(Math.max(g00 + g01 + g02, g11 + g01 + g12, g22 + g02 + g12));
}

// ---------------------------------------------------------------------------
// Frusta

function frustumSetFor(
  view: AnchorView,
  parent: THREE.Object3D | null,
  marginDeg: number
): FrustumSet {
  for (let i = 0; i < view.setCount; i += 1) {
    const set = view.sets[i]!;
    if (set.parent === parent && set.marginDeg === marginDeg) return set;
  }
  let set = view.sets[view.setCount];
  if (!set) {
    set = {
      parent,
      marginDeg,
      frusta: [],
      eyes: [],
      parentStretch: 1,
      parentInvStretch: 1,
    };
    view.sets.push(set);
  }
  view.setCount += 1;
  set.parent = parent;
  set.marginDeg = marginDeg;

  scratchParentInv.identity();
  set.parentStretch = 1;
  set.parentInvStretch = 1;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    scratchParentInv.copy(parent.matrixWorld).invert();
    set.parentStretch = maxStretch(parent.matrixWorld);
    set.parentInvStretch = maxStretch(scratchParentInv);
  }
  const marginRad = THREE.MathUtils.degToRad(marginDeg);
  for (let k = 0; k < view.viewCount; k += 1) {
    const slot = view.slots[k]!;
    scratchViewInParent.multiplyMatrices(scratchParentInv, slot.worldFromView);
    const eye = set.eyes[k] ?? (set.eyes[k] = new THREE.Vector3());
    eye.setFromMatrixPosition(scratchViewInParent);
    widenProjection(slot.projection, marginRad, scratchProjection);
    scratchClip.multiplyMatrices(
      scratchProjection,
      scratchViewInParent.invert()
    );
    const frustum = set.frusta[k] ?? (set.frusta[k] = new THREE.Frustum());
    frustum.setFromProjectionMatrix(
      scratchClip,
      slot.coordinateSystem,
      slot.reversedDepth
    );
  }
  return set;
}

const scratchParentInv = new THREE.Matrix4();
const scratchViewInParent = new THREE.Matrix4();
const scratchProjection = new THREE.Matrix4();
const scratchClip = new THREE.Matrix4();

/**
 * Copy `projection` into `out` with each side plane turned outward by
 * `marginRad`. Only the x and y rows change, so near, far, depth convention
 * and off-axis asymmetry are kept. A projection that is not a plain
 * (possibly off-axis) perspective is copied unwidened.
 */
function widenProjection(
  projection: THREE.Matrix4,
  marginRad: number,
  out: THREE.Matrix4
): void {
  out.copy(projection);
  const e = out.elements;
  if (marginRad === 0 || !isPlainPerspective(e)) return;
  // x_ndc = e0 * (x / -z) - e8: the tangents at x_ndc = -1 and +1.
  const l = widenedTangent((e[8] - 1) / e[0], -marginRad);
  const r = widenedTangent((e[8] + 1) / e[0], marginRad);
  const b = widenedTangent((e[9] - 1) / e[5], -marginRad);
  const t = widenedTangent((e[9] + 1) / e[5], marginRad);
  e[0] = 2 / (r - l);
  e[8] = (r + l) / (r - l);
  e[5] = 2 / (t - b);
  e[9] = (t + b) / (t - b);
}

/** A perspective projection, possibly off-axis, with no skew or shear terms. */
function isPlainPerspective(e: readonly number[]): boolean {
  return (
    e[11] === -1 &&
    e[15] === 0 &&
    e[3] === 0 &&
    e[7] === 0 &&
    e[1] === 0 &&
    e[2] === 0 &&
    e[4] === 0 &&
    e[6] === 0 &&
    e[0]! > 0 &&
    e[5]! > 0
  );
}

/**
 * The side tangent turned outward by `delta` radians, clamped below 90 deg.
 * A side already past the clamp stays where it is: widening never turns a
 * side plane inward.
 */
function widenedTangent(tangent: number, delta: number): number {
  const angle = THREE.MathUtils.clamp(
    Math.atan(tangent) + delta,
    -MAX_SIDE_ANGLE_RAD,
    MAX_SIDE_ANGLE_RAD
  );
  const widened = Math.tan(angle);
  return delta >= 0 ? Math.max(tangent, widened) : Math.min(tangent, widened);
}

// ---------------------------------------------------------------------------
// Bounds cache

interface Renderable extends THREE.Object3D {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  isBatchedMesh?: boolean;
  isSkinnedMesh?: boolean;
  isCSS3DObject?: boolean;
  geometry?: THREE.BufferGeometry;
  morphTargetInfluences?: number[];
}

function isRenderable(object: THREE.Object3D): boolean {
  const r = object as Renderable;
  return Boolean(
    r.isMesh || r.isPoints || r.isLine || r.isSprite || r.isCSS3DObject
  );
}

function buildBounds(
  cache: AnchorBoundsCache,
  anchor: THREE.Object3D,
  nowMs: number
): void {
  anchor.updateWorldMatrix(true, true);
  if (cache.anchor !== anchor) {
    cache.mergeRoots.clear();
    cache.bindData.clear();
    cache.anchor = anchor;
  }
  const entries: BoundEntry[] = [];
  const keptRoots = new Map<THREE.Object3D, MergeRootSphere>();
  const bind: BindLookup = { previous: cache.bindData, kept: new Map() };
  const visit = (object: THREE.Object3D): void => {
    if (object.userData[FLAG_KEY] === FLAG_MERGE) {
      const sphere = cache.mergeRoots.get(object) ?? mergeRootSphere(object);
      keptRoots.set(object, sphere);
      for (const sprite of sphere.loose) {
        entries.push(nodeEntry(sprite, ORIGIN, 0, true));
      }
      if (sphere.radius >= 0) {
        entries.push({
          kind: 'node',
          object,
          centre: sphere.centre,
          radius: sphere.radius,
          sprite: false,
          layerMask: sphere.layerMask,
          morphReach: null,
        });
      }
      return;
    }
    if (isRenderable(object)) entries.push(...entriesFor(object, bind));
    for (const child of object.children) visit(child);
  };
  visit(anchor);
  cache.mergeRoots.clear();
  for (const [root, sphere] of keptRoots) cache.mergeRoots.set(root, sphere);
  cache.bindData.clear();
  for (const [object, record] of bind.kept) cache.bindData.set(object, record);
  cache.entries = capEntries(entries, anchor);
  cache.valid = true;
  cache.builtAtMs = nowMs;
}

/** The cache entries for one renderable (none when it has no bound). */
function entriesFor(object: THREE.Object3D, bind: BindLookup): BoundEntry[] {
  const r = object as Renderable;
  if (r.isSprite) {
    return [nodeEntry(object, ORIGIN, 0, true)];
  }
  if (r.isCSS3DObject) {
    return [nodeEntry(object, ORIGIN, 0, false)];
  }
  if (r.isSkinnedMesh) {
    const mesh = object as THREE.SkinnedMesh;
    const bound = skinBound(mesh, bind);
    if (bound) return [{ kind: 'skinned', mesh, bound }];
    // No usable skin data (unbound, missing attributes, zero weights): still
    // drawn, so bounded like a plain mesh rather than dropped.
  }
  const morphed = morphBound(r, bind);
  if (morphed) {
    return [
      {
        ...nodeEntry(object, ORIGIN, morphed.base, false),
        morphReach: morphed.reach,
      },
    ];
  }
  const local = localSphere(r);
  if (!local) return [];
  if (r.isInstancedMesh || r.isBatchedMesh) {
    // The instance spread sits anywhere relative to the origin: keep it exact.
    return [nodeEntry(object, local.center, local.radius, false)];
  }
  // Rotation-invariant about the renderable's own origin, so a renderable
  // that turns about itself (a sign facing the camera) needs no rebuild.
  return [
    nodeEntry(object, ORIGIN, local.center.length() + local.radius, false),
  ];
}

const ORIGIN = new THREE.Vector3();

/**
 * Bind-time data of one skinned or morphed renderable (the vertex walk, the
 * costly part of a traversal), with what it was computed from.
 */
interface BindRecord {
  /** The kind, geometry, morph flag, and each input attribute with its version. */
  readonly key: readonly unknown[];
  /** Skinned: the per-bone `boneInverse * bindMatrix` it used. */
  readonly toBone: readonly THREE.Matrix4[] | null;
  readonly value: SkinBound | MorphBound | null;
}

/** The previous traversal's records, and the ones this traversal keeps. */
interface BindLookup {
  readonly previous: ReadonlyMap<THREE.Object3D, BindRecord>;
  readonly kept: Map<THREE.Object3D, BindRecord>;
}

const BIND_ATTRIBUTES = ['position', 'skinIndex', 'skinWeight'] as const;

/**
 * The previous traversal's value for `object` when its inputs are unchanged,
 * else `compute()`. An edit three would upload bumps an attribute's version,
 * a replaced attribute or geometry changes identity, and a rebind changes
 * `toBone`; each of these recomputes. Without a lookup (merge roots, built
 * once until the bounds change) it always computes.
 */
function keptBind<T extends SkinBound | MorphBound>(
  bind: BindLookup | null,
  object: THREE.Object3D,
  kind: 'skin' | 'morph',
  geometry: THREE.BufferGeometry,
  toBone: readonly THREE.Matrix4[] | null,
  compute: () => T | null
): T | null {
  if (!bind) return compute();
  const key: unknown[] = [kind, geometry, geometry.morphTargetsRelative];
  for (const name of BIND_ATTRIBUTES) {
    pushAttribute(key, geometry.getAttribute(name));
  }
  for (const target of geometry.morphAttributes.position ?? []) {
    pushAttribute(key, target);
  }
  const previous = bind.previous.get(object);
  const record =
    previous &&
    sameItems(previous.key, key) &&
    sameMatrices(previous.toBone, toBone)
      ? previous
      : { key, toBone, value: compute() };
  bind.kept.set(object, record);
  return record.value as T | null;
}

function pushAttribute(key: unknown[], a: Attribute | undefined): void {
  if (!a) {
    key.push(null, -1);
    return;
  }
  const interleaved = a as THREE.InterleavedBufferAttribute;
  key.push(
    a,
    interleaved.isInterleavedBufferAttribute
      ? interleaved.data.version
      : (a as THREE.BufferAttribute).version
  );
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameMatrices(
  a: readonly THREE.Matrix4[] | null,
  b: readonly THREE.Matrix4[] | null
): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((m, i) => m.equals(b[i]!));
}

function nodeEntry(
  object: THREE.Object3D,
  centre: THREE.Vector3,
  radius: number,
  sprite: boolean
): NodeEntry {
  return {
    kind: 'node',
    object,
    centre: centre.clone(),
    radius,
    sprite,
    layerMask: null,
    morphReach: null,
  };
}

/** A renderable's bound in its own frame: instance spread first, then geometry. */
function localSphere(r: Renderable): THREE.Sphere | null {
  if (r.isInstancedMesh) return instancedSphere(r as THREE.InstancedMesh);
  if (r.isBatchedMesh) return batchedSphere(r as unknown as THREE.BatchedMesh);
  return geometrySphere(r.geometry);
}

function geometrySphere(
  geometry: THREE.BufferGeometry | undefined
): THREE.Sphere | null {
  if (!geometry) return null;
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const s = geometry.boundingSphere;
  return s && Number.isFinite(s.radius) && s.radius >= 0 ? s : null;
}

/**
 * One sphere around every instance's geometry sphere, each scaled by the
 * stretch of its instance matrix. three's own object sphere scales by the
 * longest column instead, which a sheared instance matrix exceeds.
 */
function instancedSphere(mesh: THREE.InstancedMesh): THREE.Sphere | null {
  const local = geometrySphere(mesh.geometry);
  if (!local || !(mesh.count > 0)) return null;
  const m = new THREE.Matrix4();
  const centre = new THREE.Vector3();
  const box = new THREE.Box3();
  const each = (visit: (radius: number) => void): void => {
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, m);
      centre.copy(local.center).applyMatrix4(m);
      visit(local.radius * maxStretch(m));
    }
  };
  each((radius) => {
    box.expandByPoint(scratchVec.copy(centre).addScalar(radius));
    box.expandByPoint(scratchVec.copy(centre).addScalar(-radius));
  });
  const out = new THREE.Sphere(box.getCenter(new THREE.Vector3()), 0);
  each((radius) => {
    out.radius = Math.max(out.radius, out.center.distanceTo(centre) + radius);
  });
  return Number.isFinite(out.radius) ? out : null;
}

/**
 * three's object sphere of a BatchedMesh (whose instance list is internal),
 * widened by sqrt(3). three scales each instance's sphere by the longest
 * column of its matrix; the true stretch is at most sqrt(3) times that
 * (spectral norm <= Frobenius norm), and every instance sphere (c, r) lies
 * in the union (C, R), so |c - C| + sqrt(3) r <= R + (sqrt(3) - 1) r <= sqrt(3) R.
 */
function batchedSphere(mesh: THREE.BatchedMesh): THREE.Sphere | null {
  mesh.computeBoundingSphere();
  const s = mesh.boundingSphere;
  if (!s || !(s.radius >= 0) || !Number.isFinite(s.radius)) return null;
  return new THREE.Sphere(s.center.clone(), s.radius * Math.sqrt(3));
}

/**
 * One sphere, in `root`'s frame, around every renderable under it. Sprites
 * that keep a constant screen size cannot be bounded in a frame, so they
 * are returned as `loose` and become their own entries.
 */
function mergeRootSphere(root: THREE.Object3D): MergeRootSphere {
  const spheres: THREE.Sphere[] = [];
  const loose: THREE.Object3D[] = [];
  let layerMask = 0;
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((object) => {
    if (!isRenderable(object)) return;
    if (
      (object as Renderable).isSprite &&
      isNonAttenuatedSprite(object as THREE.Sprite)
    ) {
      loose.push(object);
      return;
    }
    const sphere = sphereInRoot(object, invRoot);
    if (sphere) {
      spheres.push(sphere);
      layerMask |= object.layers.mask;
    }
  });
  if (spheres.length === 0) {
    return { centre: new THREE.Vector3(), radius: -1, layerMask: 0, loose };
  }
  const merged = enclosingSphere(spheres);
  return { centre: merged.center, radius: merged.radius, layerMask, loose };
}

/** One renderable's sphere in a merge root's frame (null when it has no bound). */
function sphereInRoot(
  r: Renderable,
  invRoot: THREE.Matrix4
): THREE.Sphere | null {
  if (r.isSprite || r.isCSS3DObject) {
    const centre = new THREE.Vector3()
      .setFromMatrixPosition(r.matrixWorld)
      .applyMatrix4(invRoot);
    const radius = r.isSprite
      ? spriteWorldRadius(r as unknown as THREE.Sprite) * maxStretch(invRoot)
      : 0;
    return new THREE.Sphere(centre, radius);
  }
  if (r.isSkinnedMesh) {
    const mesh = r as unknown as THREE.SkinnedMesh;
    const bound = skinBound(mesh, null);
    if (bound) {
      const centre = new THREE.Vector3();
      skinnedWorldSphere(mesh, bound, centre);
      return new THREE.Sphere(
        centre.applyMatrix4(invRoot),
        scratchRadius * maxStretch(invRoot)
      );
    }
  }
  const rel = new THREE.Matrix4().multiplyMatrices(invRoot, r.matrixWorld);
  const morphed = morphBound(r, null);
  if (morphed) {
    // Influences at build time: a merge root follows no inner change.
    return new THREE.Sphere(
      new THREE.Vector3().applyMatrix4(rel),
      (morphed.base + morphTerm(r, morphed.reach)) * maxStretch(rel)
    );
  }
  const local = localSphere(r);
  if (!local) return null;
  return new THREE.Sphere(
    local.center.clone().applyMatrix4(rel),
    local.radius * maxStretch(rel)
  );
}

/** A sphere around all of `spheres`: the centre of their box, the farthest reach from it. */
function enclosingSphere(spheres: readonly THREE.Sphere[]): THREE.Sphere {
  const box = new THREE.Box3();
  for (const s of spheres) {
    box.expandByPoint(scratchVec.copy(s.center).addScalar(s.radius));
    box.expandByPoint(scratchVec.copy(s.center).addScalar(-s.radius));
  }
  const centre = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (const s of spheres) {
    radius = Math.max(radius, centre.distanceTo(s.center) + s.radius);
  }
  return new THREE.Sphere(centre, radius);
}

/** Smallest sphere around two spheres. */
function unionOfTwo(a: THREE.Sphere, b: THREE.Sphere): THREE.Sphere {
  const d = a.center.distanceTo(b.center);
  if (d + b.radius <= a.radius) return a.clone();
  if (d + a.radius <= b.radius) return b.clone();
  const radius = (d + a.radius + b.radius) / 2;
  const centre = a.center.clone();
  if (d > 0)
    centre.addScaledVector(
      scratchVec.subVectors(b.center, a.center),
      (radius - a.radius) / d
    );
  return new THREE.Sphere(centre, radius);
}

interface Cluster {
  sphere: THREE.Sphere;
  members: NodeEntry[];
  alive: boolean;
}

/**
 * Merge down to ANCHOR_SPHERE_CAP entries: repeatedly merge the two clusters
 * whose centres are nearest (O(n^2), run on a cache build only). Skinned and
 * morphed entries and constant-screen-size sprites follow live inputs and are
 * never merged; they still count toward the cap, so with more of them than
 * the cap allows the result holds them all plus one merged sphere. Unmerged
 * node entries stay live.
 */
function capEntries(
  entries: BoundEntry[],
  anchor: THREE.Object3D
): BoundEntry[] {
  if (entries.length <= ANCHOR_SPHERE_CAP) return entries;
  const fixed: BoundEntry[] = [];
  const clusters: Cluster[] = [];
  const invAnchor = new THREE.Matrix4().copy(anchor.matrixWorld).invert();
  const invStretch = maxStretch(invAnchor);
  scratchInvAnchor.copy(invAnchor);
  for (const entry of entries) {
    if (
      entry.kind !== 'node' ||
      entry.morphReach !== null ||
      (entry.sprite && isNonAttenuatedSprite(entry.object as THREE.Sprite))
    ) {
      fixed.push(entry);
      continue;
    }
    nodeSphereInAnchor(entry, invStretch);
    clusters.push({
      sphere: new THREE.Sphere(scratchCentre.clone(), scratchRadius),
      members: [entry],
      alive: true,
    });
  }
  const target = Math.max(1, ANCHOR_SPHERE_CAP - fixed.length);
  mergeNearestPairs(clusters, target);
  const out = fixed;
  for (const cluster of clusters) {
    if (!cluster.alive) continue;
    if (cluster.members.length === 1) out.push(cluster.members[0]!);
    else
      out.push({
        kind: 'merged',
        centre: cluster.sphere.center,
        radius: cluster.sphere.radius,
        members: cluster.members,
      });
  }
  return out;
}

/**
 * Merge the two alive clusters whose centres are nearest until `target`
 * remain. Each cluster keeps its nearest alive neighbour. A cluster whose
 * neighbour was merged is only marked stale (its recorded distance is then
 * a lower bound) and rescanned when it is picked, so a merge costs O(n)
 * even when many clusters share one neighbour, as coincident centres do:
 * the whole run is O(n^2) time and O(n) memory.
 */
function mergeNearestPairs(clusters: Cluster[], target: number): void {
  let alive = clusters.length;
  if (alive <= target) return;
  const near: NearestTable = { index: [], dist: [], stale: [] };
  for (let i = 0; i < clusters.length; i += 1) scanNearest(clusters, near, i);
  while (alive > target) {
    const i = closestCluster(clusters, near);
    if (i < 0) return;
    const j = near.index[i]!;
    const a = clusters[i]!;
    const b = clusters[j]!;
    a.alive = false;
    b.alive = false;
    clusters.push({
      sphere: unionOfTwo(a.sphere, b.sphere),
      members: a.members.concat(b.members),
      alive: true,
    });
    alive -= 1;
    updateNearest(clusters, near, i, j);
  }
}

/**
 * Per cluster: index of and squared distance to its nearest alive neighbour,
 * and whether that neighbour has merged since (the distance is then a lower
 * bound: the alive set only lost members, and newer clusters were compared).
 */
interface NearestTable {
  readonly index: number[];
  readonly dist: number[];
  readonly stale: boolean[];
}

function scanNearest(
  clusters: readonly Cluster[],
  near: NearestTable,
  i: number
): void {
  let best = -1;
  let bestDist = Infinity;
  const c = clusters[i]!.sphere.center;
  for (let m = 0; m < clusters.length; m += 1) {
    if (m === i || !clusters[m]!.alive) continue;
    const d = c.distanceToSquared(clusters[m]!.sphere.center);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  near.index[i] = best;
  near.dist[i] = bestDist;
  near.stale[i] = false;
}

/**
 * The alive cluster with the nearest neighbour, or -1. A stale pick is
 * rescanned and the choice made again: its distance can only have grown,
 * and every other recorded distance is exact or a lower bound.
 */
function closestCluster(
  clusters: readonly Cluster[],
  near: NearestTable
): number {
  for (;;) {
    let i = -1;
    let bestDist = Infinity;
    for (let m = 0; m < clusters.length; m += 1) {
      if (clusters[m]!.alive && near.dist[m]! < bestDist) {
        bestDist = near.dist[m]!;
        i = m;
      }
    }
    if (i < 0 || !near.stale[i]) return i;
    scanNearest(clusters, near, i);
  }
}

/** After clusters `i` and `j` merged into the last cluster: mark what pointed at them stale. */
function updateNearest(
  clusters: readonly Cluster[],
  near: NearestTable,
  i: number,
  j: number
): void {
  const index = clusters.length - 1;
  scanNearest(clusters, near, index);
  const centre = clusters[index]!.sphere.center;
  for (let m = 0; m < index; m += 1) {
    if (!clusters[m]!.alive) continue;
    if (near.index[m] === i || near.index[m] === j) near.stale[m] = true;
    const d = centre.distanceToSquared(clusters[m]!.sphere.center);
    // Nearer than a lower bound of every other alive cluster: exact again.
    if (d < near.dist[m]!) {
      near.dist[m] = d;
      near.index[m] = index;
      near.stale[m] = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Skinned meshes

/**
 * Bind-pose data for bounding a skinned mesh from its bones' current
 * matrices. A vertex is drawn at
 * `G * sum_i w_i * boneWorld_i * boneInverse_i * bindMatrix * v'`, with
 * `G = matrixWorld * bindMatrixInverse` and `v'` the morphed position. Each
 * term lies within `stretch(boneWorld_i) * D_i` of bone i's position, where
 * D_i is the largest bone-local distance of a vertex weighted to bone i, so
 * a weighted sum (non-negative weights summing to s) lies in s times the
 * sphere around those balls.
 */
interface SkinBound {
  /** Per bone: base bone-local distance, or -1 when no vertex is weighted to it. */
  readonly base: Float64Array;
  /** Per bone: stretch of boneInverse_i * bindMatrix (scales a morph displacement). */
  readonly morphScale: Float64Array;
  /** Per bone and morph target (row-major): largest displacement of a weighted vertex. */
  readonly morphReach: Float64Array;
  readonly targetCount: number;
  /** Smallest and largest per-vertex weight sum. */
  readonly weightMin: number;
  readonly weightMax: number;
}

function skinBound(
  mesh: THREE.SkinnedMesh,
  bind: BindLookup | null
): SkinBound | null {
  const attrs = skinAttributes(mesh);
  if (!attrs) return null;
  const skeleton = attrs.skeleton;
  const toBone = skeleton.bones.map((_, i) =>
    new THREE.Matrix4().multiplyMatrices(
      skeleton.boneInverses[i] ?? new THREE.Matrix4(),
      mesh.bindMatrix
    )
  );
  return keptBind(bind, mesh, 'skin', attrs.geometry, toBone, () =>
    skinBoundOf(attrs, toBone)
  );
}

function skinBoundOf(
  attrs: NonNullable<ReturnType<typeof skinAttributes>>,
  toBone: readonly THREE.Matrix4[]
): SkinBound | null {
  const { geometry, position, skinIndex, skinWeight } = attrs;
  const targets = geometry.morphAttributes.position ?? [];
  const acc: SkinAccumulator = {
    toBone,
    targets,
    relative: geometry.morphTargetsRelative,
    base: new Float64Array(toBone.length).fill(-1),
    morphReach: new Float64Array(toBone.length * targets.length),
    reach: new Float64Array(targets.length),
    weightMin: Infinity,
    weightMax: -Infinity,
  };
  for (let vi = 0; vi < position.count; vi += 1) {
    accumulateSkinVertex(acc, position, skinIndex, skinWeight, vi);
  }
  if (!Number.isFinite(acc.weightMax) || acc.weightMax <= 0) return null;
  return {
    base: acc.base,
    morphScale: Float64Array.from(toBone, (m) => maxStretch(m)),
    morphReach: acc.morphReach,
    targetCount: targets.length,
    weightMin: acc.weightMin,
    weightMax: acc.weightMax,
  };
}

type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** The geometry, skeleton and skinning attributes, or null when one is missing. */
function skinAttributes(mesh: THREE.SkinnedMesh): {
  geometry: THREE.BufferGeometry;
  skeleton: THREE.Skeleton;
  position: Attribute;
  skinIndex: Attribute;
  skinWeight: Attribute;
} | null {
  const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
  const skeleton = mesh.skeleton as THREE.Skeleton | undefined;
  if (!geometry || !skeleton) return null;
  const position = geometry.getAttribute('position') as Attribute | undefined;
  const skinIndex = geometry.getAttribute('skinIndex') as Attribute | undefined;
  const skinWeight = geometry.getAttribute('skinWeight') as
    Attribute | undefined;
  if (!position || !skinIndex || !skinWeight) return null;
  return { geometry, skeleton, position, skinIndex, skinWeight };
}

interface SkinAccumulator {
  readonly toBone: readonly THREE.Matrix4[];
  readonly targets: readonly Attribute[];
  readonly relative: boolean;
  readonly base: Float64Array;
  readonly morphReach: Float64Array;
  /** Scratch: this vertex's displacement per morph target. */
  readonly reach: Float64Array;
  weightMin: number;
  weightMax: number;
}

const skinV = new THREE.Vector3();
const skinQ = new THREE.Vector3();

/** Folds one vertex into the per-bone distances, morph reaches and weight-sum range. */
function accumulateSkinVertex(
  acc: SkinAccumulator,
  position: Attribute,
  skinIndex: Attribute,
  skinWeight: Attribute,
  vi: number
): void {
  skinV.fromBufferAttribute(position, vi);
  for (let t = 0; t < acc.targets.length; t += 1) {
    skinQ.fromBufferAttribute(acc.targets[t]!, vi);
    if (!acc.relative) skinQ.sub(skinV);
    acc.reach[t] = skinQ.length();
  }
  let sum = 0;
  for (let c = 0; c < skinWeight.itemSize; c += 1) {
    const w = Math.max(0, skinWeight.getComponent(vi, c));
    if (w === 0) continue;
    const bone = skinIndex.getComponent(vi, c);
    // An index past the skeleton reads the bone texture's zero padding (past
    // the texture, what is read is not defined): its weight moves the vertex
    // nowhere, so it adds nothing to the sum.
    if (bone >= 0 && bone < acc.toBone.length) {
      sum += w;
      foldBone(acc, bone);
    }
  }
  acc.weightMin = Math.min(acc.weightMin, sum);
  acc.weightMax = Math.max(acc.weightMax, sum);
}

/** Folds the current vertex (skinV, acc.reach) into one bone's bound. */
function foldBone(acc: SkinAccumulator, bone: number): void {
  const d = skinQ.copy(skinV).applyMatrix4(acc.toBone[bone]!).length();
  if (d > acc.base[bone]!) acc.base[bone] = d;
  const n = acc.targets.length;
  for (let t = 0; t < n; t += 1) {
    const at = bone * n + t;
    if (acc.reach[t]! > acc.morphReach[at]!) acc.morphReach[at] = acc.reach[t]!;
  }
}

const skinBox = new THREE.Box3();
const skinBonePos = new THREE.Vector3();
const skinG = new THREE.Matrix4();

/**
 * Writes the skinned mesh's world sphere centre into `out` and its radius
 * into scratchRadius, from the bones' current world matrices and the mesh's
 * current morph influences (two passes over the bones).
 */
function skinnedWorldSphere(
  mesh: THREE.SkinnedMesh,
  bound: SkinBound,
  out: THREE.Vector3
): void {
  const bones = mesh.skeleton.bones;
  const influences = mesh.morphTargetInfluences ?? [];
  const reachOf = (i: number): number => {
    let d = bound.base[i]!;
    if (bound.targetCount > 0) {
      let morph = 0;
      for (let t = 0; t < bound.targetCount; t += 1) {
        morph +=
          Math.abs(influences[t] ?? 0) *
          bound.morphReach[i * bound.targetCount + t]!;
      }
      d += bound.morphScale[i]! * morph;
    }
    return d * maxStretch(bones[i]!.matrixWorld);
  };
  skinBox.makeEmpty();
  for (let i = 0; i < bones.length; i += 1) {
    if (bound.base[i]! < 0) continue;
    const r = reachOf(i);
    skinBonePos.setFromMatrixPosition(bones[i]!.matrixWorld);
    skinBox.expandByPoint(scratchVec.copy(skinBonePos).addScalar(r));
    skinBox.expandByPoint(scratchVec.copy(skinBonePos).addScalar(-r));
  }
  skinBox.getCenter(out);
  let radius = 0;
  for (let i = 0; i < bones.length; i += 1) {
    if (bound.base[i]! < 0) continue;
    skinBonePos.setFromMatrixPosition(bones[i]!.matrixWorld);
    radius = Math.max(radius, out.distanceTo(skinBonePos) + reachOf(i));
  }
  // Weight sums s in [min, max] scale the combination about the origin.
  const mid = (bound.weightMin + bound.weightMax) / 2;
  radius =
    ((bound.weightMax - bound.weightMin) / 2) * out.length() +
    bound.weightMax * radius;
  out.multiplyScalar(mid);
  skinG.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
  out.applyMatrix4(skinG);
  scratchRadius = radius * maxStretch(skinG);
}

function assertObject3D(value: unknown, where: string): void {
  if (!(value instanceof THREE.Object3D)) {
    throw new TypeError(`${where}: expected a THREE.Object3D`);
  }
}
