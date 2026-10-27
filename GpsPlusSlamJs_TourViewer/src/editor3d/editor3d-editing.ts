/**
 * Editing in the 3D view: the gizmo on the selection (`editor3d-gizmo.ts`)
 * and the pointer, touch and keys (`editor3d-input.ts`), wired to the
 * scene's camera, its ground and its tour layer. This is where the world
 * the pure gesture maths reads (`GestureWorld`) is built: the SAMPLED
 * ground under a pointer (`groundHit`), the level plane under it, a world
 * point's place, and the ground's height at a place in the tour's
 * ellipsoidal heights (the drawn ground plus the geoid's N - the editor
 * draws everything N lower than its file's height).
 *
 * The selection's gizmo is placed each frame from the tour, or from a
 * gesture's preview while one runs; codes have none (read-only here), and
 * a locked station's is its radius dots alone.
 * Two fingers move the camera (tilt, or pinch, pan and twist); OrbitControls
 * is told to leave two fingers alone.
 *
 * @see editor3d-editing.ts.md
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import { groundHit } from "gps-plus-slam-globe/editor";

import type { GroundPlace } from "../editor/editor-shell/scene-menu.js";
import { STATION_PREFIX as STATION } from "../editor/editor-model.js";
import { worldBlocks } from "../tour-document.js";
import { EDITOR_CAMERA } from "./editor3d-camera.js";
import {
  clampedPose,
  orbitPoseOf,
  orbitPosition,
  type OrbitPose,
} from "./editor3d-flight.js";
import { createGizmo, drawGizmoPictures } from "./editor3d-gizmo.js";
import {
  createSceneInput,
  type InputPage,
  type InputScene,
} from "./editor3d-input.js";
import type { createStationsLayer, LayerPreview } from "./editor3d-stations.js";
import type { EditorTerrain } from "./editor3d-terrain.js";
import type { GesturePreview, GestureTarget, GestureWorld } from "./gesture.js";
import {
  gizmoLayout,
  handleAt,
  type GizmoHandle,
  type GizmoLayout,
  type ScreenPoint,
  type WorldPoint,
} from "./gizmo-maths.js";
import { headingOfGeo, turnedGeo } from "./pose-edits.js";
import { mapGestureOf, tiltedPolarRad } from "./two-finger.js";

const DEG = Math.PI / 180;

type StationsLayer = ReturnType<typeof createStationsLayer>;

/** What the editing needs of the scene and the page. */
export interface SceneEditingDeps {
  /** The view's box (its docks inside it are not the scene's). */
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly layer: StationsLayer;
  readonly ground: EditorTerrain;
  readonly ecefFromWorld: THREE.Matrix4;
  undulationAt(place: { lat: number; lon: number }): number;
  /** The tour as the view draws it now. */
  tour(): TourManifest | null;
  /** Whether a station's pose is locked (the page's view state): its
   *  gizmo is then its radius dots alone. */
  stationLocked(stationId: string): boolean;
  /** The page's selection and the store's dispatch, and its edits. */
  readonly page: InputPage;
  /** The camera's flights: a two-finger touch ends one; a double click
   *  frames. */
  endFlight(): void;
  /** Spend the orbit's coast at once: the camera stops moving. */
  dropMomentum(): void;
  frame(selection: string): void;
}

/** The gizmo's parts a check can ask the screen position of. */
export type GizmoPart = "middle" | "knob" | "dot";

/**
 * The gizmo and the input on the view, until `dispose`. `update` each
 * frame, before the drawing.
 */
