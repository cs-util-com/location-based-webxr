/**
 * Can the AR content still be SEEN once the environment map is gone?
 *
 * WHY THIS FILE EXISTS — milestone 2's last claim, "materials verified to
 * actually draw". The desktop view lights its `MeshStandardMaterial`s from
 * `scene.environment`: `sky-rig.ts` PMREM-processes the sky and assigns it, and
 * that indirect light is a real part of what the demo looks like. **AR has
 * none** — `ar-scene-environment.ts` clears it deliberately, because the one
 * time this project assigned a raw equirect texture there, every standard
 * material failed to compile and silently stopped drawing for ten work items
 * while the suite stayed green.
 *
 * So AR keeps the materials and removes their indirect light. That is safe for
 * a diffuse material and NOT safe for a metallic one: at `metalness = 1` the
 * diffuse term is zero by definition and the whole surface is whatever the
 * environment reflects, so with no environment it is black. A metallic building
 * would draw perfectly, pass every existing assertion, and be invisible.
 *
 * These are properties of the materials rather than of AR, which is the point:
 * the constraint has to be checked where the materials are AUTHORED, since
 * nobody editing `mesh-layers.ts` for the desktop look is thinking about a mode
 * that removes their environment map.
 *
 * **What this canNOT prove is that pixels appear** — that needs a GL context and
 * ultimately a phone, and §6 of the plan says so. It proves the specific
 * property whose absence would make them not appear.
 *
 * @see ar-scene-environment.ts.md
 */

// Types only: this file inspects materials the demo builds, it never builds
// three.js objects of its own.
import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import { drawMeshLayers } from "./mesh-layers.js";
import { cellFaceMaterial, cellOutlineMaterial } from "./cell-materials.js";
import {
  CELL_PRESETS,
  DEFAULT_CELL_PRESET,
  type CellPreset,
} from "./cell-presets.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** Above this, the diffuse term is small enough for "no environment" to show. */
const MAX_AR_SAFE_METALNESS = 0.2;

/** One triangle, enough for every layer to produce its real material. */
function triangle() {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    triangleCount: 1,
    forcedEars: 0,
  };
}

function oneChunk(): { key: string; mesh: ReturnType<typeof triangle> }[] {
  return [{ key: "0,0", mesh: triangle() }];
}

/**
 * Every mesh layer populated, so the traversal sees every material.
 *
 * Deliberately NOT a subset: a guard that only walked the buildings would pass
 * while a metallic road shipped. The shape mirrors `mesh-layers.test.ts`'s
 * `fullMesh()`, including the fields nothing here reads — that file records why
 * (a `variant: 0` where a string union belonged survived for exactly as long as
 * nothing grouped by it).
 */
function everyLayer(): TransferableMesh {
  return {
    buildings: oneChunk(),
    trees: [
      {
        feature: "node/1",
        position: { x: 10, y: 20 },
        groundHeightM: 53,
        heightM: 8,
        crownDiameterM: 4,
        rotationY: 0.5,
        variant: "unknown",
      },
    ],
    plates: oneChunk(),
    plateCount: 3,
    roads: oneChunk(),
    roadCount: 2,
    regions: [{ medianScore: 4, id: "r1", mesh: triangle() }],
    poi: [
      {
        feature: "node/4242",
        position: { x: 5, y: -7 },
        groundHeightM: 53,
        kind: "amenity=cafe",
        label: "Café Schmitz",
        rotationY: 0,
        scale: 1,
      },
    ],
    volumes: 21,
    parts: 25,
    guessedHeights: 7,
    approximateRoofs: 2,
    barriers: 4,
  } as unknown as TransferableMesh;
}

/**
 * Every material in the AR content set — `SceneContent`'s three members.
 *
 * `building-view-content.test.ts` pins that set as the mesh-layer group plus
 * `cellMesh` plus `cellOutlines`. An earlier version of this guard walked only
 * the first (r508 review), which left out the ONE material carrying an
 * `onBeforeCompile` patch — the surface `cell-materials.ts` names as having
 * taken the whole scene off screen for ten work items.
 */
function arMaterials(): { material: THREE.Material; where: string }[] {
  return [
    ...meshLayerMaterials(),
    // EVERY preset, not just the default: they are reachable by hotkey, so a
    // metallic or envMapped one is shippable without touching a default.
    ...CELL_PRESETS.map((preset) => ({
      material: cellFaceMaterial(preset),
      where: `cell face (${preset.name})`,
    })),
    { material: cellOutlineMaterial(), where: "cell outlines" },
  ];
}

/** Every material reachable from what `drawMeshLayers` hands the scene. */
function meshLayerMaterials(): { material: THREE.Material; where: string }[] {
  const { objects } = drawMeshLayers(everyLayer(), {
    buildings: true,
    trees: true,
    plates: true,
    roads: true,
    poi: true,
    areas: true,
  });
  const found: { material: THREE.Material; where: string }[] = [];
  for (const object of objects) {
    // TRAVERSE rather than read `objects[i].material`: trees are instanced and
    // POI markers are groups of several meshes, so the top-level object is not
    // always the thing carrying a material.
    object.traverse((node) => {
      const material = (node as THREE.Mesh).material;
      if (material === undefined) return;
      for (const single of Array.isArray(material) ? material : [material]) {
        found.push({ material: single, where: node.name || node.type });
      }
    });
  }
  return found;
}

