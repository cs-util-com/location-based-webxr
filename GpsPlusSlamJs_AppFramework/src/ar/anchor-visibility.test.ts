/**
 * Unit tests for the subtree visibility predicate (`anchor-visibility.ts`).
 *
 * Why these tests matter: a content anchor re-places its subtree only while
 * none of it is in view. A false "out" makes content jump on screen, which
 * is the one failure the predicate exists to prevent; a false "in" only
 * delays a re-placement. Each case below pins one way a subtree can be
 * drawn although a naive test of its root would say it is not (or the
 * reverse, where the answer must be "out"). All scenes are real three.js
 * objects; the views are synthetic.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { WebXRManager } from 'three/src/renderers/webxr/WebXRManager.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANCHOR_BOUNDS_REFRESH_MS,
  ANCHOR_SPHERE_CAP,
  ANCHOR_VIEW_MARGIN_DEG,
  anchorBoundsNeedRefresh,
  createAnchorBoundsCache,
  createAnchorView,
  ignoreForAnchorVisibility,
  isAnchorInView,
  markAnchorBoundsChanged,
  mergeForAnchorBounds,
  updateAnchorView,
  type AnchorBoundsCache,
  type AnchorVisibilityCounters,
  type XrCameraSource,
} from './anchor-visibility';

/** A camera at the origin looking down -z: 60 deg vertical fov, aspect 1, so 30 deg to each side. */
function makeCamera(far = 200): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, far);
  camera.updateMatrixWorld(true);
  return camera;
}

/** A point `distance` metres out along a ray `deg` degrees right of the view axis. */
function atAngle(deg: number, distance: number): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(distance * Math.sin(a), 0, -distance * Math.cos(a));
}

function tinyMesh(at?: THREE.Vector3, radius = 0.01): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 4, 2));
  if (at) mesh.position.copy(at);
  return mesh;
}

interface Rig {
  scene: THREE.Scene;
  parent: THREE.Group;
  anchor: THREE.Group;
  camera: THREE.PerspectiveCamera;
  cache: AnchorBoundsCache;
}

function makeRig(): Rig {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  const anchor = new THREE.Group();
  scene.add(parent);
  parent.add(anchor);
  const camera = makeCamera();
  scene.add(camera);
  return { scene, parent, anchor, camera, cache: createAnchorBoundsCache() };
}

function inView(
  rig: Rig,
  opts: {
    marginDeg?: number;
    atLocal?: THREE.Matrix4;
    fresh?: boolean;
    nowMs?: number;
    xr?: XrCameraSource;
  } = {}
): boolean {
  rig.scene.updateMatrixWorld(true);
  const view = updateAnchorView(createAnchorView(), rig.camera, opts.xr);
  return isAnchorInView(view, rig.anchor, {
    marginDeg: opts.marginDeg ?? 0,
    cache: rig.cache,
    atLocal: opts.atLocal,
    fresh: opts.fresh,
    nowMs: opts.nowMs ?? 0,
  });
}

/** A presenting XR source with one sub-camera at `pose` (relative to the user camera's parent). */
function fakeXr(sub: THREE.PerspectiveCamera): XrCameraSource {
  return { isPresenting: true, getCamera: () => ({ cameras: [sub] }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anchor-visibility: the current XR view inside the app loop', () => {
  it('three sets each sub-camera view pose and projection before the frame callback runs', async () => {
    // The premise of reading `xr.getCamera().cameras` from a frame update:
    // inside the app's frame callback the sub-camera already holds THIS
    // frame's view pose and projection (not the last rendered frame's).
    // Driven through three's real WebXRManager with a stub session and frame.
    vi.stubGlobal(
      'XRWebGLLayer',
      class {
        framebufferWidth = 4;
        framebufferHeight = 4;
        framebuffer = {};
        ignoreDepthValues = false;
        getViewport() {
          return { x: 0, y: 0, width: 4, height: 4 };
        }
      }
    );
    const gl = {
      getContextAttributes: () => ({
        xrCompatible: true,
        antialias: false,
        alpha: true,
        depth: true,
        stencil: false,
      }),
    };
    const renderer = {
      getRenderTarget: () => null,
      getPixelRatio: () => 1,
      getSize: (v: THREE.Vector2) => v.set(4, 4),
      setPixelRatio: () => undefined,
      setSize: () => undefined,
      setRenderTargetFramebuffer: () => undefined,
      setRenderTarget: () => undefined,
      outputColorSpace: THREE.SRGBColorSpace,
    };
    let onFrame: ((time: number, frame: unknown) => void) | null = null;
    const session = {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      updateRenderState: () => undefined,
      requestReferenceSpace: () => Promise.resolve({}),
      requestAnimationFrame: (cb: (time: number, frame: unknown) => void) => {
        onFrame = cb;
        return 1;
      },
      cancelAnimationFrame: () => undefined,
      inputSources: [],
      renderState: {},
    };
    const xr = new WebXRManager(renderer as never, gl as never);
    await xr.setSession(session as never);

    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(0, 0, -10)));
    // Frame 1 looks away (turned 90 deg left, far 200); frame 2 looks at the
    // content with a depth-sensing far of 50.
    const away = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const ahead = new THREE.Matrix4();
    const proj200 = makeCamera(200).projectionMatrix.clone();
    const proj50 = makeCamera(50).projectionMatrix.clone();
    const frameFor = (pose: THREE.Matrix4, proj: THREE.Matrix4) => ({
      getViewerPose: () => ({
        views: [
          {
            transform: { matrix: pose.elements.slice() },
            projectionMatrix: proj.elements.slice(),
          },
        ],
      }),
    });

    const seen: { inView: boolean; matrix: number[]; projection: number[] }[] =
      [];
    xr.setAnimationLoop(() => {
      const sub = xr.getCamera().cameras[0];
      seen.push({
        inView: inView(rig, { xr }),
        matrix: sub.matrix.elements.slice(),
        projection: sub.projectionMatrix.elements.slice(),
      });
    });
    expect(onFrame).not.toBeNull();
    onFrame!(0, frameFor(away, proj200));
    onFrame!(16, frameFor(ahead, proj50));

    expect(seen).toHaveLength(2);
    expect(seen[0]!.matrix).toEqual(away.elements);
    expect(seen[0]!.projection).toEqual(proj200.elements);
    expect(seen[0]!.inView).toBe(false);
    expect(seen[1]!.matrix).toEqual(ahead.elements);
    expect(seen[1]!.projection).toEqual(proj50.elements);
    expect(seen[1]!.inView).toBe(true);
  });
});

