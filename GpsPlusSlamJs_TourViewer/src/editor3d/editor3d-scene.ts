/**
 * The desktop editor's 3D view, read-only: the renderer, the scene, the
 * frame loop, the lost context and the disposal. Loaded by a dynamic
 * import from the editor page only when the view switch asks for it
 * (`view-switch.ts`), so neither the map page's own code nor the phone's
 * pages hold any of it.
 *
 * What it draws: the globe's relief on Mapterhorn's heights with the
 * OpenStreetMap map on it (`editor3d-terrain.ts`), the tour in it
 * (`editor3d-stations.ts`) and the credits both owe, under an orbit at
 * the chosen design's start (`editor3d-camera.ts`). It reads the tour from
 * the store - what a save would write now (`manifestToWrite`), and again
 * whenever the document changes - and the selection from `editorView`; it
 * writes nothing.
 *
 * `openEditor3d` resolves once the first frame is drawn. It rejects with
 * an error whose `reason` is `empty` (nothing with a position to show) or
 * `webgl` (no WebGL); a context lost later is reported through
 * `events.contextLost`, and the page goes back to the map.
 *
 * @see editor3d-scene.ts.md
 */
import * as THREE from "three";

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";

import { loadGlbModel } from "../glb-model.js";
import { createPinLabel } from "../pin-label.js";
import { manifestToWrite, type TourDocumentState } from "../tour-document.js";
import type { EditorViewState } from "../editor/editor-view.js";
import {
  EDITOR_CAMERA,
  EDITOR_CLIP,
  createEditorCamera,
  editorClipPlanes,
} from "./editor3d-camera.js";
import {
  createBillboard,
  createCodeSquare,
  resizeBillboard,
} from "./editor3d-marks.js";
import { createStationsLayer } from "./editor3d-stations.js";
import { createEditorTerrain, reliefDeviceClass } from "./editor3d-terrain.js";
import { tourCentre } from "./editor3d-tour-root.js";
import { morphStanding, selectedStationOf } from "./editor3d-visibility.js";

/** The store, as the 3D view reads it. */
export interface Editor3dStore {
  getState(): {
    readonly tourDocument: TourDocumentState;
    readonly editorView: EditorViewState;
  };
  subscribe(listener: () => void): () => void;
}

/** What the page hands the 3D view. */
export interface Editor3dDeps {
  /** The view's box, over the map (`#view3d`). */
  readonly container: HTMLElement;
  /** The credits' line in it. */
  readonly credits: HTMLElement;
  readonly store: Editor3dStore;
  /** The open tour's codes, by level id. */
  levels(): ReadonlyMap<string, QrLevel>;
  /** A content entry of the open tour (photos, models). */
  loadContent(entryName: string): Promise<Blob>;
  readonly events: { contextLost(): void };
}

/** A shown 3D view. */
export interface Editor3dView {
  dispose(): void;
  /** For the page's checks (the dev server's test hook). */
  stats(): Editor3dStats;
  /** Tilt the orbit to `deg` from straight down, keeping its distance
   *  and heading (the page's checks; no control of the page uses it). */
  setTilt(deg: number): void;
}

export interface Editor3dStats {
  readonly frames: number;
  readonly tiltDeg: number;
  readonly standing: number;
  readonly stations: number;
  readonly codes: number;
  readonly shown: readonly string[];
  readonly renders: number;
  readonly osm: Record<string, unknown>;
  /** Each station's drawn height and the drawn ground under it (m over
   *  the ellipsoid; null where no ground has loaded). */
  readonly ground: readonly {
    id: string;
    drawnM: number;
    groundM: number | null;
  }[];
}

/** A failure with the reason the view switch says. */
function failure(reason: "empty" | "webgl", message: string): Error {
  return Object.assign(new Error(message), { reason });
}

const BACKGROUND = 0x232427;
const DEG = Math.PI / 180;

