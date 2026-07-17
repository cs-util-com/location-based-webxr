/**
 * Persistent occlusion mesh — a depth-only `THREE.Mesh` of the occupancy grid.
 *
 * Wraps the pure {@link meshOccupiedCells} (face-culled voxel surface) into a
 * THREE object that **writes depth but no color** (`colorWrite = false`,
 * `depthWrite = true`), drawn before virtual content (low `renderOrder`) so real
 * geometry the camera saw earlier hides virtual objects placed behind it —
 * including out-of-view surfaces a single-frame live depth occluder cannot
 * remember (2026-06-13-0004-occupancy-mesh-options-plan.md §4; complements the live
 * occluder in 2026-06-14-0009-webxr-depth-occlusion-plan.md).
 *
 * Reusable across consumer apps (AnchorStarter / MinimalExample want occlusion
 * too); the recorder only owns the off-by-default toggle + scene wiring.
 *
 * Coordinate space: the grid cells (and therefore the mesh positions) are **raw
 * WebXR**, but the parent `arWorldGroup` is AR-odometry NUE. The mesh carries
 * the constant `WEBXR_TO_NUE` basis change as its own local matrix — identical
 * to `OccupancyCubesVisualizer` — so it rides the `alignment × WEBXR_TO_NUE`
 * chain. The parent node is injected (no `getArWorldGroup()`) to stay testable.
 *
 * Scope: this is a full-rebuild occluder (re-mesh the whole snapshot on
 * `update`). The chunked dirty-remesh perf layer (plan §7) is a follow-on.
 *
 * @see occlusion-mesh.ts.md for detailed documentation
 */

import * as THREE from 'three';
import type { GridCell } from '../ar/bresenham3d.js';
import {
  meshOccupiedCells,
  type Aabb,
  type MeshMode,
  type MeshOccupiedCellsOptions,
} from '../ar/occupancy-mesher.js';
import { WEBXR_TO_NUE } from '../ar/webxr-nue-basis.js';
import type { Vector3 } from 'gps-plus-slam-js';

/**
 * Debug-visualization style for the **persistent occluder** mesh (2026-07-02
 * debug-viz-styles plan) — which visible debug skin(s) `OcclusionMesh` renders
 * on top of the invisible depth-only occluder:
 * - `'off'` — no debug rendering (the shipped default; occlusion is invisible).
 * - `'matcap'` — the original shiny semi-transparent cyan skin.
 * - `'depth-shaded'` — matcap + camera-distance fade + white fresnel rim, so
 *   overlapping near/far surfaces read as separate shells.
 * - `'wireframe'` — the raw triangulation as GL lines (mesh-structure
 *   inspection: triangle density, mesher seams, degenerate spots).
 * - `'depth-shaded-wireframe'` — both of the above composed.
 *
 * Owned here since the 2026-07-11 G-1 move (this module is the consumer; it
 * previously lived in the recorder settings catalog). The values array is
 * exported so the recorder's `occluderDebugStyle` validator can enum-check
 * persisted values; the settings `<select>` options are hardcoded in the
 * recorder's `index.html`.
 */
export const OCCLUDER_DEBUG_STYLES = [
  'off',
  'matcap',
  'depth-shaded',
  'wireframe',
  'depth-shaded-wireframe',
] as const;
export type OccluderDebugStyle = (typeof OCCLUDER_DEBUG_STYLES)[number];

const MESH_NAME = 'occupancy-occluder';
const DEBUG_MESH_NAME = 'occupancy-occluder-debug';
const DEBUG_WIREFRAME_MESH_NAME = 'occupancy-occluder-debug-wireframe';

/** Default render order — well before virtual content (which is ≥ 0). */
const DEFAULT_RENDER_ORDER = -1;

/** Opacity of the matcap debug skin — see-through enough to read the real scene
 *  behind it while the shape stays legible. */
const DEBUG_SKIN_OPACITY = 0.6;

/** Light-cyan GL lines of the wireframe skin — faint enough not to swamp the
 *  shaded skin in the combined style, visible enough to read triangle density. */
const WIREFRAME_COLOR = 0xaaeeff;
const WIREFRAME_OPACITY = 0.35;

/** Which styles shade with the matcap (and therefore need vertex normals —
 *  pure 'wireframe' is unlit and keeps the remesh path normal-free). */
