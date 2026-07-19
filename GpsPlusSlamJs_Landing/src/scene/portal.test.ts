/**
 * Why these tests matter: the golden-hour restyle (2026-07-19) rebuilt
 * the forest portal from a glowing cyan disc into the reference-image
 * monument — a weathered rectangular moss-covered stone frame that
 * STANDS PERMANENTLY in the forest, with a bright warm "other world"
 * interior that the story timeline opens/closes. This deliberately
 * INVERTS the old "translucent gateway, never a wall" contract: the
 * frame is now a solid, shadow-casting monument; only the INTERIOR
 * (`PORTAL_INTERIOR_NAME`) is the magic part. Brightness must come from
 * the unlit interior gradient (fog-excluded), never from a neon frame.
 * The interior animation stays a pure function of the clock so
 * scrub-path independence holds, and the whole build is deterministic
 * for the shoot-script screenshot review.
 */
import { describe, expect, it } from "vitest";
import {
  Box3,
  Color,
  Vector3,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from "three";
import { getPalette } from "./palette";
import {
  applyPortalPalette,
  buildForestPortal,
  PORTAL_INTERIOR_NAME,
  PORTAL_NAME,
  portalInteriorColorAt,
  updatePortalSpin,
} from "./portal";

const ANCHOR = new Vector3(10, 0, -6);
const FACE = new Vector3(0, 0, 0);

/** Portal built without rotation so bbox axes align with frame axes. */
function axisAlignedPortal() {
  return buildForestPortal(new Vector3(0, 0, 0), new Vector3(0, 0, 10));
}

describe("buildForestPortal — monument frame", () => {
  it("stands permanently: the group is full-scale, only the interior is primed closed", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    expect(portal.name).toBe(PORTAL_NAME);
    // The frame is an ancient monument among the trees — always there.
    expect(portal.scale.x).toBeCloseTo(1);
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME);
    expect(interior).toBeDefined();
    expect(interior!.scale.x).toBeLessThan(0.01); // timeline opens it
  });

  it("is a solid weathered rectangle: ≥4 opaque shadow-casting portal-role members, taller than wide", () => {
    const portal = axisAlignedPortal();
    const frameMeshes: Mesh[] = [];
    portal.traverse((o) => {
      if ((o as Mesh).userData?.paletteRole === "portal") {
        frameMeshes.push(o as Mesh);
      }
    });
    expect(frameMeshes.length).toBeGreaterThanOrEqual(4);
    for (const mesh of frameMeshes) {
      const material = mesh.material as MeshStandardMaterial;
      // Inverts the old gateway pin: a monument, not a glow membrane.
      expect(material.transparent, mesh.name).toBe(false);
      expect(mesh.castShadow, mesh.name).toBe(true);
    }
    const size = new Box3().setFromObject(portal).getSize(new Vector3());
    expect(size.y).toBeGreaterThan(size.x); // standing rectangle
    expect(size.y).toBeGreaterThan(4); // monumental, not door-sized
  });

  it("grows moss: portalMoss-role clumps on the frame", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    let moss = 0;
    portal.traverse((o) => {
      if ((o as Mesh).userData?.paletteRole === "portalMoss") {
        moss += 1;
      }
    });
    expect(moss).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic: two builds produce identical weathering", () => {
    const shape = (p: ReturnType<typeof buildForestPortal>) => {
      const parts: number[] = [];
      p.traverse((o) => {
        parts.push(...o.position.toArray(), ...o.scale.toArray());
      });
      return parts;
    };
    expect(shape(buildForestPortal(ANCHOR, FACE))).toEqual(
      shape(buildForestPortal(ANCHOR, FACE)),
    );
  });

  it("faces the doorway toward the approaching camera", () => {
    const portal = buildForestPortal(
      new Vector3(10, 0, 0),
      new Vector3(0, 0, 0),
    );
    const normal = new Vector3(0, 0, 1).applyEuler(portal.rotation);
    expect(normal.x).toBeLessThan(-0.5); // points back toward the world
  });
});

