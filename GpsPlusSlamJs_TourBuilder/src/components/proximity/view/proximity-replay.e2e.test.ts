import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { replayRecording } from "gps-plus-slam-app-framework/state";
import { Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  ProximityObject,
  StepConfig,
  ZoneState,
  ZoneTransition,
} from "../core/proximity-machine.js";
import { createProximityDriver } from "./proximity-driver.js";

/**
 * Replay e2e (TASK.md §2.3 component 4, second test level): feed a REAL outdoor
 * walk recorded in Task 1 through the pure machine and assert the zone
 * transitions behave correctly on genuinely noisy GPS+IMU data — deterministic,
 * on a desktop, no phone (plan Q9 "replay-then-iterate").
 *
 * We replay the recording once, take the user's ordered world-space path
 * (`odometryPositions`), synthesize waypoint anchors *from that same path* so the
 * whole test lives in one self-consistent metric frame (plan Q10 — no alignment
 * matrix, no geo math needed; distance is rigid-transform-invariant), then feed
 * every sample through `createProximityDriver` — the exact impure half the
 * composed app runs, with its default movement-epsilon gate live. That the
 * assertions below hold with the gate enabled is the proof the gate is
 * behaviour-preserving on real GPS noise, not just on synthetic poses.
 *
 * The assertions are geometry-derived, not hand-tuned (plan Q11):
 *  - **deepest zone reached == what the real minimum distance implies** — proves
 *    a pass-through waypoint reaches ACTIVE, a near-miss reaches only
 *    PREFETCHING, and a far one stays IDLE;
 *  - **no illegal skip** — every emitted edge is between adjacent zones (D15);
 *  - **unimodal zone sequence** — on a single fly-by the zone rank rises then
 *    falls and never bounces back up; this is the no-flicker proof *on real
 *    noise* (the fractional hysteresis band, D16, is what makes it hold);
 *  - **timing (soft)** — ACTIVE is first entered near the sample of closest
 *    approach, within a generous tolerance.
 */

const CONFIG: StepConfig = { hysteresisFraction: 0.15 }; // contract default h
const PREFETCH_R = 25;
const ACTIVE_R = 10;

const RANK: Record<ZoneState, number> = { IDLE: 0, PREFETCHING: 1, ACTIVE: 2 };

/** Normalise a recorded odometry entry (stored as a tuple) to a Vector3. */
function toVec(p: unknown): Vector3 {
  if (Array.isArray(p)) {
    return new Vector3(Number(p[0]), Number(p[1]), Number(p[2]));
  }
  const o = p as { x: number; y: number; z: number };
  return new Vector3(o.x, o.y, o.z);
}

