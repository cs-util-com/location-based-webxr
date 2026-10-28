/**
 * A tour model's world view, mounted on the model the visitor's renderer
 * drew (`content-placement.ts`): what makes a `ghost` glass, a `cutaway`
 * cut open, a `hotspots` model carry its notes, and a `toy` play. `placed`
 * is the model as it is. Every view keeps the size the one shared rule
 * gave it (`modelScale`); a toy multiplies that size by its own factor.
 *
 * - `ghost`: every mesh drawn as glass - a rim that glows where the
 *   surface turns away, a slow light sweeping up, feet fading into the
 *   ground - over a depth pass, so the glass shows only its front.
 * - `hotspots`: the clip held at rest, so the notes stay on the surface;
 *   the notes themselves are drawn on the screen (`note-markers.ts`) from
 *   `notePoints`.
 * - `cutaway`: every mesh clipped by one plane, its cut faces drawn in a
 *   flat colour (the back faces the cut opens), and four brass corner
 *   marks framing the cut. Without sections the plane turns to face the
 *   visitor and removes the near half; with sections it is the current
 *   section's plane, removing the side its normal points to.
 * - `toy`: real size at its pose until the visitor resizes or moves it
 *   (`model-gestures.ts`); `resetToy` puts it back.
 * - `animation` with `autoplay`: the named clip loops in every view but
 *   `hotspots`. A name the file lacks plays nothing.
 *
 * Disposing restores the model's own materials and removes what the view
 * added, so the caller frees the model as usual (`disposeObject3D`).
 *
 * @see model-views.ts.md
 */

import * as THREE from "three";
import type {
  TourBlock,
  TourModelNote,
  TourModelWorldView,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { TOUR_MODEL_WORLD_VIEWS } from "gps-plus-slam-app-framework/ar/tour-blocks";

import { pinchedToyFactor, toyStartFactor } from "./model-gestures.js";

/** A model block, as the views read it. */
export type TourModelBlock = Extract<TourBlock, { kind: "model" }>;

/** What a view needs from the page: the renderer's clipping switch (a
 *  cutaway's planes are ignored while it is off). */
export interface ModelViewEnv {
  enableClipping(): void;
}

/** A note's three points in the world, for the screen's markers. */
export interface NoteWorldPoints {
  /** Where the note sits on the surface. */
  readonly surface: THREE.Vector3;
  /** Where its marker floats, off the surface along its normal. */
  readonly marker: THREE.Vector3;
  /** Its normal in the world (unit length). */
  readonly normal: THREE.Vector3;
}

export interface ModelViewHandle {
  readonly blockId: string;
  readonly view: TourModelWorldView;
  readonly block: TourModelBlock;
  /** The model the view is mounted on. */
  readonly model: THREE.Object3D;
  /** The notes drawn on the model: its annotations in `hotspots`, none in
   *  any other view. */
  readonly notes: readonly TourModelNote[];
  /** The notes' points in the world now (empty outside `hotspots`). */
  notePoints(): NoteWorldPoints[];
  /** The cutaway's section shown (an index into `block.sections`), or -1
   *  for the cut that faces the visitor (and outside a cutaway). */
  section(): number;
  /** Show section `index` (wrapped into range); nothing outside a cutaway
   *  with sections. */
  setSection(index: number): void;
  /** The toy's factor of its real size (1 outside a toy). */
  toyFactor(): number;
  /** Scale the toy by a pinch from `fromPx` to `toPx` (fingers' distance);
   *  nothing outside a toy. */
  pinchToy(fromPx: number, toPx: number): void;
  /** Move the toy by `dx`, `dz` metres in the WORLD's frame; nothing
   *  outside a toy. */
  moveToy(dx: number, dz: number): void;
  /** The toy back at its pose and real size. */
  resetToy(): void;
  /** Whether the toy is anywhere but its place, or at another size. */
  toyMoved(): boolean;
  /** One frame: `dtS` seconds since the last, `camera` the visitor's (the
   *  cutaway turns to it). */
  update(dtS: number, camera: THREE.Camera | null): void;
  dispose(): void;
}

/** The ghost's colours: the deep core and the bright rim. */
const GHOST_CORE = "#1f4366";
const GHOST_RIM = "#d8efff";
/** The cut faces' colour when a material has none of its own. */
const SECTION_FALLBACK = "#e0a060";
/** The brass the cutaway's corner marks are drawn in. */
const BRASS = "#f2a54e";
/** A marker floats this share of the model's largest side off its
 *  surface, held within 4 cm and 4 m. */
const MARKER_OFFSET_SHARE = 0.13;
const MARKER_OFFSET_MIN_M = 0.04;
const MARKER_OFFSET_MAX_M = 4;
/** How fast the facing cut turns after the visitor (per second). */
const CUT_TURN_RATE = 3;

const GHOST_VS = `varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vY = (modelMatrix * vec4(position, 1.0)).y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

const GHOST_FS = `uniform float uTime; uniform float uAppear; uniform float uGround;
uniform vec3 uRim; uniform vec3 uCore;
varying vec3 vN; varying vec3 vV; varying float vY;
void main() {
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float rim = pow(1.0 - abs(dot(n, v)), 1.6);
  float h = vY - uGround;
  float sweep = smoothstep(0.75, 1.0, 0.5 + 0.5 * sin(h * 2.2 - uTime * 1.3));
  float foot = smoothstep(0.0, 0.7, h);
  vec3 col = mix(uCore, uRim, clamp(rim * 1.2 + sweep * 0.35, 0.0, 1.0));
  float a = (0.4 + 0.58 * rim + 0.2 * sweep) * foot * uAppear;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/** The ghost's glass material (one per model). */
export function createGhostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "ghost",
    vertexShader: GHOST_VS,
    fragmentShader: GHOST_FS,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uAppear: { value: 1 },
      uGround: { value: 0 },
      uRim: { value: new THREE.Color(GHOST_RIM) },
      uCore: { value: new THREE.Color(GHOST_CORE) },
    },
  });
}

