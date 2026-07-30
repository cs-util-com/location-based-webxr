/**
 * The three.js view: buildings extruded from the same merged features.
 *
 * WHY IT SHARES THE PIPELINE RATHER THAN FETCHING ITS OWN DATA. The 3D view is
 * here to verify the MESH code — `building:part` suppression, wall normals,
 * roof shapes, the `isApproximate` flag — and it can only do that if it is
 * looking at exactly the features the 2D view scored. Two fetch paths would
 * mean a discrepancy could be the data rather than the geometry.
 *
 * WHY THE PACKAGE DOES NOT DO THIS. `gps-plus-slam-osm` produces `Float32Array`
 * positions and normals plus `Uint32Array` indices and stops there, because it
 * must not depend on `three` (plan §4.2). Everything below is the three lines
 * that turn those buffers into a mesh, and they belong in the consumer.
 *
 * @see building-view.ts.md
 */

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { type MeshData, type TreePlacement } from "gps-plus-slam-osm";

import type { CellMesh } from "./cell-mesh.js";
import type { Heightfield } from "./heightfield.js";
import { SKY_GRADIENT_ROWS, skyGradientPixels } from "./sky-gradient.js";
import type { TransferableMesh } from "./worker/protocol.js";

/**
 * Half-width of the ground plane and of the terrain sampled under it, metres.
 *
 * 1400 m — a 2.8 km plane — which matches the extent of the geometry actually
 * being rendered. **This overrides DEC-15's 600 m** (see DEC-R2-8).
 *
 * WHY IT HAD TO GROW. `buildBuildings` applies no distance filter: it extrudes
 * every merged feature, i.e. everything in the res-7 fetch tile, 2.81 km across,
 * and the camera's far plane is 4000 m. So a 600 m terrain square sat under ~2.8 km
 * of city — and the buildings outside it were not left flat, they were offset by
 * `bilinear`'s per-axis CLAMP, which extrudes the edge profile outward as stripes.
 * That is fabricated height presented as data (finding R2-9), and sizing the field
 * to the geometry is what makes it unrepresentable rather than merely unlikely.
 *
 * WHY THE COST OBJECTION DID NOT HOLD. DEC-15 costed this in Terrarium tiles, and a
 * z13 tile is ~3.1 km of ground at Cologne — so covering the whole rendered city is
 * the 1–4 tiles already being fetched. What genuinely scales is the post count, and
 * that is handled by `terrain-field.ts`: posts are cached across positions, so the
 * larger area is paid for once rather than on every step.
 */
export const TERRAIN_EXTENT_M = 1400;

/**
 * Metres between terrain posts. Terrarium z13 is ~12 m per pixel at this latitude.
 *
 * Sampling finer would interpolate detail the DEM never had; sampling coarser would
 * throw away detail already fetched.
 */
export const TERRAIN_SPACING_M = 12;

/**
 * Plane subdivisions per axis, DERIVED rather than chosen.
 *
 * This was a hard-coded 64 with a comment explaining that 64 over 600 m gave a
 * ~9.4 m quad, just finer than the DEM's ~12 m pitch. Prose does not follow a
 * constant: at the new 2.8 km extent that same 64 would be **44 m quads**, four
 * times coarser than the data, and the symptom would be "the terrain got blurry"
 * rather than an error. Deriving it means the relationship the comment described is
 * now enforced (finding B2).
 */
const GROUND_SEGMENTS = Math.round((TERRAIN_EXTENT_M * 2) / TERRAIN_SPACING_M);

export interface BuildingViewOptions {
  readonly container: HTMLElement;
  /** Called with the H3 id when an affordance cell is clicked in the scene. */
  readonly onCellClick?: (cell: string) => void;
}

export interface BuildingStats {
  readonly volumes: number;
  readonly parts: number;
  readonly triangles: number;
  readonly guessedHeights: number;
  /** Roofs generated from the bounding rectangle rather than exactly. */
  readonly approximateRoofs: number;
  readonly trees: number;
}

/**
 * Where a tree's cone stands in the scene, from its ENU placement.
 *
 * Extracted from the draw loop because it is the one part of it that can be
 * proved without a GPU, and the part that fails silently: see
 * `building-view.test.ts`.
 */