function styleNeedsNormals(style: OccluderDebugStyle): boolean {
  return (
    style === 'matcap' ||
    style === 'depth-shaded' ||
    style === 'depth-shaded-wireframe'
  );
}

/**
 * Depth-shaded debug-skin constants — **module constants, not user settings**
 * (tune in code after the first on-device look; 2026-07-02 debug-viz-styles
 * plan). Exported so the unit/property tests of the GLSL-mirror curves below
 * pin the same numbers the shader bakes in.
 */
export const OCCLUDER_DEPTH_SHADE = {
  /** Distance (m) where the fade starts — nearer stays full-bright cyan.
   *  Indoor-scale since the 2026-07-03 field pass (finding F1): the original
   *  1.5 → 10 m range kept a whole room in the "near" band (94% brightness at
   *  3 m), making depth-shaded indistinguishable from matcap on device. */
  FADE_START_M: 0.75,
  /** Distance (m) where the fade bottoms out at {@link FADE_MIN_BRIGHTNESS}.
   *  ~Room depth, so indoor scenes span the full near→far gradient; beyond it
   *  everything sits uniformly at the floor (still separated from near). */
  FADE_END_M: 4.5,
  /** Brightness floor far away — never fades to black, so distant mesh stays
   *  inspectable (the reason the fog-to-background idea was rejected). */
  FADE_MIN_BRIGHTNESS: 0.3,
  /** Fresnel exponent — higher hugs the silhouette tighter. */
  RIM_POWER: 2.5,
  /** White-rim contribution at a fully grazing view angle. */
  RIM_STRENGTH: 0.6,
} as const;

/** Far-distance fade target (dark desaturated blue) — keeps the occluder's
 *  single-color cyan identity while clearly separating far from near. */
const FADE_TARGET_RGB = [0.03, 0.07, 0.12] as const;

/** GLSL `smoothstep` (clamped Hermite), mirrored exactly for the TS curves. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pure TS mirror of the shader's **distance fade**: 1 at/inside FADE_START_M,
 * smoothly down to FADE_MIN_BRIGHTNESS at/after FADE_END_M. The fragment color
 * is `mix(darkBlue, matcapColor, fade)` — near = bright cyan, far = dark blue.
 * Mirrored so the curve is unit-testable without a GPU (the
 * `buildFullscreenOcclusionShader` GLSL-mirror precedent).
 */
export function occluderDepthFade(distanceM: number): number {
  const { FADE_START_M, FADE_END_M, FADE_MIN_BRIGHTNESS } =
    OCCLUDER_DEPTH_SHADE;
  return (
    1 -
    (1 - FADE_MIN_BRIGHTNESS) * smoothstep(FADE_START_M, FADE_END_M, distanceM)
  );
}

/**
 * Pure TS mirror of the shader's **fresnel rim**: 0 where the surface faces
 * the camera head-on (|cos| = 1), RIM_STRENGTH at a fully grazing angle
 * (cos = 0) — silhouettes brighten, so overlapping shells read as separate.
 *
 * @param cosViewAngle `dot(normal, viewDir)` — cosine of the angle between the
 *   surface normal and the view direction, in [-1, 1].
 */
export function occluderFresnelRim(cosViewAngle: number): number {
  const { RIM_POWER, RIM_STRENGTH } = OCCLUDER_DEPTH_SHADE;
  return RIM_STRENGTH * Math.pow(1 - Math.abs(cosViewAngle), RIM_POWER);
}

/** A number as a GLSL float literal (fixed decimals so it never reads as int). */
function glslFloat(value: number): string {
  return value.toFixed(4);
}

/**
 * The fragment-shader snippet the depth-shaded material injects before
 * `#include <opaque_fragment>` in three.js's matcap fragment shader — the
 * point where `outgoingLight` (matcap-lit color), `normal` and `viewDir` /
 * `vViewPosition` are all in scope. Exported so tests can pin the exact
 * injected code. Constants are baked as literals (no uniforms — they are
 * module constants by design, see {@link OCCLUDER_DEPTH_SHADE}).
 */
