/**
 * `barrier-gates.ts` — where a mapped gate opens a wall.
 *
 * Why this test matters:
 * The eighth testing session reported ways crossing barriers with no opening,
 * and offered a hypothesis the code ruled out: the OSM way really is continuous
 * there. So the question stopped being "are we drawing it wrong" and became
 * "when may we cut". DEC-R12-1 answers it as narrowly as possible — ONLY where
 * OSM explicitly maps a gate or entrance node on the barrier's own way — because
 * the measured alternative (cut at any way crossing) would invent openings, and
 * an invented opening lets an agent walk through a wall that is really there.
 *
 * The assertions below are therefore mostly about what does NOT open: a gate
 * near a wall, a gate on a different way, a gate mapped as a way rather than a
 * node, and a bollard (excluded by DEC-R12-7 for buying one opening across the
 * whole corpus while being the one value that could invent a hole).
 *
 * @see barrier-gates.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-08-1330-osm-demo-eighth-testing-session-user-feedback.md §4 DEC-R12-1, §5 DEC-R12-7
 */

import { describe, expect, it } from "vitest";

import {
  GATE_GAP_M,
  NO_GATES,
  gateOpenings,
  splitAtGates,
} from "./barrier-gates.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";

/** A metre in degrees of latitude, close enough for a test fixture. */
const M = 1 / 111_320;

const ORIGIN: LatLng = { lat: 51.5, lng: -0.1 };

/** A point `metres` north of the origin — the axis every wall here runs along. */
function north(metres: number): LatLng {
  return { lat: ORIGIN.lat + metres * M, lng: ORIGIN.lng };
}

function node(
  id: number,
  position: LatLng,
  tags: Record<string, string>,
): OsmFeature {
  return { type: "node", id, position, tags };
}

