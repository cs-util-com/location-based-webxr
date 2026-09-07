/**
 * Why these tests matter: the use-case vignettes (round-11) are the
 * destinations of the gallery camera journey — if a vignette drifts
 * inside the walkable world it collides with the story compositions; if
 * the castle ghost writes depth or goes opaque it stops reading as "how
 * it USED to look" and starts occluding the ruin it explains; and after
 * round-10 R10-3, nothing out there may float over the void again.
 */
import { describe, expect, it } from "vitest";
import { Box3, Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import { buildClayWorld, VIGNETTE_ANCHORS, WORLD_NODE } from "./clay-world";
import { buildUseCaseVignettes, VIGNETTE_NODE } from "./use-case-vignettes";

function rolesIn(root: { traverse(cb: (obj: unknown) => void): void }) {
  const counts = new Map<string, number>();
  root.traverse((obj) => {
    const role = (obj as Mesh).userData?.paletteRole as string | undefined;
    if (role) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  });
  return counts;
}

describe("palette roles for the vignettes", () => {
  it("every palette styles tent, ruin and ghost", () => {
    for (const theme of THEME_IDS) {
      const roles = getPalette(theme).roles;
      expect(roles.tent, theme).toBeDefined();
      expect(roles.ruin, theme).toBeDefined();
      expect(roles.ghost, theme).toBeDefined();
    }
  });
});

describe("vignette anchors", () => {
  it("sit well OUTSIDE the walkable world disc, clearly apart from each other", () => {
    for (const anchor of [VIGNETTE_ANCHORS.campus, VIGNETTE_ANCHORS.castle]) {
      expect(new Vector3(anchor.x, 0, anchor.z).length()).toBeGreaterThan(34);
    }
    expect(
      VIGNETTE_ANCHORS.campus.distanceTo(VIGNETTE_ANCHORS.castle),
    ).toBeGreaterThan(15);
  });
});

describe("buildUseCaseVignettes", () => {
  const vignettes = () => buildUseCaseVignettes(VIGNETTE_ANCHORS);

  it("is part of the built world under its WORLD_NODE name", () => {
    const world = buildClayWorld("high");
    expect(world.getObjectByName(WORLD_NODE.vignettes)).toBeDefined();
  });

  it("contains the campus (tents + static AR arrows) and the castle (ruin + ghost)", () => {
    const group = vignettes();
    const campus = group.getObjectByName(VIGNETTE_NODE.campus);
    const castle = group.getObjectByName(VIGNETTE_NODE.castle);
    expect(campus).toBeDefined();
    expect(castle).toBeDefined();
    const campusRoles = rolesIn(campus!);
    expect(campusRoles.get("tent") ?? 0).toBeGreaterThanOrEqual(2);
    // The blue AR arrows reappear here statically (the maintainer's
    // "die blauen Pfeile als 3D-Modelle aufgreift").
    expect(campusRoles.get("arrow") ?? 0).toBeGreaterThanOrEqual(3);
    const castleRoles = rolesIn(castle!);
    expect(castleRoles.get("ruin") ?? 0).toBeGreaterThanOrEqual(3);
    expect(castleRoles.get("ghost") ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("renders the ghost as a translucent overlay that never writes depth", () => {
    const group = vignettes();
    const ghosts: MeshStandardMaterial[] = [];
    group.getObjectByName(VIGNETTE_NODE.ghost)?.traverse((obj) => {
      const material = (obj as Mesh).material as
        MeshStandardMaterial | undefined;
      if (material && (obj as Mesh).isMesh) {
        ghosts.push(material);
      }
    });
    expect(ghosts.length).toBeGreaterThanOrEqual(2);
    for (const material of ghosts) {
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThan(0.1);
      expect(material.opacity).toBeLessThan(0.6);
      expect(material.depthWrite).toBe(false);
    }
  });

  it("spreads the tents apart and routes the arrow trail BETWEEN them (round-13 R13-3)", () => {
    // Round-13 device test: "die blauen Pfeile … sind teilweise innerhalb
    // der Zelte und sieht halt buggy aus" — and the tents themselves
    // stood so close their roof hulls overlapped. Every arrow must keep
    // clear horizontal distance from every tent's widest hull (the roof
    // cone), and the tents must leave a walkable gap between each other.
    const group = vignettes();
    const campus = group.getObjectByName(VIGNETTE_NODE.campus)!;
    campus.updateWorldMatrix(true, true);

    const tents: { center: Vector3; radius: number }[] = [];
    for (const child of campus.children) {
      if (child.name === "tent") {
        const box = new Box3().setFromObject(child);
        const center = box.getCenter(new Vector3());
        // Cones/cylinders are rotationally symmetric, so the box's x
        // half-extent IS the widest hull radius (the roof cone).
        tents.push({ center, radius: (box.max.x - box.min.x) / 2 });
      }
    }
    expect(tents.length).toBeGreaterThanOrEqual(3);

    const arrows: Vector3[] = [];
    campus.traverse((obj) => {
      if ((obj as Mesh).userData?.paletteRole === "arrow") {
        arrows.push(obj.getWorldPosition(new Vector3()));
      }
    });
    expect(arrows.length).toBeGreaterThanOrEqual(3);

    for (const [i, arrow] of arrows.entries()) {
      for (const [j, tent] of tents.entries()) {
        const distance = Math.hypot(
          arrow.x - tent.center.x,
          arrow.z - tent.center.z,
        );
        expect(
          distance,
          `arrow ${i} clips tent ${j} (hull radius ${tent.radius.toFixed(2)})`,
        ).toBeGreaterThan(tent.radius + 0.3);
      }
    }

    // Tents keep a real gap between their hulls ("stehen ein bisschen zu
    // nah beieinander") — wide enough for the trail to read as a path.
    for (let a = 0; a < tents.length; a++) {
      for (let b = a + 1; b < tents.length; b++) {
        const centerDistance = Math.hypot(
          tents[a]!.center.x - tents[b]!.center.x,
          tents[a]!.center.z - tents[b]!.center.z,
        );
        const hullGap = centerDistance - tents[a]!.radius - tents[b]!.radius;
        expect(hullGap, `tents ${a}/${b} too close`).toBeGreaterThan(1.2);
      }
    }
  });

  it("stands each vignette on its own sunken ground disc (nothing floats — the R10-3 lesson)", () => {
    const group = vignettes();
    group.updateWorldMatrix(true, true);
    for (const name of [VIGNETTE_NODE.campus, VIGNETTE_NODE.castle]) {
      const vignette = group.getObjectByName(name);
      const box = new Box3().setFromObject(vignette!);
      expect(box.min.y, `${name} floats`).toBeLessThan(-2);
    }
  });

  it("is deterministic: two builds are identical", () => {
    const a: string[] = [];
    const b: string[] = [];
    vignettes().traverse((obj) =>
      a.push(`${obj.name}:${obj.position.toArray().join(",")}`),
    );
    vignettes().traverse((obj) =>
      b.push(`${obj.name}:${obj.position.toArray().join(",")}`),
    );
    expect(a).toEqual(b);
  });
});
