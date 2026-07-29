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
import {
  buildBuildings,
  buildTrees,
  enuFrameAt,
  mergeMeshes,
  type BuildingVolume,
  type LatLng,
  type MeshData,
  type OsmFeature,
} from "gps-plus-slam-osm";

import type { CellMesh } from "./cell-mesh.js";

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

    this.scene.background = new THREE.Color(0x11131a);
    this.scene.add(this.group);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(60, 120, 40);
    this.scene.add(sun);
    // A ground plane, so a building with no neighbours still reads as standing
    // on something rather than floating in the void.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x1d2230 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

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
    this.container.addEventListener("pointerdown", (event) => {
      downAt = { x: event.clientX, y: event.clientY };
    });
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
      this.cellMesh.geometry.dispose();
      (this.cellMesh.material as THREE.Material).dispose();
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

  resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rebuilds the scene from features around `centre`.
   *
   * The ENU frame is anchored at the user, not at the tile: mesh coordinates
   * stay small, which keeps float32 vertex buffers precise where it matters.
   */
  render(features: Iterable<OsmFeature>, centre: LatLng): BuildingStats {
    this.clear();

    const frame = enuFrameAt(centre);
    const all = [...features];
    const volumes = buildBuildings(all, { frame });
    const trees = buildTrees(all, { frame });

    // ONE merged geometry for this view. The package's own guidance is to batch
    // per res-8/res-9 cell rather than per fetch tile, because a batch spanning
    // 2.8 km defeats frustum culling — but this view shows one working set at a
    // time and is always wholly on screen, so a single batch is right here.
    const merged = mergeMeshes(volumes.map((volume) => volume.mesh));
    if (merged.triangleCount > 0) this.group.add(this.meshFor(merged));

    for (const tree of trees) {
      const trunk = new THREE.Mesh(
        new THREE.ConeGeometry(tree.crownDiameterM / 2, tree.heightM, 6),
        new THREE.MeshStandardMaterial({ color: 0x3f7d4a }),
      );
      trunk.position.set(
        tree.position.x,
        tree.groundHeightM + tree.heightM / 2,
        tree.position.y,
      );
      trunk.rotation.y = tree.rotationY;
      this.group.add(trunk);
    }

    this.renderer.render(this.scene, this.camera);
    return statsFor(volumes, merged, trees.length);
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
    this.container.removeEventListener("pointerup", this.onPointerDown);
    this.controls.dispose();
    window.removeEventListener("resize", this.onWindowResize);
    this.clear();
    this.renderer.dispose();
  }
}

/**
 * The numbers that make the picture checkable.
 *
 * `guessedHeights` and `approximateRoofs` are the two honesty flags the mesh
 * layer carries, and this view is the only place they ever become visible. The
 * census said 16 % of buildings carry `height` and 12 % a non-flat roof shape —
 * these counters are how that gets confirmed on real data rather than quoted.
 */
function statsFor(
  volumes: readonly BuildingVolume[],
  merged: MeshData,
  trees: number,
): BuildingStats {
  return {
    volumes: volumes.length,
    parts: volumes.filter((v) => v.parentFeature !== undefined).length,
    triangles: merged.triangleCount,
    guessedHeights: volumes.filter((v) => v.heights.heightIsGuessed).length,
    // THE REAL FLAG, not a proxy for it. This used to test
    // `roofShape === 'gabled' || 'hipped'`, which is a different claim: a
    // gabled roof on an actual rectangle is EXACT, and that is the common case
    // the package's approximation trade rests on — so the counter meant to
    // confirm the census against real data was over-reporting every time.
    approximateRoofs: volumes.filter((v) => v.roofIsApproximate).length,
    trees,
  };
}