export function buildOccluderDepthShadeSnippet(): string {
  const { FADE_START_M, FADE_END_M, FADE_MIN_BRIGHTNESS, RIM_POWER } =
    OCCLUDER_DEPTH_SHADE;
  const { RIM_STRENGTH } = OCCLUDER_DEPTH_SHADE;
  const [r, g, b] = FADE_TARGET_RGB;
  return [
    '// Occluder debug depth-shading: distance fade + fresnel rim (2026-07-02).',
    `float dbgDistance = length( vViewPosition );`,
    `float dbgFade = 1.0 - ( 1.0 - ${glslFloat(FADE_MIN_BRIGHTNESS)} ) * smoothstep( ${glslFloat(FADE_START_M)}, ${glslFloat(FADE_END_M)}, dbgDistance );`,
    `outgoingLight = mix( vec3( ${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)} ), outgoingLight, dbgFade );`,
    `float dbgRim = ${glslFloat(RIM_STRENGTH)} * pow( 1.0 - abs( dot( normal, viewDir ) ), ${glslFloat(RIM_POWER)} );`,
    `outgoingLight += vec3( 1.0 ) * dbgRim;`,
  ].join('\n\t');
}

/**
 * Build a tiny procedural matcap texture (a shaded sphere with a specular
 * highlight) so the debug skin reads as a **shiny** surface with **no scene
 * lights** — `MeshMatcapMaterial` bakes the lighting into this lookup. Generated
 * from a typed array (no canvas/WebGL), so it works headless in tests too.
 */