/** Length of a polyline in metres. */
function lengthM(line: readonly LatLng[]): number {
  const frame = enuFrameAt(line[0] ?? ORIGIN);
  let total = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = frame.toEnu(line[i]!);
    const b = frame.toEnu(line[i + 1]!);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

describe("gateOpenings", () => {
  it("collects the node tags DEC-R12-7 accepts", () => {
    const openings = gateOpenings([
      node(1, north(0), { barrier: "gate" }),
      node(2, north(10), { barrier: "lift_gate" }),
      node(3, north(20), { barrier: "swing_gate" }),
      node(4, north(30), { barrier: "kissing_gate" }),
      node(5, north(40), { barrier: "stile" }),
      node(6, north(50), { barrier: "cycle_barrier" }),
      // `barrier=entrance` is the one tag that means literally "a gap in a
      // barrier", so excluding it would exclude the value that states the rule's
      // own premise.
      node(7, north(60), { barrier: "entrance" }),
      node(8, north(70), { entrance: "main" }),
      node(9, north(80), { entrance: "yes" }),
    ]);

    for (const metres of [0, 10, 20, 30, 40, 50, 60, 70, 80]) {
      expect(openings.opensAt(north(metres))).toBe(true);
    }
  });

  it("does NOT accept a bollard (DEC-R12-7)", () => {
    // Measured: including it bought exactly one extra opening across the whole
    // six-site corpus, and it is the one accepted-set candidate that is street
    // furniture rather than a way through — so it is the one value that could
    // invent a hole in a real wall.
    const openings = gateOpenings([node(1, north(0), { barrier: "bollard" })]);
    expect(openings.opensAt(north(0))).toBe(false);
  });

  it("does NOT accept a gate mapped as a WAY", () => {
    // A gap is a POINT on a barrier. A `barrier=gate` way is a gate drawn as a
    // line — itself an obstacle-shaped thing — and treating its vertices as
    // openings would cut the wall it is attached to.
    const openings = gateOpenings([
      {
        type: "way",
        id: 1,
        geometry: [north(0), north(1)],
        tags: { barrier: "gate" },
      },
    ]);
    expect(openings.opensAt(north(0))).toBe(false);
  });

  it("matches on EXACT coordinates, because that is what node identity is here", () => {
    // WHY EXACT, AND WHY THAT IS SOUND. The model carries inlined geometry and
    // explicitly no node references (`out geom` exists to avoid resolving them),
    // so "the gate is ON this way" cannot be a membership test. It does not need
    // to be: Overpass emits the same node's coordinates identically wherever
    // they appear, which `positionsEqual` already documents and relies on for
    // ring stitching. An epsilon here would be the "plausible-but-wrong" match
    // that docstring warns about — a gate near a wall it is not part of.
    const openings = gateOpenings([node(1, north(0), { barrier: "gate" })]);
    expect(openings.opensAt(north(0))).toBe(true);
    expect(openings.opensAt({ lat: ORIGIN.lat + 1e-9, lng: ORIGIN.lng })).toBe(
      false,
    );
  });
});

describe("splitAtGates", () => {
  /** A straight 100 m wall running north, with a vertex every 10 m. */
  const wall: readonly LatLng[] = Array.from({ length: 11 }, (_, i) =>
    north(i * 10),
  );

  it("leaves a wall with no gate exactly as it was", () => {
    // The default must be "solid": DEC-R12-1 fails towards an unbroken barrier,
    // which reads as OSM tagging rather than as a pathfinding defect.
    expect(splitAtGates(wall, NO_GATES)).toEqual([wall]);
  });

  it("cuts a wall in two at a gate in the middle", () => {
    const gates = gateOpenings([node(1, north(50), { barrier: "gate" })]);
    const parts = splitAtGates(wall, gates);

    expect(parts).toHaveLength(2);
    // The gap is centred on the gate node, so each part stops half a gap short
    // of it. Asserted as a LENGTH rather than as coordinates: the cut point is
    // interpolated, and pinning its digits would test the arithmetic rather than
    // the behaviour.
    expect(lengthM(parts[0]!)).toBeCloseTo(50 - GATE_GAP_M / 2, 1);
    expect(lengthM(parts[1]!)).toBeCloseTo(50 - GATE_GAP_M / 2, 1);
  });

  it("does NOTHING for a gate that lies between two vertices rather than on one", () => {
    // THE PRECISE MEANING OF "ON THE BARRIER'S OWN WAY", and it is a claim about
    // OSM rather than about geometry: a gate node that belongs to a way IS a
    // vertex of that way, because that is how ways are built. A node merely
    // sitting on the line between two vertices belongs to something else, and
    // opening the wall for it would require a distance test — an epsilon, which
    // is exactly the proximity match DEC-R12-1 rejected. The same 50 m gate cuts
    // the vertexed wall above and leaves this one whole.
    const gates = gateOpenings([node(1, north(50), { barrier: "gate" })]);
    const coarse: readonly LatLng[] = [north(0), north(100)];
    expect(splitAtGates(coarse, gates)).toEqual([coarse]);
  });

  it("shortens rather than splits when the gate is at an END of the wall", () => {
    const gates = gateOpenings([node(1, north(0), { barrier: "gate" })]);
    const parts = splitAtGates(wall, gates);
    expect(parts).toHaveLength(1);
    expect(lengthM(parts[0]!)).toBeCloseTo(100 - GATE_GAP_M / 2, 1);
  });

  it("merges two gates closer together than one gap into a single opening", () => {
    // Two gate nodes a metre apart are one gateway mapped twice, not two. A
    // naive per-gate cut would emit a sliver of wall between them that is
    // narrower than the barrier is thick.
    const gates = gateOpenings([
      node(1, north(50), { barrier: "gate" }),
      node(2, north(51), { barrier: "gate" }),
    ]);
    const parts = splitAtGates(wall, gates);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(lengthM(part)).toBeGreaterThan(GATE_GAP_M);
  });

  it("removes a short wall entirely when a gate swallows it", () => {
    // A 2 m fence stub with a gate on it is a gate, not a fence. Emitting two
    // sub-metre bands instead would be geometry too small to see and too small
    // to path around.
    const gates = gateOpenings([node(1, north(0), { barrier: "gate" })]);
    expect(splitAtGates([north(0), north(2)], gates)).toEqual([]);
  });

  it("never emits a line with fewer than two points", () => {
    // A one-point "line" can be neither drawn nor indexed, and both consumers
    // assume at least a direction.
    const gates = gateOpenings([
      node(1, north(0), { barrier: "gate" }),
      node(2, north(100), { barrier: "gate" }),
    ]);
    for (const part of splitAtGates(wall, gates)) {
      expect(part.length).toBeGreaterThanOrEqual(2);
    }
  });
});
