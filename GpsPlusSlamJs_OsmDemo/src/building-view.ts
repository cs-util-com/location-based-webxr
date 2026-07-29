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

export interface BuildingViewOptions {
  readonly container: HTMLElement;
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

  constructor(options: BuildingViewOptions) {
    this.container = options.container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // The scene renders on demand rather than in a rAF loop, so without this
      // the drawing buffer is cleared before anything can read it back. It
      // costs a little memory and buys the only way to assert this view drew
      // anything at all: the e2e suite reads the pixels and counts the
      // non-background ones. A 3D pane that silently renders nothing looks
      // exactly like a 3D pane with no buildings nearby.
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

    this.resize();
    // Held rather than passed inline, so `dispose()` can actually remove it.
    // An anonymous listener outlives disposal and then calls `setSize()` and
    // `updateProjectionMatrix()` on a renderer whose GL context is gone.
    this.onWindowResize = () => {
      this.resize();
    };
    window.addEventListener("resize", this.onWindowResize);
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