describe('anchor-visibility: what is in view', () => {
  it('a tall child in view counts while the anchor origin is out of view', () => {
    // A station's root sits on the ground below the view; its tall sign
    // reaches up into it.
    const rig = makeRig();
    rig.anchor.position.set(0, -30, -10);
    const tall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 40, 0.2).translate(0, 20, 0)
    );
    rig.anchor.add(tall);
    expect(inView(rig)).toBe(true);
    tall.position.set(0, -50, 0); // its 40 m reach now ends 10 m below the anchor
    expect(inView(rig)).toBe(false);
  });

  it('a Mesh anchor counts its own geometry and its children', () => {
    const rig = makeRig();
    const meshAnchor = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    rig.parent.remove(rig.anchor);
    rig.parent.add(meshAnchor);
    rig.anchor = meshAnchor as unknown as THREE.Group;
    meshAnchor.position.set(0, 0, -10);
    expect(inView(rig)).toBe(true);

    meshAnchor.position.set(100, 0, -10);
    const child = tinyMesh(new THREE.Vector3(-100, 0, 0));
    meshAnchor.add(child);
    markAnchorBoundsChanged(rig.cache);
    expect(inView(rig)).toBe(true);
    child.position.set(0, 0, 0);
    expect(inView(rig)).toBe(false);
  });

  it('hidden children and hidden ancestors do not count, read live after the cache was built', () => {
    const rig = makeRig();
    const frame = new THREE.Group();
    const part = tinyMesh(new THREE.Vector3(0, 0, -10));
    frame.add(part);
    rig.anchor.add(frame);
    expect(inView(rig)).toBe(true);
    part.visible = false;
    expect(inView(rig)).toBe(false);
    part.visible = true;
    frame.visible = false;
    expect(inView(rig)).toBe(false);
    frame.visible = true; // no markAnchorBoundsChanged: the flag is read live
    expect(inView(rig)).toBe(true);
    rig.anchor.visible = false;
    expect(inView(rig)).toBe(false);
  });

  it('an opted-out shape (an edge hint drawn by the camera) does not count', () => {
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(100, 0, -10)));
    const hint = new THREE.Group();
    hint.add(tinyMesh(new THREE.Vector3(0, 0, -5)));
    rig.anchor.add(hint);
    expect(inView(rig)).toBe(true);
    ignoreForAnchorVisibility(hint); // set after the build: read live
    expect(inView(rig)).toBe(false);
  });

  it('a wide world-scaled sprite counts when its origin is out of view', () => {
    const rig = makeRig();
    // 3 m beyond the right side plane, 20 m out; scale 10 reaches 5 m in.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    sprite.position.copy(atAngle(30, 20)).addScaledVector(plane, 3);
    sprite.scale.set(10, 10, 1);
    rig.anchor.add(sprite);
    expect(inView(rig)).toBe(true);
    sprite.scale.set(1, 1, 1);
    expect(inView(rig)).toBe(false);
  });

  it('a sprite with a non-default center reaches as far as its quad does', () => {
    const rig = makeRig();
    // center.x = 1 puts the whole quad to the LEFT of the origin, a full
    // scale (2 m) inward from an origin 1.6 m beyond the right plane. A
    // default-center bound (0.71 x scale = 1.41 m) would miss it.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    sprite.position.copy(atAngle(30, 20)).addScaledVector(plane, 1.6);
    sprite.scale.set(2, 2, 1);
    sprite.center.set(1, 0.5);
    rig.anchor.add(sprite);
    expect(inView(rig)).toBe(true);
    sprite.center.set(0.5, 0.5); // default center: 1.41 m reach, short of 1.6 m
    expect(inView(rig)).toBe(false);
  });

  it('a sizeAttenuation:false sprite widens by its angular size, at any distance', () => {
    const rig = makeRig();
    // Scale 0.2 on a constant-size sprite spans about 8 deg from its origin;
    // its origin sits 4 deg beyond the right plane, 50 m out.
    const material = new THREE.SpriteMaterial({ sizeAttenuation: false });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(atAngle(34, 50));
    sprite.scale.set(0.2, 0.2, 1);
    rig.anchor.add(sprite);
    expect(inView(rig)).toBe(true);
    material.sizeAttenuation = true; // now 0.14 m wide at 50 m: out
    expect(inView(rig)).toBe(false);
  });

  it('sibling frames are both counted', () => {
    const rig = makeRig();
    const items = new THREE.Group();
    const story = new THREE.Group();
    items.add(tinyMesh(new THREE.Vector3(100, 0, -10)));
    const figure = tinyMesh(new THREE.Vector3(0, 0, -10));
    story.add(figure);
    rig.anchor.add(items, story);
    expect(inView(rig)).toBe(true);
    figure.position.set(-100, 0, -10);
    expect(inView(rig)).toBe(false);
  });

  it('the target pose in view says in while the current pose is out (and the reverse)', () => {
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(0, 0, -10)));
    rig.anchor.position.set(100, 0, 0);
    const here = new THREE.Matrix4();
    const away = new THREE.Matrix4().makeTranslation(100, 0, 0);
    expect(inView(rig)).toBe(false);
    expect(inView(rig, { atLocal: here })).toBe(true);
    rig.anchor.position.set(0, 0, 0);
    expect(inView(rig)).toBe(true);
    expect(inView(rig, { atLocal: away })).toBe(false);
  });

  it('3 deg beyond a side plane is in at margin 5 and out at margin 0', () => {
    const rig = makeRig();
    rig.anchor.add(tinyMesh(atAngle(33, 10)));
    expect(inView(rig, { marginDeg: 0 })).toBe(false);
    expect(inView(rig, { marginDeg: ANCHOR_VIEW_MARGIN_DEG })).toBe(true);
  });

  it('each side of an off-axis projection widens outward by the margin', () => {
    // The four side tangents of an off-axis projection differ (45 deg right,
    // 26.6 deg left, top and bottom); a sign slip on any one of them narrows
    // that side, a false "out" at the margin in use. One point 3 deg beyond
    // each side: out at margin 0, in at margin 5.
    const offAxis = new THREE.PerspectiveCamera();
    offAxis.projectionMatrix.makePerspective(-0.05, 0.1, 0.05, -0.05, 0.1, 200);
    const sides: [string, THREE.Vector3][] = [];
    const deg = (t: number) => THREE.MathUtils.radToDeg(Math.atan(t)) + 3;
    const up = (d: number) => {
      const a = THREE.MathUtils.degToRad(d);
      return new THREE.Vector3(0, 10 * Math.sin(a), -10 * Math.cos(a));
    };
    sides.push(['right', atAngle(deg(1), 10)]);
    sides.push(['left', atAngle(-deg(0.5), 10)]);
    sides.push(['top', up(deg(0.5))]);
    sides.push(['bottom', up(-deg(0.5))]);
    for (const [side, at] of sides) {
      const rig = makeRig();
      rig.camera = offAxis;
      rig.anchor.add(tinyMesh(at));
      expect(inView(rig, { marginDeg: 0 }), side).toBe(false);
      expect(inView(rig, { marginDeg: 5 }), side).toBe(true);
    }
  });

  it('a cache built for one anchor is rebuilt when another anchor is tested with it', () => {
    // Nothing else binds a cache to its anchor: testing anchor B with A's
    // cache would read A's parts, none of which count under B, and say "out"
    // while B's part is in view.
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(100, 0, -10)));
    expect(inView(rig)).toBe(false);
    const other = new THREE.Group();
    other.add(tinyMesh(new THREE.Vector3(0, 0, -10)));
    rig.parent.add(other);
    rig.anchor = other;
    expect(inView(rig)).toBe(true);
  });

  it('content behind the camera is out', () => {
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(0, 0, 5), 1));
    expect(inView(rig, { marginDeg: ANCHOR_VIEW_MARGIN_DEG })).toBe(false);
  });

  it('content beyond the far plane of the projection is out, with a depth-sensing far', () => {
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(0, 0, -30)));
    expect(inView(rig)).toBe(true); // user camera far 200
    const sub = makeCamera(20); // the session's depth far is 20 m
    expect(inView(rig, { xr: fakeXr(sub) })).toBe(false);
  });

  it('a layer-1 object counts for an XR sub-camera that renders layer 1', () => {
    const rig = makeRig();
    const part = tinyMesh(new THREE.Vector3(0, 0, -10));
    part.layers.set(1);
    rig.anchor.add(part);
    expect(inView(rig)).toBe(false); // the user camera renders layer 0 only
    const sub = makeCamera();
    sub.layers.mask = 0b011; // three: camera layers | the eye's layer
    expect(inView(rig, { xr: fakeXr(sub) })).toBe(true);
  });

  it('an anchor with nothing drawable is out', () => {
    const rig = makeRig();
    const frame = new THREE.Group();
    frame.add(new THREE.Group(), new THREE.PointLight());
    frame.position.set(0, 0, -10);
    rig.anchor.add(frame);
    expect(inView(rig, { marginDeg: ANCHOR_VIEW_MARGIN_DEG })).toBe(false);
    expect(rig.cache.entries).toHaveLength(0);
  });

  it('nine pins over the sphere cap: every merged sphere stays within one pin', () => {
    // 9 pins x 8 parts = 72 spheres, more than the cap of 32. Nearest-pair
    // merging must merge parts of one pin, never two pins into a sphere
    // that spans the station.
    const rig = makeRig();
    const pins: THREE.Group[] = [];
    for (let p = 0; p < 9; p += 1) {
      const pin = new THREE.Group();
      pin.position.set(p * 5 - 20, 0, -60);
      for (let i = 0; i < 8; i += 1)
        pin.add(tinyMesh(new THREE.Vector3(0, i * 0.12, 0), 0.05));
      rig.anchor.add(pin);
      pins.push(pin);
    }
    expect(inView(rig)).toBe(true);
    const entries = rig.cache.entries;
    expect(entries.length).toBeLessThanOrEqual(ANCHOR_SPHERE_CAP);
    for (const entry of entries) {
      if (entry.kind !== 'merged') continue;
      const owners = new Set(entry.members.map((m) => m.object.parent));
      expect(owners.size).toBe(1);
      expect(entry.radius).toBeLessThan(1);
    }
  });

  it('a pending cache that keeps saying "in" asks for a refresh within 1 s, and the refresh sees the change', () => {
    // An instance moved without a bounds change leaves a stale "in"; the
    // refresh bounds how long it can hold a re-placement back.
    const rig = makeRig();
    const instanced = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.1),
      undefined,
      1
    );
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, -10));
    rig.anchor.add(instanced);
    expect(inView(rig, { nowMs: 0 })).toBe(true);
    instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(100, 0, -10));
    expect(inView(rig, { nowMs: 500 })).toBe(true); // stale, by design
    expect(anchorBoundsNeedRefresh(rig.cache, 500)).toBe(false);
    expect(anchorBoundsNeedRefresh(rig.cache, ANCHOR_BOUNDS_REFRESH_MS)).toBe(
      true
    );
    expect(inView(rig, { nowMs: ANCHOR_BOUNDS_REFRESH_MS, fresh: true })).toBe(
      false
    );
    expect(
      anchorBoundsNeedRefresh(rig.cache, ANCHOR_BOUNDS_REFRESH_MS + 1)
    ).toBe(false);
  });

  it('a bone scaled after the cache was built widens the skinned bound', () => {
    // Skinned meshes are bounded from their bones on every test. A bone's
    // scale moves its vertices outward, so the bound widens by it.
    const rig = makeRig();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4)
    );
    const weights = new Array(count * 4).fill(0);
    for (let i = 0; i < count; i += 1) weights[i * 4] = 1;
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(weights, 4)
    );
    const mesh = new THREE.SkinnedMesh(geometry);
    const bone = new THREE.Bone();
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    // Box half-diagonal 0.87 m; the bone sits 8 m beyond the right plane.
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    bone.position.copy(atAngle(30, 20)).addScaledVector(plane, 8);
    rig.anchor.add(mesh);
    expect(inView(rig)).toBe(false);
    bone.scale.setScalar(20); // vertices now reach 17 m from the bone
    expect(inView(rig)).toBe(true);
  });

  /** A unit box skinned to one bone with every vertex weighted `weight`. */
  function skinnedBox(weight: number): {
    mesh: THREE.SkinnedMesh;
    bone: THREE.Bone;
    geometry: THREE.BufferGeometry;
  } {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4)
    );
    const weights = new Array(count * 4).fill(0);
    for (let i = 0; i < count; i += 1) weights[i * 4] = weight;
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(weights, 4)
    );
    return {
      mesh: new THREE.SkinnedMesh(geometry),
      bone: new THREE.Bone(),
      geometry,
    };
  }

  it('a morph influence raised after the cache was built widens the skinned bound', () => {
    // Morph targets displace vertices before skinning; the bound reads the
    // current influences on every test, so raising one after the build
    // still counts the displaced shape.
    const rig = makeRig();
    const { mesh, bone, geometry } = skinnedBox(1);
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    const count = geometry.getAttribute('position').count;
    const shift = new Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      shift[i * 3] = -plane.x * 12;
      shift[i * 3 + 1] = 0;
      shift[i * 3 + 2] = -plane.z * 12;
    }
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(shift, 3),
    ];
    geometry.morphTargetsRelative = true;
    mesh.updateMorphTargets();
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    bone.position.copy(atAngle(30, 20)).addScaledVector(plane, 8);
    rig.anchor.add(mesh);
    expect(inView(rig)).toBe(false);
    mesh.morphTargetInfluences![0] = 1; // the box now sits 4 m inside the plane
    expect(inView(rig)).toBe(true);
  });

  /**
   * A unit box 17.5 m beyond the right side plane with two relative morph
   * targets, each moving it 6 m toward the view per unit of influence.
   */
  function morphedBoxBeyondPlane(): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    const count = geometry.getAttribute('position').count;
    const shift = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      shift[i * 3] = -plane.x * 6;
      shift[i * 3 + 2] = -plane.z * 6;
    }
    geometry.morphAttributes.position = [
      new THREE.BufferAttribute(shift, 3),
      new THREE.BufferAttribute(shift.slice(), 3),
    ];
    geometry.morphTargetsRelative = true;
    const mesh = new THREE.Mesh(geometry);
    mesh.position.copy(atAngle(30, 20)).addScaledVector(plane, 17.5);
    return mesh;
  }

  it('a plain mesh with two morph targets active at once counts the summed displacement', () => {
    // three's geometry bounding sphere covers each morph target alone at
    // influence 1; two relative targets at 1 (or one above 1) displace
    // further. Three's own sphere reaches 12.7 m from the mesh origin here,
    // so only the summed 18 m brings the box in. Influences are raised after
    // the build.
    const rig = makeRig();
    const mesh = morphedBoxBeyondPlane();
    rig.anchor.add(mesh);
    expect(inView(rig)).toBe(false);
    mesh.morphTargetInfluences![0] = 1.5;
    mesh.morphTargetInfluences![1] = 1.5; // 18 m: 0.5 m inside the plane
    expect(inView(rig)).toBe(true);
    mesh.morphTargetInfluences![1] = 0;
    mesh.morphTargetInfluences![0] = 3; // one target above 1, the same 18 m
    expect(inView(rig)).toBe(true);
  });

  it('a morphed mesh over the sphere cap keeps its own live bound and is never merged', () => {
    // A merged sphere is built once from the members' build-time bounds, so a
    // morphed mesh inside one would not follow an influence raised later.
    // A tiny mesh 1 cm from the box makes it the nearest pair; 40 more,
    // behind the camera, push the count over the cap.
    const rig = makeRig();
    const mesh = morphedBoxBeyondPlane();
    rig.anchor.add(mesh);
    rig.anchor.add(
      tinyMesh(mesh.position.clone().add(new THREE.Vector3(0, 0.01, 0)))
    );
    for (let i = 0; i < 40; i += 1)
      rig.anchor.add(tinyMesh(new THREE.Vector3(i * 3 - 60, 0, 30)));
    expect(inView(rig)).toBe(false);
    expect(rig.cache.entries.length).toBeLessThanOrEqual(ANCHOR_SPHERE_CAP);
    mesh.morphTargetInfluences![0] = 1.5;
    mesh.morphTargetInfluences![1] = 1.5;
    expect(inView(rig)).toBe(true);
  });

  it('one merge over the sphere cap joins the nearest pair anywhere in the subtree, not the first', () => {
    // 33 parts, so exactly one merge. The first two children are 2 m apart,
    // a later pair 10 cm apart, the rest 20 m apart: merging the nearest
    // pair gives one small sphere, merging near the start of the list a 1 m
    // one, which keeps saying "in" over a wider angle.
    const rig = makeRig();
    rig.anchor.add(tinyMesh(new THREE.Vector3(-1, 0, -60), 0.05));
    rig.anchor.add(tinyMesh(new THREE.Vector3(1, 0, -60), 0.05));
    for (let i = 0; i < 29; i += 1)
      rig.anchor.add(tinyMesh(new THREE.Vector3(i * 20 - 280, 0, -80), 0.05));
    rig.anchor.add(tinyMesh(new THREE.Vector3(0, 5, -60), 0.05));
    rig.anchor.add(tinyMesh(new THREE.Vector3(0.1, 5, -60), 0.05));
    expect(inView(rig)).toBe(true);
    const merged = rig.cache.entries.filter((e) => e.kind === 'merged');
    expect(rig.cache.entries).toHaveLength(ANCHOR_SPHERE_CAP);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.radius).toBeLessThan(0.2);
  });

  it('skin weights summing to less than one pull the skinned shape toward the origin', () => {
    // three does not normalise skin weights on bind: a vertex weighted 0.5
    // is drawn at half its bone-transformed position. With the bone 300 m
    // ahead (beyond the far plane of 200 m) the box is drawn 150 m ahead.
    const rig = makeRig();
    const { mesh, bone } = skinnedBox(0.5);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300);
    rig.anchor.add(mesh);
    expect(inView(rig)).toBe(true);
    bone.position.set(0, 0, -450); // drawn 225 m ahead: out
    expect(inView(rig)).toBe(false);
  });

  it('a weight on a bone index past the skeleton adds nothing to the weight sum', () => {
    // A malformed file: each vertex weighs 0.5 on bone 0 and 0.5 on index 3
    // of a one-bone skeleton. three reads a zero matrix for the bad index
    // (the bone texture's padding), so the vertex is drawn at half its bone
    // transform: the bone 300 m ahead puts the box 150 m ahead, in view.
    const rig = makeRig();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute('position').count;
    const index: number[] = [];
    const weight: number[] = [];
    for (let i = 0; i < count; i += 1) {
      index.push(0, 3, 0, 0);
      weight.push(0.5, 0.5, 0, 0);
    }
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(index, 4)
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(weight, 4)
    );
    const mesh = new THREE.SkinnedMesh(geometry);
    const bone = new THREE.Bone();
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300);
    rig.anchor.add(mesh);
    expect(inView(rig)).toBe(true);
  });

  /**
   * An instance matrix with a non-uniform scale between two rotations, which
   * shears it: its largest stretch (4) exceeds every column length (2.9), so
   * a bound scaled by the largest column (three's `Sphere.applyMatrix4`)
   * falls short. Placed so the farthest drawn vertex (found by brute force)
   * reaches 0.05 m inside the right side plane.
   */
  function placeShearedInstance(
    rig: Rig,
    mesh: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    instance: THREE.Matrix4
  ): void {
    rig.anchor.add(mesh);
    rig.scene.updateMatrixWorld(true);
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    const position = geometry.getAttribute('position');
    let reach = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(instance);
      reach = Math.max(reach, -v.dot(plane));
    }
    mesh.position.copy(atAngle(30, 20)).addScaledVector(plane, reach - 0.05);
  }

  function shearedMatrix(): THREE.Matrix4 {
    return new THREE.Matrix4()
      .makeRotationY((5 * Math.PI) / 6)
      .multiply(new THREE.Matrix4().makeScale(4, 1, 1))
      .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
  }

  it('a sheared instance of an InstancedMesh is still bounded', () => {
    const rig = makeRig();
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(1, 0, 0);
    const mesh = new THREE.InstancedMesh(geometry, undefined, 1);
    mesh.setMatrixAt(0, shearedMatrix());
    placeShearedInstance(rig, mesh, geometry, shearedMatrix());
    expect(inView(rig)).toBe(true);
  });

  it('a sheared instance of a BatchedMesh is still bounded', () => {
    const rig = makeRig();
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(1, 0, 0);
    const mesh = new THREE.BatchedMesh(1, 64, 64);
    const id = mesh.addInstance(mesh.addGeometry(geometry));
    mesh.setMatrixAt(id, shearedMatrix());
    placeShearedInstance(rig, mesh, geometry, shearedMatrix());
    expect(inView(rig)).toBe(true);
  });

  it('bind-time bounds are reused by a fresh traversal until the geometry or the bind changes', () => {
    // The vertex walk of a skinned or morphed part is the expensive part of
    // a traversal (tens of ms for a 20k-vertex rig with 50 blend shapes), and
    // a fresh traversal runs every second while content waits. It reads the
    // same bind data each time, so it is kept; an attribute replaced or
    // edited (its version bumps, as three needs to upload it), a swapped
    // geometry and a rebind still recompute.
    const rig = makeRig();
    const mesh = morphedBoxBeyondPlane();
    rig.anchor.add(mesh);
    const { mesh: skinned, bone } = skinnedBox(1);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300); // beyond the far plane
    rig.anchor.add(skinned);
    const morphReads = vi.spyOn(
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      'getX'
    );
    const skinReads = vi.spyOn(
      skinned.geometry.getAttribute('position') as THREE.BufferAttribute,
      'getX'
    );
    expect(inView(rig, { fresh: true })).toBe(false);
    expect(morphReads).toHaveBeenCalled();
    expect(skinReads).toHaveBeenCalled();
    morphReads.mockClear();
    skinReads.mockClear();
    expect(inView(rig, { fresh: true })).toBe(false);
    expect(morphReads).not.toHaveBeenCalled();
    expect(skinReads).not.toHaveBeenCalled();

    // A target edited in place (18 m toward the view at influence 1).
    mesh.morphTargetInfluences![0] = 1;
    const target = mesh.geometry.morphAttributes.position![0]!;
    for (let i = 0; i < target.count; i += 1) {
      target.setXYZ(i, target.getX(i) * 3, 0, target.getZ(i) * 3);
    }
    target.needsUpdate = true;
    expect(inView(rig, { fresh: true })).toBe(true);
    mesh.visible = false;

    // New bone inverses (a rebind): the box is now drawn 200 m nearer than
    // its bone, 100 m ahead.
    expect(inView(rig, { fresh: true })).toBe(false);
    skinned.skeleton.boneInverses[0]!.makeTranslation(0, 0, 200);
    expect(inView(rig, { fresh: true })).toBe(true);
  });

  it('a skinned mesh with no usable skin data is still bounded by its geometry', () => {
    // An unbound skeleton or all-zero weights give no skinned bound, yet the
    // mesh is still drawn (zero weights collapse it onto its origin).
    // Dropping it would be a false "out"; its plain geometry sphere about
    // its origin is the safe side.
    const unbound = skinnedBox(1).mesh;
    const zeroWeights = skinnedBox(0);
    zeroWeights.mesh.add(zeroWeights.bone);
    zeroWeights.mesh.bind(new THREE.Skeleton([zeroWeights.bone]));
    for (const mesh of [unbound, zeroWeights.mesh]) {
      const rig = makeRig();
      mesh.position.set(0, 0, -10);
      rig.anchor.add(mesh);
      expect(inView(rig)).toBe(true);
      const root = new THREE.Group();
      mergeForAnchorBounds(root);
      root.add(mesh);
      rig.anchor.add(root);
      expect(inView(rig, { fresh: true })).toBe(true);
    }
  });

  it('a bound skinned mesh missing a skin attribute counts as in view wherever it is', () => {
    // three still skins it, reading the missing attribute from the generic
    // vertex attribute value at its location, which another program may
    // have set (a default colour of 1, say): its weights and bone indices
    // are unknown, so no finite bound holds. A plain geometry bound would be
    // a false "out" (here: the mesh origin behind the camera). While hidden
    // it does not count, also over the sphere cap, where merging it would
    // leave an endless sphere behind that its hiding cannot remove.
    for (const missing of ['skinWeight', 'skinIndex'] as const) {
      const { mesh, bone, geometry } = skinnedBox(1);
      geometry.deleteAttribute(missing);
      mesh.add(bone);
      mesh.bind(new THREE.Skeleton([bone]));
      const rig = makeRig();
      mesh.position.set(0, 0, 10);
      rig.anchor.add(mesh);
      expect(inView(rig), missing).toBe(true);
      for (let i = 0; i < 40; i += 1)
        rig.anchor.add(tinyMesh(new THREE.Vector3(i * 0.1, 0, 10)));
      expect(inView(rig, { fresh: true }), missing).toBe(true);
      expect(rig.cache.entries.length).toBeLessThanOrEqual(ANCHOR_SPHERE_CAP);
      mesh.visible = false;
      expect(inView(rig), missing).toBe(false);
      mesh.visible = true;
      const root = new THREE.Group();
      mergeForAnchorBounds(root);
      root.add(mesh);
      rig.anchor.add(root);
      expect(inView(rig, { fresh: true }), missing).toBe(true);
    }
  });

  it('a geometry swapped in with the same attributes after an in-place morph edit is walked again', () => {
    // three keys its morph texture on the geometry and ignores needsUpdate
    // on morph attributes, so a target edited in place is drawn by a
    // geometry three has not drawn yet. A new geometry around the same,
    // edited attribute objects draws the larger shape; a key made of the
    // attributes alone would keep the old, small reach and say "out".
    const rig = makeRig();
    const mesh = morphedBoxBeyondPlane();
    mesh.morphTargetInfluences![0] = 1; // 6 m toward the view: still out
    rig.anchor.add(mesh);
    expect(inView(rig, { fresh: true })).toBe(false);
    const old = mesh.geometry;
    const target = old.morphAttributes.position![0]!;
    // 18 m at influence 1, set without needsUpdate.
    for (let i = 0; i < target.count; i += 1) {
      target.setXYZ(i, target.getX(i) * 3, 0, target.getZ(i) * 3);
    }
    const swapped = new THREE.BufferGeometry();
    swapped.setAttribute('position', old.getAttribute('position'));
    swapped.morphAttributes.position = old.morphAttributes.position!;
    swapped.morphTargetsRelative = true;
    mesh.geometry = swapped; // 0.5 m inside the side plane
    expect(inView(rig, { fresh: true })).toBe(true);
  });

  it('an interleaved attribute moved to another offset or item size of the same buffer is read again', () => {
    // Another view of the same interleaved buffer keeps its uuid and its
    // version: only the offset or the item size tells the two apart, so
    // the key must carry both.
    const rig = makeRig();
    const { mesh, bone, geometry } = skinnedBox(1);
    const plain = geometry.getAttribute('position') as THREE.BufferAttribute;
    const data = new Float32Array(plain.count * 6);
    for (let i = 0; i < plain.count; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        data[i * 6 + c] = plain.array[i * 3 + c]!;
        data[i * 6 + 3 + c] = plain.array[i * 3 + c]! + (c === 2 ? 200 : 0);
      }
    }
    const positions = new THREE.InterleavedBuffer(data, 6);
    geometry.setAttribute(
      'position',
      new THREE.InterleavedBufferAttribute(positions, 3, 0)
    );
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300); // beyond the far plane
    rig.anchor.add(mesh);
    expect(inView(rig, { fresh: true })).toBe(false);
    // The second copy is 200 m nearer: drawn 100 m ahead.
    geometry.setAttribute(
      'position',
      new THREE.InterleavedBufferAttribute(positions, 3, 3)
    );
    expect(inView(rig, { fresh: true })).toBe(true);

    // The weights as an interleaved view, then the same view with fewer
    // components: the walk reads `itemSize` components, so it must run again.
    const weights = geometry.getAttribute(
      'skinWeight'
    ) as THREE.BufferAttribute;
    const weightData = new THREE.InterleavedBuffer(
      new Float32Array(weights.array),
      4
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.InterleavedBufferAttribute(weightData, 4, 0)
    );
    expect(inView(rig, { fresh: true })).toBe(true);
    const narrower = new THREE.InterleavedBufferAttribute(weightData, 2, 0);
    const reads = vi.spyOn(narrower, 'getComponent');
    geometry.setAttribute('skinWeight', narrower);
    expect(inView(rig, { fresh: true })).toBe(true);
    expect(reads).toHaveBeenCalled();
  });

  it('a wider margin never narrows a view whose sides are past the angle clamp', () => {
    // At a 179.5 deg field of view each side sits at 89.75 deg, beyond the
    // 89.5 deg clamp that keeps a widened tangent finite. Clamping the
    // widened angle there would turn the side plane inward, so a larger
    // margin would be less conservative than none.
    const rig = makeRig();
    rig.camera.fov = 179.5;
    rig.camera.updateProjectionMatrix();
    rig.anchor.add(tinyMesh(atAngle(89.6, 50)));
    expect(inView(rig, { marginDeg: 0 })).toBe(true);
    expect(inView(rig, { marginDeg: ANCHOR_VIEW_MARGIN_DEG })).toBe(true);
    expect(inView(rig, { marginDeg: 30 })).toBe(true);
  });

  it('the anchor itself can be a merge root', () => {
    // A loaded model is often added as the anchor itself; marking it must
    // not be silently ignored. Its one sphere follows the target pose and
    // keeps the inner layout of the build.
    const rig = makeRig();
    const part = tinyMesh(new THREE.Vector3(0, 0, -10));
    rig.anchor.add(part);
    mergeForAnchorBounds(rig.anchor);
    expect(inView(rig)).toBe(true);
    expect(rig.cache.entries).toHaveLength(1);
    const away = new THREE.Matrix4().makeTranslation(100, 0, 0);
    expect(inView(rig, { atLocal: away })).toBe(false);
    part.position.set(100, 0, -10); // inner motion: not followed, even fresh
    expect(inView(rig, { fresh: true })).toBe(true);
    markAnchorBoundsChanged(rig.cache);
    expect(inView(rig)).toBe(false);
  });

  it('an interleaved position edited in place is read again by a fresh traversal', () => {
    // Loaded models often carry interleaved vertex data, whose version lives
    // on the shared buffer, not on the attribute: the kept bind data must
    // follow that version too.
    const rig = makeRig();
    const { mesh: skinned, bone } = skinnedBox(1);
    const plain = skinned.geometry.getAttribute(
      'position'
    ) as THREE.BufferAttribute;
    const buffer = new THREE.InterleavedBuffer(
      new Float32Array(plain.array),
      3
    );
    skinned.geometry.setAttribute(
      'position',
      new THREE.InterleavedBufferAttribute(buffer, 3, 0)
    );
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300); // beyond the far plane
    rig.anchor.add(skinned);
    expect(inView(rig, { fresh: true })).toBe(false);
    for (let i = 2; i < buffer.array.length; i += 3) buffer.array[i]! += 200;
    buffer.needsUpdate = true; // the box is now drawn 100 m ahead
    expect(inView(rig, { fresh: true })).toBe(true);
  });

  it('a swapped geometry is bounded by its own vertices on the next fresh traversal', () => {
    // A part whose geometry is replaced (a level of detail, a reloaded
    // model) must not be served the old geometry's kept bind data, or the
    // new shape could be drawn where the bound says nothing is.
    const rig = makeRig();
    const { mesh: skinned, bone } = skinnedBox(1);
    skinned.add(bone);
    skinned.bind(new THREE.Skeleton([bone]));
    bone.position.set(0, 0, -300); // beyond the far plane
    rig.anchor.add(skinned);
    const morphed = morphedBoxBeyondPlane();
    rig.anchor.add(morphed);
    expect(inView(rig, { fresh: true })).toBe(false);
    // Each new geometry is freshly built and its arrays written directly,
    // so every attribute version equals the old one's: only the identity
    // of the geometry and its attributes tells them apart.
    const shifted = (
      geometry: THREE.BufferGeometry,
      by: THREE.Vector3
    ): THREE.BufferGeometry => {
      const array = (geometry.getAttribute('position') as THREE.BufferAttribute)
        .array;
      for (let i = 0; i < array.length; i += 3) {
        array[i]! += by.x;
        array[i + 1]! += by.y;
        array[i + 2]! += by.z;
      }
      return geometry;
    };
    // Drawn 200 m nearer than its bone: 100 m ahead.
    skinned.geometry = shifted(
      skinnedBox(1).geometry,
      new THREE.Vector3(0, 0, 200)
    );
    expect(inView(rig, { fresh: true })).toBe(true);
    skinned.visible = false;
    expect(inView(rig, { fresh: true })).toBe(false);
    // The base moved 18 m toward the view: 0.5 m inside the side plane.
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    morphed.geometry = shifted(
      morphedBoxBeyondPlane().geometry,
      plane.clone().multiplyScalar(-18)
    );
    expect(inView(rig, { fresh: true })).toBe(true);
  });

  it('a skinned mesh bounded as a plain morphed one keeps its bind data across fresh traversals', () => {
    // With all-zero weights a skinned mesh has no skinned bound and falls
    // back to its morph bound: both walks read the same object, so the kept
    // records must not overwrite each other, or every fresh traversal (each
    // second while content waits) repeats both vertex walks.
    const rig = makeRig();
    const { mesh, bone, geometry } = skinnedBox(0);
    const count = geometry.getAttribute('position').count;
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3),
    ];
    geometry.morphTargetsRelative = true;
    mesh.updateMorphTargets();
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    mesh.position.set(0, 0, -300); // beyond the far plane
    rig.anchor.add(mesh);
    const reads = vi.spyOn(
      geometry.getAttribute('position') as THREE.BufferAttribute,
      'getX'
    );
    expect(inView(rig, { fresh: true })).toBe(false);
    expect(reads).toHaveBeenCalled();
    reads.mockClear();
    expect(inView(rig, { fresh: true })).toBe(false);
    expect(reads).not.toHaveBeenCalled();
  });

  it('kept bind data holds no geometry or attribute alive', () => {
    // A key that held the objects would keep a replaced geometry and its
    // vertex arrays in memory for as long as the part stays mounted; ids,
    // buffer uuids and offsets identify them just as well.
    const rig = makeRig();
    const { mesh, bone } = skinnedBox(1);
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    rig.anchor.add(mesh);
    rig.anchor.add(morphedBoxBeyondPlane());
    inView(rig, { fresh: true });
    const keys = [...rig.cache.bindData.values()].flatMap((records) =>
      Object.values(records).flatMap((record) => [...record.key])
    );
    expect(keys.length).toBeGreaterThan(0);
    for (const item of keys) {
      expect(item === null || typeof item !== 'object').toBe(true);
    }
  });

  it('a merge root keeps its one sphere, moved by the root, until the bounds change', () => {
    const rig = makeRig();
    const model = new THREE.Group();
    const part = tinyMesh(new THREE.Vector3(0, 0, 0));
    model.add(part);
    model.position.set(0, 0, -10);
    mergeForAnchorBounds(model);
    rig.anchor.add(model);
    expect(inView(rig)).toBe(true);
    expect(rig.cache.entries).toHaveLength(1);
    model.position.set(100, 0, -10); // the root moves: its sphere follows
    expect(inView(rig, { fresh: true })).toBe(false);
    part.position.set(-100, 0, 0); // inside the root: not followed, even fresh
    expect(inView(rig, { fresh: true })).toBe(false);
    markAnchorBoundsChanged(rig.cache);
    expect(inView(rig)).toBe(true);
  });

  it('a sheared subtree is still bounded (rotation under a non-uniform scale)', () => {
    // A child rotated 45 deg under a parent scaled (4, 1, 1) is sheared: its
    // longest stretch exceeds every column length, so a column-length bound
    // would be too small.
    const rig = makeRig();
    const squash = new THREE.Group();
    squash.rotation.y = (5 * Math.PI) / 6; // its x axis points across the right plane, inward
    squash.scale.set(4, 1, 1);
    const turned = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(1, 0, 0)
    );
    turned.rotation.z = Math.PI / 4;
    squash.add(turned);
    rig.anchor.add(squash);
    rig.scene.updateMatrixWorld(true);
    // Place the subtree so its farthest vertex (found by brute force) just
    // reaches 0.05 m inside the right plane.
    const plane = new THREE.Vector3(
      Math.cos(Math.PI / 6),
      0,
      Math.sin(Math.PI / 6)
    );
    const position = turned.geometry.getAttribute('position');
    let reach = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(turned.matrixWorld);
      reach = Math.max(reach, -v.dot(plane));
    }
    rig.anchor.position
      .copy(atAngle(30, 20))
      .addScaledVector(plane, reach - 0.05);
    expect(inView(rig)).toBe(true);
  });
});

