/**
 * Why these tests matter: the gizmo is what the creator grabs. Its knob
 * and dots must be drawn where the hit test looks for them (the layout's
 * spots, on the ground there) and at their on-screen size whatever the
 * zoom, a handle under the pointer or held drawn larger, the ring only for
 * an item (a station's own circle is the tour's) and the dots only for a
 * station or a model. A gizmo left showing after the selection is gone
 * would offer handles that edit nothing.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createGizmo } from "./editor3d-gizmo.js";
import { GIZMO, gizmoLayout, type GizmoSubject } from "./gizmo-maths.js";

const PICTURES = {
  dot: new THREE.Texture(),
  knob: new THREE.Texture(),
  move: new THREE.Texture(),
};

const STATION: GizmoSubject = {
  kind: "station",
  centre: { x: 10, y: 500, z: -20 },
  headingDeg: 90,
  radiusM: 25,
  sizeM: null,
};

const PIN: GizmoSubject = {
  kind: "item",
  centre: { x: 0, y: 500, z: 0 },
  headingDeg: 0,
  radiusM: null,
  sizeM: null,
};

/** 0.05 m a pixel at the selection; a sprite of n px is n * 0.002. */
const M_PER_PX = 0.05;
const SPRITE_PER_PX = 0.002;

function frame(subject: GizmoSubject, hovered: "move" | "turn" | "dot" | null) {
  return {
    layout: gizmoLayout(subject, M_PER_PX),
    spritePerPx: SPRITE_PER_PX,
    // The ground rises 1 m per 10 m east.
    groundY: (spot: { x: number; z: number }) => 500 + spot.x / 10,
    hovered,
  };
}

describe("createGizmo", () => {
  it("draws a station's knob, dots and move disc where the layout has them, without a ring", () => {
    const parent = new THREE.Scene();
    const gizmo = createGizmo(parent, PICTURES);
    const layout = frame(STATION, null).layout;
    gizmo.update(frame(STATION, null));
    const { knob, dots, ring, disc, bar } = gizmo.parts;
    expect(knob.visible).toBe(true);
    expect(knob.position.x).toBeCloseTo(layout.knob.x, 9);
    expect(knob.position.z).toBeCloseTo(layout.knob.z, 9);
    // On the ground under it, a little above.
    expect(knob.position.y).toBeGreaterThan(500 + layout.knob.x / 10);
    expect(knob.position.y).toBeLessThan(500 + layout.knob.x / 10 + 0.5);
    expect(knob.scale.x).toBeCloseTo(GIZMO.knobPx * SPRITE_PER_PX, 12);
    expect(dots.filter((d) => d.visible)).toHaveLength(4);
    dots.forEach((d, i) => {
      expect(d.position.x).toBeCloseTo(layout.dots[i]!.x, 9);
      expect(d.position.z).toBeCloseTo(layout.dots[i]!.z, 9);
      expect(d.scale.x).toBeCloseTo(GIZMO.dotPx * SPRITE_PER_PX, 12);
    });
    expect(ring.visible).toBe(false);
    expect(disc.visible).toBe(true);
    expect(disc.scale.x).toBeCloseTo(layout.moveM, 9);
    // The stalk runs from the ring's radius out along the heading (east).
    expect(bar.visible).toBe(true);
    expect(bar.scale.z).toBeCloseTo(layout.bar.lengthM, 9);
    expect(bar.position.x).toBeCloseTo(10 + 25, 9);
  });

  it("draws a pin's ring and no dots, and the handle under the pointer larger", () => {
    const parent = new THREE.Scene();
    const gizmo = createGizmo(parent, PICTURES);
    gizmo.update(frame(PIN, "turn"));
    const { knob, dots, ring } = gizmo.parts;
    expect(ring.visible).toBe(true);
    expect(ring.scale.x).toBeCloseTo(frame(PIN, null).layout.ringM!, 9);
    expect(dots.some((d) => d.visible)).toBe(false);
    expect(knob.scale.x).toBeCloseTo(
      GIZMO.knobPx * SPRITE_PER_PX * GIZMO.hoverScale,
      12,
    );
  });

  it("hides everything without a selection, and leaves the scene when disposed", () => {
    const parent = new THREE.Scene();
    const gizmo = createGizmo(parent, PICTURES);
    gizmo.update(frame(STATION, null));
    gizmo.update(null);
    const { knob, dots, ring, disc, bar } = gizmo.parts;
    for (const part of [knob, ...dots, ring, disc, bar]) {
      expect(part.visible).toBe(false);
    }
    gizmo.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
