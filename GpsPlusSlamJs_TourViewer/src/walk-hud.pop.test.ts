import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFrameUpdates,
  runFrameUpdates,
} from "gps-plus-slam-app-framework/ar/frame-loop";
import { clearSessionDisposers } from "gps-plus-slam-app-framework/ar/session-disposers";
import { createWayfindingHud } from "gps-plus-slam-app-framework/visualization/wayfinding-hud";
import type { WayfindingTarget } from "gps-plus-slam-app-framework/visualization/wayfinding-targets";

import { startWalkHuds, WALK_HUD_LOOKS, type WalkHudLook } from "./walk-hud";

/**
 * Why this measurement matters: the walk marks the station it is about in
 * orange and the others in white by running two of the framework's HUDs,
 * so a station that becomes the focus moves from one HUD to the other and
 * is a fresh target there. Whether that "pops" its marker decides whether
 * the framework needs a per-target colour instead (a change every
 * dependent app's gate pays for). This drives the REAL framework HUD,
 * frame by frame, through a focus change and measures what a visitor
 * would see:
 * - frames where the station has no marker, or two (a blink or a double);
 * - how far its marker jumps in the switching frame, against how far it
 *   moves in an ordinary frame, for a phone held still and one turning;
 * - what becomes of the arrival band (the HUD's hide-then-wait-to-return
 *   memory) across the move.
 * Parameters swept: the turn rate (0, 15, 30, 60 degrees a second) and
 * the frame rate (30 and 60 a second); fixed: a portrait phone 390 px
 * wide with a 60 degree vertical view, the HUD plane at 2.5 m, stations
 * 30 m off. Set `WALK_HUD_POP_OUT=<file>` to write the table. The verdict
 * is in `walk-hud.ts.md`.
 */

beforeEach(() => {
  // The HUD's distance labels draw into a canvas; the unit tests run
  // without a DOM, and the label module skips the drawing without one.
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => null }),
  });
});

afterEach(() => {
  clearFrameUpdates();
  clearSessionDisposers();
  vi.unstubAllGlobals();
});

/** A phone in portrait: a 60 degree vertical view, 9:16. */
function phoneCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 9 / 16, 0.1, 1000);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const HUD_DISTANCE = 2.5;
const SCREEN_WIDTH_PX = 390;

/** Pixels per HUD-plane unit across the portrait screen. */
function pxPerUnit(camera: THREE.PerspectiveCamera): number {
  const halfWidth =
    HUD_DISTANCE * Math.tan(((camera.fov / 2) * Math.PI) / 180) * camera.aspect;
  return SCREEN_WIDTH_PX / (2 * halfWidth);
}

/**
 * Two HUDs as the walk starts them, each on its own camera held to the
 * same pose (so each camera's children are one HUD's markers); the first
 * target starts as the focus.
 */
function rig(targets: WayfindingTarget[], fps: number) {
  const cameras: Record<WalkHudLook, THREE.PerspectiveCamera> = {
    focus: phoneCamera(),
    others: phoneCamera(),
  };
  let focus: string | null = targets[0]!.id ?? null;
  const huds = startWalkHuds({
    create: ({ getTargets, look }) =>
      createWayfindingHud({
        camera: cameras[look],
        getTargets,
        distanceMin: 5,
        distanceMax: 7,
        hudDistance: HUD_DISTANCE,
        // The shipped looks: the focus at its 1.25 scale is what is measured.
        ...WALK_HUD_LOOKS[look],
      }),
    targets: () => targets,
    focusId: () => focus,
  });
  expect(huds).not.toBeNull();
  let yawDeg = 0;
  let t = 0;
  function face(deg: number): void {
    yawDeg = deg;
    for (const c of Object.values(cameras)) {
      c.rotation.set(0, (-deg * Math.PI) / 180, 0);
      c.updateMatrixWorld(true);
    }
  }
  /** One frame; what each HUD shows of its one marker. */
  function frame(): Record<
    WalkHudLook,
    { visible: number; at: THREE.Vector3 | null }
  > {
    t += 1 / fps;
    runFrameUpdates(1 / fps, t);
    const read = (camera: THREE.Camera) => {
      const shown = camera.children.filter(
        (c) =>
          c.visible &&
          (c.name === "wayfinding-circle" || c.name === "wayfinding-arrow"),
      );
      return {
        visible: shown.length,
        at: shown[0]?.position.clone() ?? null,
      };
    };
    return { focus: read(cameras.focus), others: read(cameras.others) };
  }
  return {
    frame,
    face,
    turn: (deg: number) => {
      face(yawDeg + deg);
    },
    setFocus(id: string | null) {
      focus = id;
    },
    dispose: () => huds!.dispose(),
    pxPerUnit: pxPerUnit(cameras.focus),
  };
}

function station(id: string, x: number, z: number): WayfindingTarget {
  return {
    id,
    position: new THREE.Vector3(x, 0, z),
    distanceMin: 5,
    distanceMax: 7,
  };
}

interface SwitchMeasure {
  /** Markers per HUD in every frame, before and after the switch. */
  readonly counts: { focus: number; others: number }[];
  /** How far the station's marker moved in the switching frame, px. */
  readonly jumpPx: number;
  /** The largest move of the marker in an ordinary frame, px. */
  readonly ordinaryPx: number;
}

/** A focus change from `a` to `b` while turning `degPerS` at `fps`,
 *  measured on the station `b`'s marker. */
