/**
 * The hero film's 3D picture: the model park (slab, stream, mill and
 * wheel, barn, fountain, lookout, trees, the code on its post), the route
 * drawn as dots, the five pins with their labels, the person and the wedge
 * of view, a camera fitted to each view, and the phone's screen drawn as
 * the same park at eye height in a second pass. Ported from the prototype's
 * `start()`.
 *
 * Driven, not running: `draw(frame, camera, t)` draws one picture of the
 * film at timeline position `t` and draws nothing when nothing visible
 * changed. It never schedules a frame of its own (the player does), so an
 * idle film costs nothing. `release()` frees the renderer and its context
 * on purpose (AR needs the GPU); its lost-context event is not reported.
 *
 * @see film-scene.ts.md
 */
import * as THREE from "three";

import type { FilmFrame, SceneState, ViewName } from "./film-story.js";
import { smoothEase } from "./film-math.js";
import {
  EYES,
  LIGHT,
  PARK,
  REGIONS,
  ROUTE,
  STATIONS,
  STREAM,
  TREES,
  type EyeName,
  type XYZ,
} from "./film-park.js";
import { ndcRect, viewParams, type FilmLayout } from "./film-layout.js";
import type { CameraAt } from "./film-timeline.js";
import type { ScreenAnchors } from "./film-phone.js";

/** The renderer's cost knobs, in the order they are given up when a frame is too slow. */
export interface SceneQuality {
  /** The device pixel ratio is capped at this (the prototype's: 2). */
  readonly pixelRatioCap: number;
  readonly shadows: boolean;
  /** The second pass that draws the phone's screen in 3D; off, the screen shows its drawn still. */
  readonly eyePass: boolean;
  readonly antialias: boolean;
}

export const FULL_QUALITY: SceneQuality = {
  pixelRatioCap: 2,
  shadows: true,
  eyePass: true,
  antialias: true,
};

export interface SceneParts {
  /** The box the canvas goes into (the film's stage). */
  readonly stage: HTMLElement;
  /** Put the canvas right after this element. */
  readonly after: Element;
  readonly tags: HTMLElement;
  readonly leadLine: SVGLineElement;
  readonly leadDot: SVGCircleElement;
}

export interface FilmScene {
  readonly canvas: HTMLCanvasElement;
  /** Sizes the renderer and refits the views to the layout. */
  layout(ly: FilmLayout): void;
  /** Draws the film; returns true when it rendered (false: nothing changed). */
  draw(frame: FilmFrame, cam: CameraAt<ViewName>, t: number): boolean;
  /** Where the eye's spots sit on its screen, screen px. */
  anchors(eye: EyeName, sw: number, sh: number): ScreenAnchors;
  /**
   * Compiles the scene's shaders ahead of its first draw, in parallel where
   * the browser offers `KHR_parallel_shader_compile`, so that draw does
   * not stall the page. Resolves when they are ready; on a browser without
   * the extension the first draw finishes what is left.
   */
  prepare(): Promise<void>;
  /** Shows the canvas (fades in). */
  show(): void;
  /** Frees the renderer and its WebGL context on purpose. */
  release(): void;
  /** Average ms of `n` full renders (model and screen), GPU work included. */
  bench(n: number): number;
  info(): { renderer: string; calls: number; triangles: number; dpr: number };
}

const DEG = Math.PI / 180;
const C = PARK.colors;
const SIZES: Readonly<Record<ViewName, { big: number; fig: number }>> = {
  over: { big: 1.45, fig: 1.9 },
  mill: { big: 1.1, fig: 1.3 },
  poster: { big: 1.1, fig: 1.3 },
};