/** The colour a cut face of `material` is drawn in: its own colour where
 *  it has one, else a warm fallback. */
export function sectionColour(material: THREE.Material): THREE.Color {
  const own = (material as { color?: unknown }).color;
  return own instanceof THREE.Color
    ? own.clone()
    : new THREE.Color(SECTION_FALLBACK);
}

/** Every mesh of `root`, collected before anything is added to it. */
function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  return meshes;
}

/** The materials of `mesh`, one or many. */
function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** The four brass corner marks and the faint plane of a cut, two units
 *  wide and high (scaled to the model by the caller). */
function cutFrame(): THREE.Group {
  const frame = new THREE.Group();
  frame.name = "cutaway-frame";
  const points: THREE.Vector3[] = [];
  const k = 0.16;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    points.push(
      new THREE.Vector3(sx, sy, 0),
      new THREE.Vector3(sx - sx * k, sy, 0),
      new THREE.Vector3(sx, sy, 0),
      new THREE.Vector3(sx, sy - sy * k * 1.2, 0),
    );
  }
  frame.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: BRASS,
        transparent: true,
        opacity: 0.9,
      }),
    ),
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        color: BRASS,
        transparent: true,
        opacity: 0.012,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  return frame;
}

/** The model's box at rest, in its own frame (its own transform left
 *  out): what the facing cut is centred on. */
function ownBox(model: THREE.Object3D): THREE.Box3 {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const partToModel = new THREE.Matrix4();
  for (const mesh of meshesOf(model)) {
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    const own = mesh.geometry.boundingBox;
    if (own === null) continue;
    partToModel.multiplyMatrices(toModel, mesh.matrixWorld);
    box.union(part.copy(own).applyMatrix4(partToModel));
  }
  return box;
}

/** A view the format does not know is drawn as `placed` (defensive: the
 *  reader never hands one over). */
function viewOf(block: TourModelBlock): TourModelWorldView {
  return (TOUR_MODEL_WORLD_VIEWS as readonly string[]).includes(block.view)
    ? (block.view as TourModelWorldView)
    : "placed";
}

/**
 * Mount `block`'s world view on `model`, which the caller has already
 * scaled by `baseScale` (`modelScale(model, sizeM)`) and put at its pose
 * in its parent. `env` turns clipping on for a cutaway; without it a
 * cutaway's planes are set but the renderer may ignore them.
 */
