/**
 * What the approach's arrival draws in the tour's frame besides the
 * stations themselves: one fading ring on the ground around each station
 * as it pops in, and the recorded walk drawing itself as a line through
 * the walk's camera captures, in their order. Both live in one group under
 * the tour's frame (x east, y up, z south at the tour's centre), so a
 * recentre of the globe's frame moves nothing.
 *
 * The walk's line is three's screen-space line (`Line2`), 3 px wide in
 * the shell's accent colour, as the chosen prototype draws its route; a
 * share of it is drawn by cutting the polyline at that share of its
 * length.
 *
 * @see globe-approach-marks.ts.md
 */
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** The shell's accent (`--s-accent`). */
const ACCENT = 0xe9a23b;
/** The walk's width on screen (px) and opacity. */
const WALK_PX = 3;
const WALK_OPACITY = 0.9;
/** The walk floats this far over the captures' heights (m), so the
 *  ground never cuts it. */
const WALK_LIFT_M = 0.05;

/**
 * The first `share` (0 to 1) of the polyline `points` by its length: the
 * points passed whole, then one cut between the last two. Fewer than two
 * points, or a share that is not a number above 0, give none.
 */
export function walkPrefix(
  points: readonly THREE.Vector3[],
  share: number,
): THREE.Vector3[] {
  if (points.length < 2 || !(share > 0)) return [];
  if (share >= 1) return points.map((p) => p.clone());
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i]!.distanceTo(points[i - 1]!);
  }
  if (!(total > 0)) return [];
  let left = total * share;
  const out = [points[0]!.clone()];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = a.distanceTo(b);
    if (d >= left) {
      out.push(a.clone().lerp(b, d === 0 ? 1 : left / d));
      return out;
    }
    out.push(b.clone());
    left -= d;
  }
  return out;
}

export interface ArrivalMarks {
  /** The ring of station `id` at `at` (the tour's frame), `radiusM` its
   *  size; null removes it. */
  ring(
    id: string,
    at: THREE.Vector3 | null,
    ring: { readonly radius: number; readonly opacity: number } | null,
  ): void;
  /** The walk's points (the tour's frame), null for none. */
  setWalk(points: readonly THREE.Vector3[] | null): void;
  /** Draw `share` (0 to 1) of the walk. */
  drawWalk(share: number): void;
  /** Whether the walk shows (its layer chip). */
  showWalk(on: boolean): void;
  /** The canvas's size in CSS px, for the line's width. */
  resize(widthPx: number, heightPx: number): void;
  stats(): { rings: number; walkPoints: number; walkDrawn: number };
  dispose(): void;
}

/** The arrival's marks under `parent` (the tour's frame). */
export function createArrivalMarks(parent: THREE.Object3D): ArrivalMarks {
  const group = new THREE.Group();
  group.name = "approach-marks";
  parent.add(group);
  const ringGeometry = new THREE.RingGeometry(0.92, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);
  const rings = new Map<
    string,
    THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  >();

  const lineMaterial = new LineMaterial({
    color: ACCENT,
    linewidth: WALK_PX,
    transparent: true,
    opacity: WALK_OPACITY,
    depthWrite: false,
  });
  let walk: THREE.Vector3[] = [];
  let line: Line2 | null = null;
  let drawn = 0;
  let drawnShare = -1;
  let walkOn = true;

  const dropLine = () => {
    if (line === null) return;
    line.removeFromParent();
    line.geometry.dispose();
    line = null;
  };

  return {
    ring(id, at, ring) {
      let mesh = rings.get(id);
      if (at === null || ring === null) {
        if (mesh !== undefined) {
          mesh.removeFromParent();
          mesh.material.dispose();
          rings.delete(id);
        }
        return;
      }
      if (mesh === undefined) {
        mesh = new THREE.Mesh(
          ringGeometry,
          new THREE.MeshBasicMaterial({
            color: ACCENT,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        mesh.name = `approach-ring-${id}`;
        group.add(mesh);
        rings.set(id, mesh);
      }
      mesh.position.copy(at);
      mesh.scale.setScalar(Math.max(1e-3, ring.radius));
      mesh.material.opacity = Math.min(1, Math.max(0, ring.opacity));
    },
    setWalk(points) {
      walk = (points ?? []).map((p) => p.clone().setY(p.y + WALK_LIFT_M));
      drawn = 0;
      drawnShare = -1;
      dropLine();
    },
    drawWalk(share) {
      const k = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 1));
      if (k === drawnShare) return;
      drawnShare = k;
      const part = walkPrefix(walk, k);
      drawn = part.length;
      dropLine();
      if (part.length < 2) return;
      const geometry = new LineGeometry();
      geometry.setPositions(part.flatMap((p) => [p.x, p.y, p.z]));
      line = new Line2(geometry, lineMaterial);
      line.name = "approach-walk";
      line.visible = walkOn;
      line.computeLineDistances();
      group.add(line);
    },
    showWalk(on) {
      walkOn = on;
      if (line !== null) line.visible = on;
    },
    resize(widthPx, heightPx) {
      lineMaterial.resolution.set(Math.max(1, widthPx), Math.max(1, heightPx));
    },
    stats: () => ({
      rings: rings.size,
      walkPoints: walk.length,
      walkDrawn: drawn,
    }),
    dispose() {
      dropLine();
      for (const mesh of rings.values()) mesh.material.dispose();
      rings.clear();
      ringGeometry.dispose();
      lineMaterial.dispose();
      group.removeFromParent();
    },
  };
}
