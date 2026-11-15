import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  measureLightReadouts,
  type LightMeasureDeps,
} from "./light-measure.js";
import { litSurfaceLuma, meanChroma } from "./light-readouts.js";

/** Two fixed frames: a grey lit surface, then the same with a coloured grid. */
const WITHOUT = new Uint8Array([120, 118, 110, 255, 30, 60, 200, 255]);
const WITH = new Uint8Array([200, 40, 30, 255, 30, 60, 200, 255]);

/** A transparent grid face and its outlines, as the demo draws them. */
const gridObjects = (): THREE.Object3D[] => [
  new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false }),
  ),
  new THREE.LineSegments(new THREE.BufferGeometry()),
];

/** The AO's exclusion rule in miniature: lines and see-through meshes. */
const hiddenFromAo = (o: THREE.Object3D): boolean => {
  if ((o as THREE.Line).isLine === true) return true;
  if ((o as THREE.Mesh).isMesh !== true) return false;
  const m = (o as THREE.Mesh).material as THREE.Material;
  return m.transparent || !m.depthWrite;
};

/** Deps that count every render, AO pass, readback and frame request. */
function counting(
  grid: (THREE.Object3D | undefined)[],
  options: { withMargin?: boolean; reapplies?: boolean } = {},
) {
  const counts = {
    draws: 0,
    aoRenders: 0,
    aoReapplies: 0,
    reads: 0,
    frames: 0,
  };
  const gridSeen: boolean[] = [];
  const deps: LightMeasureDeps = {
    grid,
    withMargin: options.withMargin ?? true,
    drawScene: () => {
      counts.draws += 1;
      gridSeen.push(grid.some((o) => o?.visible === true));
    },
    ambientOcclusion: {
      render: () => {
        counts.aoRenders += 1;
        return true;
      },
      reapply: () => {
        if (options.reapplies === false) return false;
        counts.aoReapplies += 1;
        return true;
      },
    },
    hiddenFromAo,
    readFrame: () => {
      counts.reads += 1;
      return counts.reads === 1 ? WITHOUT : WITH;
    },
    requestFrame: () => {
      counts.frames += 1;
    },
  };
  return { deps, counts, gridSeen };
}

describe("measureLightReadouts", () => {
  // Why this test matters: on a software rasteriser one measurement was a
  // single main-thread task of about 3 s, followed by a redraw of the same
  // view, which together outran the dialog e2e's wait. The heat grid is left
  // out of the AO's normal pass, so toggling it leaves the AO unchanged: the
  // margin's second read reuses it, and the canvas already holds the view as
  // found afterwards, so no extra frame is drawn. Counting the work pins the
  // cost without a wall-clock test.
  it("measures the margin with two scene renders, one AO, two readbacks and no extra frame", () => {
    const { deps, counts, gridSeen } = counting(gridObjects());
    const result = measureLightReadouts(deps);
    expect(counts).toEqual({
      draws: 2,
      aoRenders: 1,
      aoReapplies: 1,
      reads: 2,
      frames: 0,
    });
    // The grid hidden for the brightness, shown for the margin.
    expect(gridSeen).toEqual([false, true]);
    // The numbers are the readouts' own measures of the two frames.
    expect(result.litLuma).toBe(litSurfaceLuma(WITHOUT));
    expect(result.margin).toBe(meanChroma(WITH) - meanChroma(WITHOUT));
  });

  // Why this test matters: an opaque grid preset writes depth, so the AO's
  // normal pass sees it and the AO differs with the grid shown: reusing it
  // would report a wrong margin silently.
  it("recomputes the AO when the AO's normal pass sees the grid", () => {
    const opaque = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial(),
    );
    const { deps, counts } = counting([opaque]);
    measureLightReadouts(deps);
    expect(counts.aoRenders).toBe(2);
    expect(counts.aoReapplies).toBe(0);
  });

  // Why this test matters: a refused reapply (no AO of this size yet) must
  // still put the AO on the second frame.
  it("renders the AO when a reapply is refused", () => {
    const { deps, counts } = counting(gridObjects(), { reapplies: false });
    measureLightReadouts(deps);
    expect(counts.aoRenders).toBe(2);
  });

  // Why this test matters: the brightness alone leaves the canvas without
  // the grid, so one frame must redraw the view as found.
  it("redraws once after the brightness alone with a grid shown", () => {
    const { deps, counts } = counting(gridObjects(), { withMargin: false });
    const result = measureLightReadouts(deps);
    expect(result.margin).toBeNull();
    expect(counts).toEqual({
      draws: 1,
      aoRenders: 1,
      aoReapplies: 0,
      reads: 1,
      frames: 1,
    });
  });

  // Why this test matters: without a grid the only read is the view as
  // found, so no frame is needed and no margin exists.
  it("measures without a grid in one render and draws no extra frame", () => {
    const hidden = gridObjects();
    for (const o of hidden) o.visible = false;
    const { deps, counts } = counting([undefined, ...hidden]);
    const result = measureLightReadouts(deps);
    expect(result.margin).toBeNull();
    expect(counts.draws).toBe(1);
    expect(counts.frames).toBe(0);
    // An invisible grid object stays invisible.
    expect(hidden.map((o) => o.visible)).toEqual([false, false]);
  });

  // Why this test matters: a render that throws must not leave the grid
  // hidden, nor the canvas holding a frame without it.
  it("restores the grid and redraws when a render throws", () => {
    const grid = gridObjects();
    const { deps, counts } = counting(grid);
    let draws = 0;
    const failing: LightMeasureDeps = {
      ...deps,
      drawScene: () => {
        draws += 1;
        if (draws === 2) throw new Error("context lost");
      },
    };
    expect(() => measureLightReadouts(failing)).toThrow("context lost");
    expect(grid.map((o) => o.visible)).toEqual([true, true]);
    expect(counts.frames).toBe(1);
  });
});