export function treeConePosition(
  tree: TreePlacement,
): [x: number, y: number, z: number] {
  return [
    tree.position.x,
    // `ConeGeometry` is centred on its origin, so the base sits on the terrain
    // sample only if the centre is half a height above it.
    tree.groundHeightM + tree.heightM / 2,
    // ENU y is north; the scene's -z is north (`mesh-data.ts`), the same
    // reflection `cell-mesh.ts` and `MeshBuilder` apply. Without it a tree 50 m
    // north renders 50 m SOUTH — 100 m from the building it stands next to.
    -tree.position.y,
  ];
}

export class BuildingView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly onWindowResize: () => void;
  private readonly group = new THREE.Group();
  private readonly container: HTMLElement;
  private readonly controls: MapControls;
  /** The pending rAF handle, so `dispose()` can cancel it. */
  private frame: number | undefined;
  /** The affordance grid, kept separate so `clear()` does not drop it. */
  private cellMesh: THREE.Mesh | undefined;
  /** Triangle index → cell id for the current grid. */
  private cellForTriangle: readonly string[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerStart: (event: PointerEvent) => void;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.Material>;
  /** The sky gradient, used as both background and environment map. */
  private readonly sky: THREE.DataTexture;
  /** The flat plane's vertex positions, kept so terrain can be re-applied. */
  private flatGround: Float32Array | undefined;

  constructor(options: BuildingViewOptions) {
    this.container = options.container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // Without this the drawing buffer is cleared after each composite, so a
      // readback from JS gets a blank image. It costs a little memory and buys
      // the only way to assert this view drew anything at all: the e2e suite
      // reads the pixels and counts the non-background ones. A 3D pane that
      // silently renders nothing looks exactly like a 3D pane with no
      // buildings nearby. (Still needed now that there IS a rAF loop — the
      // readback races the next frame otherwise.)
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    options.container.appendChild(this.renderer.domElement);

    // The sky is BOTH the background and the environment map (DEC-R2-1/DEC-R2-2).
    // One texture, two jobs: it replaces the near-black background that the ground
    // could not lift off, and it gives `MeshStandardMaterial` something to reflect
    // — without which the reflective ground below has no specular to show, because
    // a single directional light produces a lobe narrow enough to miss almost
    // every facet.
    this.sky = new THREE.DataTexture(
      skyGradientPixels(),
      1,
      SKY_GRADIENT_ROWS,
      THREE.RGBAFormat,
    );
    this.sky.mapping = THREE.EquirectangularReflectionMapping;
    this.sky.colorSpace = THREE.SRGBColorSpace;
    // `flipY` DEFAULTS TO FALSE ON `DataTexture` — unlike an image-backed texture,
    // where it is true. So row 0 of the array lands at `v = 0`, which on an
    // equirectangular map is the NADIR, and the sky comes out upside down: bright
    // overhead, dark at the horizon. Measured before fixing: 63.5 luma at the top
    // against 52.9 near the horizon, i.e. exactly reversed.
    //
    // Corrected here rather than by reversing `skyGradientPixels`, so the pure
    // function keeps the contract its tests assert ("top row first", which is the
    // intuitive reading) and the three.js-specific quirk stays in the three.js
    // file.
    this.sky.flipY = true;
    this.sky.needsUpdate = true;
    this.scene.background = this.sky;
    this.scene.environment = this.sky;

    this.scene.add(this.group);
    // Ambient LOWERED from 0.55. Ambient light is flat by definition — it adds the
    // same amount to every facet regardless of its normal — so it was actively
    // washing out the only cue that distinguishes one ground facet from the next.
    // The environment map now supplies the soft fill it used to.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);
    // A ground plane, so a building with no neighbours still reads as standing
    // on something rather than floating in the void.
    //
    // 600 m across, not 2000 (DEC-15). The scoring working set reaches ~128 m
    // from the user, so a 2 km plane is mostly ground no cell is ever scored
    // on — and once it carries terrain, sampling all of it would fetch DEM
    // tiles for exactly that unscored ground, while sampling only the working
    // set would leave a flat-to-relief cliff at the seam. 600 m covers the
    // working set with margin and has no seam. The accepted cost is a visible
    // plane edge at the horizon.
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(
        TERRAIN_EXTENT_M * 2,
        TERRAIN_EXTENT_M * 2,
        GROUND_SEGMENTS,
        GROUND_SEGMENTS,
      ),
      // REFLECTIVE, and flat-shaded (DEC-R2-1). The owner's decision was to keep
      // normal-based shading and accept that genuinely flat ground looks flat,
      // but to make the surface reflective so the facet edges show up as a
      // highlight slides across them while the camera moves.
      //
      // Three changes together, and all three are needed:
      //  - `color` lifted out of near-black (`0x1d2230` -> `0x3a4356`), because a
      //    surface that dark has almost no dynamic range for a highlight to live
      //    in — the shading was mathematically present and perceptually absent.
      //  - `roughness` well below the 1.0 default, which narrows the specular lobe
      //    so neighbouring facets return visibly different amounts of it. Too low
      //    and the ground turns to chrome; 0.42 keeps it reading as ground.
      //  - `flatShading` KEPT, because per-facet normals are what the highlight is
      //    varying over. Smooth shading would average exactly the discontinuity
      //    this is trying to reveal.
      //
      // Accepted, and correct: in genuinely flat terrain this still looks flat.
      // `terrain ±N m` in the status line is the only remaining signal separating
      // that from "the DEM did not load" — see `terrain-note.ts`.
      new THREE.MeshStandardMaterial({
        color: 0x3a4356,
        flatShading: true,
        roughness: 0.42,
        metalness: 0.0,
      }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    this.camera.position.set(140, 110, 140);
    this.camera.lookAt(0, 10, 0);

    // `MapControls` rather than `OrbitControls` (DEC-5): pan-first suits a
    // top-down city view, where dragging should slide the ground rather than
    // swing the camera around a point the user did not choose. Both ship
    // INSIDE the `three` package this demo already depends on, so neither is a
    // new dependency — the concern that a camera controller would mean pulling
    // one in is out of date. Touch is handled natively: one finger pans, two
    // dolly and rotate.
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.resize();
    // Held rather than passed inline, so `dispose()` can actually remove it.
    // An anonymous listener outlives disposal and then calls `setSize()` and
    // `updateProjectionMatrix()` on a renderer whose GL context is gone.
    this.onWindowResize = () => {
      this.resize();
    };
    window.addEventListener("resize", this.onWindowResize);
    // Repaint when the camera moves — and ONLY then. See `requestFrame`.
    this.controls.addEventListener("change", () => {
      this.requestFrame();
    });

    // Picking on `pointerup` after a still pointer, not on `click`: MapControls
    // consumes drags, and a click at the end of a 200 px pan would otherwise
    // select whatever cell happened to be under the pointer when it stopped.
    let downAt: { x: number; y: number } | undefined;
    // Held, like every other listener here, so `dispose()` can remove it. An
    // anonymous one outlives disposal and keeps the view reachable.
    this.onPointerStart = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    this.container.addEventListener("pointerdown", this.onPointerStart);
    this.onPointerDown = (event: PointerEvent): void => {
      const from = downAt;
      downAt = undefined;
      if (from === undefined) return;
      const moved =
        Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y);
      if (moved > 4) return;
      const cell = this.pick(event);
      if (cell !== undefined) options.onCellClick?.(cell);
    };
    this.container.addEventListener("pointerup", this.onPointerDown);
  }

  /**
   * Displaces the ground plane by a heightfield, or flattens it again.
   *
   * The plane is built in its own XY space and rotated into place, so the
   * height goes into the vertex's **z** before the rotation — putting it in `y`
   * would push the terrain sideways, which looks like a sheared plane rather
   * than like a mistake.
   *
   * The undisplaced positions are kept rather than recomputed: re-applying a
   * new field to already-displaced vertices would accumulate the relief on
   * every refresh, and a city would grow into a mountain over a few clicks.
   */
  setTerrain(field: Heightfield | undefined): void {
    const attribute = this.ground.geometry.getAttribute("position");
    const positions = attribute.array as Float32Array;
    this.flatGround ??= Float32Array.from(positions);
    const flat = this.flatGround;

    for (let i = 0; i < positions.length; i += 3) {
      const x = flat[i] ?? 0;
      const planeY = flat[i + 1] ?? 0;
      // The plane's +y becomes the scene's -z under the -90° x rotation, and
      // `cell-mesh.ts` uses the same north convention.
      positions[i + 2] =
        field === undefined ? 0 : field.heightAt({ x, y: planeY });
    }
    attribute.needsUpdate = true;
    this.ground.geometry.computeVertexNormals();
    this.requestFrame();
  }

  /**
   * The cell under a pointer event, or `undefined`.
   *
   * Only the grid is raycast — not the buildings — because a building is not a
   * selectable thing in this app and hitting one should not silently select the
   * cell behind it.
   */
  private pick(event: PointerEvent): string | undefined {
    if (this.cellMesh === undefined) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return undefined;
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hit = this.raycaster.intersectObject(this.cellMesh, false)[0];
    // `faceIndex` IS the triangle index for an indexed BufferGeometry, which is
    // what `cellForTriangle` is keyed on — built in the same pass as the
    // geometry so the two cannot drift.
    // `faceIndex` is `number | null` in three's types — null when the hit
    // object has no indexed faces, which this one always does.
    const face = hit?.faceIndex;
    return face === undefined || face === null
      ? undefined
      : this.cellForTriangle[face];
  }

  /**
   * Draws the affordance grid, replacing any previous one.
   *
   * Kept out of `this.group` (and therefore out of `clear()`) so rebuilding the
   * buildings does not silently drop the grid, and vice versa — they arrive from
   * different parts of the same snapshot and neither should depend on the
   * other's timing.
   */
  renderCells(mesh: CellMesh): void {
    if (this.cellMesh !== undefined) {
      this.scene.remove(this.cellMesh);
      disposeMesh(this.cellMesh);
      this.cellMesh = undefined;
    }
    this.cellForTriangle = mesh.cellForTriangle;
    if (mesh.indices.length === 0) {
      this.requestFrame();
      return;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3),
    );
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.cellMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        // Matches the 2D map's fill opacity, so the same cell reads as the same
        // strength of claim in both views.
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.scene.add(this.cellMesh);
    this.requestFrame();
  }

  /**
   * Schedules exactly one frame, coalescing repeats.
   *
   * WHY NOT A PERMANENT rAF LOOP. That was the first attempt, and it was
   * measured: an always-running loop over a static city scene made the e2e
   * suite ~6× slower (21 s → 2.2 m) and pushed one test into a timeout, because
   * the loop competes for the same CPU as everything else in a headless
   * browser. On a phone it is worse than slow — it is a scene that never stops
   * drawing, burning battery to repaint an identical picture.
   *
   * The scene is static except while the user is moving the camera, so frames
   * are scheduled on demand. This still works with damping, which is the part
   * that looks like it should need a loop: `controls.update()` emits another
   * `change` while the camera is still easing, which schedules the next frame,
   * so the sequence sustains itself until the motion settles and then stops.
   *
   * The handle is HELD so `dispose()` can cancel it. An orphaned frame callback
   * touching a disposed WebGL context is a crash, not a leak — the same reason
   * the resize listener is held rather than passed inline.
   */
  private requestFrame(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /**
   * Matches the renderer and camera to the container, and REPAINTS.
   *
   * The repaint is not optional and is the whole of finding R2-3. `setSize`
   * reallocates the drawing buffer, which clears it — so on a view that renders
   * on demand (see `requestFrame`) a resize leaves the pane **blank** until
   * something else happens to schedule a frame. The next thing that does is the
   * user dragging the camera, which is exactly how the bug was reported: the
   * picture comes back the moment you touch it.
   *
   * `requestFrame` coalesces, so the sheet-drag path calling this many times per
   * second still costs one frame per animation frame rather than one per event.
   */
  resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.requestFrame();
  }

  /**
   * Draws a mesh the WORKER built.
   *
   * WHAT MOVED AND WHY. This method used to take the merged features and call
   * `buildBuildings`/`buildTrees` itself. Both now run in the worker, because the
   * features are 28–68 MB and must not cross the boundary to be turned into
   * geometry that crosses back — the package's mesh output is `Float32Array`
   * precisely so the BUFFERS can transfer instead (`mesh/extrude.ts` says so).
   * The ENU frame anchoring and the terrain sampling moved with them.
   *
   * So this is now purely "typed arrays in, three.js objects out", which is what
   * `building-view.ts`'s header always claimed the file was for.
   */
  render(mesh: TransferableMesh): BuildingStats {
    this.clear();

    if (mesh.buildings.triangleCount > 0) {
      this.group.add(this.meshFor(mesh.buildings));
    }

    for (const tree of mesh.trees) {
      const trunk = new THREE.Mesh(
        new THREE.ConeGeometry(tree.crownDiameterM / 2, tree.heightM, 6),
        new THREE.MeshStandardMaterial({ color: 0x3f7d4a }),
      );
      trunk.position.set(...treeConePosition(tree));
      trunk.rotation.y = tree.rotationY;
      this.group.add(trunk);
    }

    this.renderer.render(this.scene, this.camera);
    return {
      volumes: mesh.volumes,
      parts: mesh.parts,
      triangles: mesh.buildings.triangleCount,
      guessedHeights: mesh.guessedHeights,
      approximateRoofs: mesh.approximateRoofs,
      trees: mesh.trees.length,
    };
  }

  /**
   * Empties the scene and repaints it, leaving the ground plane and lights.
   *
   * The 3D counterpart of `MapView.clear()`: after a failed refresh the
   * buildings on screen belong to a working set that no longer exists. Clearing
   * without repainting would leave the LAST rendered frame in the drawing
   * buffer — the view renders on demand, so nothing else would ever overwrite
   * it, and the pane would keep showing buildings that are no longer anywhere
   * in the app's state.
   */
  clearScene(): void {
    this.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private meshFor(data: MeshData): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );
    geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xc8ccd8,
        // Double-sided because OSM volumes are not reliably closed — a
        // `building:part` with no floor, or a footprint the triangulator could
        // only partly cut, shows as a hole under culling for reasons that have
        // nothing to do with this package's correctness.
        //
        // IT DOES NOT VALIDATE WINDING — it hides it. Every wall quad in the
        // package was wound inside-out when this view was written and it looked
        // entirely fine here, which is why orientation is now pinned by
        // `mesh-orientation.test.ts` instead of by looking at this.
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    );
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      // ASSERTED, not inferred. `instanceof THREE.Mesh` narrows to
      // `Mesh<any, any, any>` because three's generic parameters default to
      // `any`, so `.geometry` and `.material` both arrive untyped and every
      // dispose call below them is unchecked. Naming the real shape once here
      // is the smallest place to put the assertion — everything this view
      // adds to `this.group` is built in `meshFor` or the tree loop, and both
      // use exactly this pairing.
      if (!(child instanceof THREE.Mesh)) continue;
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >;
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        for (const one of material) one.dispose();
      } else {
        material.dispose();
      }
    }
  }

  dispose(): void {
    // Cancelled FIRST: a frame already queued would otherwise fire against a
    // disposed context, which crashes rather than leaks.
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.container.removeEventListener("pointerdown", this.onPointerStart);
    this.container.removeEventListener("pointerup", this.onPointerDown);
    this.controls.dispose();
    window.removeEventListener("resize", this.onWindowResize);
    this.clear();
    // `clear()` only walks `this.group`. The ground and the affordance grid are
    // deliberately added straight to the scene — so that rebuilding the
    // buildings cannot drop them — which also means nothing else ever frees
    // their GPU buffers. Missing these leaks a geometry and a material per
    // disposed view, and the whole point of holding the resize listener and the
    // rAF handle is that this method actually cleans up.
    disposeMesh(this.ground);
    // The sky is a GPU texture like any other and nothing else frees it. It is
    // small, but it is also referenced by `scene.background` AND
    // `scene.environment`, so leaving it behind keeps the whole scene reachable.
    this.sky.dispose();
    if (this.cellMesh !== undefined) disposeMesh(this.cellMesh);
    this.cellMesh = undefined;
    this.renderer.dispose();
  }
}

/** Frees a mesh GPU-side. Materials may be an array; three does not do this. */
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const one of material) one.dispose();
  } else {
    material.dispose();
  }
}