export function mountModelView(
  model: THREE.Object3D,
  block: TourModelBlock,
  baseScale: number,
  env?: ModelViewEnv,
): ModelViewHandle {
  if (!(Number.isFinite(baseScale) && baseScale > 0)) {
    throw new RangeError(
      `a model's scale must be finite and > 0, got ${baseScale}`,
    );
  }
  const view = viewOf(block);
  const sizeM = block.sizeM ?? 1;
  // The model's largest side in its own units.
  const native = sizeM / baseScale;
  const restPosition = model.position.clone();
  const restores: (() => void)[] = [];
  const owned: { dispose(): void }[] = [];
  const meshes = meshesOf(model);

  // --- the clip
  let mixer: THREE.AnimationMixer | null = null;
  const clip =
    block.animation?.autoplay === true && view !== "hotspots"
      ? model.animations.find((c) => c.name === block.animation?.name)
      : undefined;
  if (clip !== undefined) {
    mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    restores.push(() => {
      mixer?.stopAllAction();
      mixer?.uncacheRoot(model);
    });
  }

  // --- ghost
  let ghost: THREE.ShaderMaterial | null = null;
  if (view === "ghost") {
    ghost = createGhostMaterial();
    const depthOnly = new THREE.MeshBasicMaterial({
      name: "ghost-depth",
      colorWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 2,
    });
    owned.push(ghost, depthOnly);
    for (const mesh of meshes) {
      const own = mesh.material;
      const order = mesh.renderOrder;
      mesh.material = ghost;
      mesh.renderOrder = 2;
      const depth = new THREE.Mesh(mesh.geometry, depthOnly);
      depth.name = "ghost-depth";
      depth.renderOrder = 1;
      mesh.add(depth);
      restores.push(() => {
        mesh.material = own;
        mesh.renderOrder = order;
        depth.removeFromParent();
      });
    }
  }

  // --- cutaway
  const sections = block.sections ?? [];
  let sectionIndex = view === "cutaway" && sections.length > 0 ? 0 : -1;
  let clipPlane: THREE.Plane | null = null;
  let frame: THREE.Group | null = null;
  let cutDir: THREE.Vector3 | null = null;
  const centre = ownBox(model).getCenter(new THREE.Vector3());
  if (view === "cutaway") {
    env?.enableClipping();
    clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const planes = [clipPlane];
    for (const mesh of meshes) {
      for (const material of materialsOf(mesh)) {
        const ownPlanes = material.clippingPlanes;
        const ownSide = material.side;
        material.clippingPlanes = planes;
        material.side = THREE.FrontSide;
        restores.push(() => {
          material.clippingPlanes = ownPlanes;
          material.side = ownSide;
        });
      }
      const first = materialsOf(mesh)[0];
      const fill = new THREE.MeshBasicMaterial({
        name: "cutaway-fill",
        color: first === undefined ? SECTION_FALLBACK : sectionColour(first),
        side: THREE.BackSide,
        clippingPlanes: planes,
      });
      owned.push(fill);
      const back = new THREE.Mesh(mesh.geometry, fill);
      back.name = "cutaway-fill";
      mesh.add(back);
      restores.push(() => back.removeFromParent());
    }
    frame = cutFrame();
    frame.scale.set(native * 0.62, native * 0.5, 1);
    model.add(frame);
    const builtFrame = frame;
    restores.push(() => builtFrame.removeFromParent());
    builtFrame.traverse((o) => {
      const part = o as THREE.Mesh;
      if (part.geometry !== undefined) owned.push(part.geometry);
      if (part.material !== undefined) owned.push(...materialsOf(part));
    });
  }

  // --- toy
  let toyFactor = view === "toy" ? toyStartFactor(sizeM) : 1;
  const applyToyScale = (): void => {
    model.scale.setScalar(baseScale * toyFactor);
  };
  if (view === "toy") applyToyScale();
  const scratch = new THREE.Vector3();
  const scratchQ = new THREE.Quaternion();

  const notes = view === "hotspots" ? (block.annotations ?? []) : [];

  /** The cut's plane and frame for the current section, in the world. */
  const placeSection = (): void => {
    const section = sections[sectionIndex];
    if (clipPlane === null || frame === null || section === undefined) return;
    model.updateMatrixWorld(true);
    const point = model.localToWorld(new THREE.Vector3(...section.position));
    const normal = new THREE.Vector3(...section.normal)
      .normalize()
      .applyQuaternion(model.getWorldQuaternion(scratchQ))
      .normalize();
    // Three keeps the side a plane's normal points to: the section's
    // normal names the side cut away, so the plane faces the other way.
    clipPlane.setFromNormalAndCoplanarPoint(normal.clone().negate(), point);
    frame.position.set(...section.position);
    frame.lookAt(point.clone().add(normal));
  };
  if (sectionIndex >= 0) placeSection();

  let elapsed = 0;
  return {
    blockId: block.id,
    view,
    block,
    model,
    notes,
    notePoints() {
      if (notes.length === 0) return [];
      model.updateMatrixWorld(true);
      const q = model.getWorldQuaternion(new THREE.Quaternion());
      const worldScale = model.getWorldScale(scratch).x;
      const offset = Math.min(
        MARKER_OFFSET_MAX_M,
        Math.max(
          MARKER_OFFSET_MIN_M,
          MARKER_OFFSET_SHARE * native * worldScale,
        ),
      );
      return notes.map((note) => {
        const surface = model.localToWorld(new THREE.Vector3(...note.position));
        const normal = new THREE.Vector3(...note.normal)
          .normalize()
          .applyQuaternion(q)
          .normalize();
        return {
          surface,
          marker: surface.clone().addScaledVector(normal, offset),
          normal,
        };
      });
    },
    section: () => sectionIndex,
    setSection(index) {
      if (view !== "cutaway" || sections.length === 0) return;
      if (!Number.isInteger(index)) return;
      const n = sections.length;
      sectionIndex = ((index % n) + n) % n;
      placeSection();
    },
    toyFactor: () => toyFactor,
    pinchToy(fromPx, toPx) {
      if (view !== "toy") return;
      toyFactor = pinchedToyFactor(toyFactor, fromPx, toPx, sizeM);
      applyToyScale();
    },
    moveToy(dx, dz) {
      if (view !== "toy" || !Number.isFinite(dx) || !Number.isFinite(dz)) {
        return;
      }
      // A world step, turned into the parent's frame (a station's frame
      // carries its heading).
      const step = new THREE.Vector3(dx, 0, dz);
      if (model.parent !== null) {
        model.parent.updateMatrixWorld(true);
        step.applyQuaternion(
          model.parent.getWorldQuaternion(scratchQ).invert(),
        );
      }
      model.position.add(step);
    },
    resetToy() {
      if (view !== "toy") return;
      toyFactor = toyStartFactor(sizeM);
      applyToyScale();
      model.position.copy(restPosition);
    },
    toyMoved: () =>
      view === "toy" &&
      (toyFactor !== toyStartFactor(sizeM) ||
        !model.position.equals(restPosition)),
    update(dtS, camera) {
      const dt = Number.isFinite(dtS) && dtS > 0 ? Math.min(dtS, 0.1) : 0;
      elapsed += dt;
      mixer?.update(dt);
      if (ghost !== null) {
        ghost.uniforms["uTime"]!.value = elapsed;
        // The station's fade writes the material's opacity
        // (`content-fade.ts`); the glass reads it as its appear.
        ghost.uniforms["uAppear"]!.value = ghost.opacity;
        ghost.uniforms["uGround"]!.value = model.getWorldPosition(scratch).y;
      }
      if (clipPlane === null || frame === null || sectionIndex >= 0) return;
      if (camera === null) return;
      // The facing cut: a vertical plane through the model's centre,
      // turned (smoothed) toward the visitor, removing the near half.
      model.updateMatrixWorld(true);
      const worldCentre = model.localToWorld(centre.clone());
      const eye = camera.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(
        worldCentre.x - eye.x,
        0,
        worldCentre.z - eye.z,
      );
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      if (cutDir === null) cutDir = dir;
      else cutDir.lerp(dir, Math.min(1, dt * CUT_TURN_RATE)).normalize();
      const worldScale = model.getWorldScale(scratch).x;
      clipPlane.setFromNormalAndCoplanarPoint(
        cutDir,
        worldCentre
          .clone()
          .addScaledVector(cutDir, -0.02 * native * worldScale),
      );
      frame.position.copy(centre);
      frame.lookAt(worldCentre.clone().add(cutDir));
    },
    dispose() {
      for (const restore of restores.reverse()) restore();
      restores.length = 0;
      for (const o of owned) o.dispose();
      owned.length = 0;
      model.scale.setScalar(baseScale);
      model.position.copy(restPosition);
    },
  };
}

/** The view mounted on `object` (`content-placement.ts` keeps it in the
 *  model's `userData.modelView`), or null. */
export function modelViewOf(object: THREE.Object3D): ModelViewHandle | null {
  const handle: unknown = object.userData["modelView"];
  return typeof handle === "object" &&
    handle !== null &&
    "blockId" in handle &&
    "update" in handle
    ? (handle as ModelViewHandle)
    : null;
}
