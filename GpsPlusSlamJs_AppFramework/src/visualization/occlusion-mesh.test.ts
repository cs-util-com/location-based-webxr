/**
 * OcclusionMesh — unit tests.
 *
 * Why this test matters:
 * OcclusionMesh is the THREE adapter that turns the pure `meshOccupiedCells`
 * output into a depth-only occluder Mesh parented under `arWorldGroup`. These
 * tests pin the things that make it an *occluder* and not a visible mesh: the
 * material writes depth but not color, the node carries the WEBXR_TO_NUE basis
 * (so it rides alignment like the cubes), `update` rebuilds geometry from a
 * snapshot, `clear` empties it, and `dispose` detaches + frees. The geometry
 * counts come straight from the mesher's proven invariants.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d';
import type { Vector3 } from 'gps-plus-slam-js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis';
import { meshOccupiedCells } from '../ar/occupancy-mesher';
import {
  OcclusionMesh,
  OCCLUDER_DEPTH_SHADE,
  buildOccluderDepthShadeSnippet,
  occluderDepthFade,
  occluderFresnelRim,
} from './occlusion-mesh';

function findMesh(parent: THREE.Object3D): THREE.Mesh | undefined {
  return parent.children.find((c) => c instanceof THREE.Mesh) as
    | THREE.Mesh
    | undefined;
}

function meshes(parent: THREE.Object3D): THREE.Mesh[] {
  return parent.children.filter((c) => c instanceof THREE.Mesh) as THREE.Mesh[];
}

/** The invisible depth-only occluder mesh (colorWrite off). */
function occluderMesh(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find(
    (m) => (m.material as THREE.Material).colorWrite === false
  );
}

/** The visible matcap debug skin, if present. */
function debugSkin(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find(
    (m) => m.material instanceof THREE.MeshMatcapMaterial
  );
}

/** The shaded (matcap-based) debug skin, located by its stable node name. */
function shadedSkin(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find((m) => m.name === 'occupancy-occluder-debug');
}

/** The wireframe debug skin, located by its stable node name. */
function wireframeSkin(parent: THREE.Object3D): THREE.Mesh | undefined {
  return meshes(parent).find(
    (m) => m.name === 'occupancy-occluder-debug-wireframe'
  );
}

/**
 * Assert the invisible depth-only occluder is untouched — the occlusion
 * invariant every debug style must preserve: same mesh, same material flags,
 * same renderOrder, and the SAME geometry object (the skins share it, they
 * never replace it).
 */
function expectOccluderUntouched(
  parent: THREE.Object3D,
  geometryBefore: THREE.BufferGeometry
): void {
  const depthMesh = occluderMesh(parent);
  expect(depthMesh).toBeDefined();
  const material = depthMesh!.material as THREE.Material;
  expect(material.colorWrite).toBe(false);
  expect(material.depthWrite).toBe(true);
  expect(depthMesh!.renderOrder).toBeLessThan(0);
  expect(depthMesh!.geometry).toBe(geometryBefore);
}