function createRenderer(): THREE.WebGLRenderer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (error) {
    throw failure(
      "webgl",
      `no WebGL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (renderer.getContext() === null) {
    renderer.dispose();
    throw failure("webgl", "no WebGL context");
  }
  return renderer;
}

function fillCredits(
  box: HTMLElement,
  credits: readonly { short: string; href: string }[],
): void {
  const parts: Node[] = [];
  credits.forEach((credit, i) => {
    if (i > 0) parts.push(document.createTextNode(" · "));
    const a = document.createElement("a");
    a.href = credit.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = credit.short;
    parts.push(a);
  });
  box.replaceChildren(...parts);
}

/** The 3D view in `deps.container`, once its first frame is drawn. */
export async function openEditor3d(deps: Editor3dDeps): Promise<Editor3dView> {
  const state = deps.store.getState();
  const levels = deps.levels();
  const manifest = manifestToWrite(state.tourDocument);
  const codeGeos = [...levels.values()].flatMap((l) =>
    l.qr.geo === undefined ? [] : [l.qr.geo],
  );
  const centre = tourCentre(manifest?.stations ?? [], codeGeos);
  if (centre === null) {
    throw failure("empty", "the tour has nothing with a position");
  }
  const { egm96Geoid } = await import("gps-plus-slam-osm/elevation/egm96");
  const geoid = egm96Geoid();
  const undulationAt = (p: { lat: number; lon: number }) =>
    geoid.undulationMetres({ lat: p.lat, lng: p.lon });

  const renderer = createRenderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.className = "view3d-canvas";
  deps.container.prepend(canvas);
  // The box is hidden until the first frame is drawn (the map stays in
  // view while the view loads): the window's size until it shows.
  const size = () => ({
    w: Math.max(1, deps.container.clientWidth || window.innerWidth),
    h: Math.max(1, deps.container.clientHeight || window.innerHeight),
  });
  renderer.setSize(size().w, size().h, false);

  const ground = createEditorTerrain({
    renderer,
    centre: { lat: centre.lat, lng: centre.lng },
    device: reliefDeviceClass(window.innerWidth),
  });
  const { ellipsoid } = ground.terrain.tiles;
  const ecefFromWorld = ground.worldFromEcef.clone().invert();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.Fog(
    BACKGROUND,
    EDITOR_CLIP.fogStartM,
    EDITOR_CLIP.fogEndM,
  );
  scene.add(new THREE.HemisphereLight(0xe9eef5, 0x5d5a52, 1.25));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.75);
  sun.position.set(-160, 260, 120);
  scene.add(sun);
  scene.add(ground.terrain.tiles.group);

  const target = new THREE.Vector3(
    0,
    centre.altM - undulationAt({ lat: centre.lat, lon: centre.lng }),
    0,
  );
  const cam = createEditorCamera({
    domElement: canvas,
    target,
    aspect: size().w / size().h,
  });
  const { camera, controls } = cam;
  const billboardView = () => ({
    viewportPx: size().h,
    fovDeg: EDITOR_CAMERA.fovDeg,
  });

  const layer = createStationsLayer({
    parent: scene,
    ellipsoid,
    worldFromEcef: ground.worldFromEcef,
    undulationAt,
    makeLabel: createPinLabel,
    loadPhotoTexture: async (entry) =>
      decodeFrameTexture(await deps.loadContent(entry), 2, {
        maxPixels: TOUR_MAX_IMAGE_PIXELS,
      }),
    loadContent: (entry) => deps.loadContent(entry),
    loadGlbModel,
    makeBillboard: (number, title, selected) =>
      createBillboard(number, title, selected, billboardView()),
    makeCodeSquare: createCodeSquare,
  });
  layer.setTour(manifest, levels);
  fillCredits(deps.credits, ground.credits);

  // The tour as the view draws it, read again only when the document
  // changes (never per frame: it is the save's manifest).
  let documentNow = state.tourDocument;
  let tourNow = manifest;
  const unsubscribe = deps.store.subscribe(() => {
    const next = deps.store.getState().tourDocument;
    if (next === documentNow) return;
    documentNow = next;
    tourNow = manifestToWrite(next);
    layer.setTour(tourNow, deps.levels());
  });

  const resize = new ResizeObserver(() => {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layer.group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite && o.name.startsWith("billboard")) {
        resizeBillboard(o as THREE.Sprite, billboardView());
      }
    });
  });
  resize.observe(deps.container);

  const onLost = () => {
    deps.events.contextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  let frames = 0;
  let standing = 1;
  const ecef = new THREE.Vector3();
  const groundUnder = (worldPoint: THREE.Vector3): number | null => {
    ecef.copy(worldPoint).applyMatrix4(ecefFromWorld);
    const at = ellipsoid.getPositionToCartographic(ecef, {}) as {
      lat: number;
      lon: number;
    };
    return ground.groundAt(at.lat, at.lon);
  };
  let firstFrame: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    firstFrame = resolve;
  });
  renderer.setAnimationLoop((now) => {
    controls.update();
    standing = morphStanding(cam.tiltDeg());
    const planes = editorClipPlanes({
      ellipsoid,
      cameraEcef: ecef.copy(camera.position).applyMatrix4(ecefFromWorld),
      samples: [
        { distanceM: 0, groundM: groundUnder(camera.position) },
        {
          distanceM: Math.hypot(
            camera.position.x - controls.target.x,
            camera.position.z - controls.target.z,
          ),
          groundM: groundUnder(controls.target),
        },
      ],
    });
    camera.near = planes.near;
    camera.far = planes.far;
    camera.updateProjectionMatrix();
    ground.update(camera, renderer, now);
    const ui = deps.store.getState().editorView;
    layer.update({
      centre: controls.target,
      selectedStation: selectedStationOf(ui.selected, tourNow),
      standing,
    });
    renderer.render(scene, camera);
    frames++;
    if (frames === 1) firstFrame();
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    canvas.removeEventListener("webglcontextlost", onLost);
    resize.disconnect();
    unsubscribe();
    layer.dispose();
    ground.dispose();
    cam.dispose();
    renderer.dispose();
    canvas.remove();
    deps.credits.replaceChildren();
  };

  await ready;
  return {
    dispose,
    setTilt(deg) {
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.phi = Math.min(
        EDITOR_CAMERA.maxPolarAngle,
        Math.max(1e-4, deg * DEG),
      );
      camera.position
        .copy(controls.target)
        .add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
    },
    stats() {
      const now = tourNow;
      return {
        frames,
        tiltDeg: cam.tiltDeg(),
        standing,
        ...layer.stats(),
        osm: ground.osm.stats(),
        ground: (now?.stations ?? []).map((s) => ({
          id: s.id,
          drawnM: s.geo.alt - undulationAt(s.geo),
          groundM: ground.groundAt(s.geo.lat * DEG, s.geo.lon * DEG),
        })),
      };
    },
  };
}
