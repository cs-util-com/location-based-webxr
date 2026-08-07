/**
 * The sky rig's resource bookkeeping (§1, DEC-R6-2).
 *
 * WHY THESE TESTS MATTER, AND WHY THEY ARE NOT ABOUT PIXELS. Nothing here can
 * check what the sky LOOKS like — CI has no GPU and jsdom cannot compile a
 * shader. What it can check is the part that goes wrong silently: every sun
 * change builds a new PMREM render target, and a target that is never released
 * is VRAM abandoned on the GPU. Round 5 shipped exactly this shape of leak (the
 * ground colour attribute, ~1.9 MB per position change) and it was caught by a
 * human reading the diff, not by the suite.
 *
 * A leak has no symptom until the tab dies, which is why it needs a test rather
 * than care. The time-of-day control invites the user to change the sun
 * repeatedly, so the leak would be driven by the exact interaction the feature
 * exists for.
 *
 * The second thing pinned is the ORDER inside `refreshEnvironment`: the new
 * target is generated BEFORE the old one is released, so a throw leaves the
 * scene with its previous environment rather than with none.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { SkyRig, type PmremLike } from "./sky-rig.js";
import { sunAt } from "./sun-position.js";

/** A PMREM generator that allocates nothing and counts everything. */
function fakePmrem(): PmremLike & {
  readonly built: { disposed: boolean }[];
  throwNext: boolean;
} {
  const built: { disposed: boolean }[] = [];
  return {
    built,
    throwNext: false,
    compileEquirectangularShader: vi.fn(),
    fromScene(): { texture: THREE.Texture; dispose(): void } {
      if (this.throwNext) throw new Error("GL context lost");
      const record = { disposed: false };
      built.push(record);
      return {
        texture: new THREE.Texture(),
        dispose: () => {
          record.disposed = true;
        },
      };
    },
    dispose: vi.fn(),
  };
}

function rigWith(pmrem: PmremLike): { rig: SkyRig; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  const rig = new SkyRig({
    // The renderer is only handed to the factory, which ignores it here.
    renderer: {} as unknown as THREE.WebGLRenderer,
    scene,
    pmremFactory: () => pmrem,
  });
  return { rig, scene };
}

describe("SkyRig resource lifetime", () => {
  it("keeps exactly one live environment map however often the sun moves", () => {
    // N sun changes must leave N−1 released targets and one live one. Anything
    // else is a leak that grows with how much the user plays with the control.
    const pmrem = fakePmrem();
    const { rig } = rigWith(pmrem);
    const moves = 6;
    for (let i = 0; i < moves; i++) rig.setSun(sunAt(i / moves));
    expect(pmrem.built).toHaveLength(moves);
    expect(pmrem.built.filter((t) => t.disposed)).toHaveLength(moves - 1);
    expect(rig.releasedTargetCount).toBe(moves - 1);
  });

  it("releases the last one on dispose, leaving nothing live", () => {
    const pmrem = fakePmrem();
    const { rig } = rigWith(pmrem);
    rig.setSun(sunAt(0.5));
    rig.dispose();
    expect(pmrem.built.every((t) => t.disposed)).toBe(true);
  });

  it("clears scene.environment on dispose rather than leaving a dead texture", () => {
    // A disposed texture left assigned is a use-after-free three does not
    // report: it simply stops drawing the materials that sample it, which is
    // this file's own W20 outage wearing a different hat.
    const pmrem = fakePmrem();
    const { rig, scene } = rigWith(pmrem);
    rig.setSun(sunAt(0.5));
    expect(scene.environment).not.toBeNull();
    rig.dispose();
    expect(scene.environment).toBeNull();
  });

  it("keeps the previous environment when regeneration throws", () => {
    // Generated before disposed, deliberately. A scene whose environment is
    // stale still draws; a scene whose environment is null after a mid-flight
    // failure is the one that goes dark.
    const pmrem = fakePmrem();
    const { rig, scene } = rigWith(pmrem);
    rig.setSun(sunAt(0.5));
    const first = scene.environment;
    pmrem.throwNext = true;
    expect(() => rig.setSun(sunAt(0.2))).toThrow(/GL context lost/);
    expect(scene.environment).toBe(first);
    expect(pmrem.built[0]?.disposed).toBe(false);
  });

  it("NEVER puts the sky mesh in the scene", () => {
    // The deviation from §1, pinned so it cannot be "fixed" back. Our far plane
    // is 2400 (tied to TERRAIN_EXTENT_M by far-field.test.ts); a dome large
    // enough to enclose the city is entirely beyond it and would be clipped
    // away, and with `depthWrite: false` that fails silently. The mesh exists
    // only as a source for `fromScene`.
    const pmrem = fakePmrem();
    const { rig, scene } = rigWith(pmrem);
    expect(scene.children).not.toContain(rig.mesh);
    rig.setSun(sunAt(0.5));
    expect(scene.children).not.toContain(rig.mesh);
  });

  it("drives the background and the environment from ONE texture", () => {
    // Two textures would be two skies tuned to match, and they would drift:
    // the lit scene would stop belonging to the visible sky and nobody could
    // say which was wrong.
    const pmrem = fakePmrem();
    const { rig, scene } = rigWith(pmrem);
    rig.setSun(sunAt(0.5));
    expect(scene.background).toBe(scene.environment);
    expect(scene.background).not.toBeNull();
  });

  it("clears the background as well as the environment on dispose", () => {
    const pmrem = fakePmrem();
    const { rig, scene } = rigWith(pmrem);
    rig.setSun(sunAt(0.5));
    rig.dispose();
    expect(scene.background).toBeNull();
  });

  it("returns the SAME direction the light must use", () => {
    // One vector, two consumers. A second derivation would show up as a sun in
    // the sky that disagrees with where the highlights fall — the
    // two-derivations-of-one-thing defect this project keeps removing.
    const pmrem = fakePmrem();
    const { rig } = rigWith(pmrem);
    const angles = sunAt(0.25);
    const direction = rig.setSun(angles);
    expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 9);
  });
});
