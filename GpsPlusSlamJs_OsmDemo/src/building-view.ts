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

import * as THREE from 'three';
import {
  buildBuildings,
  buildTrees,
  enuFrameAt,
  mergeMeshes,
  type BuildingVolume,
  type LatLng,
  type MeshData,
  type OsmFeature,
} from 'gps-plus-slam-osm';

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
      new THREE.MeshStandardMaterial({ color: 0x1d2230 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    this.camera.position.set(140, 110, 140);
    this.camera.lookAt(0, 10, 0);

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
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
        new THREE.MeshStandardMaterial({ color: 0x3f7d4a })
      );
      trunk.position.set(
        tree.position.x,
        tree.groundHeightM + tree.heightM / 2,
        tree.position.y
      );
      trunk.rotation.y = tree.rotationY;
      this.group.add(trunk);
    }

    this.renderer.render(this.scene, this.camera);
    return statsFor(volumes, merged, trees.length);
  }

  private meshFor(data: MeshData): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(data.positions, 3)
    );
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0xc8ccd8,
        // Double-sided so a wrongly-wound wall is VISIBLE as a shading oddity
        // rather than invisible. This view exists to find that class of bug, and
        // backface culling would hide exactly it.
        side: THREE.DoubleSide,
        flatShading: true,
      })
    );
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    }
  }

  dispose(): void {
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
  trees: number
): BuildingStats {
  return {
    volumes: volumes.length,
    parts: volumes.filter((v) => v.parentFeature !== undefined).length,
    triangles: merged.triangleCount,
    guessedHeights: volumes.filter((v) => v.heights.heightIsGuessed).length,
    approximateRoofs: volumes.filter(
      (v) => v.heights.roofShape === 'gabled' || v.heights.roofShape === 'hipped'
    ).length,
    trees,
  };
}
