/**
 * The travelling box's controller: the imperative shell around the pure
 * rules (`travelling-box-rules.ts`). Each frame it measures one surface's
 * plate on screen, decides where the surface wants to be (its plate in
 * the world, the dock at the screen, or hidden), settles that with the
 * holds, steps the flight and the fade, paints the one texture when it
 * looks different, and shows either the plate or the flight quad
 * (`travelling-box-quad.ts`), never both. It owns the texture, its canvas
 * and the quad; the surface (`travel-surface.ts`) owns its plate, its
 * ghost and its gestures.
 *
 * @see travelling-box.ts.md
 */
import {
  Matrix4,
  Vector3,
  Vector4,
  type Camera,
  type CanvasTexture,
  type Material,
  type Object3D,
  type Texture,
} from "three";

import type {
  TravelLayout,
  TravelRect,
  TravelSurface,
} from "./travel-surface.js";
import {
  createTravellingBoxQuad,
  type TravellingBoxQuad,
} from "./travelling-box-quad.js";
import {
  easeInOutCubic,
  facingAngleDeg,
  flightClip,
  inQuad,
  plateMetrics,
  quadOfClip,
  settlePlace,
  stepToward,
  TRAVEL_MIN_W,
  wantPlace,
  type PlateMetrics,
  type SettleState,
  type TravelPlace,
  type TravellingBoxKnobs,
  type TravelWhy,
} from "./travelling-box-rules.js";
import { CLOSING_TAP_GRACE_MS } from "./view-switch.js";
import { canvasTexture } from "./world-part.js";

/** The fade in and out (s): the prototype's. */
const PRESENCE_S = 0.3;
/** A frame step longer than this (s) is a pause, not motion. */
const MAX_STEP_S = 0.1;
/** Frame gaps the cost counters count (ms). */
const GAPS_MS = [33, 50, 100] as const;

/** The drawing area on the page (CSS px). */
export interface TravelViewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A settled change of place, for the field log. */
export interface TravelPlaceEvent {
  /** `now()` at the change (ms). */
  readonly at: number;
  readonly surface: string;
  readonly place: TravelPlace;
  readonly why: TravelWhy;
}

export interface TravellingBoxDeps {
  readonly surface: TravelSurface;
  /** Where the flight quad goes: the scene the camera renders. */
  readonly scene: Object3D;
  /** The frame's camera, its matrices current when `frame()` runs. */
  readonly camera: Camera;
  readonly knobs: TravellingBoxKnobs;
  /** The page's time (ms). */
  readonly now: () => number;
  readonly reduceMotion: () => boolean;
  /** The drawing area on the page; cheap, read once a frame. */
  readonly viewRect: () => TravelViewRect;
  /** A new canvas for the texture (`document.createElement` by default). */
  readonly createCanvas?: () => HTMLCanvasElement;
  /** Uploads a painted texture at once, so the paint's cost includes it
   *  (the page passes `renderer.initTexture`). */
  readonly upload?: (texture: Texture) => void;
  readonly onPlace?: (event: TravelPlaceEvent) => void;
  /** Whether this surface owns its screen slot (alone it always does). */
  readonly slotFree?: () => boolean;
}

/** A pointer on the words: where it hit and how deep. */
export interface TravelHit {
  /** On the flying quad (drawn over the world) rather than the plate. */
  readonly quad: boolean;
  /** The plate's mean clip w (its distance along the view); 0 on a quad. */
  readonly depth: number;
  /** One line of the words as the finger sees it (px). */
  readonly linePx: number;
}

