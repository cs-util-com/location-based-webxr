import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { DESCENT_FALL_S, DESCENT_HOLD_S } from "./ar-descent.js";
import {
  createArEntryVeil,
  ENTRY_VEIL_COLOUR,
  ENTRY_VEIL_RADIUS_M,
  entryVeilAlpha,
} from "./ar-entry-veil.js";
import { RENDER_ORDER } from "./layer-order.js";

/**
 * Tests for the AR entry veil (J1, DEC-J1..DEC-J4).
 *
 * **Why these tests matter, and why they are not the same tests the entry
 * ground had.** This module puts a screen-filling, initially OPAQUE surface
 * between the camera feed and the city. Two failures matter and they pull in
 * opposite directions:
 *
 * - **A veil that outlives the entry is a lid over the passthrough** — the worst
 *   outcome available here. Every degenerate input therefore resolves to "no
 *   veil", never to an opaque one.
 * - **A veil that never appears is the defect this module exists to fix.**
 *   `renderer.setClearAlpha` was the previous mechanism and is provably dead
 *   inside an `immersive-ar` session: three's `WebGLBackground.render()` reads
 *   `xr.getEnvironmentBlendMode()` AFTER applying our clear and overwrites it to
 *   `(0,0,0,0)` for `alpha-blend`, i.e. every phone.
 *
 * **NONE of this proves the veil is visible on a device**, because no gate here
 * opens an XR session. What these tests pin is everything that CAN be pinned
 * without one: the curve, the material contract, and the disposal paths.
 */

const START_M = 60;
const LANDED_S = DESCENT_HOLD_S + DESCENT_FALL_S;