interface CamState {
  az: number;
  el: number;
  d: number;
  fov: number;
  target: THREE.Vector3;
  big: number;
  figS: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const angLerp = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const dirOf = (az: number, el: number) =>
  V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

/** Fits points into an NDC rectangle by distance (bisection) and a shift of the target. */
function fit(
  pts: readonly XYZ[],
  vp: { az: number; el: number; fov: number },
  aspect: number,
  rect: readonly [number, number, number, number],
): { az: number; el: number; d: number; fov: number; target: THREE.Vector3 } {
  const fov = vp.fov * DEG;
  const tv = Math.tan(fov / 2);
  const th = tv * aspect;
  const dir = dirOf(vp.az, vp.el);
  const r = new THREE.Vector3().crossVectors(V3(0, 1, 0), dir).normalize();
  const u = new THREE.Vector3().crossVectors(dir, r).normalize();
  const target = V3(0, 0, 0);
  for (const p of pts) {
    target.x += p[0] / pts.length;
    target.y += p[1] / pts.length;
    target.z += p[2] / pts.length;
  }
  const hw = (rect[1] - rect[0]) / 2;
  const hh = (rect[3] - rect[2]) / 2;
  const cxT = (rect[0] + rect[1]) / 2;
  const cyT = (rect[2] + rect[3]) / 2;
  const tmp = new THREE.Vector3();
  const ndc = (d: number) => {
    const c = target.clone().addScaledVector(dir, d);
    let x0 = 99;
    let x1 = -99;
    let y0 = 99;
    let y1 = -99;
    for (const k of pts) {
      tmp.set(k[0], k[1], k[2]).sub(c);
      const z = -tmp.dot(dir);
      const x = tmp.dot(r) / (z * th);
      const y = tmp.dot(u) / (z * tv);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return [x0, x1, y0, y1] as const;
  };
  let d = 100;
  for (let it = 0; it < 4; it++) {
    let lo = 5;
    let hi = 4000;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const b = ndc(mid);
      if ((b[1] - b[0]) / 2 <= hw && (b[3] - b[2]) / 2 <= hh) hi = mid;
      else lo = mid;
    }
    d = hi;
    const b = ndc(d);
    target
      .addScaledVector(r, ((b[0] + b[1]) / 2 - cxT) * d * th)
      .addScaledVector(u, ((b[2] + b[3]) / 2 - cyT) * d * tv);
  }
  return { az: vp.az, el: vp.el, d, fov: vp.fov, target };
}

/**
 * Builds the scene into `parts.stage`. Throws when WebGL cannot start
 * (the caller falls back to the drawing). `onContextLost` is called for a
 * real loss only: `release()` removes the listener before it frees.
 */
export function createFilmScene(
  doc: Document,
  parts: SceneParts,
  quality: SceneQuality,
  opts: {
    readonly reducedMotion: boolean;
    readonly devicePixelRatio: number;
    readonly smallScreen: boolean;
  },
  onContextLost: () => void,
): FilmScene {
  const canvas = doc.createElement("canvas");
  canvas.className = "lf-gl";
  canvas.setAttribute("aria-hidden", "true");
  parts.after.after(canvas);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost, false);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: true,
    });
  } catch (e) {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.remove();
    throw e;
  }
  renderer.setPixelRatio(
    Math.min(opts.devicePixelRatio || 1, quality.pixelRatioCap),
  );
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(15, 1, 1, 2000);
  cam.layers.enable(2); // layer 2: seen from above only (the person, the wedge)
  const eye = new THREE.PerspectiveCamera(60, 0.5, 0.08, 220);
  eye.layers.enable(1); // layer 1: seen at eye height only (the land beyond the model)
  scene.add(new THREE.HemisphereLight(0xfff7e8, 0xb6a684, 1.55));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.0);
  sun.position.set(LIGHT[0] * 40, LIGHT[1] * 40, LIGHT[2] * 40);
  sun.castShadow = quality.shadows;
  const mapSize = opts.smallScreen ? 1024 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 5,
    far: 90,
  });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const mat = (c: string, extra?: THREE.MeshLambertMaterialParameters) => {
    const k = c + (extra ? JSON.stringify(extra) : "");
    let m = mats.get(k);
    if (!m) {
      m = own(new THREE.MeshLambertMaterial({ color: c, ...extra }));
      mats.set(k, m);
    }
    return m;
  };
  const mesh = (
    geo: THREE.BufferGeometry,
    m: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
    cast = true,
    recv = true,
  ) => {
    own(geo);
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = cast;
    o.receiveShadow = recv;
    scene.add(o);
    return o;
  };

  // --- the slab: a rounded tile of grass on a band of earth, on a table that catches its shadow
  const S0 = PARK.slab;
  const shape = (inset: number) => {
    const w = S0.w / 2 - inset;
    const d = S0.d / 2 - inset;
    const r = S0.r - inset;
    const s = new THREE.Shape();
    s.moveTo(-w + r, -d);
    s.lineTo(w - r, -d);
    s.quadraticCurveTo(w, -d, w, -d + r);
    s.lineTo(w, d - r);
    s.quadraticCurveTo(w, d, w - r, d);
    s.lineTo(-w + r, d);
    s.quadraticCurveTo(-w, d, -w, d - r);
    s.lineTo(-w, -d + r);
    s.quadraticCurveTo(-w, -d, -w + r, -d);
    return s;
  };
  const slab = (
    inset: number,
    depth: number,
    bev: number,
    top: number,
    capC: string,
    sideC: string,
  ) => {
    const g = new THREE.ExtrudeGeometry(shape(inset + bev), {
      depth,
      bevelEnabled: true,
      bevelThickness: bev,
      bevelSize: bev,
      bevelSegments: 2,
      curveSegments: 6,
    });
    g.rotateX(-Math.PI / 2);
    const m = mesh(g, [mat(capC), mat(sideC)]);
    m.position.y = top - depth - bev;
  };
  slab(0, S0.grass - 0.1, 0.05, 0, C.grass, C.grassSide);
  slab(0.04, S0.earth - 0.1, 0.05, -S0.grass, C.earth, C.earth);
  const table = mesh(
    new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2),
    own(new THREE.ShadowMaterial({ opacity: 0.13, color: 0x46381e })),
    0,
    -S0.grass - S0.earth - 0.01,
    0,
    false,
  );
  table.layers.set(2);

  // --- at eye height the model's edge must not show: land and a ring of far trees beyond it, seen by the phone only
  const land = mesh(
    new THREE.CircleGeometry(170, 48).rotateX(-Math.PI / 2),
    mat("#cfcba0"),
    0,
    -0.03,
    0,
    false,
    false,
  );
  land.layers.set(1);
  {
    const far: { x: number; z: number; s: number }[] = [];
    let sd = 11;
    const rnd = () => {
      sd = (sd * 16807) % 2147483647;
      return (sd - 1) / 2147483646;
    };
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 21 + rnd() * 40;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.85;
      if (Math.abs(x) < 19 && Math.abs(z) < 15.5) continue;
      far.push({ x, z, s: 1.1 + rnd() * 1.4 });
    }
    const geo = own(new THREE.IcosahedronGeometry(1, 0));
    const o = new THREE.Object3D();
    const im = new THREE.InstancedMesh(
      geo,
      mat("#b3b98d", { flatShading: true }),
      far.length,
    );
    far.forEach((t, i) => {
      o.position.set(t.x, 1.6 * t.s, t.z);
      o.scale.set(1.3 * t.s, 1.6 * t.s, 1.3 * t.s);
      o.rotation.set(0, t.x, 0);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.layers.set(1);
    scene.add(im);
  }

  // --- ground decals
  const ribbonGeo = (
    pts: readonly (readonly [number, number])[],
    w: number,
    y: number,
  ) => {
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const nx = ((-dz / l) * w) / 2;
      const nz = ((dx / l) * w) / 2;
      pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
      if (i) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        pos.map((_, i) => (i % 3 === 1 ? 1 : 0)),
        3,
      ),
    );
    g.setIndex(idx);
    return g;
  };
  const flat = (c: string) => mat(c, { side: THREE.DoubleSide });
  mesh(ribbonGeo(STREAM, PARK.streamW, 0.012), flat(C.water), 0, 0, 0, false);
  mesh(
    ribbonGeo(
      STREAM.map((q) => [q[0] + 0.25, q[1]] as const),
      0.14,
      0.02,
    ),
    flat(C.waterLine),
    0,
    0,
    0,
    false,
  );
  const Y = PARK.yard;
  mesh(
    new THREE.PlaneGeometry(Y.x1 - Y.x0, Y.z1 - Y.z0).rotateX(-Math.PI / 2),
    mat(C.paving),
    (Y.x0 + Y.x1) / 2,
    0.01,
    (Y.z0 + Y.z1) / 2,
    false,
  );
  const pondRim = mesh(
    new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
    mat(C.stone),
    PARK.pond.x,
    0.008,
    PARK.pond.z,
    false,
  );
  pondRim.scale.set(PARK.pond.rx + 0.2, 1, PARK.pond.rz + 0.2);
  const pond = mesh(
    new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2),
    mat(C.water),
    PARK.pond.x,
    0.016,
    PARK.pond.z,
    false,
  );
  pond.scale.set(PARK.pond.rx, 1, PARK.pond.rz);
  mesh(ribbonGeo(ROUTE.pts, PARK.pathW, 0.022), flat(C.path), 0, 0, 0, false);

  // --- buildings
  const roofGeo = (b: typeof PARK.mill) => {
    const o = 0.3;
    const xa = b.x0 - o;
    const xb = b.x1 + o;
    const za = b.z0 - o;
    const zb = b.z1 + o;
    const zm = (b.z0 + b.z1) / 2;
    const y0 = b.h;
    const y1 = b.h + b.roof;
    // prettier-ignore
    const v = [xa, y0, zb, xb, y0, zb, xb, y1, zm, xa, y0, zb, xb, y1, zm, xa, y1, zm,
      xb, y0, za, xa, y0, za, xa, y1, zm, xb, y0, za, xa, y1, zm, xb, y1, zm,
      xa + o, y0, zb - o, xa + o, y1, zm, xa + o, y0, za + o, xb - o, y0, za + o, xb - o, y1, zm, xb - o, y0, zb - o,
      xa, y0 - 0.02, za, xb, y0 - 0.02, za, xb, y0 - 0.02, zb, xa, y0 - 0.02, za, xb, y0 - 0.02, zb, xa, y0 - 0.02, zb];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  };
  const house = (
    b: typeof PARK.mill,
    roofC: string,
    details: readonly (readonly [number, number, number, number])[],
  ) => {
    mesh(
      new THREE.BoxGeometry(b.x1 - b.x0, b.h, b.z1 - b.z0),
      mat(C.wall),
      (b.x0 + b.x1) / 2,
      b.h / 2,
      (b.z0 + b.z1) / 2,
    );
    mesh(roofGeo(b), mat(roofC, { side: THREE.DoubleSide }));
    for (const d of details) {
      mesh(
        new THREE.BoxGeometry(d[1] - d[0], d[3] - d[2], 0.06),
        mat(C.dark),
        (d[0] + d[1]) / 2,
        (d[2] + d[3]) / 2,
        b.z1 + 0.03,
        false,
        false,
      );
    }
  };
  house(PARK.mill, C.roof, [
    [-8.9, -8.1, 0, 1.3],
    [-11.4, -10.6, 1.2, 1.9],
    [-7.4, -6.8, 1.2, 1.9],
  ]);
  house(PARK.barn, C.roof2, [[8.5, 9.3, 0, 1.2]]);

  // --- the mill wheel (still: one moving thing at a time)
  const W = PARK.wheel;
  const wheel = new THREE.Group();
  wheel.position.set(W.x - W.w / 2, W.y, W.z);
  const wood = mat(C.wood);
  const woodD = mat("#8f7457");
  for (const dx of [-W.w / 2, W.w / 2]) {
    const t = new THREE.Mesh(
      own(new THREE.TorusGeometry(W.r, 0.08, 5, 28).rotateY(Math.PI / 2)),
      woodD,
    );
    t.position.x = dx;
    t.castShadow = true;
    wheel.add(t);
  }
  const paddleGeo = own(new THREE.BoxGeometry(W.w + 0.1, 0.06, 0.42));
  const spokeGeo = own(new THREE.BoxGeometry(0.08, W.r * 2, 0.08));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const paddle = new THREE.Mesh(paddleGeo, wood);
    paddle.position.set(
      0,
      Math.cos(a) * (W.r - 0.1),
      Math.sin(a) * (W.r - 0.1),
    );
    paddle.rotation.x = -a;
    paddle.castShadow = true;
    wheel.add(paddle);
    if (i % 3 === 0) {
      const sp = new THREE.Mesh(spokeGeo, woodD);
      sp.rotation.x = a;
      wheel.add(sp);
    }
  }
  wheel.add(
    new THREE.Mesh(
      own(
        new THREE.CylinderGeometry(0.2, 0.2, W.w + 0.4, 10).rotateZ(
          Math.PI / 2,
        ),
      ),
      woodD,
    ),
  );
  wheel.rotation.x = -0.4;
  scene.add(wheel);

  // --- fountain, lookout, the code on its post
  const F = PARK.fountain;
  mesh(
    new THREE.CylinderGeometry(1.0, 1.05, 0.38, 20),
    mat(C.stone),
    F.x,
    0.19,
    F.z,
  );
  mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.02, 20),
    mat(C.water),
    F.x,
    0.37,
    F.z,
    false,
  );
  mesh(
    new THREE.CylinderGeometry(0.16, 0.2, 0.75, 8),
    mat(C.stone),
    F.x,
    0.74,
    F.z,
  );
  mesh(
    new THREE.CylinderGeometry(0.45, 0.3, 0.12, 12),
    mat(C.stone),
    F.x,
    1.14,
    F.z,
  );
  const LK = PARK.lookout;
  const hs = LK.s / 2;
  mesh(
    new THREE.BoxGeometry(LK.s, LK.h, LK.s),
    mat(C.stone),
    LK.x,
    LK.h / 2,
    LK.z,
  );
  mesh(
    new THREE.BoxGeometry(0.12, 0.8, LK.s),
    wood,
    LK.x + hs - 0.06,
    LK.h + 0.4,
    LK.z,
  );
  mesh(
    new THREE.BoxGeometry(LK.s, 0.8, 0.12),
    wood,
    LK.x,
    LK.h + 0.4,
    LK.z - hs + 0.06,
  );
  const posterG = new THREE.Group();
  posterG.position.set(PARK.poster.x, 0, PARK.poster.z);
  {
    const part = (
      geo: THREE.BufferGeometry,
      m: THREE.Material,
      x: number,
      y: number,
      z: number,
    ) => {
      const o = new THREE.Mesh(own(geo), m);
      o.position.set(x, y, z);
      posterG.add(o);
    };
    part(new THREE.BoxGeometry(0.12, 1.0, 0.12), wood, 0, 0.5, 0);
    part(new THREE.BoxGeometry(1.0, 1.2, 0.08), mat("#ffffff"), 0, 1.5, 0.08);
    part(new THREE.PlaneGeometry(1.0, 0.18), mat(C.route), 0, 2.0, 0.125);
    part(new THREE.PlaneGeometry(0.6, 0.6), mat(C.ink), 0, 1.45, 0.125);
    part(new THREE.PlaneGeometry(0.4, 0.4), mat("#ffffff"), 0, 1.45, 0.13);
    part(new THREE.PlaneGeometry(0.2, 0.2), mat(C.ink), 0, 1.45, 0.135);
  }
  posterG.scale.setScalar(0.001);
  scene.add(posterG);
  const BOARD = {
    x: PARK.poster.x,
    z: PARK.poster.z + 0.13,
    y0: 0.9,
    y1: 2.1,
    w: 1.0,
  };

  // --- trees (instanced)
  const broad = TREES.filter((t) => !t.kind);
  const conif = TREES.filter((t) => t.kind);
  const icoGeo = own(new THREE.IcosahedronGeometry(1, 0));
  const coneGeo = own(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0));
  const trunkGeo = own(
    new THREE.CylinderGeometry(0.1, 0.14, 1, 6).translate(0, 0.5, 0),
  );
  const inst = <T>(
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    list: readonly T[],
    setter: (o: THREE.Object3D, t: T) => void,
  ) => {
    const im = new THREE.InstancedMesh(geo, m, list.length);
    const o = new THREE.Object3D();
    list.forEach((t, i) => {
      setter(o, t);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  };
  inst(icoGeo, mat(C.tree, { flatShading: true }), broad, (o, t) => {
    o.position.set(t.x, 1.75 * t.s, t.z);
    o.scale.set(0.95 * t.s, 0.86 * t.s, 0.95 * t.s);
    o.rotation.set(0, t.x * 3.1, 0);
  });
  inst(coneGeo, mat(C.conifer, { flatShading: true }), conif, (o, t) => {
    o.position.set(t.x, 0.4 * t.s, t.z);
    o.scale.set(0.75 * t.s, 2.6 * t.s, 0.75 * t.s);
    o.rotation.set(0, t.z * 2.3, 0);
  });
  inst(trunkGeo, mat(C.trunk), TREES, (o, t) => {
    o.position.set(t.x, 0, t.z);
    o.scale.set(t.s, (t.kind ? 0.5 : 0.95) * t.s, t.s);
    o.rotation.set(0, 0, 0);
  });
  const O = PARK.oak;
  mesh(
    new THREE.CylinderGeometry(0.26, 0.38, O.h, 7).translate(0, O.h / 2, 0),
    mat(C.trunk),
    O.x,
    0,
    O.z,
  );
  for (const c of [
    [-0.5, O.h + 0.9, 0, 0.8],
    [0.7, O.h + 0.7, 0.3, 0.75],
    [0, O.h + 1.4, -0.4, 0.8],
  ] as const) {
    const m = new THREE.Mesh(icoGeo, mat(C.tree, { flatShading: true }));
    m.position.set(O.x + c[0], c[1], O.z + c[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    m.scale.set(O.r * c[3], O.r * c[3] * 0.85, O.r * c[3]);
    scene.add(m);
  }

  // --- the route: dots that draw themselves
  const dotPos: number[] = [];
  for (let s = 0.3; s < ROUTE.len; s += 0.62) dotPos.push(s);
  const dots = new THREE.InstancedMesh(
    own(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 10)),
    own(new THREE.MeshBasicMaterial({ color: C.route })),
    dotPos.length,
  );
  {
    const o = new THREE.Object3D();
    dotPos.forEach((s, i) => {
      const q = ROUTE.at(s);
      o.position.set(q.x, 0.05, q.z);
      o.updateMatrix();
      dots.setMatrixAt(i, o.matrix);
    });
  }
  dots.count = 0;
  dots.layers.set(2); // the dotted route belongs to the model, not to what a phone sees
  scene.add(dots);

  // --- pins with blob shadows, and their labels
  const blobGeo = own(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2));
  const blobMat = own(
    new THREE.MeshBasicMaterial({
      color: 0x2a2824,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );
  const red = mat(C.route);
  const ink = mat(C.ink);
  const white = own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const ballGeo = own(new THREE.SphereGeometry(0.44, 18, 12));
  const tipGeo = own(new THREE.ConeGeometry(0.33, 0.66, 16).rotateX(Math.PI));
  const eyeDotGeo = own(new THREE.SphereGeometry(0.18, 12, 8));
  const poleGeo = own(
    new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, 0.5, 0),
  );
  const tag = (cls: string) => {
    const el = doc.createElement("span");
    el.className = cls;
    parts.tags.append(el);
    return el;
  };
  const pins = STATIONS.map((st) => {
    const g = new THREE.Group();
    g.position.set(st.pin[0], 0, st.pin[1]);
    const head = new THREE.Group();
    const tip = new THREE.Mesh(tipGeo, red);
    tip.position.y = -0.42;
    const eyeDot = new THREE.Mesh(eyeDotGeo, white);
    head.add(new THREE.Mesh(ballGeo, red), tip, eyeDot);
    const pole = new THREE.Mesh(poleGeo, ink);
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.position.y = 0.03;
    blob.scale.setScalar(0.45);
    g.add(head, pole, blob);
    scene.add(g);
    const el = tag("lf-tag");
    const b = doc.createElement("b");
    b.textContent = String(st.n);
    el.append(b, doc.createTextNode(st.name));
    return { g, head, pole, blob, eyeDot, tag: el, rise: 0, base: 0.001 };
  });
  const startTag = tag("lf-tag lf-start");
  startTag.textContent = "Start: the code";
  const whoTag = tag("lf-tag lf-who");
  const setPin = (p: (typeof pins)[number], k: number, pulse: number) => {
    p.rise = k;
    p.base = Math.min(1, Math.max(0.001, k * 1.3)) * (1 + 0.25 * pulse);
    p.blob.scale.setScalar(0.45 * Math.min(1, Math.max(0.001, k)));
    p.g.visible = k > 0.001;
  };
  // the pin stands at its full height in the model and lower in the phone (eyePinH)
  const poseFor = (H: number) => {
    for (const p of pins) {
      const h = H * Math.max(0, p.rise);
      p.head.position.y = h;
      p.pole.scale.y = Math.max(0.001, h - 0.75);
      p.pole.visible = h > 0.8;
    }
  };

  // --- the person (the maker in route red, a visitor in ink) and the pale wedge their phone looks along
  const fig = new THREE.Group();
  const bodyMaker = red;
  const bodyVisitor = ink;
  const body = new THREE.Mesh(
    own(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10)),
    bodyVisitor,
  );
  body.position.y = 0.36;
  const headF = new THREE.Mesh(
    own(new THREE.SphereGeometry(0.15, 14, 10)),
    mat(C.paper),
  );
  headF.position.y = 0.76;
  const fBlob = new THREE.Mesh(blobGeo, blobMat);
  fBlob.position.y = 0.03;
  fBlob.scale.setScalar(0.3);
  fig.add(body, headF, fBlob);
  fig.visible = false;
  fig.traverse((o) => o.layers.set(2));
  scene.add(fig);
  let figK = 0;
  const wedgeGeo = own(new THREE.BufferGeometry());
  wedgeGeo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3),
  );
  wedgeGeo.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
  );
  const wedgeMat = own(
    new THREE.MeshBasicMaterial({
      color: C.route,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.layers.set(2);
  wedge.visible = false;
  wedge.renderOrder = 2;
  scene.add(wedge);

  // --- cameras: an overview fitted to the real frustum, close views fitted beside the phone, and the phone's eye
  const keyPts: XYZ[] = [];
  {
    const w = S0.w / 2;
    const d = S0.d / 2;
    for (const [x, z] of [
      [-w, -d],
      [w, -d],
      [w, d],
      [-w, d],
      [0, -d],
      [0, d],
      [-w, 0],
      [w, 0],
    ] as const) {
      keyPts.push([x, 0, z], [x, -S0.grass - S0.earth, z]);
    }
    const m = PARK.mill;
    const b = PARK.barn;
    keyPts.push(
      [m.x0, m.h + m.roof, (m.z0 + m.z1) / 2],
      [m.x1, m.h + m.roof, (m.z0 + m.z1) / 2],
      [b.x0, b.h + b.roof, (b.z0 + b.z1) / 2],
      [b.x1, b.h + b.roof, (b.z0 + b.z1) / 2],
    );
    for (const t of TREES) keyPts.push([t.x, 2.7 * t.s, t.z]);
    for (const st of STATIONS)
      keyPts.push([st.pin[0], PARK.pinH + 1.9, st.pin[1]]);
    keyPts.push([PARK.poster.x, 3.6, PARK.poster.z]);
  }
  let VIEWS: Record<ViewName, ReturnType<typeof fit>> | null = null;
  let ly: FilmLayout | null = null;
  let W0 = 0;
  let H0 = 0;
  const viewState = (name: ViewName): CamState => {
    const v = VIEWS![name];
    return {
      az: v.az,
      el: v.el,
      d: v.d,
      fov: v.fov,
      target: v.target.clone(),
      big: SIZES[name].big,
      figS: SIZES[name].fig,
    };
  };
  const blend = (a: CamState, b: CamState, t: number): CamState => ({
    az: angLerp(a.az, b.az, t),
    el: lerp(a.el, b.el, t),
    d: Math.exp(lerp(Math.log(a.d), Math.log(b.d), t)),
    fov: lerp(a.fov, b.fov, t),
    target: a.target.clone().lerp(b.target, t),
    big: lerp(a.big, b.big, t),
    figS: lerp(a.figS, b.figS, t),
  });
  const placeCamera = (c: CamState) => {
    cam.fov = c.fov;
    cam.position.copy(c.target).addScaledVector(dirOf(c.az, c.el), c.d);
    cam.near = Math.max(0.5, c.d * 0.2);
    cam.far = c.d * 4 + 80;
    cam.lookAt(c.target);
    cam.updateProjectionMatrix();
  };
  let eyeName: EyeName = "mill";
  const setEye = (name: EyeName) => {
    const e = EYES[name];
    eye.position.set(e.pos[0], e.pos[1], e.pos[2]);
    eye.fov = e.fov;
    eye.aspect = ly ? Math.max(0.2, ly.screen.w / ly.screen.h) : 0.5;
    eye.lookAt(e.target[0], e.target[1], e.target[2]);
    eye.updateProjectionMatrix();
    eye.updateMatrixWorld();
  };

  const pv = new THREE.Vector3();
  const project = (
    c: THREE.Camera,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
  ) => {
    pv.set(x, y, z).project(c);
    return [((pv.x + 1) / 2) * w, ((1 - pv.y) / 2) * h, pv.z] as const;
  };
  const tagOn = new Map<HTMLElement, boolean>();
  const lab = (
    el: HTMLElement,
    on: boolean,
    x: number,
    y: number,
    z: number,
    dy: number,
  ) => {
    if (tagOn.get(el) !== on) {
      tagOn.set(el, on);
      el.classList.toggle("lf-on", on);
    }
    if (!on) return;
    const q = project(cam, x, y, z, W0, H0);
    el.style.transform = `translate(${q[0].toFixed(1)}px,${(q[1] - dy).toFixed(1)}px) translate(-50%,-100%)`;
  };
  const setLead = (p: readonly [number, number] | null) => {
    if (!p || !ly) {
      parts.leadLine.setAttribute("opacity", "0");
      parts.leadDot.setAttribute("opacity", "0");
      return;
    }
    const px = ly.phone.x - 3;
    const py = ly.phone.y + ly.phone.h * 0.46;
    parts.leadLine.setAttribute("x1", p[0].toFixed(1));
    parts.leadLine.setAttribute("y1", p[1].toFixed(1));
    parts.leadLine.setAttribute("x2", px.toFixed(1));
    parts.leadLine.setAttribute("y2", py.toFixed(1));
    parts.leadDot.setAttribute("cx", p[0].toFixed(1));
    parts.leadDot.setAttribute("cy", p[1].toFixed(1));
    parts.leadLine.setAttribute("opacity", ".6");
    parts.leadDot.setAttribute("opacity", ".8");
  };

  let state: SceneState | null = null;
  let phoneOn = false;
  let camNow: CamState | null = null;
  let camView: ViewName = "over";
  let camMoving = false;
  let firstFrame = true;
  let sig = "";
  let released = false;

  const sync = (S: SceneState, on: boolean, eyeOf: EyeName, t: number) => {
    state = S;
    const n = dotPos.findIndex((s) => s > S.route);
    dots.count = n < 0 ? dotPos.length : n;
    pins.forEach((p, i) => setPin(p, S.pins[i] ?? 0, S.pulse[i] ?? 0));
    posterG.scale.setScalar(Math.max(0.001, S.poster));
    const f = S.fig;
    if (f && f.k > 0.001) {
      fig.visible = true;
      fig.position.set(
        f.x,
        f.bob && !opts.reducedMotion ? Math.abs(Math.sin(t * 9)) * 0.05 : 0,
        f.z,
      );
      fig.rotation.y = f.yaw;
      body.material = f.who === "maker" ? bodyMaker : bodyVisitor;
      figK = f.k;
      whoTag.textContent = f.who === "maker" ? "You" : "A visitor";
      whoTag.classList.toggle("lf-maker", f.who === "maker");
    } else {
      fig.visible = false;
      figK = 0;
    }
    if (f?.look && S.wedge > 0.01) {
      const wl = 4.4;
      const hw = 17 * DEG;
      const wy = Math.atan2(f.look[0] - f.x, f.look[1] - f.z);
      const a = wedgeGeo.attributes.position as THREE.BufferAttribute;
      a.setXYZ(0, f.x, 0.045, f.z);
      a.setXYZ(
        1,
        f.x + Math.sin(wy - hw) * wl,
        0.045,
        f.z + Math.cos(wy - hw) * wl,
      );
      a.setXYZ(
        2,
        f.x + Math.sin(wy + hw) * wl,
        0.045,
        f.z + Math.cos(wy + hw) * wl,
      );
      a.needsUpdate = true;
      wedgeGeo.computeBoundingSphere();
      wedge.visible = true;
      wedgeMat.opacity = 0.26 * S.wedge;
    } else wedge.visible = false;
    if (eyeOf !== eyeName) {
      eyeName = eyeOf;
      setEye(eyeName);
    }
    phoneOn = on;
  };

  const render = () => {
    if (!camNow || !ly) return;
    const c = camNow;
    placeCamera(c);
    const big = c.big;
    for (const p of pins) p.head.scale.setScalar(p.base * big);
    poseFor(PARK.pinH);
    fig.scale.setScalar(Math.max(0.001, c.figS * figK));
    // the pin's white "eye" faces whoever looks
    const faceTo = (cc: THREE.Camera) => {
      for (const p of pins) {
        const v = cc.position.clone().sub(p.g.position);
        v.y = 0;
        v.normalize().multiplyScalar(0.33);
        p.eyeDot.position.set(v.x, 0.04, v.z);
      }
    };
    faceTo(cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W0, H0);
    renderer.setClearColor(0x000000, 0);
    if (firstFrame) renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, cam);
    // labels follow the model
    const L = ly;
    const hidden = (x: number, y: number) =>
      x < 30 ||
      x > W0 - 30 ||
      y < 22 ||
      y > H0 - 4 ||
      (phoneOn &&
        x > L.phone.x - 8 &&
        x < L.phone.x + L.phone.w + 8 &&
        y > L.phone.y - 8 &&
        y < L.phone.y + L.phone.h + 8);
    for (const p of pins) {
      const hy = PARK.pinH * Math.max(p.rise, 0.6) + 0.45 + 0.45 * big;
      const q = project(cam, p.g.position.x, hy, p.g.position.z, W0, H0);
      lab(
        p.tag,
        p.rise > 0.6 && !hidden(q[0], q[1]),
        p.g.position.x,
        hy,
        p.g.position.z,
        4,
      );
    }
    const sq = project(cam, PARK.poster.x, 2.3, PARK.poster.z, W0, H0);
    lab(
      startTag,
      !!state && state.poster > 0.6 && !hidden(sq[0], sq[1]),
      PARK.poster.x,
      2.3,
      PARK.poster.z,
      6,
    );
    const fy = 0.95 * c.figS * figK + 0.15;
    if (camView === "over" && !camMoving) {
      // in the overview the tag hangs below the person, so it never sits on a station's name
      const on = fig.visible && figK > 0.6;
      if (tagOn.get(whoTag) !== on) {
        tagOn.set(whoTag, on);
        whoTag.classList.toggle("lf-on", on);
      }
      const q = project(cam, fig.position.x, 0, fig.position.z, W0, H0);
      whoTag.style.transform = `translate(${q[0].toFixed(1)}px,${(q[1] + 7).toFixed(1)}px) translate(-50%,0)`;
    } else
      lab(
        whoTag,
        fig.visible && figK > 0.6,
        fig.position.x,
        fy,
        fig.position.z,
        4,
      );
    // the dashed line from the phone to the person
    if (phoneOn && fig.visible && figK > 0.5 && camView !== "over") {
      const q = project(
        cam,
        fig.position.x,
        0.62 * c.figS,
        fig.position.z,
        W0,
        H0,
      );
      setLead([q[0], q[1]]);
    } else setLead(null);
    // the phone's screen: the same park at eye height, drawn into the rectangle under the phone frame
    if (phoneOn && quality.eyePass) {
      const s = L.screen;
      for (const p of pins) p.head.scale.setScalar(p.base);
      poseFor(PARK.eyePinH);
      faceTo(eye);
      renderer.setScissorTest(true);
      renderer.setScissor(s.x, H0 - s.y - s.h, s.w, s.h);
      renderer.setViewport(s.x, H0 - s.y - s.h, s.w, s.h);
      renderer.setClearColor(C.sky, 1);
      renderer.render(scene, eye);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W0, H0);
      renderer.setClearColor(0x000000, 0);
    }
    firstFrame = false;
  };

  let layoutKey = 0;
  return {
    canvas,
    layout(next) {
      if (released || next.W < 2 || next.H < 2) return;
      ly = next;
      W0 = next.W;
      H0 = next.H;
      renderer.setSize(W0, H0, false);
      cam.aspect = W0 / H0;
      const a = W0 / H0;
      VIEWS = {
        over: fit(keyPts, viewParams("over", next), a, ndcRect("over", next)),
        mill: fit(
          REGIONS.mill,
          viewParams("mill", next),
          a,
          ndcRect("mill", next),
        ),
        poster: fit(
          REGIONS.poster,
          viewParams("poster", next),
          a,
          ndcRect("poster", next),
        ),
      };
      setEye(eyeName);
      layoutKey += 1;
    },
    draw(frame, cv, t) {
      if (released || !VIEWS) return false;
      const S = frame.s;
      const u = frame.u;
      const k = cv.from === cv.to ? 1 : cv.k;
      const f = S.fig;
      const bob = !!f && f.bob === 1 && !opts.reducedMotion;
      const key = [
        layoutKey,
        cv.from,
        cv.to,
        k.toFixed(4),
        S.route.toFixed(2),
        S.pins.map((v) => v.toFixed(3)).join(),
        S.pulse.map((v) => v.toFixed(2)).join(),
        S.poster.toFixed(3),
        f
          ? [
              f.who,
              f.x.toFixed(3),
              f.z.toFixed(3),
              f.k.toFixed(3),
              f.yaw.toFixed(3),
              bob ? t.toFixed(3) : 0,
            ].join()
          : "-",
        S.wedge.toFixed(3),
        u.on,
        u.eye,
      ].join("|");
      if (key === sig) return false;
      sig = key;
      sync(S, u.on, u.eye, t);
      camMoving = k < 1;
      camView = cv.to;
      camNow =
        k >= 1
          ? viewState(cv.to)
          : blend(viewState(cv.from), viewState(cv.to), smoothEase(k));
      render();
      return true;
    },
    anchors(name, sw, sh) {
      setEye(name);
      eye.aspect = Math.max(0.2, sw / Math.max(1, sh));
      eye.updateProjectionMatrix();
      const pin = STATIONS[0]!.pin;
      const p = project(eye, pin[0], PARK.eyePinH + 0.55, pin[1], sw, sh);
      const g = project(eye, pin[0], 0.02, pin[1], sw, sh);
      const a = project(eye, BOARD.x - BOARD.w / 2, BOARD.y1, BOARD.z, sw, sh);
      const b = project(eye, BOARD.x + BOARD.w / 2, BOARD.y0, BOARD.z, sw, sh);
      setEye(eyeName);
      return {
        pin: [p[0], p[1]],
        ground: [g[0], g[1]],
        next: [sw * 0.5, sh * 0.88],
        board: [
          Math.min(a[0], b[0]),
          Math.min(a[1], b[1]),
          Math.max(a[0], b[0]),
          Math.max(a[1], b[1]),
        ],
      };
    },
    async prepare() {
      if (released) return;
      await renderer.compileAsync(scene, cam);
      if (quality.eyePass && !released) await renderer.compileAsync(scene, eye);
    },
    show() {
      canvas.classList.add("lf-on");
    },
    release() {
      if (released) return;
      released = true;
      // a deliberate release is not a loss: the listener goes first
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const d of disposables.splice(0)) {
        try {
          d.dispose();
        } catch {
          // one part that fails to free leaves the others to run
        }
      }
      renderer.dispose();
      // dispose() keeps the WebGL context; AR needs it back
      renderer.forceContextLoss();
      canvas.remove();
      parts.tags.replaceChildren();
      setLead(null);
    },
    bench(n) {
      if (released || !camNow) return Number.NaN;
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const was = phoneOn;
      phoneOn = true;
      render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = (performance.now() - t0) / n;
      phoneOn = was;
      render();
      return Math.round(ms * 100) / 100;
    },
    info() {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        renderer: ext
          ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
          : "n/a",
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        dpr: renderer.getPixelRatio(),
      };
    },
  };
}
