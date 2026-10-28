/**
 * Why this test matters: the clearance and the relief's update moved out
 * of the globe lab as a pure refactor. The clearance reads the ground at
 * the camera's place in the globe's frame and lifts by exactly what
 * `clearedAltitudeM` asks; the update keeps its order (camera, resolution,
 * exaggeration, tiles) and times an E step only when E changes, since each
 * one re-walks the relief's tile tree.
 */

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  liftAlongRadius,
  reliefClearance,
  updateRelief,
} from "./globe-relief-step.js";

const DEG = Math.PI / 180;

describe("reliefClearance", () => {
  function at(altitudeM: number, groundM: number | null) {
    const camera = new THREE.PerspectiveCamera();
    const group = new THREE.Group();
    group.position.set(-1000, 0, 0);
    group.updateMatrixWorld(true);
    WGS84_ELLIPSOID.getCartographicToPosition(
      46.9 * DEG,
      7.4 * DEG,
      altitudeM,
      camera.position,
    );
    camera.position.x -= 1000;
    const asked: number[][] = [];
    const out = reliefClearance({
      ellipsoid: WGS84_ELLIPSOID,
      group,
      camera,
      sampleGround: (lat, lon) => {
        asked.push([lat / DEG, lon / DEG]);
        return groundM;
      },
      altitudeM,
      clearanceM: 50,
    });
    return { out, asked };
  }

  it("samples the ground at the camera's place in the globe's frame", () => {
    const { out, asked } = at(2000, 500);
    expect(asked[0]![0]).toBeCloseTo(46.9, 9);
    expect(asked[0]![1]).toBeCloseTo(7.4, 9);
    expect(out).toEqual({ groundM: 500, clearedM: 2000, lift: false });
  });

  it("lifts a camera closer to the ground than the clearance", () => {
    const low = at(520, 500).out;
    expect(low.lift).toBe(true);
    expect(low.clearedM).toBeCloseTo(550, 9);
    expect(at(100, null).out).toEqual({
      groundM: null,
      clearedM: 100,
      lift: false,
    });
  });

  it("lifts along the radius", () => {
    const p = liftAlongRadius(new THREE.Vector3(3, 4, 0), 100, 105);
    expect(p.toArray()).toEqual([6, 8, 0]);
  });
});

describe("updateRelief", () => {
  function run(heightScale: number, current: number) {
    const calls: string[] = [];
    const plugin = { heightScale: current };
    const steps: number[][] = [];
    let t = 10;
    updateRelief({
      tiles: {
        setCamera: () => calls.push("camera"),
        setResolution: (_c, x, y) => calls.push(`resolution ${x}x${y}`),
        update: () => calls.push("update"),
      },
      plugin,
      camera: new THREE.PerspectiveCamera(),
      renderer: {
        getDrawingBufferSize: (v) => {
          calls.push("buffer");
          return v.set(640, 480);
        },
      },
      resolution: new THREE.Vector2(),
      heightScale,
      onEStep: (ms, e) => steps.push([ms, e]),
      clock: () => (t += 3),
    });
    return { calls, plugin, steps };
  }

  it("sets the camera and resolution, then updates the tiles", () => {
    const { calls, steps } = run(1, 1);
    expect(calls).toEqual(["camera", "buffer", "resolution 640x480", "update"]);
    expect(steps).toEqual([]);
  });

  it("times an E step only when E changes", () => {
    const { plugin, steps } = run(2, 1);
    expect(plugin.heightScale).toBe(2);
    expect(steps).toEqual([[3, 2]]);
  });
});