export function createSceneEditing(deps: SceneEditingDeps) {
  const { camera, controls, canvas, layer, ground } = deps;
  const { ellipsoid } = ground.terrain.tiles;
  // Two fingers are the editing's (`two-finger.ts`): OrbitControls keeps
  // one finger and the mouse.
  controls.touches.TWO = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ecef = new THREE.Vector3();
  const plane = new THREE.Plane();
  const UP = new THREE.Vector3(0, 1, 0);

  const rayAt = (pointer: ScreenPoint): THREE.Raycaster => {
    const r = canvas.getBoundingClientRect();
    ndc.set(
      (pointer.x / Math.max(1, r.width)) * 2 - 1,
      -(pointer.y / Math.max(1, r.height)) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  };

  const placeOf = (at: WorldPoint) => {
    ecef.set(at.x, at.y, at.z).applyMatrix4(deps.ecefFromWorld);
    const c = ellipsoid.getPositionToCartographic(ecef, {}) as {
      lat: number;
      lon: number;
    };
    return { lat: c.lat / DEG, lon: c.lon / DEG };
  };

  /** A tour pose's point in the world (drawn N lower than its file's
   *  ellipsoidal height). */
  const worldOf = (geo: {
    readonly lat: number;
    readonly lon: number;
    readonly alt: number;
  }): THREE.Vector3 => {
    const out = new THREE.Vector3();
    ellipsoid.getCartographicToPosition(
      geo.lat * DEG,
      geo.lon * DEG,
      geo.alt - deps.undulationAt(geo),
      out,
    );
    return out.applyMatrix4(deps.ground.worldFromEcef);
  };

  const world: GestureWorld = {
    groundUnder(pointer) {
      const hit = groundHit(ground.terrain, rayAt(pointer).ray);
      return hit.miss === null
        ? { at: { x: hit.point.x, y: hit.point.y, z: hit.point.z } }
        : { miss: hit.miss };
    },
    planeUnder(pointer, y) {
      plane.set(UP, -y);
      const p = rayAt(pointer).ray.intersectPlane(plane, new THREE.Vector3());
      return p === null ? null : { x: p.x, y: p.y, z: p.z };
    },
    placeOf,
    groundAt(place) {
      const drawn = ground.groundAt(place.lat * DEG, place.lon * DEG);
      return drawn === null ? null : drawn + deps.undulationAt(place);
    },
  };

  /** The selection as a gesture's target (the ground under an item is
   *  the gizmo's centre); null for a code or one the tour lacks. */
  const targetOf = (selection: string): GestureTarget | null => {
    const tour = deps.tour();
    if (tour === null) return null;
    if (selection.startsWith(STATION)) {
      const id = selection.slice(STATION.length);
      const station = tour.stations.find((s) => s.id === id);
      if (station === undefined) return null;
      const c = worldOf(station.geo);
      return {
        kind: "station",
        id,
        geo: station.geo,
        foundRadiusM: station.foundRadiusM,
        centre: { x: c.x, y: c.y, z: c.z },
        locked: deps.stationLocked(id),
      };
    }
    for (const station of tour.stations) {
      const item = worldBlocks(station).find((i) => i.id === selection);
      if (item === undefined) continue;
      const geo = itemGeoPose(item.pose, station.geo);
      const c = worldOf({ ...geo, alt: world.groundAt(geo) ?? geo.alt });
      return {
        kind: "item",
        id: item.id,
        geo,
        sizeM: item.kind === "model" ? (item.sizeM ?? null) : null,
        centre: { x: c.x, y: c.y, z: c.z },
      };
    }
    return null;
  };

  // --- the gizmo -----------------------------------------------------------
  const gizmo = createGizmo(deps.scene, drawGizmoPictures());
  let preview: { target: GestureTarget; now: GesturePreview } | null = null;
  let hovered: GizmoHandle | null = null;
  let layout: GizmoLayout | null = null;

  const spritePerPx = () =>
    (2 * Math.tan((EDITOR_CAMERA.fovDeg * DEG) / 2)) /
    Math.max(1, canvas.getBoundingClientRect().height);

  /** The gizmo's layout for the selection now: its target, or the
   *  preview of a gesture on it. */
  const layoutNow = (): GizmoLayout | null => {
    const selection = deps.page.selected();
    if (selection === null) return null;
    const target = targetOf(selection);
    if (target === null) return null;
    let centre = target.centre;
    let geo = target.geo;
    let radiusM = target.kind === "station" ? target.foundRadiusM : null;
    let sizeM = target.kind === "item" ? target.sizeM : null;
    if (preview !== null && preview.target.id === target.id) {
      geo = preview.now.geo;
      radiusM = preview.now.foundRadiusM ?? radiusM;
      sizeM = preview.now.sizeM ?? sizeM;
      const under =
        target.kind === "item" ? (world.groundAt(geo) ?? geo.alt) : geo.alt;
      const c = worldOf({ ...geo, alt: under });
      centre = { x: c.x, y: c.y, z: c.z };
    }
    const distance = camera.position.distanceTo(
      new THREE.Vector3(centre.x, centre.y, centre.z),
    );
    const metresPerPx = Math.max(1e-6, distance * spritePerPx());
    return gizmoLayout(
      {
        kind: target.kind,
        centre,
        headingDeg: headingOfGeo(geo),
        radiusM,
        sizeM,
        locked: target.kind === "station" && target.locked === true,
      },
      metresPerPx,
    );
  };

  const screenOf = (at: THREE.Vector3): ScreenPoint | null => {
    const p = at.clone().project(camera);
    if (p.z > 1 || p.z < -1) return null;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((p.x + 1) / 2) * r.width,
      y: ((1 - p.y) / 2) * r.height,
    };
  };

  // --- the input -----------------------------------------------------------
  const sceneSide: InputScene = {
    target: targetOf,
    handleAt(pointer) {
      if (layout === null) return null;
      const ray = rayAt(pointer);
      const selection = deps.page.selected();
      const under = layer.pick(ray);
      const onDisc = ray.intersectObject(gizmo.parts.disc).length > 0;
      return handleAt({
        pointer,
        knob: gizmo.parts.knob.visible
          ? screenOf(gizmo.parts.knob.position)
          : null,
        dots: gizmo.parts.dots
          .filter((d) => d.visible)
          .flatMap((d) => {
            const s = screenOf(d.position);
            return s === null ? [] : [s];
          }),
        onDisc,
        underPointer:
          under === null ? null : under === selection ? "selected" : "other",
        posable: layout.posable,
      });
    },
    pickAt(pointer) {
      const hit = layer.pick(rayAt(pointer));
      if (hit !== null) return hit;
      // On the ground inside a station's found radius: that station (the
      // nearest, where radii overlap).
      const g = groundHit(ground.terrain, rayAt(pointer).ray);
      if (g.miss !== null) return null;
      let best: { id: string; d: number } | null = null;
      for (const s of deps.tour()?.stations ?? []) {
        const at = layer.pointOf(s.id);
        if (at === null) continue;
        const d = Math.hypot(at.x - g.point.x, at.z - g.point.z);
        if (d <= s.foundRadiusM && (best === null || d < best.d)) {
          best = { id: s.id, d };
        }
      }
      return best === null ? null : `${STATION}${best.id}`;
    },
    world,
    preview(target, now) {
      preview = now === null ? null : { target, now };
      const shown: LayerPreview | null =
        now === null
          ? null
          : target.kind === "station"
            ? {
                kind: "station",
                id: target.id,
                geo: now.geo,
                foundRadiusM: now.foundRadiusM ?? target.foundRadiusM,
              }
            : { kind: "item", id: target.id, geo: now.geo, sizeM: now.sizeM };
      layer.setPreview(shown);
    },
    hover(handle) {
      hovered = handle;
    },
    lockCamera(on) {
      // Locked, the camera stands still: a flight or the orbit's coast
      // would move the object under a pointer that holds still.
      if (on) {
        deps.endFlight();
        deps.dropMomentum();
      }
      controls.enableRotate = !on;
      controls.enablePan = !on;
      controls.enableZoom = !on;
    },
    twoFingerStart() {
      deps.endFlight();
    },
    twoFinger(mode, last, now) {
      const pose = orbitPoseOf(camera.position, controls.target);
      let next: OrbitPose;
      if (mode === "tilt") {
        next = { ...pose, polarRad: tiltedPolarRad(pose.polarRad, last, now) };
      } else {
        const { distanceScale, turnRad } = mapGestureOf(last, now);
        const mid = (p: typeof now): ScreenPoint => ({
          x: (p[0].x + p[1].x) / 2,
          y: (p[0].y + p[1].y) / 2,
        });
        // The ground under the fingers stays under them: the target moves
        // by what lay under their midpoint before less what lies there now.
        const from = world.planeUnder(mid(last), pose.target.y);
        const to = world.planeUnder(mid(now), pose.target.y);
        const target = pose.target.clone();
        if (from !== null && to !== null) {
          target.x += from.x - to.x;
          target.z += from.z - to.z;
        }
        next = {
          target,
          distanceM: pose.distanceM * distanceScale,
          polarRad: pose.polarRad,
          azimuthRad: pose.azimuthRad + turnRad,
        };
      }
      const placed = clampedPose(next);
      controls.target.copy(placed.target);
      orbitPosition(placed, camera.position);
      camera.lookAt(placed.target);
    },
    frame(selection) {
      deps.frame(selection);
    },
  };
  const input = createSceneInput({
    element: deps.container,
    surface: canvas,
    scene: sceneSide,
    page: deps.page,
  });

  return {
    /** The place the view looks at (the orbit's centre), on the ground:
     *  the ground's ellipsoidal height there, or the centre's own height
     *  where no ground has loaded yet. */
    centre(): GroundPlace {
      const at = controls.target;
      const place = placeOf(at);
      const groundAlt = world.groundAt(place);
      if (groundAlt !== null) return { ...place, alt: groundAlt };
      ecef.copy(at).applyMatrix4(deps.ecefFromWorld);
      const c = ellipsoid.getPositionToCartographic(ecef, {}) as {
        height: number;
      };
      return { ...place, alt: c.height + deps.undulationAt(place) };
    },
    /** The ground's ellipsoidal height at a place, as loaded (null where
     *  none has loaded yet). */
    groundAt: (place: { readonly lat: number; readonly lon: number }) =>
      world.groundAt(place),
    /** Turn the selection `deg` clockwise about up, where it stands: one
     *  edit through the page (a locked station's is refused there).
     *  False for a selection without a pose here (a code). */
    turn(selection: string, deg: number): boolean {
      const target = targetOf(selection);
      if (target === null) return false;
      const geo = turnedGeo(target.geo, deg);
      deps.page.commit(
        target.kind === "station"
          ? { kind: "station-pose", id: target.id, geo }
          : { kind: "item-pose", id: target.id, geo },
      );
      return true;
    },
    /** Each frame: the input's retries, then the gizmo on the selection. */
    update() {
      input.frame();
      layout = layoutNow();
      if (layout === null) {
        gizmo.update(null);
        return;
      }
      const centreY = layout.centre.y;
      gizmo.update({
        layout,
        spritePerPx: spritePerPx(),
        groundY: (spot) => {
          const place = placeOf({ x: spot.x, y: centreY, z: spot.z });
          const drawn = ground.groundAt(place.lat * DEG, place.lon * DEG);
          if (drawn === null) return centreY;
          return worldOf({ ...place, alt: drawn + deps.undulationAt(place) }).y;
        },
        hovered,
      });
    },
    /** Cancel a gesture under way, writing nothing. */
    cancel() {
      input.cancel();
    },
    /** Where the selection, or a part of its gizmo, is on the screen (the
     *  page's checks), or null. */
    screenOf(selection: string): ScreenPoint | null {
      const at = selection.startsWith(STATION)
        ? layer.pointOf(selection.slice(STATION.length))
        : (layer.itemPointOf(selection) ?? layer.codePointOf(selection));
      return at === null ? null : screenOf(at);
    },
    handleScreen(part: GizmoPart): ScreenPoint | null {
      const o =
        part === "middle"
          ? gizmo.parts.disc
          : part === "knob"
            ? gizmo.parts.knob
            : gizmo.parts.dots[0];
      return o?.visible === true ? screenOf(o.position) : null;
    },
    /** The gizmo's drawn sizes on the screen (px), for the layout checks:
     *  the knob, a dot, and the ring's or the move disc's radius. */
    handleSizes(): { knobPx: number; dotPx: number; ringPx: number } | null {
      if (layout === null) return null;
      const perPx = spritePerPx();
      const c = layout.centre;
      const metresPerPx =
        camera.position.distanceTo(new THREE.Vector3(c.x, c.y, c.z)) * perPx;
      return {
        knobPx: gizmo.parts.knob.scale.x / perPx,
        dotPx:
          gizmo.parts.dots[0]?.visible === true
            ? gizmo.parts.dots[0].scale.x / perPx
            : 0,
        ringPx: (layout.ringM ?? layout.moveM) / metresPerPx,
      };
    },
    dispose() {
      input.dispose();
      layer.setPreview(null);
      gizmo.dispose();
    },
  };
}
