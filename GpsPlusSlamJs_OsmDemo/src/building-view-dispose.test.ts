/**
 * `BuildingView` disposes its scene-parented meshes through the framework's
 * shared `disposeObject3D`, not a private copy.
 *
 * WHY THIS TEST EXISTS. The private `disposeMesh` this replaces was the
 * sharpest case in the 2026-08-24 duplicated-helpers review: the shared helper
 * lives in a package `GpsPlusSlamJs_OsmDemo` already depends on, so nothing
 * structural prevented reuse — only not knowing it was there.
 *
 * WHY IT IS NOT A PURE WIRING TEST. The two functions are NOT equivalent, and
 * the swap is only safe because of a precondition nobody had written down:
 * `disposeObject3D` walks every DESCENDANT and disposes each material's `.map`
 * TEXTURE, neither of which the private copy did. On a mesh with children, or
 * one sharing a texture with something that outlives it, the swap would
 * over-dispose — and three.js does not report drawing a freed resource, so the
 * symptom is silent absence, exactly the failure mode `building-view.ts`'s own
 * teardown comments are about. So this file pins the PRECONDITION first and the
 * wiring second.
 *
 * Runtime coverage is possible here and only here: `BuildingView` constructs a
 * `THREE.WebGLRenderer` and cannot be instantiated in the unit suite, but the
 * two meshes it disposes are built from ingredients that CAN be — a cone plus a
 * `MeshStandardMaterial` for the route agent, and `cellFaceMaterial()` for the
 * cell grid. The source-text half then checks that the production file actually
 * routes through the shared helper, which no runtime test could see.
 *
 * @see building-view.ts.md
 * @see ../../GpsPlusSlamJs_AppFramework/src/visualization/three-dispose.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";
import { cellFaceMaterial } from "./cell-materials.js";
import {
  CELL_PRESETS,
  cellPreset,
  DEFAULT_CELL_PRESET,
} from "./cell-presets.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(path.join(HERE, "building-view.ts"), "utf-8");

/** The route agent, built exactly as `BuildingView.makeAgent` builds it. */
function agentLikeMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.8, 10),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0,
    }),
  );
}

/** The cell grid, built exactly as `BuildingView.publishCellMesh` builds it. */
function cellLikeMesh(preset = cellPreset(DEFAULT_CELL_PRESET)): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3),
  );
  return new THREE.Mesh(geometry, cellFaceMaterial(preset));
}

describe("BuildingView disposal preconditions", () => {
  it("disposes no descendants, because neither mesh has any", () => {
    // THE FIRST HALF OF THE PRECONDITION. `disposeObject3D` traverses; the copy
    // it replaces did not. Equivalent only while these stay leaf nodes, so a
    // future edit that parents a label or a halo under either one has to come
    // past this assertion and decide deliberately.
    expect(agentLikeMesh().children).toHaveLength(0);
    expect(cellLikeMesh().children).toHaveLength(0);
  });

  it("carries no texture on any preset, so texture disposal is a no-op", () => {
    // THE SECOND HALF. `disposeObject3D` frees `material.map`. A shared texture
    // freed here would blacken whatever else sampled it, and three reports
    // nothing. Asserted across EVERY preset rather than the default one,
    // because the presets are the axis most likely to grow a texture later.
    expect(agentLikeMesh().material).toMatchObject({ map: null });
    for (const preset of CELL_PRESETS) {
      const material = cellLikeMesh(preset)
        .material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
    }
  });

  it("frees geometry and material of a leaf mesh", () => {
    // The behaviour the private helper provided, asserted of the shared one so
    // the swap is not taken on faith.
    const mesh = agentLikeMesh();
    const geometry = vi.spyOn(mesh.geometry, "dispose");
    const material = vi.spyOn(mesh.material as THREE.Material, "dispose");

    disposeObject3D(mesh);

    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });

  it("frees every material of an array-material mesh", () => {
    // The one case the private helper's docstring called out — "materials may
    // be an array; three does not do this" — kept as a regression because it is
    // the reason that helper was written in the first place.
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    const spies = (mesh.material as THREE.Material[]).map((one) =>
      vi.spyOn(one, "dispose"),
    );

    disposeObject3D(mesh);

    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
});

describe("BuildingView disposal wiring", () => {
  it("defines no private mesh-disposal helper", () => {
    // Source text, because the helper was private and unreachable from a test.
    // Its absence is the whole deliverable of this milestone.
    expect(SOURCE).not.toMatch(/function\s+disposeMesh\s*\(/);
  });

  it("imports the shared helper and uses it at every disposal site", () => {
    expect(SOURCE).toContain(
      'from "gps-plus-slam-app-framework/visualization/three-dispose"',
    );
    // Three sites: the cell-grid rebuild, and the agent and grid in teardown.
    // A count rather than a boolean, so deleting one site fails loudly instead
    // of leaving a leak the gate calls green.
    const uses = SOURCE.match(/\bdisposeObject3D\(/g) ?? [];
    expect(uses).toHaveLength(3);
  });
});