describe("portal interior — the bright other world", () => {
  it("is an unlit, fog-excluded, vertex-colored gradient (brighter-than-world contract)", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME)!;
    const plane = interior.children.find(
      (c) => (c as Mesh).userData?.portalGradient === true,
    ) as Mesh;
    expect(plane).toBeDefined();
    const material = plane.material as MeshBasicMaterial;
    // Unlit + fog-excluded is WHY the interior reads brighter than the
    // lit, shadowed, fogged world — no bloom dependency.
    expect(material.isMeshBasicMaterial).toBe(true);
    expect(material.fog).toBe(false);
    expect(material.vertexColors).toBe(true);
  });

  it("paints the gradient from the palette's portalInterior block on applyPortalPalette", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    const dusk = getPalette("dusk");
    applyPortalPalette(portal, dusk);
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME)!;
    const plane = interior.children.find(
      (c) => (c as Mesh).userData?.portalGradient === true,
    ) as Mesh;
    const colors = plane.geometry.getAttribute("color");
    expect(colors).toBeDefined();
    // Analytic endpoints (à la domeGradientColorAt): 0 = bottom horizon
    // warmth, 1 = top turquoise sky.
    expect(portalInteriorColorAt(0, dusk).getHex()).toBe(
      new Color(dusk.portalInterior.bottom).getHex(),
    );
    expect(portalInteriorColorAt(1, dusk).getHex()).toBe(
      new Color(dusk.portalInterior.top).getHex(),
    );
    // The plane's first vertex row is the TOP of the plane geometry.
    const top = portalInteriorColorAt(1, dusk);
    expect(colors.getX(0)).toBeCloseTo(top.r, 5);
    expect(colors.getY(0)).toBeCloseTo(top.g, 5);
    expect(colors.getZ(0)).toBeCloseTo(top.b, 5);
    const last = colors.count - 1;
    const bottom = portalInteriorColorAt(0, dusk);
    expect(colors.getX(last)).toBeCloseTo(bottom.r, 5);
    expect(colors.getZ(last)).toBeCloseTo(bottom.b, 5);
  });

  it("tints the interior cloud wisps with the palette's clouds color", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    const dusk = getPalette("dusk");
    applyPortalPalette(portal, dusk);
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME)!;
    const wisps = interior.children.filter(
      (c) => c.userData.drift !== undefined,
    );
    expect(wisps.length).toBeGreaterThanOrEqual(2);
    for (const wisp of wisps) {
      const material = (wisp as Mesh).material as MeshBasicMaterial;
      expect(material.color.getHex()).toBe(dusk.portalInterior.clouds);
      expect(material.fog).toBe(false);
    }
  });

  it("re-applying another palette fully restores colors (no sticky state)", () => {
    const portal = buildForestPortal(ANCHOR, FACE);
    applyPortalPalette(portal, getPalette("neon"));
    applyPortalPalette(portal, getPalette("dusk"));
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME)!;
    const plane = interior.children.find(
      (c) => (c as Mesh).userData?.portalGradient === true,
    ) as Mesh;
    const colors = plane.geometry.getAttribute("color");
    const top = portalInteriorColorAt(1, getPalette("dusk"));
    expect(colors.getX(0)).toBeCloseTo(top.r, 5);
  });
});

describe("updatePortalSpin — clock-pure interior life", () => {
  it("breathes the gradient plane and drifts the wisps as a pure function of the clock", () => {
    const a = buildForestPortal(ANCHOR, FACE);
    const b = buildForestPortal(ANCHOR, FACE);
    // Different call histories, same final time → identical pose.
    updatePortalSpin(a, 999);
    updatePortalSpin(a, 4000);
    updatePortalSpin(a, 4000);
    updatePortalSpin(b, 4000);
    const pose = (p: typeof a) => {
      const parts: number[] = [];
      p.getObjectByName(PORTAL_INTERIOR_NAME)!.traverse((o) => {
        parts.push(...o.position.toArray(), ...o.scale.toArray());
      });
      return parts;
    };
    expect(pose(a)).toEqual(pose(b));
  });

  it("keeps the breathing gentle and NEVER touches the interior group's own scale", () => {
    // The story timeline owns the interior group scale (open/close pop);
    // the breathing lives on the plane below it. If this update ever
    // scaled the group, a scrub-closed portal would visibly reopen.
    const portal = buildForestPortal(ANCHOR, FACE);
    const interior = portal.getObjectByName(PORTAL_INTERIOR_NAME)!;
    const plane = interior.children.find(
      (c) => (c as Mesh).userData?.portalGradient === true,
    )!;
    const groupScale = interior.scale.x;
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t <= 8000; t += 100) {
      updatePortalSpin(portal, t);
      expect(interior.scale.x).toBe(groupScale); // untouched
      min = Math.min(min, plane.scale.x);
      max = Math.max(max, plane.scale.x);
    }
    expect(min).toBeGreaterThan(0.96);
    expect(max).toBeLessThan(1.04);
    expect(max - min).toBeGreaterThan(0.01); // it does visibly breathe
  });
});
