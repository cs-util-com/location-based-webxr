/**
 * What the approach's arrival draws in the tour's frame besides the
 * stations themselves: one fading ring on the ground around each station
 * as it pops in, and the recorded walk drawing itself as a line through
 * the walk's camera captures, in their order. Both live in one group under
 * the tour's frame (x east, y up, z south at the tour's centre), so a
 * recentre of the globe's frame moves nothing.
 *
 * The walk's line is three's screen-space line (`Line2`), 3 px wide in
 * the shell's accent colour, as the chosen prototype draws its route. Its
 * geometry is built once per walk; a share of it is drawn by showing the
 * segments up to that share of its length and cutting the last one there
 * (its end point written in place), so a frame of the walk's drawing
 * uploads one point, not a new line.
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

/** Where a share of the walk ends: in segment `segment` (from point
 *  `segment` to the next), at `t` (0 to 1) along it. */
export interface WalkCut {
  readonly segment: number;
  readonly t: number;
}

/**
 * Where the first `share` (0 to 1, more is 1) of a walk ends by its
 * length, `along` the walk's length up to each point (`along[0]` 0): the
 * first segment whose end reaches that length, and how far along it.
 * Fewer than two points, a walk of no length or a share that is not a
 * number above 0 give null.
 */
export function walkCut(
  along: readonly number[],
  share: number,
): WalkCut | null {
  const total = along[along.length - 1] ?? 0;
  if (along.length < 2 || !(total > 0) || !(share > 0)) return null;
  const left = total * Math.min(1, share);
  let i = 0;
  while (i < along.length - 2 && along[i + 1]! < left) i++;
  const d = along[i + 1]! - along[i]!;
  return { segment: i, t: d === 0 ? 1 : (left - along[i]!) / d };
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
  /** The walk's length up to each point (`along[0]` 0). */
  let along: number[] = [];
  let line: Line2 | null = null;
  /** The segment whose end is cut, null for none. */
  let cutSegment: number | null = null;
  let drawn = 0;
  let drawnShare = -1;
  let walkOn = true;

  /** The segments' end points, as the line's geometry holds them. */
  const endsOf = (l: Line2) =>
    l.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;

  /** The cut segment's end put back where the walk has it. */
  const uncut = (l: Line2) => {
    if (cutSegment === null) return;
    const b = walk[cutSegment + 1]!;
    endsOf(l).setXYZ(cutSegment, b.x, b.y, b.z);
    cutSegment = null;
  };

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
      along = [0];
      for (let i = 1; i < walk.length; i++) {
        along.push(along[i - 1]! + walk[i]!.distanceTo(walk[i - 1]!));
      }
      drawn = 0;
      drawnShare = -1;
      cutSegment = null;
      dropLine();
      const total = along[along.length - 1] ?? 0;
      if (walk.length < 2 || !(total > 0)) return;
      const geometry = new LineGeometry();
      geometry.setPositions(walk.flatMap((p) => [p.x, p.y, p.z]));
      geometry.instanceCount = 0;
      line = new Line2(geometry, lineMaterial);
      line.name = "approach-walk";
      line.visible = false;
      line.computeLineDistances();
      group.add(line);
    },
    drawWalk(share) {
      const k = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 1));
      if (k === drawnShare) return;
      drawnShare = k;
      const l = line;
      if (l === null) {
        drawn = 0;
        return;
      }
      uncut(l);
      const ends = endsOf(l);
      // A line has two points and a length, so only a share of 0 cuts
      // nothing.
      const cut = walkCut(along, k);
      if (cut === null) {
        drawn = 0;
        l.geometry.instanceCount = 0;
        l.visible = false;
        ends.data.needsUpdate = true;
        return;
      }
      const i = cut.segment;
      if (cut.t < 1) {
        const at = walk[i]!.clone().lerp(walk[i + 1]!, cut.t);
        ends.setXYZ(i, at.x, at.y, at.z);
        cutSegment = i;
      }
      ends.data.needsUpdate = true;
      l.geometry.instanceCount = i + 1;
      l.visible = walkOn;
      drawn = i + 2;
    },
    showWalk(on) {
      walkOn = on;
      if (line !== null) line.visible = on && drawn > 0;
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