describe('OcclusionMesh', () => {
  it('attaches a depth-only mesh under the injected node with the NUE basis', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    const mesh = findMesh(parent);
    expect(mesh).toBeDefined();
    const material = mesh!.material as THREE.MeshBasicMaterial;
    // Invisible depth-writer: this is what makes it occlude rather than show.
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    // Drawn before virtual content (renderOrder ≥ 0).
    expect(mesh!.renderOrder).toBeLessThan(0);
    // Carries the raw-WebXR → NUE basis change as its local matrix.
    expect(mesh!.matrixAutoUpdate).toBe(false);
    expect(mesh!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);
    occluder.dispose();
  });

  it('exposes the underlying mesh via getMesh() for pointer raycasting', () => {
    // The Part-B pointer-picking layer needs a handle to the real occluder mesh;
    // getMesh() must return the very object attached to the scene graph.
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    expect(occluder.getMesh()).toBe(findMesh(parent));
    occluder.dispose();
  });

  it('setVisible toggles the depth mesh AND active debug skins', () => {
    // A hidden occluder must stop writing depth so co-located cubes are not
    // occluded by it (the physics-demo "Show Mesh + Cubes shows nothing" bug).
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.setDebugStyle('depth-shaded-wireframe'); // adds visible skins
    const depthMesh = occluder.getMesh();
    const skins = parent.children.filter((c) => c !== depthMesh);
    expect(skins.length).toBeGreaterThan(0);
    expect(depthMesh.visible).toBe(true);

    occluder.setVisible(false);
    expect(depthMesh.visible).toBe(false);
    expect(skins.every((s) => !s.visible)).toBe(true);

    occluder.setVisible(true);
    expect(depthMesh.visible).toBe(true);
    expect(skins.every((s) => s.visible)).toBe(true);
    occluder.dispose();
  });

  it('starts empty and meshes a snapshot on update', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    expect(occluder.getTriangleCount()).toBe(0);

    // Single isolated voxel → 6 faces → 12 triangles (greedy can't merge one).
    occluder.update([[0, 0, 0]], 0.15);
    expect(occluder.getTriangleCount()).toBe(12);
    expect(occluder.getAabbs()).toHaveLength(1);
    occluder.dispose();
  });

  it('greedy-merges a flat slab (default greedy=true) to fewer triangles', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) cells.push([x, y, 0]);

    const greedy = new OcclusionMesh(new THREE.Group());
    greedy.update(cells, 0.15);
    const perFace = new OcclusionMesh(new THREE.Group(), { greedy: false });
    perFace.update(cells, 0.15);

    // 5×5×1 slab: greedy → 6 quads (12 tris); per-face → 70 quads (140 tris).
    expect(greedy.getTriangleCount()).toBe(12);
    expect(perFace.getTriangleCount()).toBe(140);
    // AABB list is unaffected by greedy — one box per cell either way.
    expect(greedy.getAabbs()).toHaveLength(25);
    expect(perFace.getAabbs()).toHaveLength(25);
    greedy.dispose();
    perFace.dispose();
  });

  it('mode "smooth" builds the surface-nets sheet and consumes getCellPoint (additive opt-in)', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) cells.push([x, y, 0]);
    const occ = new Set(cells.map((c) => `${c[0]},${c[1]},${c[2]}`));
    const getCellPoint = (c: GridCell): Vector3 | null =>
      occ.has(`${c[0]},${c[1]},${c[2]}`)
        ? [c[0] * 0.15 + 0.03, c[1] * 0.15 - 0.02, c[2] * 0.15 + 0.01]
        : null;

    const smooth = new OcclusionMesh(new THREE.Group(), { mode: 'smooth' });
    smooth.update(cells, 0.15, getCellPoint);

    // 5×5 single-thick sheet, dual-contouring surface nets: one quad per
    // occupied↔empty crossing (top 25 + bottom 25 + 20 perimeter sides) = 70
    // quads = 140 triangles — full coverage, like the cubes, not the 12-tri
    // greedy box of the same input.
    expect(smooth.getTriangleCount()).toBe(140);
    // AABB list is mode-independent — one box per cell.
    expect(smooth.getAabbs()).toHaveLength(25);
    // Distinct from the default (greedy) occluder output for the same input
    // (centroid consumption itself is proven in occupancy-mesher.smooth.test).
    const greedy = new OcclusionMesh(new THREE.Group());
    greedy.update(cells, 0.15);
    expect(smooth.getTriangleCount()).not.toBe(greedy.getTriangleCount());

    smooth.dispose();
    greedy.dispose();
  });

  it('applyMeshData swaps in precomputed geometry (the Web Worker offload path)', () => {
    const cells: GridCell[] = [];
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++) cells.push([x, 0, z]);
    // Precompute geometry the way the worker would (a plain per-face mesh).
    const { positions, indices } = meshOccupiedCells(cells, 0.15);

    const occluder = new OcclusionMesh(new THREE.Group());
    occluder.applyMeshData(positions, indices);

    // Geometry is applied → triangle count matches the precomputed buffer…
    expect(occluder.getTriangleCount()).toBe(indices.length / 3);
    // …and equals what a synchronous update() of the same cells would produce.
    const sync = new OcclusionMesh(new THREE.Group(), { greedy: false });
    sync.update(cells, 0.15);
    expect(occluder.getTriangleCount()).toBe(sync.getTriangleCount());
    // The worker path does not populate the AABB physics hook (documented).
    expect(occluder.getAabbs()).toHaveLength(0);

    occluder.applyMeshData(new Float32Array(0), new Uint32Array(0));
    expect(occluder.getTriangleCount()).toBe(0);

    occluder.dispose();
    sync.dispose();
  });

  it('clear() empties the geometry but keeps the node attached', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.clear();
    expect(occluder.getTriangleCount()).toBe(0);
    expect(occluder.getAabbs()).toHaveLength(0);
    expect(findMesh(parent)).toBeDefined(); // still in scene
    occluder.dispose();
  });

  it('dispose() removes the mesh and is idempotent', () => {
    const parent = new THREE.Group();
    const occluder = new OcclusionMesh(parent);
    occluder.update([[0, 0, 0]], 0.15);
    occluder.dispose();
    expect(findMesh(parent)).toBeUndefined();
    // No-op after dispose (no throw, no re-mesh).
    occluder.update([[1, 1, 1]], 0.15);
    expect(() => occluder.dispose()).not.toThrow();
  });

  /**
   * Debug styles (2026-07-02 debug-viz-styles plan): `setDebugStyle` composes a
   * small set of additive skins per style — matcap, depth-shaded (matcap-based
   * material with distance fade + fresnel rim), and a triangle wireframe. Every
   * style must preserve the occlusion invariant: the invisible depth-only mesh
   * (colorWrite:false / depthWrite:true / renderOrder −1) is never modified, so
   * occlusion is identical no matter which debug skin is showing. Normals are
   * only computed for the matcap-based styles — a pure wireframe (like 'off')
   * keeps the remesh path cheap.
   */
  describe('setDebugStyle', () => {
    it("'matcap' adds only the shaded matcap skin; depth mesh untouched", () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      const geometryBefore = occluderMesh(parent)!.geometry;

      occluder.setDebugStyle('matcap');

      const skin = shadedSkin(parent);
      expect(skin).toBeDefined();
      expect(wireframeSkin(parent)).toBeUndefined();
      const mat = skin!.material as THREE.MeshMatcapMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshMatcapMaterial);
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeLessThan(1);
      expect(mat.depthWrite).toBe(false);
      expect(skin!.geometry).toBe(geometryBefore); // shared, not copied
      expect(skin!.geometry.getAttribute('normal')).toBeTruthy();
      expectOccluderUntouched(parent, geometryBefore);
      occluder.dispose();
    });

    it("'wireframe' adds only the line skin and computes no normals", () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.setDebugStyle('wireframe'); // set BEFORE meshing
      occluder.update([[0, 0, 0]], 0.15);
      const geometryBefore = occluderMesh(parent)!.geometry;

      const wire = wireframeSkin(parent);
      expect(wire).toBeDefined();
      expect(shadedSkin(parent)).toBeUndefined();
      const mat = wire!.material as THREE.MeshBasicMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
      expect(mat.wireframe).toBe(true);
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeLessThan(1);
      expect(mat.depthWrite).toBe(false);
      // Drawn AFTER the shaded skin (renderOrder 0) so lines overlay the surface.
      expect(wire!.renderOrder).toBe(1);
      // Same raw-WebXR → NUE basis as the occluder so it overlays exactly.
      expect(wire!.matrixAutoUpdate).toBe(false);
      expect(wire!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);
      expect(wire!.geometry).toBe(geometryBefore); // shared, not copied
      // Wireframe needs no lighting — the remesh path must stay normal-free.
      expect(wire!.geometry.getAttribute('normal')).toBeUndefined();
      expectOccluderUntouched(parent, geometryBefore);
      occluder.dispose();
    });

    it("'depth-shaded' uses a distinct matcap-based material (not the plain matcap)", () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);

      occluder.setDebugStyle('matcap');
      const matcapMaterial = shadedSkin(parent)!.material;
      occluder.setDebugStyle('depth-shaded');

      const skin = shadedSkin(parent);
      expect(skin).toBeDefined();
      expect(wireframeSkin(parent)).toBeUndefined();
      expect(skin!.material).toBeInstanceOf(THREE.MeshMatcapMaterial);
      expect(skin!.material).not.toBe(matcapMaterial);
      expect(skin!.geometry.getAttribute('normal')).toBeTruthy();
      occluder.dispose();
    });

    it("'depth-shaded-wireframe' composes both skins over the untouched occluder", () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      const geometryBefore = occluderMesh(parent)!.geometry;

      occluder.setDebugStyle('depth-shaded-wireframe');

      expect(shadedSkin(parent)).toBeDefined();
      expect(wireframeSkin(parent)).toBeDefined();
      expect(shadedSkin(parent)!.geometry).toBe(geometryBefore);
      expect(wireframeSkin(parent)!.geometry).toBe(geometryBefore);
      expect(geometryBefore.getAttribute('normal')).toBeTruthy();
      expectOccluderUntouched(parent, geometryBefore);
      occluder.dispose();
    });

    it("'off' removes every skin and is the construction default", () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      expect(meshes(parent)).toHaveLength(1); // default: depth-only mesh alone

      occluder.setDebugStyle('depth-shaded-wireframe');
      expect(meshes(parent)).toHaveLength(3);
      occluder.setDebugStyle('off');
      expect(meshes(parent)).toHaveLength(1);
      expect(occluderMesh(parent)).toBeDefined();
      occluder.dispose();
    });

    it('style switches are idempotent (no duplicate skins)', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);

      occluder.setDebugStyle('depth-shaded-wireframe');
      occluder.setDebugStyle('depth-shaded-wireframe');
      expect(meshes(parent)).toHaveLength(3);
      // Switching between shaded styles reuses the single shaded skin node.
      occluder.setDebugStyle('matcap');
      occluder.setDebugStyle('depth-shaded');
      expect(meshes(parent)).toHaveLength(2);
      occluder.dispose();
    });

    it('keeps all active skins in sync across update, applyMeshData and clear', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.setDebugStyle('depth-shaded-wireframe');

      // Sync path (update → swapGeometry).
      occluder.update([[0, 0, 0]], 0.15);
      let geometry = occluderMesh(parent)!.geometry;
      expect(shadedSkin(parent)!.geometry).toBe(geometry);
      expect(wireframeSkin(parent)!.geometry).toBe(geometry);
      expect(geometry.getAttribute('normal')).toBeTruthy();

      // Worker path (applyMeshData → swapGeometry) — same skins, new geometry.
      const { positions, indices } = meshOccupiedCells([[1, 0, 0]], 0.15, {
        mode: 'greedy',
      });
      occluder.applyMeshData(positions, indices);
      geometry = occluderMesh(parent)!.geometry;
      expect(shadedSkin(parent)!.geometry).toBe(geometry);
      expect(wireframeSkin(parent)!.geometry).toBe(geometry);
      expect(geometry.getAttribute('normal')).toBeTruthy();

      // clear() — skins must rebind to the new empty geometry too.
      occluder.clear();
      geometry = occluderMesh(parent)!.geometry;
      expect(shadedSkin(parent)!.geometry).toBe(geometry);
      expect(wireframeSkin(parent)!.geometry).toBe(geometry);
      expect(geometry.getIndex()?.count ?? 0).toBe(0);
      occluder.dispose();
    });

    it('dispose removes all skins, disposes their materials, and later calls are no-ops', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugStyle('depth-shaded-wireframe');

      const shadedMaterial = shadedSkin(parent)!.material as THREE.Material;
      const wireMaterial = wireframeSkin(parent)!.material as THREE.Material;
      let disposedCount = 0;
      shadedMaterial.addEventListener('dispose', () => disposedCount++);
      wireMaterial.addEventListener('dispose', () => disposedCount++);

      occluder.dispose();
      expect(parent.children).toHaveLength(0);
      expect(disposedCount).toBe(2);
      expect(() => occluder.setDebugStyle('matcap')).not.toThrow();
      expect(parent.children).toHaveLength(0);
    });
  });

  /**
   * Depth-shaded material (2026-07-02 debug-viz-styles plan): the matcap
   * material extended via onBeforeCompile with a camera-distance fade (near =
   * bright cyan, far = dark desaturated blue) and a white fresnel rim on
   * silhouettes, so overlapping mesh layers read as separate shells. The GLSL
   * cannot run headless, so these tests pin (a) the exact injected snippet and
   * its placement, and (b) the curve MATH via the exported pure TS mirrors of
   * the fade and rim (the `buildFullscreenOcclusionShader` GLSL-mirror
   * precedent from the live-occluder work).
   */
  describe('depth-shaded material', () => {
    it('injects the fade+rim snippet before the opaque fragment include', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugStyle('depth-shaded');

      const mat = shadedSkin(parent)!.material as THREE.MeshMatcapMaterial;
      const shader = {
        vertexShader: '',
        fragmentShader:
          'void main() {\n\tvec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;\n\t#include <opaque_fragment>\n}',
        uniforms: {},
      };
      mat.onBeforeCompile(shader as never, null as never);

      const snippet = buildOccluderDepthShadeSnippet();
      expect(shader.fragmentShader).toContain(snippet);
      // Injected BEFORE the output write so it can modify outgoingLight.
      expect(shader.fragmentShader.indexOf(snippet)).toBeLessThan(
        shader.fragmentShader.indexOf('#include <opaque_fragment>')
      );
      // The snippet reads the view-space position + normal the matcap shader
      // provides, and bakes the module constants as GLSL float literals.
      expect(snippet).toContain('vViewPosition');
      expect(snippet).toContain('smoothstep');
      expect(snippet).toContain(OCCLUDER_DEPTH_SHADE.FADE_START_M.toFixed(4));
      expect(snippet).toContain(OCCLUDER_DEPTH_SHADE.FADE_END_M.toFixed(4));
      expect(snippet).toContain(OCCLUDER_DEPTH_SHADE.RIM_POWER.toFixed(4));
      occluder.dispose();
    });

    it("three.js's matcap fragment shader still contains the injection anchor", () => {
      // onBeforeCompile's string replace silently no-ops when the anchor is
      // missing (e.g. a three.js upgrade renames the chunk) — the style would
      // degrade to plain matcap with no error. Pin the anchor against the
      // installed three version so an upgrade fails loudly here instead.
      expect(THREE.ShaderChunk.meshmatcap_frag).toContain(
        '#include <opaque_fragment>'
      );
    });

    it('uses a custom program cache key so three.js does not reuse the plain matcap program', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);

      occluder.setDebugStyle('matcap');
      const plain = shadedSkin(parent)!.material as THREE.MeshMatcapMaterial;
      occluder.setDebugStyle('depth-shaded');
      const shaded = shadedSkin(parent)!.material as THREE.MeshMatcapMaterial;

      expect(shaded.customProgramCacheKey()).not.toBe(
        plain.customProgramCacheKey()
      );
      occluder.dispose();
    });

    it('fade mirror: 1 near, FADE_MIN_BRIGHTNESS far, smooth in between', () => {
      const { FADE_START_M, FADE_END_M, FADE_MIN_BRIGHTNESS } =
        OCCLUDER_DEPTH_SHADE;
      expect(occluderDepthFade(0)).toBe(1);
      expect(occluderDepthFade(FADE_START_M)).toBe(1);
      expect(occluderDepthFade(FADE_END_M)).toBeCloseTo(
        FADE_MIN_BRIGHTNESS,
        10
      );
      expect(occluderDepthFade(FADE_END_M + 100)).toBeCloseTo(
        FADE_MIN_BRIGHTNESS,
        10
      );
      const mid = occluderDepthFade((FADE_START_M + FADE_END_M) / 2);
      expect(mid).toBeGreaterThan(FADE_MIN_BRIGHTNESS);
      expect(mid).toBeLessThan(1);
    });

    it('fade mirror: perceptibility pins for indoor rooms (field finding F1)', () => {
      // Why this test matters: the first field pass (2026-07-03) proved the
      // original constants (fade 1.5 → 10 m) made depth-shaded visually
      // identical to matcap in a normal room — fade was still at 94%
      // brightness at 3 m, so the whole room sat in the "near" band (see
      // 2026-07-02-0800-occluder-debug-viz-styles-followups.md §F1). These pins are
      // the executable form of "must be visibly darker across a room": the
      // fade must engage within arm's reach, bottom out by ~5 m so indoor
      // scenes span the full near→far gradient, and a wall ~3 m away must
      // have lost at least 40% brightness. A future retune that regresses
      // depth-shaded back to matcap-indistinguishable-indoors fails here
      // instead of resurfacing on device.
      expect(OCCLUDER_DEPTH_SHADE.FADE_START_M).toBeLessThanOrEqual(1);
      expect(OCCLUDER_DEPTH_SHADE.FADE_END_M).toBeLessThanOrEqual(5);
      expect(occluderDepthFade(3)).toBeLessThanOrEqual(0.6);
    });

    it('rim mirror: 0 head-on, RIM_STRENGTH at grazing', () => {
      const { RIM_STRENGTH } = OCCLUDER_DEPTH_SHADE;
      expect(occluderFresnelRim(1)).toBe(0); // facing the camera
      expect(occluderFresnelRim(-1)).toBe(0); // back face head-on
      expect(occluderFresnelRim(0)).toBeCloseTo(RIM_STRENGTH, 10); // grazing
      const between = occluderFresnelRim(0.5);
      expect(between).toBeGreaterThan(0);
      expect(between).toBeLessThan(RIM_STRENGTH);
    });
  });

  /**
   * Debug visualization (2026-06-29 testing feedback): when on, a VISIBLE shiny
   * matcap "skin" is added so the operator can judge the meshed surface, while
   * the original invisible depth-only mesh is left untouched — so occlusion is
   * provably unchanged. (A single transparent material would render in three.js's
   * transparent phase after opaque content, which would stop it occluding opaque
   * objects; the additive skin avoids that entirely.)
   *
   * The deprecated boolean `setDebugVisualization` wrapper was removed 2026-07-10
   * (quality-review C-4; it had no production callers) — these tests now pin the
   * equivalent `setDebugStyle('matcap' | 'off')` behaviour directly.
   */
  describe('matcap debug skin via setDebugStyle', () => {
    it('adds a visible semi-transparent matcap skin while keeping the depth-only occluder', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);

      expect(debugSkin(parent)).toBeUndefined();
      occluder.setDebugStyle('matcap');

      // The invisible depth-only occluder is still present and still occludes.
      const depthMesh = occluderMesh(parent);
      expect(depthMesh).toBeDefined();
      expect((depthMesh!.material as THREE.Material).colorWrite).toBe(false);
      expect((depthMesh!.material as THREE.Material).depthWrite).toBe(true);

      // A second, visible matcap mesh now exists: shiny, semi-transparent.
      const skin = debugSkin(parent);
      expect(skin).toBeDefined();
      const mat = skin!.material as THREE.MeshMatcapMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeLessThan(1);
      expect(mat.matcap).toBeTruthy(); // shaded/"shiny", not flat
      // Matcap shading needs normals; the mesher emits none, so debug computes them.
      expect(skin!.geometry.getAttribute('normal')).toBeTruthy();
      // Skin rides the same NUE basis as the occluder so it overlays exactly.
      expect(skin!.matrix.elements).toEqual(WEBXR_TO_NUE.elements);

      occluder.dispose();
    });

    it('removes the skin when turned back off, leaving only the depth-only mesh', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugStyle('matcap');
      expect(debugSkin(parent)).toBeDefined();

      occluder.setDebugStyle('off');
      expect(debugSkin(parent)).toBeUndefined();
      expect(occluderMesh(parent)).toBeDefined();
      occluder.dispose();
    });

    it('keeps the skin geometry + normals in sync across re-mesh', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.setDebugStyle('matcap'); // enabled before any geometry
      occluder.update([[0, 0, 0]], 0.15);

      const skin = debugSkin(parent)!;
      expect(skin.geometry).toBe(occluderMesh(parent)!.geometry); // shared
      expect(skin.geometry.getAttribute('normal')).toBeTruthy();
      occluder.dispose();
    });

    it('clear() rebinds the debug skin to the new empty geometry (no stale skin left on screen)', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugStyle('matcap');

      // clear() (e.g. a store swap) must keep the visible matcap skin in sync
      // with the depth-only mesh — otherwise the skin keeps rendering the old,
      // now-disposed geometry, so a stale debug surface stays on screen after
      // the clear. swapGeometry() already rebinds the skin; clear() must too.
      occluder.clear();

      const skin = debugSkin(parent)!;
      const depth = occluderMesh(parent)!;
      expect(skin.geometry).toBe(depth.geometry); // shared new empty geometry
      expect(skin.geometry.getIndex()?.count ?? 0).toBe(0); // nothing left to draw
      occluder.dispose();
    });

    it('is idempotent and safe after dispose', () => {
      const parent = new THREE.Group();
      const occluder = new OcclusionMesh(parent);
      occluder.update([[0, 0, 0]], 0.15);
      occluder.setDebugStyle('matcap');
      occluder.setDebugStyle('matcap'); // no duplicate skin
      expect(
        meshes(parent).filter(
          (m) => m.material instanceof THREE.MeshMatcapMaterial
        )
      ).toHaveLength(1);

      occluder.dispose();
      expect(debugSkin(parent)).toBeUndefined();
      expect(() => occluder.setDebugStyle('matcap')).not.toThrow();
    });
  });
});