describe('anchor-visibility: frames, counts and inputs', () => {
  it('tests in the parent frame: a rigid move of the whole world leaves the answer unchanged', () => {
    const rig = makeRig();
    const world = new THREE.Group();
    rig.scene.remove(rig.parent, rig.camera);
    rig.scene.add(world);
    world.add(rig.parent, rig.camera);
    rig.parent.position.set(3, 1, -2);
    rig.parent.rotation.y = 0.3;
    rig.anchor.add(tinyMesh(atAngle(29, 10)));
    rig.anchor.position.set(-3, 0, 2);
    const before = inView(rig);
    world.position.set(1e4, -50, 3e3);
    world.rotation.set(0.4, -1.2, 0.7);
    expect(inView(rig)).toBe(before);
  });

  it('counts sphere tests per view and traversals per build', () => {
    const rig = makeRig();
    rig.anchor.add(
      tinyMesh(new THREE.Vector3(100, 0, -10)),
      tinyMesh(new THREE.Vector3(-100, 0, -10))
    );
    rig.scene.updateMatrixWorld(true);
    const sub = makeCamera();
    const xr: XrCameraSource = {
      isPresenting: true,
      getCamera: () => ({ cameras: [sub, sub] }),
    };
    const view = updateAnchorView(createAnchorView(), rig.camera, xr);
    const counters: AnchorVisibilityCounters = {
      sphereTests: 0,
      traversals: 0,
    };
    expect(
      isAnchorInView(view, rig.anchor, {
        marginDeg: 0,
        cache: rig.cache,
        counters,
        nowMs: 0,
      })
    ).toBe(false);
    expect(counters).toEqual({ sphereTests: 4, traversals: 1 });
    isAnchorInView(view, rig.anchor, {
      marginDeg: 0,
      cache: rig.cache,
      counters,
      nowMs: 0,
    });
    expect(counters).toEqual({ sphereTests: 8, traversals: 1 });
    isAnchorInView(view, rig.anchor, {
      marginDeg: 0,
      cache: rig.cache,
      counters,
      fresh: true,
      nowMs: 0,
    });
    expect(counters).toEqual({ sphereTests: 12, traversals: 2 });
  });

  it('rejects bad inputs at the boundary', () => {
    const rig = makeRig();
    const view = updateAnchorView(createAnchorView(), rig.camera);
    const cache = rig.cache;
    for (const marginDeg of [Number.NaN, -1, 90, Infinity]) {
      expect(() =>
        isAnchorInView(view, rig.anchor, { marginDeg, cache })
      ).toThrow(RangeError);
    }
    expect(() =>
      isAnchorInView(view, {} as THREE.Object3D, { marginDeg: 0, cache })
    ).toThrow(TypeError);
    expect(() =>
      isAnchorInView(view, rig.anchor, {
        marginDeg: 0,
        cache,
        atLocal: [1, 0] as unknown as THREE.Matrix4,
      })
    ).toThrow(TypeError);
    expect(() =>
      isAnchorInView(view, rig.anchor, {
        marginDeg: 0,
        cache: {} as AnchorBoundsCache,
      })
    ).toThrow(TypeError);
    expect(() =>
      updateAnchorView(createAnchorView(), {} as THREE.Camera)
    ).toThrow(TypeError);
    expect(() =>
      ignoreForAnchorVisibility(null as unknown as THREE.Object3D)
    ).toThrow(TypeError);
    expect(() =>
      mergeForAnchorBounds(undefined as unknown as THREE.Object3D)
    ).toThrow(TypeError);
    expect(() => anchorBoundsNeedRefresh(cache, Number.NaN)).toThrow(
      RangeError
    );
    // A non-finite build stamp would make anchorBoundsNeedRefresh false for
    // ever, so a stale "in" would never be refreshed.
    for (const nowMs of [Number.NaN, Infinity, -Infinity]) {
      expect(() =>
        isAnchorInView(view, rig.anchor, { marginDeg: 0, cache, nowMs })
      ).toThrow(RangeError);
    }
    expect(
      isAnchorInView(createAnchorView(), rig.anchor, { marginDeg: 0, cache })
    ).toBe(false);
  });

  it('imports nothing from the store and dispatches nothing', () => {
    // The predicate runs inside a frame update, which must not dispatch,
    // and sits below the state layer.
    const source = readFileSync(
      fileURLToPath(new URL('./anchor-visibility.ts', import.meta.url)),
      'utf8'
    );
    expect(source).not.toMatch(/from\s+['"][^'"]*\/state(\/|['"])/);
    expect(source).not.toMatch(/dispatch\s*\(/);
  });
});