function horizontal(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Non-decreasing then non-increasing (allows plateaus). */
function isUnimodal(ranks: readonly number[]): boolean {
  let i = 1;
  while (i < ranks.length && ranks[i]! >= ranks[i - 1]!) i++;
  while (i < ranks.length && ranks[i]! <= ranks[i - 1]!) i++;
  return i === ranks.length;
}

interface WaypointCase {
  readonly obj: ProximityObject;
  readonly expectedDeepest: ZoneState;
}

describe("proximity replay e2e — real Task 1 walk", () => {
  let path: Vector3[];
  let cases: WaypointCase[];

  beforeAll(async () => {
    const zipPath = fileURLToPath(
      new URL(
        "../../../../recordings/2026-06-22_16-06-59utc.zip",
        import.meta.url,
      ),
    );
    const state = await replayRecording(new Uint8Array(readFileSync(zipPath)));
    path = state.gpsData!.gpsEvents.odometryPositions.map(toVec);

    // Synthesize anchors FROM the path (plan Q10):
    const passA = path[Math.floor(path.length * 0.3)]!.clone();
    const passB = path[Math.floor(path.length * 0.7)]!.clone();
    // Near-miss: offset a mid point ~17 m to the side so the closest approach
    // lands inside the prefetch band (25) but never the active band (10).
    const nearMissBase = path[Math.floor(path.length * 0.5)]!;
    const nearMiss = new Vector3(
      nearMissBase.x,
      nearMissBase.y,
      nearMissBase.z + 17,
    );
    // Far: nowhere near the walk.
    const far = new Vector3(
      nearMissBase.x,
      nearMissBase.y,
      nearMissBase.z + 200,
    );

    const mk = (id: string, position: Vector3): ProximityObject => ({
      id,
      position,
      prefetchRadius: PREFETCH_R,
      activeRadius: ACTIVE_R,
    });

    cases = [
      { obj: mk("pass-a", passA), expectedDeepest: "ACTIVE" },
      { obj: mk("pass-b", passB), expectedDeepest: "ACTIVE" },
      { obj: mk("near-miss", nearMiss), expectedDeepest: "PREFETCHING" },
      { obj: mk("far", far), expectedDeepest: "IDLE" },
    ];
  });

  it("drives every synthesized waypoint correctly along the real walk", () => {
    expect(path.length).toBeGreaterThan(50);
    const objects = cases.map((c) => c.obj);

    // Replay-then-iterate: feed every recorded sample through the real driver
    // (default movement-epsilon gate), mirroring the composition's store
    // round-trip — `onTransition` applies the edge, `getZones` reads it back.
    const zones: Record<string, ZoneState> = Object.fromEntries(
      objects.map((o) => [o.id, "IDLE"]),
    );
    const zoneSeq = new Map<string, ZoneState[]>(
      objects.map((o) => [o.id, []]),
    );
    const edges = new Map<string, ZoneTransition[]>(
      objects.map((o) => [o.id, []]),
    );
    let userPos = path[0]!;
    const driver = createProximityDriver({
      getUserWorldPos: () => userPos,
      getObjects: () => objects,
      getZones: () => zones,
      onTransition: (t) => {
        edges.get(t.id)!.push(t);
        zones[t.id] = t.to;
      },
      config: CONFIG,
    });
    for (const p of path) {
      userPos = p;
      driver.tick();
      for (const o of objects) zoneSeq.get(o.id)!.push(zones[o.id]!);
    }

    for (const { obj, expectedDeepest } of cases) {
      const seq = zoneSeq.get(obj.id)!;
      const ranks = seq.map((z) => RANK[z]);

      // Geometry: the minimum horizontal distance actually achieved on the walk.
      let minDist = Infinity;
      let argmin = 0;
      path.forEach((p, i) => {
        const d = horizontal(p, obj.position);
        if (d < minDist) {
          minDist = d;
          argmin = i;
        }
      });
      const geomDeepest: ZoneState =
        minDist <= ACTIVE_R
          ? "ACTIVE"
          : minDist <= PREFETCH_R
            ? "PREFETCHING"
            : "IDLE";

      // The stated expectation and the geometry must agree (locks the fixture).
      expect(geomDeepest, `${obj.id} geometry (minDist=${minDist})`).toBe(
        expectedDeepest,
      );

      // Deepest zone actually reached matches the geometry.
      const reached = seq.reduce(
        (m, z) => (RANK[z] > RANK[m] ? z : m),
        "IDLE" as ZoneState,
      );
      expect(reached, `${obj.id} deepest reached`).toBe(expectedDeepest);

      // No illegal skip: every edge is between adjacent zones.
      for (const e of edges.get(obj.id)!) {
        expect(
          Math.abs(RANK[e.to] - RANK[e.from]),
          `${obj.id} ${e.from}->${e.to} adjacent`,
        ).toBe(1);
      }

      // No flicker on real noise: the zone sequence is unimodal (single fly-by),
      // and the total edge count never exceeds a full up-and-down (≤4).
      expect(isUnimodal(ranks), `${obj.id} unimodal`).toBe(true);
      expect(
        edges.get(obj.id)!.length,
        `${obj.id} edge count`,
      ).toBeLessThanOrEqual(4);

      // Soft timing ("roughly the expected times"): at the moment of closest
      // approach a pass-through waypoint is ACTIVE — i.e. the knight is visible
      // exactly when the visitor is nearest it, not at some unrelated point.
      const activeAtClosest =
        expectedDeepest !== "ACTIVE" || seq[argmin] === "ACTIVE";
      expect(activeAtClosest, `${obj.id} active at closest approach`).toBe(
        true,
      );
    }
  });
});