function createOccluderDebugMatcap(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  // Light direction (front-upper-right); normalized via its length below.
  const lx = 0.4;
  const ly = 0.5;
  const lz = 0.75;
  const llen = Math.hypot(lx, ly, lz);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = (j * size + i) * 4;
      const nx = ((i + 0.5) / size) * 2 - 1;
      const ny = ((j + 0.5) / size) * 2 - 1;
      const r2 = nx * nx + ny * ny;
      let r = 12;
      let g = 12;
      let b = 14;
      if (r2 <= 1) {
        const nz = Math.sqrt(1 - r2);
        const ndl = Math.max(0, (nx * lx + ny * ly + nz * lz) / llen);
        const diff = 0.25 + 0.75 * ndl; // ambient + diffuse
        const spec = Math.pow(ndl, 32); // tight specular highlight
        // Cyan-ish tint so the occluder reads as obviously "debug".
        r = Math.min(255, 255 * (0.15 * diff + spec));
        g = Math.min(255, 255 * (0.55 * diff + spec));
        b = Math.min(255, 255 * (0.78 * diff + spec));
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export interface OcclusionMeshOptions {
  /**
   * Merge coplanar faces (fewer triangles, same occluded volume). Default
   * true — the occluder is invisible, so the coarser triangulation is free.
   * Ignored when {@link OcclusionMeshOptions.mode} is set.
   */
  readonly greedy?: boolean;
  /**
   * Mesher strategy (additive opt-in; 2026-06-30 occluder-tuning, F2). When set
   * it takes precedence over {@link greedy}. `'smooth'` selects the surface-nets
   * mesher that hugs the measured per-cell centroids — pass a `getCellPoint`
   * provider to {@link OcclusionMesh.update} for it to read. Left **unset by
   * default** so existing behaviour (greedy cubes) is byte-for-byte unchanged
   * until the smooth occluder is confirmed on-device.
   */
  readonly mode?: MeshMode;
  /**
   * `renderOrder` of the depth-only mesh. Must be below virtual content so the
   * occluder lays down depth first. Default −1. (The live occluder, when it
   * exists, sits between this and content — plan §5.)
   */
  readonly renderOrder?: number;
}

/**
 * A depth-only occlusion mesh that rebuilds from an occupancy-grid snapshot.
 * Mirrors {@link OccupancyCubesVisualizer}'s lifecycle (inject parent, `update`,
 * `clear`, `dispose`) so the recorder can wire it the same way as the cubes.
 */
export class OcclusionMesh {
  private readonly arSpaceNode: THREE.Object3D;
  private readonly greedy: boolean;
  private readonly mode: MeshMode | undefined;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private lastAabbs: readonly Aabb[] = [];
  private disposed = false;
  // Debug visualization (off by default): VISIBLE "skins" sharing the
  // occluder's geometry, composed per style (shaded matcap-based skin and/or a
  // wireframe skin). Kept separate from `this.mesh` (the invisible depth
  // writer) so styling never changes the actual occlusion — the depth mesh is
  // untouched, the skins are purely additive. Materials (and the shared matcap
  // texture) are lazily created once and cached across style switches; they are
  // released only in dispose().
  private debugStyle: OccluderDebugStyle = 'off';
  private shadedSkin: THREE.Mesh | null = null;
  private wireframeSkin: THREE.Mesh | null = null;
  private matcapTexture: THREE.DataTexture | null = null;
  private matcapMaterial: THREE.MeshMatcapMaterial | null = null;
  private depthShadedMaterial: THREE.MeshMatcapMaterial | null = null;
  private wireframeMaterial: THREE.MeshBasicMaterial | null = null;

  /**
   * @param arSpaceNode the AR-odometry-NUE node that receives the alignment
   *   matrix (`arWorldGroup` live, `replaySceneState.arWorldGroup` in replay).
   */
  constructor(arSpaceNode: THREE.Object3D, options: OcclusionMeshOptions = {}) {
    this.arSpaceNode = arSpaceNode;
    this.greedy = options.greedy ?? true;
    this.mode = options.mode;
    this.geometry = new THREE.BufferGeometry();
    // Invisible depth-writer: contributes only to the depth buffer, so virtual
    // content's normal depth test hides fragments behind the real surface.
    this.material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = MESH_NAME;
    this.mesh.renderOrder = options.renderOrder ?? DEFAULT_RENDER_ORDER;
    this.mesh.frustumCulled = false; // surface spans the whole room
    // Raw-WebXR positions; the mesh node converts to the parent's NUE frame.
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.copy(WEBXR_TO_NUE);
    this.arSpaceNode.add(this.mesh);
  }

  /** The number of triangles currently drawn. */
  getTriangleCount(): number {
    const index = this.geometry.getIndex();
    return index ? index.count / 3 : 0;
  }

  /** The AABB list from the most recent {@link update} (physics export hook). */
  getAabbs(): readonly Aabb[] {
    return this.lastAabbs;
  }

  /**
   * The underlying `THREE.Mesh` (the depth-only occluder geometry), for a
   * pointer-raycast layer to target the real occluder surface (2026-07-15
   * replay-harness Part B). The mesh's `colorWrite:false` invisibility does NOT
   * affect `THREE.Raycaster`, and `frustumCulled:false` is fine for raycasting.
   * Treat it as read-only — re-mesh via {@link update} / restyle via
   * {@link setDebugStyle} instead of mutating the returned object.
   */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Show or hide the WHOLE occluder — the depth-only mesh AND any active debug
   * skins. Hiding stops the depth mesh writing depth, so a co-located visualizer
   * (e.g. the occupancy cubes at the same surface) is no longer occluded by the
   * otherwise-invisible occluder. Independent of {@link setDebugStyle}: a later
   * `setDebugStyle` re-adds skins as visible, so re-apply `setVisible` after a
   * style change if you need them hidden (a mesh-view controller does exactly this).
   */
  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.mesh.visible = visible;
    if (this.shadedSkin) this.shadedSkin.visible = visible;
    if (this.wireframeSkin) this.wireframeSkin.visible = visible;
  }

  /**
   * Re-mesh from a fresh occupied-cell snapshot. Pass
   * `grid.getOccupiedCells(occupancy.minConfidence)` so the occluder shares the
   * same noise floor as the cubes and the COLMAP export.
   *
   * @param getCellPoint optional per-cell measured-centroid provider
   *   (`grid.getCellPoint`); only consumed when this occluder was constructed
   *   with `mode: 'smooth'` (otherwise ignored). When omitted under `'smooth'`,
   *   the surface nets falls back to cell centres.
   */
  update(
    cells: Iterable<GridCell>,
    cellSizeM: number,
    getCellPoint?: (cell: GridCell) => Vector3 | null
  ): void {
    if (this.disposed) return;
    const meshOptions: MeshOccupiedCellsOptions = this.mode
      ? { mode: this.mode, getCellPoint }
      : { mode: this.greedy ? 'greedy' : 'per-face' };
    const { positions, indices, aabbs } = meshOccupiedCells(
      cells,
      cellSizeM,
      meshOptions
    );
    this.lastAabbs = aabbs;
    this.swapGeometry(positions, indices);
  }

  /**
   * Apply **precomputed** geometry (positions/indices) without meshing — the
   * entry point for the Web Worker offload: the driver posts the occupied-cell
   * snapshot to a worker (`packMeshRequest`/`runMeshRequest`), and this swaps in
   * the returned typed arrays off the render-critical path. Byte-identical result
   * to {@link update} for the same input.
   *
   * The AABB physics hook is NOT populated on this path (the worker returns
   * geometry only; AABBs are an export hook unused by rendering) — {@link getAabbs}
   * returns empty here. Use the synchronous {@link update} if AABBs are needed.
   */
  applyMeshData(positions: Float32Array, indices: Uint32Array): void {
    if (this.disposed) return;
    this.lastAabbs = [];
    this.swapGeometry(positions, indices);
  }

  /**
   * Replace the geometry wholesale from typed arrays — a full rebuild is the
   * simple first cut; dispose the old buffers to avoid leaking GPU memory across
   * refreshes.
   */
  private swapGeometry(positions: Float32Array, indices: Uint32Array): void {
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    next.setIndex(new THREE.BufferAttribute(indices, 1));
    // Matcap shading needs per-vertex normals; the mesher emits none. Compute
    // them only when a matcap-based debug skin is showing, so the default
    // occluder path (invisible — normals unused) and the pure wireframe style
    // stay cheap.
    if (styleNeedsNormals(this.debugStyle)) next.computeVertexNormals();
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    this.rebindSkinGeometry(next);
  }

  /** Point every active debug skin at the (new) shared geometry. */
  private rebindSkinGeometry(geometry: THREE.BufferGeometry): void {
    if (this.shadedSkin) this.shadedSkin.geometry = geometry;
    if (this.wireframeSkin) this.wireframeSkin.geometry = geometry;
  }

  /**
   * Select which **visible debug skin(s)** render the occluder mesh so its
   * shape and structure can be judged on-device (2026-07-02 debug-viz-styles
   * plan): the original `'matcap'` skin, a `'depth-shaded'` variant (distance
   * fade + fresnel rim, separates overlapping layers), a `'wireframe'` overlay
   * (the raw triangulation as GL lines), the combined
   * `'depth-shaded-wireframe'`, or `'off'`.
   *
   * Additive by design: every style adds/removes separate skin meshes sharing
   * the occluder's geometry and **never touches the invisible depth-only
   * mesh**, so occlusion is byte-for-byte unchanged whichever style is active.
   * The skins are `transparent` with `depthWrite:false` (the depth-only mesh
   * already wrote the occluding depth), so they just paint where the occluder
   * is the nearest geometry; the wireframe draws at renderOrder 1 so its lines
   * overlay the shaded surface in the combined style.
   *
   * Vertex normals (the mesher emits none) are computed only for the
   * matcap-based styles — `'wireframe'` is unlit, so like `'off'` it keeps the
   * remesh path normal-free.
   *
   * Only meaningful when this occluder is actually meshing the grid (it is the
   * persistent occluder's mesh); setting a style on an empty/disabled occluder
   * is a harmless no-op until {@link update} feeds geometry.
   */
  setDebugStyle(style: OccluderDebugStyle): void {
    if (this.disposed || style === this.debugStyle) return;
    this.debugStyle = style;
    this.applyShadedSkin(this.shadedMaterialFor(style));
    this.applyWireframeSkin(
      style === 'wireframe' || style === 'depth-shaded-wireframe'
    );
  }

  /** Which matcap-based material the style shades with (null = no shaded skin). */
  private shadedMaterialFor(
    style: OccluderDebugStyle
  ): THREE.MeshMatcapMaterial | null {
    if (style === 'matcap') return this.getMatcapMaterial();
    if (style === 'depth-shaded' || style === 'depth-shaded-wireframe') {
      return this.getDepthShadedMaterial();
    }
    return null;
  }

  /** Add/retarget/remove the single shaded skin node for the desired material. */
  private applyShadedSkin(material: THREE.MeshMatcapMaterial | null): void {
    if (material) {
      // Normals for the (possibly already-meshed) current geometry.
      this.geometry.computeVertexNormals();
      if (this.shadedSkin) {
        this.shadedSkin.material = material;
      } else {
        this.shadedSkin = this.createSkinMesh(DEBUG_MESH_NAME, 0, material);
        this.arSpaceNode.add(this.shadedSkin);
      }
    } else if (this.shadedSkin) {
      this.arSpaceNode.remove(this.shadedSkin);
      this.shadedSkin = null;
    }
  }

  /** Add/remove the wireframe skin — drawn after the shaded skin (renderOrder
   *  1) so its lines sit on top of the surface in the combined style. */
  private applyWireframeSkin(want: boolean): void {
    if (want) {
      if (!this.wireframeSkin) {
        this.wireframeSkin = this.createSkinMesh(
          DEBUG_WIREFRAME_MESH_NAME,
          1,
          this.getWireframeMaterial()
        );
        this.arSpaceNode.add(this.wireframeSkin);
      }
    } else if (this.wireframeSkin) {
      this.arSpaceNode.remove(this.wireframeSkin);
      this.wireframeSkin = null;
    }
  }

  /** A debug skin mesh sharing the occluder's geometry, transform and culling
   *  behaviour — only name, renderOrder and material differ per skin. */
  private createSkinMesh(
    name: string,
    renderOrder: number,
    material: THREE.Material
  ): THREE.Mesh {
    const skin = new THREE.Mesh(this.geometry, material);
    skin.name = name;
    skin.renderOrder = renderOrder; // transparent overlay, after the depth pass
    skin.frustumCulled = false;
    skin.matrixAutoUpdate = false;
    skin.matrix.copy(WEBXR_TO_NUE); // same raw-WebXR → NUE basis as the occluder
    return skin;
  }

  /** The procedural matcap texture, shared by both matcap-based materials. */
  private getMatcapTexture(): THREE.DataTexture {
    if (!this.matcapTexture) {
      this.matcapTexture = createOccluderDebugMatcap();
    }
    return this.matcapTexture;
  }

  private getMatcapMaterial(): THREE.MeshMatcapMaterial {
    if (!this.matcapMaterial) {
      this.matcapMaterial = new THREE.MeshMatcapMaterial({
        matcap: this.getMatcapTexture(),
        transparent: true,
        opacity: DEBUG_SKIN_OPACITY,
        depthWrite: false, // the invisible depth mesh owns the occluding depth
      });
    }
    return this.matcapMaterial;
  }

  private getDepthShadedMaterial(): THREE.MeshMatcapMaterial {
    if (!this.depthShadedMaterial) {
      const material = new THREE.MeshMatcapMaterial({
        matcap: this.getMatcapTexture(),
        transparent: true,
        opacity: DEBUG_SKIN_OPACITY,
        depthWrite: false,
      });
      // Extend the stock matcap fragment shader with the distance fade +
      // fresnel rim, injected right before the output write so it can modify
      // `outgoingLight` (see buildOccluderDepthShadeSnippet for the math and
      // the TS mirrors that test it). Compiles once per program.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `${buildOccluderDepthShadeSnippet()}\n\t#include <opaque_fragment>`
        );
      };
      // Distinct cache key: without it three.js would consider this program
      // interchangeable with the unmodified matcap material's and could skip
      // the injected shader variant.
      material.customProgramCacheKey = () => 'occluder-depth-shaded';
      this.depthShadedMaterial = material;
    }
    return this.depthShadedMaterial;
  }

  private getWireframeMaterial(): THREE.MeshBasicMaterial {
    if (!this.wireframeMaterial) {
      this.wireframeMaterial = new THREE.MeshBasicMaterial({
        wireframe: true, // GL 1-px lines over the shared triangulation
        color: WIREFRAME_COLOR,
        transparent: true,
        opacity: WIREFRAME_OPACITY,
        depthWrite: false,
      });
    }
    return this.wireframeMaterial;
  }

  /** Empty the mesh (e.g. on store swap); the node stays in the scene. */
  clear(): void {
    if (this.disposed) return;
    const next = new THREE.BufferGeometry();
    this.geometry.dispose();
    this.geometry = next;
    this.mesh.geometry = next;
    // Keep the visible debug skins in sync with the depth-only mesh (as
    // swapGeometry does) — otherwise they keep rendering the old, now-disposed
    // geometry and a stale debug surface lingers on screen after a clear.
    this.rebindSkinGeometry(next);
    this.lastAabbs = [];
  }

  /** Remove the mesh from its parent and release GPU resources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.arSpaceNode.remove(this.mesh);
    if (this.shadedSkin) {
      this.arSpaceNode.remove(this.shadedSkin);
      this.shadedSkin = null;
    }
    if (this.wireframeSkin) {
      this.arSpaceNode.remove(this.wireframeSkin);
      this.wireframeSkin = null;
    }
    this.matcapTexture?.dispose();
    this.matcapTexture = null;
    this.matcapMaterial?.dispose();
    this.matcapMaterial = null;
    this.depthShadedMaterial?.dispose();
    this.depthShadedMaterial = null;
    this.wireframeMaterial?.dispose();
    this.wireframeMaterial = null;
    this.geometry.dispose();
    this.material.dispose();
    this.lastAabbs = [];
  }
}