/** The pointer fields read (a `PointerEvent` has them). */
export interface TravelPointer {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** What captures and forwards a press (the page's `ar-root`). */
export interface TravelPointerTarget extends EventTarget {
  setPointerCapture(pointerId: number): void;
}

export interface TravellingBoxState {
  readonly surface: string;
  readonly place: TravelPlace;
  readonly why: TravelWhy | null;
  /** Where it wants to be this frame, before the holds. */
  readonly want: TravelPlace;
  /** 0 on the plate, 1 docked, in between flying. */
  readonly u: number;
  /** The fade, 0 to 1. */
  readonly presence: number;
  readonly metrics: PlateMetrics;
  readonly angleDeg: number;
  readonly plateVisible: boolean;
  readonly quadVisible: boolean;
  readonly pointer: boolean;
  /** The plate's corners on screen this frame (px, TL TR BR BL), or null. */
  readonly plateQuad: [number, number][] | null;
  /** The quad's corners as last drawn (px, TL TR BR BL), or null. */
  readonly quad: [number, number][] | null;
  /** The dock (the ghost's resting rectangle, page px), or null. */
  readonly dock: TravelRect | null;
  readonly textureId: number | null;
  readonly quadTextureId: number | null;
  readonly paints: number;
}

/** The travel's own cost since it began (ms). */
export interface TravellingBoxCost {
  readonly frames: number;
  /** Frame gaps over 33, 50 and 100 ms. */
  readonly over33: number;
  readonly over50: number;
  readonly over100: number;
  readonly workAvgMs: number;
  readonly workMaxMs: number;
  readonly paints: number;
  /** Paint plus upload. */
  readonly paintAvgMs: number;
  readonly paintMaxMs: number;
}

export interface TravellingBox {
  /** One frame; a call inside a frame, or in the same ms, adds nothing. */
  frame(): void;
  /** Where a pointer at page (x, y) meets the words, or null. */
  hit(x: number, y: number): TravelHit | null;
  /** Starts a press on the plate or the flying quad; false when the
   *  pointer misses them (the ghost takes its own at the dock). */
  pointerDown(e: TravelPointer, target: TravelPointerTarget): boolean;
  /** A finger is down, or was lifted under `CLOSING_TAP_GRACE_MS` ago:
   *  an XR select now belongs to the words. */
  ownsTap(): boolean;
  pressing(): boolean;
  state(): TravellingBoxState;
  cost(): TravellingBoxCost;
  /** Takes the quad and the texture away and gives the ghost back. */
  stop(): void;
}

const CORNERS = [
  [-0.5, 0.5],
  [0.5, 0.5],
  [-0.5, -0.5],
  [0.5, -0.5],
] as const;

/** The 4 corners and the centre of the unit plate, through `mvp`. */
function projectPlate(
  mvp: Matrix4,
  corners: Float32Array,
  centre: Float32Array,
  v: Vector4,
): void {
  for (let i = 0; i < 4; i++) {
    const [x, y] = CORNERS[i]!;
    v.set(x, y, 0, 1).applyMatrix4(mvp);
    corners.set([v.x, v.y, v.z, v.w], i * 4);
  }
  v.set(0, 0, 0, 1).applyMatrix4(mvp);
  centre.set([v.x, v.y, v.z, v.w]);
}

function onScreenClip(centre: Float32Array, corners: Float32Array): boolean {
  for (let i = 0; i < 4; i++) {
    if (!(corners[i * 4 + 3]! > TRAVEL_MIN_W)) return false;
  }
  const w = centre[3]!;
  return (
    w > TRAVEL_MIN_W &&
    Math.abs(centre[0]! / w) < 1 &&
    Math.abs(centre[1]! / w) < 1
  );
}

function quadHeight(q: readonly (readonly [number, number])[]): number {
  const [tl, tr, br, bl] = q as [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  return (
    (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) +
      Math.hypot(br[0] - tr[0], br[1] - tr[1])) /
    2
  );
}

function setOpacity(material: Material | Material[], opacity: number): void {
  for (const m of Array.isArray(material) ? material : [material]) {
    m.opacity = opacity;
  }
}

export function createTravellingBox(deps: TravellingBoxDeps): TravellingBox {
  const { surface, camera, knobs } = deps;
  const canvas = (
    deps.createCanvas ?? (() => document.createElement("canvas"))
  )();
  const g = canvas.getContext("2d");
  let texture: CanvasTexture | null = null;
  let hung: TravelLayout | null = null;
  let key: string | null = null;

  const pv = new Matrix4();
  const mvp = new Matrix4();
  const v4 = new Vector4();
  const at = new Vector3();
  const normal = new Vector3();
  const eye = new Vector3();
  const frameClip = new Float32Array(16);
  const frameCentre = new Float32Array(4);
  const renderClip = new Float32Array(16);
  const renderCentre = new Float32Array(4);
  const lastClip = new Float32Array(16);
  let haveLast = false;
  const dockNdc = new Float32Array(8);
  let dock: TravelRect | null = null;
  let view: TravelViewRect = deps.viewRect();

  let settle: SettleState = { place: "hidden", pending: null, pendingS: 0 };
  let why: TravelWhy | null = null;
  let want: TravelPlace = "hidden";
  let u = 1;
  let presence = 0;
  let metrics = plateMetrics([], [], 0, 0, 0, 0, 0, 0);
  let angleDeg = 0;
  let plateQuad: [number, number][] | null = null;
  let drawnQuad: [number, number][] | null = null;
  let showPlate = false;
  let showQuad = false;
  let pointerOn = false;

  let lastT: number | null = null;
  let inFrame = false;
  let stopped = false;
  let wasPressing = false;
  let releasedAt: number | null = null;
  let press: { readonly id: number; readonly off: () => void } | null = null;

  const cost = {
    frames: 0,
    over: [0, 0, 0],
    workMs: 0,
    workMaxMs: 0,
    paints: 0,
    paintMs: 0,
    paintMaxMs: 0,
  };

  const quad: TravellingBoxQuad = createTravellingBoxQuad((cam, out) => {
    drawCorners(cam, out);
  });
  deps.scene.add(quad.mesh);
  surface.setGhost(true);

  /** The quad's corners for the render's camera: from the plate as that
   *  camera sees it (or as last seen on screen) to the dock. */
  function drawCorners(cam: Camera, out: Float32Array): void {
    surface.plate.updateWorldMatrix(true, false);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    mvp.multiplyMatrices(pv, surface.plate.matrixWorld);
    projectPlate(mvp, renderClip, renderCentre, v4);
    if (onScreenClip(renderCentre, renderClip)) {
      lastClip.set(renderClip);
      haveLast = true;
    }
    const src = onScreenClip(renderCentre, renderClip)
      ? renderClip
      : haveLast
        ? lastClip
        : null;
    if (src === null) {
      for (let i = 0; i < 4; i++) {
        out.set([dockNdc[i * 2]!, dockNdc[i * 2 + 1]!, 0, 1], i * 4);
      }
    } else {
      flightClip(src, dockNdc, easeInOutCubic(u), out);
    }
    drawnQuad = quadOfClip(out, view.width, view.height);
  }

  /** Sizes the canvas and hangs the plate for a new layout. */
  function hangFor(layout: TravelLayout | null): void {
    if (layout === hung) return;
    hung = layout;
    key = null;
    if (layout === null || !(layout.canvasW > 0 && layout.canvasH > 0)) {
      hung = null;
      surface.unhang();
      return;
    }
    if (
      texture === null ||
      canvas.width !== layout.canvasW ||
      canvas.height !== layout.canvasH
    ) {
      canvas.width = layout.canvasW;
      canvas.height = layout.canvasH;
      texture?.dispose();
      texture = canvasTexture(canvas, { mipmaps: false });
      quad.setMap(texture);
    }
    surface.hang(texture, layout);
  }

  function measure(layout: TravelLayout | null): void {
    surface.plate.updateWorldMatrix(true, false);
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    mvp.multiplyMatrices(pv, surface.plate.matrixWorld);
    projectPlate(mvp, frameClip, frameCentre, v4);
    metrics =
      layout === null
        ? plateMetrics([], [], 0, 0, 0, 0, 0, 0)
        : plateMetrics(
            frameClip,
            frameCentre,
            view.width,
            view.height,
            layout.cssW,
            layout.cssH,
            layout.fontPx,
            layout.lineHeightPx,
          );
    if (metrics.onScreen) {
      lastClip.set(frameClip);
      haveLast = true;
    }
    plateQuad = metrics.valid
      ? quadOfClip(frameClip, view.width, view.height)
      : null;
    normal.set(0, 0, 1).transformDirection(surface.plate.matrixWorld);
    at.setFromMatrixPosition(surface.plate.matrixWorld);
    eye.setFromMatrixPosition(camera.matrixWorld);
    angleDeg = facingAngleDeg(
      [normal.x, normal.z],
      [eye.x - at.x, eye.z - at.z],
    );
  }

  /** The dock in NDC from the ghost's resting rectangle. */
  function measureDock(): void {
    dock = surface.restingRect();
    if (dock === null || !(view.width > 0 && view.height > 0)) {
      dock = null;
      return;
    }
    const nx = (x: number) => ((x - view.left) / view.width) * 2 - 1;
    const ny = (y: number) => 1 - ((y - view.top) / view.height) * 2;
    const x0 = nx(dock.x);
    const x1 = nx(dock.x + dock.w);
    const y0 = ny(dock.y);
    const y1 = ny(dock.y + dock.h);
    dockNdc.set([x0, y0, x1, y0, x0, y1, x1, y1]);
  }

  function paint(): void {
    if (g === null || texture === null || hung === null) return;
    const next = surface.paintKey();
    if (next === key) return;
    const t0 = deps.now();
    surface.paint(g);
    texture.needsUpdate = true;
    deps.upload?.(texture);
    const ms = deps.now() - t0;
    key = next;
    cost.paints += 1;
    cost.paintMs += ms;
    cost.paintMaxMs = Math.max(cost.paintMaxMs, ms);
  }

  function frame(): void {
    if (inFrame || stopped) return;
    inFrame = true;
    try {
      step();
    } finally {
      inFrame = false;
    }
  }

  function step(): void {
    const t = deps.now();
    if (lastT !== null && t === lastT) return;
    const gapMs = lastT === null ? 0 : t - lastT;
    const dtS = Math.min(MAX_STEP_S, Math.max(0, gapMs / 1000));
    lastT = t;
    cost.frames += 1;
    GAPS_MS.forEach((limit, i) => {
      if (gapMs > limit) cost.over[i]! += 1;
    });

    view = deps.viewRect();
    const travelling = surface.travelling();
    const layout = travelling ? surface.layout() : null;
    hangFor(layout);
    measure(layout);
    measureDock();

    const fingerDown = surface.pressing();
    if (wasPressing && !fingerDown) releasedAt = t;
    wasPressing = fingerDown;
    const onPlate = settle.place === "plate" && u === 0;
    const wanted = wantPlace(
      {
        travelling: travelling && layout !== null,
        hideWhy: surface.hideWhy(),
        gates: surface.gates(metrics, knobs),
        metrics,
        angleDeg,
        onPlate,
        slotFree: deps.slotFree?.() ?? true,
        canFold: surface.canFold(),
      },
      knobs,
    );
    want = wanted.place;
    const before = settle.place;
    settle = settlePlace(
      settle,
      want,
      dtS,
      {
        fingerDown,
        sinceReleaseS: releasedAt === null ? Infinity : (t - releasedAt) / 1000,
      },
      knobs,
    );
    if (settle.place !== before) {
      why = wanted.why;
      const appearing = before === "hidden" || presence === 0;
      if (settle.place === "plate" || settle.place === "dock") {
        const target = settle.place === "dock" ? 1 : 0;
        if (appearing) u = target;
      }
      deps.onPlace?.({ at: t, surface: surface.id, place: settle.place, why });
    }

    const reduce = deps.reduceMotion();
    const shown = settle.place === "plate" || settle.place === "dock";
    if (shown) {
      u = stepToward(
        u,
        settle.place === "dock" ? 1 : 0,
        fingerDown ? 0 : dtS,
        knobs.fly,
        reduce,
      );
    }
    presence = stepToward(presence, shown ? 1 : 0, dtS, PRESENCE_S, reduce);

    showPlate = presence > 0 && u === 0 && hung !== null;
    showQuad = presence > 0 && u > 0 && hung !== null && dock !== null;
    surface.plate.visible = showPlate;
    setOpacity(surface.plate.material, presence);
    quad.mesh.visible = showQuad;
    quad.setOpacity(presence);
    if (!showQuad) drawnQuad = null;
    pointerOn = u === 1 && presence > 0;
    surface.setPointer(pointerOn);
    if (showPlate || showQuad) paint();

    const work = deps.now() - t;
    cost.workMs += work;
    cost.workMaxMs = Math.max(cost.workMaxMs, work);
  }

  function hit(x: number, y: number): TravelHit | null {
    if (
      presence <= 0.5 ||
      (settle.place !== "plate" && settle.place !== "dock")
    ) {
      return null;
    }
    if (u === 1 || hung === null) return null;
    const q = u === 0 ? plateQuad : drawnQuad;
    if (q === null || !inQuad(x - view.left, y - view.top, q)) return null;
    const depth =
      u === 0
        ? (frameClip[3]! + frameClip[7]! + frameClip[11]! + frameClip[15]!) / 4
        : 0;
    return {
      quad: u > 0,
      depth,
      linePx: (quadHeight(q) * hung.lineHeightPx) / hung.cssH,
    };
  }

  function endPress(kind: "up" | "cancel", x: number, y: number): void {
    const p = press;
    if (p === null) return;
    press = null;
    p.off();
    surface.endPress(kind, x, y);
    releasedAt = deps.now();
  }

  return {
    frame,
    hit,
    pointerDown(e, target) {
      if (press !== null || stopped) return false;
      const h = hit(e.clientX, e.clientY);
      if (h === null) return false;
      const id = e.pointerId;
      if (
        !surface.beginPress({
          id,
          x: e.clientX,
          y: e.clientY,
          linePx: h.linePx,
        })
      ) {
        return false;
      }
      const onMove = (ev: Event): void => {
        const p = ev as unknown as TravelPointer;
        if (p.pointerId === id) surface.movePress(p.clientX, p.clientY);
      };
      const onEnd = (ev: Event): void => {
        const p = ev as unknown as TravelPointer;
        if (p.pointerId !== id) return;
        endPress(
          ev.type === "pointerup" ? "up" : "cancel",
          p.clientX,
          p.clientY,
        );
      };
      const ends = ["pointerup", "pointercancel", "lostpointercapture"];
      target.addEventListener("pointermove", onMove);
      for (const type of ends) target.addEventListener(type, onEnd);
      press = {
        id,
        off: () => {
          target.removeEventListener("pointermove", onMove);
          for (const type of ends) target.removeEventListener(type, onEnd);
        },
      };
      try {
        target.setPointerCapture(id);
      } catch {
        // A pointer the browser no longer knows: its up still ends it.
      }
      return true;
    },
    ownsTap() {
      return (
        press !== null ||
        surface.pressing() ||
        (releasedAt !== null && deps.now() - releasedAt < CLOSING_TAP_GRACE_MS)
      );
    },
    pressing: () => press !== null || surface.pressing(),
    state() {
      return {
        surface: surface.id,
        place: settle.place,
        why,
        want,
        u,
        presence,
        metrics,
        angleDeg,
        plateVisible: showPlate,
        quadVisible: showQuad,
        pointer: pointerOn,
        plateQuad,
        quad: drawnQuad,
        dock,
        textureId: texture?.id ?? null,
        quadTextureId:
          (quad.mesh.material.uniforms.map?.value as Texture | null)?.id ??
          null,
        paints: cost.paints,
      };
    },
    cost() {
      const n = Math.max(1, cost.frames);
      const p = Math.max(1, cost.paints);
      return {
        frames: cost.frames,
        over33: cost.over[0]!,
        over50: cost.over[1]!,
        over100: cost.over[2]!,
        workAvgMs: cost.workMs / n,
        workMaxMs: cost.workMaxMs,
        paints: cost.paints,
        paintAvgMs: cost.paints === 0 ? 0 : cost.paintMs / p,
        paintMaxMs: cost.paintMaxMs,
      };
    },
    stop() {
      if (stopped) return;
      if (press !== null) endPress("cancel", 0, 0);
      stopped = true;
      quad.dispose();
      surface.unhang();
      surface.plate.visible = true;
      setOpacity(surface.plate.material, 1);
      texture?.dispose();
      texture = null;
      surface.setPointer(true);
      surface.setGhost(false);
    },
  };
}