describe("entryVeilAlpha", () => {
  it("is fully opaque while the entry holds, so the camera is hidden before the fall", () => {
    expect(entryVeilAlpha({ elapsedS: 0, startM: START_M })).toBeCloseTo(1, 5);
    expect(
      entryVeilAlpha({ elapsedS: DESCENT_HOLD_S, startM: START_M }),
    ).toBeCloseTo(1, 5);
  });

  it("reaches EXACTLY zero on landing, and stays there", () => {
    // Not "close to zero". A veil at 0.01 is still a wash over the camera and
    // would never be reported as a fade bug — only as "AR looks murky", which
    // is exactly the class of complaint that takes three sessions to diagnose.
    expect(entryVeilAlpha({ elapsedS: LANDED_S, startM: START_M })).toBe(0);
    expect(entryVeilAlpha({ elapsedS: LANDED_S + 600, startM: START_M })).toBe(
      0,
    );
  });

  it("shows NO veil when there is no descent at all", () => {
    // Entering from a ground-level 3D view has nothing to fall from, so there
    // is no transition to hide — and a veil with no fade behind it is a lid.
    // Every degenerate input lands on this side, which is the safe one.
    for (const startM of [
      0,
      -10,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(entryVeilAlpha({ elapsedS: 0, startM })).toBe(0);
    }
    expect(entryVeilAlpha({ elapsedS: Number.NaN, startM: START_M })).toBe(0);
  });

  it("fades monotonically, never darkening again part-way through", () => {
    // A veil that comes BACK mid-descent reads as a rendering fault rather than
    // as a transition, and it is the one artefact a user cannot explain away.
    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= LANDED_S; t += 0.05) {
      const value = entryVeilAlpha({ elapsedS: t, startM: START_M });
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});

describe("createArEntryVeil", () => {
  const materialOf = (veil: ReturnType<typeof createArEntryVeil>) =>
    veil.mesh.material as THREE.MeshBasicMaterial;

  it("is an inside-out sphere large enough to sit the camera inside (DEC-J2)", () => {
    const veil = createArEntryVeil();
    const geometry = veil.mesh.geometry as THREE.SphereGeometry;

    // BACKSIDE, because the camera is INSIDE it. A front-sided sphere is
    // invisible from within, which would look exactly like the bug this module
    // replaces — a veil that never appears.
    expect(materialOf(veil).side).toBe(THREE.BackSide);
    expect(geometry.parameters.radius).toBe(ENTRY_VEIL_RADIUS_M);
    // Clear of the AR camera's 0.5 m near plane by a wide margin and far inside
    // its 1000 m far plane, so it can be neither clipped through nor culled.
    expect(ENTRY_VEIL_RADIUS_M).toBeGreaterThan(5);
    expect(ENTRY_VEIL_RADIUS_M).toBeLessThan(500);

    veil.dispose();
  });

  it("draws before every layer the demo orders, and cannot be depth-rejected", () => {
    // THE ORDERING ARGUMENT, stated as an assertion rather than as a comment.
    // The veil is `transparent`, so it is in three's transparent list and draws
    // AFTER the whole opaque list — `renderOrder` only sorts within a list. What
    // it must beat is every transparent thing the demo draws, and the AR city
    // (`ar-building-material.ts`) leaves the default 0.
    //
    // Asserted against `RENDER_ORDER`'s own values rather than the literal, so
    // a new layer added with a negative rung cannot silently sort underneath.
    const veil = createArEntryVeil();
    const lowestLayer = Math.min(0, ...Object.values(RENDER_ORDER));
    expect(veil.mesh.renderOrder).toBeLessThan(lowestLayer);

    // `depthTest: false` is what makes the veil immune to the depth written by
    // the layers that are NOT swapped for the AR shell — trees, POI plates and
    // ribbons keep their opaque desktop materials, because `setArShellMaterial`
    // only swaps geometry carrying `aHeight01`.
    expect(materialOf(veil).depthTest).toBe(false);
    // A transparent surface that writes depth punches a hole in everything
    // drawn after it, which here would be the whole city.
    expect(materialOf(veil).depthWrite).toBe(false);
    expect(materialOf(veil).transparent).toBe(true);
    // Belt-and-braces rather than required: a 50 m sphere centred on the camera
    // passes all six frustum planes anyway.
    expect(veil.mesh.frustumCulled).toBe(false);

    veil.dispose();
  });

  it("is unlit, unfogged and untonemapped, so it cannot be tinted by the scene", () => {
    // `ar-scene-environment.ts` installs a `THREE.Fog` over 0–1000 m and sets a
    // tone mapping on the renderer. A veil subject to either would drift off the
    // colour it was asked for, and a lit material would additionally depend on
    // the framework's lights being present — the failure mode that module
    // records as "every affected shader silently fails to compile".
    const veil = createArEntryVeil();
    const material = materialOf(veil);

    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(false);
    expect(material.color.getHex()).toBe(ENTRY_VEIL_COLOUR);

    veil.dispose();
  });

  it("fades on opacity ALONE and never touches the colour (DEC-J4)", () => {
    // THE CORRECTED INVARIANT, and the assertion exists because an earlier draft
    // of the plan pinned its opposite. `WebGLState.setBlending` is driven by
    // `material.premultipliedAlpha` — NOT the renderer's context attribute —
    // which `Material` defaults to false, so `NormalBlending` is
    // `(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`. That already
    // yields a premultiplied framebuffer, so scaling the colour too would
    // premultiply TWICE and fade the veil at roughly double speed.
    const veil = createArEntryVeil();
    const material = materialOf(veil);

    expect(material.premultipliedAlpha).toBe(false);

    for (const alpha of [1, 0.75, 0.5, 0.25, 0.01]) {
      veil.setAlpha(alpha);
      expect(material.opacity).toBeCloseTo(alpha, 6);
      expect(material.color.getHex()).toBe(ENTRY_VEIL_COLOUR);
    }

    veil.dispose();
  });

  it("hides the mesh at zero rather than merely making it transparent", () => {
    // A fully transparent mesh is still submitted, sorted and blended every
    // frame, and this one covers the screen.
    const veil = createArEntryVeil();

    veil.setAlpha(0.5);
    expect(veil.mesh.visible).toBe(true);
    veil.setAlpha(0);
    expect(veil.mesh.visible).toBe(false);

    veil.dispose();
  });

  it("treats every unusable alpha as NO veil, never as an opaque one", () => {
    // Three renders a NaN opacity as fully opaque, so failing the other way here
    // produces precisely the lid this module must never leave behind.
    const veil = createArEntryVeil();

    for (const alpha of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      veil.setAlpha(alpha);
      expect(veil.mesh.visible, `alpha ${alpha} left the veil showing`).toBe(
        false,
      );
    }

    veil.dispose();
  });

  it("clamps +Infinity UP, because unlike a NaN it is a real request", () => {
    // Separated from the case above rather than branched inside it: `+Infinity`
    // is the one unusable input that means something coherent — "as opaque as
    // possible" — and collapsing it to zero would uncover the camera in response
    // to a request to hide it.
    const veil = createArEntryVeil();

    veil.setAlpha(Number.POSITIVE_INFINITY);
    expect(materialOf(veil).opacity).toBe(1);
    expect(veil.mesh.visible).toBe(true);

    veil.dispose();
  });

  it("follows a finite camera position, and ignores a broken one", () => {
    // A NaN component would move the veil to an undefined position, which three
    // renders as nothing — i.e. the camera would suddenly reappear mid-entry.
    // Keeping the last good position fails towards "the veil is slightly stale",
    // which is recoverable on the next frame.
    const veil = createArEntryVeil();

    veil.follow(new THREE.Vector3(3, 4, 5));
    expect(veil.mesh.position.toArray()).toEqual([3, 4, 5]);

    veil.follow(new THREE.Vector3(Number.NaN, 4, 5));
    expect(veil.mesh.position.toArray()).toEqual([3, 4, 5]);

    veil.follow(new THREE.Vector3(1, Number.POSITIVE_INFINITY, 2));
    expect(veil.mesh.position.toArray()).toEqual([3, 4, 5]);

    veil.dispose();
  });

  it("detaches AND frees its GPU resources on dispose", () => {
    // Detaching alone leaks the buffers; freeing alone leaves a mesh in the
    // scene referencing a disposed material. A session ended mid-entry is the
    // common case here — someone backing out because the entry looked wrong —
    // so this path runs more often than the landing one.
    const veil = createArEntryVeil();
    const parent = new THREE.Group();
    parent.add(veil.mesh);

    const geometrySpy = vi.spyOn(veil.mesh.geometry, "dispose");
    const materialSpy = vi.spyOn(materialOf(veil), "dispose");

    veil.dispose();

    expect(veil.mesh.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
    expect(geometrySpy).toHaveBeenCalled();
    expect(materialSpy).toHaveBeenCalled();
  });

  it("survives a second dispose, because two call sites both call it", () => {
    // `ar-mode.ts` disposes on landing AND in `release()`, deliberately: a
    // session ended mid-descent never reaches the landing branch. That means a
    // completed entry followed by a normal exit disposes twice.
    const veil = createArEntryVeil();
    veil.dispose();
    expect(() => veil.dispose()).not.toThrow();
  });
});