describe("AR content — visible without an environment map", () => {
  it("covers every layer by NAME, so a silent gap is not a passing test", () => {
    // The guard on the guard. Every check below is a `for` over this list, so a
    // short list weakens all of them at once and nothing goes red — which is
    // exactly how the cell materials went uncovered for a round.
    //
    // A COUNT WOULD NOT BE ENOUGH. `> 4` passed while two of the three members
    // of the AR content set were missing entirely. Naming the labels means a
    // layer that stops producing objects fails HERE, with its own name in the
    // diff, rather than quietly leaving the loops with less to check.
    const labels = arMaterials().map((m) => m.where);
    for (const preset of CELL_PRESETS) {
      expect(labels).toContain(`cell face (${preset.name})`);
    }
    expect(labels).toContain("cell outlines");
    // Six mesh-layer materials: buildings, plates, roads, areas, trees, poi.
    // `everyLayer()` gives each exactly one, so anything else means a layer
    // stopped drawing or started drawing twice.
    expect(labels).toHaveLength(6 + CELL_PRESETS.length + 1);
  });

  it("keeps every material diffuse enough to be lit by lights alone", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. `metalness = 1` makes the diffuse term
    // zero, so the surface is only what it reflects — and AR gives it nothing to
    // reflect. The material compiles, draws, and is black.
    for (const { material, where } of arMaterials()) {
      const metalness = (material as THREE.MeshStandardMaterial).metalness;
      if (metalness === undefined) continue; // Basic/Line materials: unlit anyway.
      expect(
        metalness,
        `${where} is too metallic to survive AR's missing environment map`,
      ).toBeLessThanOrEqual(MAX_AR_SAFE_METALNESS);
    }
  });

  it("never carries its own envMap either", () => {
    // `scene.environment` is not the only route. A material-level `envMap`
    // reaches the same CubeUV code path with the same compile failure, and it
    // would bypass `applyArEnvironment` entirely — nothing there can clear it.
    for (const { material, where } of arMaterials()) {
      const envMap = (material as THREE.MeshStandardMaterial).envMap;
      expect(envMap ?? null, `${where} carries its own envMap`).toBeNull();
    }
  });

  it("lets the AR fog reach every material the grid does not opt out of", () => {
    // `material.fog` defaults to true and an opt-out is a per-material veto on
    // the fade. In AR that is not a look preference: fog ends exactly at the far
    // plane, so a material with `fog: false` does not fade — it CLIPS, as a hard
    // edge in mid-air against the real world.
    //
    // THE CELL FACES ARE EXCLUDED, and that is a real exception rather than a
    // convenience: `fog` is a deliberate preset AXIS (§3, DEC-R6-22) and the
    // "prototype" preset sets it false. The next test pins what actually has to
    // hold for it.
    for (const { material, where } of meshLayerMaterials()) {
      // `fog` lives on the fog-aware subclasses rather than on `Material`, so
      // it is read through one of them. `not.toBe(false)` rather than
      // `toBe(true)` on purpose: a material without the property at all is not
      // opting out, and asserting `true` would fail on those for no reason.
      const fog = (material as THREE.MeshStandardMaterial).fog;
      expect(fog, `${where} opts out of the AR fade`).not.toBe(false);
    }
    expect(cellOutlineMaterial().fog).not.toBe(false);
  });
});

describe("AR content — the cell grid's fog axis", () => {
  it("carries each preset's fog flag onto the material", () => {
    // THE LINK, asserted on the material rather than on the config — an earlier
    // version of this file checked `CELL_PRESETS.find(...).fog === true` and
    // called it coverage (r508 review). Hard-coding `fog: false` in
    // `cellFaceMaterial` would have broken the behaviour that test named and
    // left it green, which is the "each part correct, nothing asserts they are
    // connected" shape this milestone's predecessor shipped three times.
    for (const preset of CELL_PRESETS) {
      expect(cellFaceMaterial(preset).fog, preset.name).toBe(preset.fog);
    }
  });

  it("keeps the DEFAULT preset fogged, which is what AR actually gets", () => {
    // The `fog: false` preset ("prototype") is safe today for the reason
    // `cell-presets.ts` records: the grid covers a ~250 m disc, AR's fog starts
    // at 400 m and desktop's at 1584 m, so the flag is a no-op in both. It is
    // reachable only by hotkey.
    //
    // Widening the heat radius past 400 m is a planned change (§6 of the
    // shiny-surfaces plan), and on that day "prototype" becomes a hard clip in
    // AR. The default must not be the one that does it.
    const shipped = CELL_PRESETS.find((p) => p.name === DEFAULT_CELL_PRESET);
    expect(shipped).toBeDefined();
    expect(cellFaceMaterial(shipped as CellPreset).fog).toBe(true);
  });
});