function measureSwitch(degPerS: number, fps: number): SwitchMeasure {
  const r = rig([station("a", 0, -30), station("b", 4, -32)], fps);
  const step = degPerS / fps;
  const settle = fps; // one second to settle the smoothing
  // Turned so the view centres on b in the switching frame: b stays on
  // screen (a circle, the smoothed marker) through the measurement.
  const bearingB = (Math.atan2(4, 32) * 180) / Math.PI;
  r.face(bearingB - (settle + 1) * step);
  const counts: { focus: number; others: number }[] = [];
  let lastB: THREE.Vector3 | null = null;
  let ordinary = 0;
  for (let i = 0; i < settle; i += 1) {
    r.turn(step);
    const f = r.frame();
    counts.push({ focus: f.focus.visible, others: f.others.visible });
    if (i >= settle / 2 && lastB !== null && f.others.at !== null) {
      ordinary = Math.max(ordinary, f.others.at.distanceTo(lastB));
    }
    lastB = f.others.at;
  }
  r.setFocus("b");
  r.turn(step);
  const at = r.frame();
  counts.push({ focus: at.focus.visible, others: at.others.visible });
  const jump =
    at.focus.at === null || lastB === null
      ? Infinity
      : at.focus.at.distanceTo(lastB);
  for (let i = 0; i < settle / 2; i += 1) {
    r.turn(step);
    const f = r.frame();
    counts.push({ focus: f.focus.visible, others: f.others.visible });
  }
  r.dispose();
  return {
    counts,
    jumpPx: jump * r.pxPerUnit,
    ordinaryPx: ordinary * r.pxPerUnit,
  };
}

const TURN_RATES = [0, 15, 30, 60];
const FRAME_RATES = [30, 60];

describe("a focus change between the two HUDs (the pop, measured)", () => {
  it("never blinks nor doubles the station's marker: one marker a frame per HUD, in the switching frame too", () => {
    for (const fps of FRAME_RATES) {
      for (const rate of TURN_RATES) {
        const m = measureSwitch(rate, fps);
        for (const f of m.counts) {
          expect(f, `${String(rate)} deg/s at ${String(fps)} fps`).toEqual({
            focus: 1,
            others: 1,
          });
        }
      }
    }
  });

  it("jumps by the old HUD's smoothing lag in the switching frame: nothing held still, a few frames' motion while turning", () => {
    // Measured (2026-10-22, the table above at both frame rates alike):
    //   held still: 0 px;
    //   15 deg/s: 17.5 px (an ordinary frame 2.7 px at 60 fps);
    //   30 deg/s: 35 px (5.3 px);
    //   60 deg/s: 66 px (9.9 px).
    // The jump is the old HUD's circle catching up: it trails the station
    // by its damping (9 a second, about 0.11 s of the turn) and the new
    // one starts on the station. It happens in the frame the marker turns
    // orange and larger - the change the visitor is meant to see.
    const rows: string[] = [];
    const table = new Map<string, SwitchMeasure>();
    for (const fps of FRAME_RATES) {
      for (const rate of TURN_RATES) {
        const m = measureSwitch(rate, fps);
        table.set(`${String(rate)}@${String(fps)}`, m);
        rows.push(
          `${String(rate)} deg/s at ${String(fps)} fps: jump ${m.jumpPx.toFixed(1)} px, an ordinary frame ${m.ordinaryPx.toFixed(1)} px (${(m.jumpPx / Math.max(m.ordinaryPx, 1e-9)).toFixed(1)} frames' motion)`,
        );
      }
    }
    const out = process.env["WALK_HUD_POP_OUT"];
    if (out !== undefined && out !== "") {
      writeFileSync(out, `${rows.join("\n")}\n`);
    }
    for (const fps of FRAME_RATES) {
      const at = (rate: number) => table.get(`${String(rate)}@${String(fps)}`)!;
      // Held still the new marker starts where the old one stood.
      expect(at(0).jumpPx).toBeLessThan(0.5);
      // Turning, it catches up with the station: a jump that grows with
      // the turn, bounded by the smoothing lag (a handful of frames).
      for (let i = 1; i < TURN_RATES.length; i += 1) {
        const m = at(TURN_RATES[i]!);
        expect(m.jumpPx).toBeGreaterThan(m.ordinaryPx);
        expect(m.jumpPx).toBeGreaterThan(at(TURN_RATES[i - 1]!).jumpPx);
        expect(m.jumpPx).toBeLessThan(10 * m.ordinaryPx);
      }
    }
  });

  it("forgets the arrival band across the move: a station hidden on arrival and still inside its exit band shows again in the other HUD", () => {
    // The HUD hides a station once the visitor is within `distanceMin`
    // and shows it again only past `distanceMax`; a fresh target shows
    // past `distanceMin`. So a station the visitor arrived at (hidden, at
    // 6 m between 5 and 7) would reappear on a focus change. In the walk
    // that state does not occur: inside its found radius a station is
    // found on the same tick and leaves the targets (`station-guide.ts`
    // `hudTargets` lists unfound stations only), and without a judged
    // position there are no targets at all.
    const targets = [station("a", 0, -30), station("b", 0, -4)];
    const r = rig(targets, 60);
    r.setFocus("a");
    r.face(0);
    expect(r.frame().others.visible).toBe(0); // b arrived: hidden at 4 m
    targets[1] = station("b", 0, -6);
    expect(r.frame().others.visible).toBe(0); // inside the band: hidden
    r.setFocus("b");
    expect(r.frame().focus.visible).toBe(1); // a fresh target: shown
    r.dispose();
  });
});
