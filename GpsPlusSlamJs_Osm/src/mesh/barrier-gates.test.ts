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
  GATE_ON_BARRIER_M,
  NO_GATES,
  gateOpenings,
  splitAtGates,
} from "./barrier-gates.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { DEFAULT_BARRIER_THICKNESS_M } from "./barriers.js";
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

  it("does NOT accept `entrance=no`, which says the opposite", () => {
    // THE ONE CASE WHERE THE DATA CONTRADICTS THE CONCLUSION. `entrance=no` is a
    // real if uncommon value meaning this node is explicitly NOT an entrance, so
    // opening a wall there would invent the one opening OSM took the trouble to
    // deny. The `barrier` key is checked against a value allowlist for exactly
    // this reason; the `entrance` key had degraded to a presence test.
    const openings = gateOpenings([
      node(1, north(0), { entrance: "no" }),
      node(2, north(10), { entrance: "none" }),
    ]);
    expect(openings.opensAt(north(0))).toBe(false);
    expect(openings.opensAt(north(10))).toBe(false);
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
    expect(splitAtGates(wall, NO_GATES, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
      wall,
    ]);
  });

  it("cuts a wall in two at a gate in the middle", () => {
    const gates = gateOpenings([node(1, north(50), { barrier: "gate" })]);
    const parts = splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M);

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
    expect(splitAtGates(coarse, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
      coarse,
    ]);
  });

  /**
   * A gate the mapper attached to the PATH instead of to the wall (DEC-A2).
   *
   * Why these tests matter:
   * At the Tower of London a footpath runs through the curtain wall and the demo
   * drew the wall solid, so the NPC could not cross. The cause is not a bug in
   * the rule above — it is the rule's own blind spot, which `barrier-gates.ts`
   * anticipated and accepted ("paths will still meet unbroken walls in places").
   * Measured on the real data: node 25620776 (`barrier=gate`, "Groups Entrance
   * to the Tower") sits **0.17 m** from city wall 509001534 and belongs to two
   * footways, one of which crosses the wall **0.17 m from the gate node** — so
   * the gate IS the crossing point, just attached to the wrong way.
   *
   * DEC-A2 opens the wall only where the data says TWO independent things: there
   * is an opening here (a gate node), AND a route passes through here (a way
   * through that node that actually crosses the barrier). Each half alone is a
   * rule this package already rejected — proximity is DEC-R12-7's "a gate NEAR a
   * wall it is not part of", and a bare crossing is DEC-R12-1's measured-and-
   * rejected "cut wherever a way crosses". The three negative cases below are
   * therefore the load-bearing ones.
   */
  describe("a gate NEAR the wall, on a way that crosses it (DEC-A2)", () => {
    /**
     * A path running east-west across the wall, WITH `at` as a vertex.
     *
     * The gate must be a vertex, not merely a point the line passes through:
     * "a way through this gate node" is coordinate identity against the way's
     * own vertices, the same membership test the exact rule uses. That is how
     * the real data is shaped — the Tower's approach bridge has the gate node
     * as one of its two vertices.
     */
    const crossingAt = (at: LatLng): readonly LatLng[] => [
      { lat: at.lat, lng: at.lng - 5 * M },
      at,
      { lat: at.lat, lng: at.lng + 5 * M },
    ];

    /** The gate node, offset off the wall by `offsetM` as a mapper would leave it. */
    const gateNear = (metres: number, offsetM: number) => ({
      position: { lat: north(metres).lat, lng: ORIGIN.lng + offsetM * M },
      atWall: north(metres),
    });

    function way(id: number, geometry: readonly LatLng[]): OsmFeature {
      return { type: "way", id, geometry, tags: { highway: "footway" } };
    }

    it("opens the wall, which is the Tower case", () => {
      const gate = gateNear(50, 0.2);
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        // The crossing path passes THROUGH the gate node, exactly as the Tower's
        // approach bridge does.
        way(2, crossingAt(gate.position)),
      ]);

      const parts = splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M);
      expect(parts).toHaveLength(2);
      expect(lengthM(parts[0]!)).toBeCloseTo(50 - GATE_GAP_M / 2, 0);
    });

    it("does NOT open it without a crossing way — proximity alone is DEC-R12-7's rejection", () => {
      const gate = gateNear(50, 0.2);
      const gates = gateOpenings([node(1, gate.position, { barrier: "gate" })]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    it("does NOT open it without a gate node — a crossing alone is DEC-R12-1's rejection", () => {
      // The measured reason that rule was thrown out: `retaining_wall` is the
      // most-crossed kind, and a road crossing one in plan normally runs above
      // or below the embankment it holds up.
      const gates = gateOpenings([way(2, crossingAt(north(50)))]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    it("does NOT open it for a gate too far from the wall, however real its path", () => {
      // A gate genuinely belonging to a different fence is metres away, not
      // centimetres — which is what keeps the tolerance from becoming the
      // epsilon DEC-R12-7 rejected.
      const gate = gateNear(50, GATE_ON_BARRIER_M * 4);
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        way(2, crossingAt(gate.position)),
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    it("does NOT open it when the way through the gate never reaches the wall", () => {
      // The conjunction is about ONE place: a gate beside the wall whose path
      // runs away from it is not a gateway, and the crossing test is what says
      // so. The Tower's own `tunnel=yes` stub is exactly this shape — it holds
      // the gate node but crosses the wall zero times.
      const gate = gateNear(50, 0.2);
      const stub: readonly LatLng[] = [
        gate.position,
        { lat: gate.position.lat, lng: gate.position.lng + 5 * M },
      ];
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        way(2, stub),
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    /**
     * FOUND BY THE CORPUS MEASUREMENT, not by reasoning — which is why DEC-A2
     * required one before adoption. The rule's first version added a second
     * opening at Cologne, on `way/160630326` (`barrier=retaining_wall`, the very
     * kind DEC-R12-1 named when it rejected a bare crossing rule). The cause was
     * node 1591065517 — `entrance=yes` **`layer=-1`**, "Zugang Südturm" — an
     * underground access sitting on a retaining wall. A person walking at ground
     * level cannot pass through it, so cutting the wall there was an invented
     * opening.
     */
    it("does NOT open it for a gate that is below the surface", () => {
      const gate = gateNear(50, 0.2);
      const gates = gateOpenings([
        node(1, gate.position, { entrance: "yes", layer: "-1" }),
        way(2, crossingAt(gate.position)),
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    /**
     * THE BOUNDARY THE RULE ACTUALLY TURNS ON (raised in review on #277). Every
     * other case here uses 0.2 m or 4 m, so nothing exercised the interval that
     * decides anything. `GATE_ON_BARRIER_M` is the whole tolerance argument, and
     * an off-by-a-comparison in `nearestOnLine` would be invisible without this.
     *
     * The offsets are in LONGITUDE degrees scaled by a latitude metre, so at
     * 51.5° N they are ~0.62 of their nominal size — hence the generous margins
     * either side rather than 0.99 / 1.01.
     */
    it("opens just inside the tolerance and refuses well outside it", () => {
      const opens = (offsetM: number): boolean => {
        const gate = gateNear(50, offsetM);
        const gates = gateOpenings([
          node(1, gate.position, { barrier: "gate" }),
          way(2, crossingAt(gate.position)),
        ]);
        return (
          splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M).length === 2
        );
      };
      expect(opens(GATE_ON_BARRIER_M)).toBe(true);
      expect(opens(GATE_ON_BARRIER_M * 3)).toBe(false);
    });

    /**
     * A PERPENDICULAR CROSSING IS THE EASIEST POSSIBLE INPUT for both
     * `nearestOnLine` and `segmentCrossing`, and every other case here uses one.
     * The Tower's own bridge meets its wall at a shallow angle.
     */
    it("opens for a way crossing at an angle, not only square-on", () => {
      const gate = gateNear(50, 0.2);
      const slanted = [
        { lat: gate.position.lat - 8 * M, lng: gate.position.lng - 5 * M },
        gate.position,
        { lat: gate.position.lat + 8 * M, lng: gate.position.lng + 5 * M },
      ];
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        way(2, slanted),
      ]);
      expect(
        splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M),
      ).toHaveLength(2);
    });

    /**
     * A WAY THAT ENDS ON THE WALL STILL COUNTS, and this pins it as a decision
     * (raised in review on #277). `segmentCrossing`'s bounds are inclusive, so a
     * dead end abutting the barrier corroborates — which is right, because a
     * footway terminating at a gate in a wall IS a gateway, and mapping it as a
     * stub rather than as a line through is the mapper's style, not a claim that
     * the wall is solid. Without this test, tightening the intersection to
     * strict inequalities would close that class silently.
     */
    it("opens for a way that ENDS on the wall rather than crossing it", () => {
      const gate = gateNear(50, 0.2);
      // Runs in from the east and STOPS on the wall line, with the gate as its
      // first vertex — a T-junction, not a line through.
      const deadEnd = [
        gate.position,
        { lat: gate.position.lat, lng: ORIGIN.lng },
      ];
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        way(2, deadEnd),
      ]);
      expect(
        splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M),
      ).toHaveLength(2);
    });

    /**
     * ONLY A ROUTE CORROBORATES (raised in review on #277). The first version
     * indexed every way, so a building outline or another wall could vouch for a
     * gate — and `entrance=*` nodes are overwhelmingly building-outline
     * vertices, which makes "building entrance + outline + nearby fence" the
     * most likely false positive in real data. It was not hypothetical: at Sylt
     * one `barrier=wall` corroborated another.
     */
    it("does NOT open it when the crossing way is not a route", () => {
      const gate = gateNear(50, 0.2);
      const outline = crossingAt(gate.position);
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        {
          type: "way",
          id: 2,
          geometry: [...outline],
          tags: { barrier: "wall" },
        },
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    /**
     * AND THE VETO IS SYMMETRIC (raised in review on #277). A below-surface gate
     * node was already refused; a below-surface WAY through a surface gate is
     * the same argument — a tunnel passing under a wall is not a way through it,
     * which is DEC-R12-1's rejected failure mode arriving from the other side.
     */
    it("does NOT open it when the crossing way is below the surface", () => {
      const gate = gateNear(50, 0.2);
      const gates = gateOpenings([
        node(1, gate.position, { barrier: "gate" }),
        {
          type: "way",
          id: 2,
          geometry: [...crossingAt(gate.position)],
          tags: { highway: "footway", tunnel: "yes" },
        },
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });

    it("still refuses a gate mapped as a WAY, even where a path crosses", () => {
      // DEC-R12-1's exclusion is unchanged: a `barrier=gate` way is a gate drawn
      // as a line, an obstacle-shaped thing in its own right.
      const gates = gateOpenings([
        {
          type: "way",
          id: 1,
          geometry: [north(50), north(51)],
          tags: { barrier: "gate" },
        },
        way(2, crossingAt(north(50))),
      ]);
      expect(splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)).toEqual([
        wall,
      ]);
    });
  });

  it("shortens rather than splits when the gate is at an END of the wall", () => {
    const gates = gateOpenings([node(1, north(0), { barrier: "gate" })]);
    const parts = splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M);
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
    const parts = splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(lengthM(part)).toBeGreaterThan(GATE_GAP_M);
  });

  it("removes a short wall entirely when a gate swallows it", () => {
    // A 2 m fence stub with a gate on it is a gate, not a fence. Emitting two
    // sub-metre bands instead would be geometry too small to see and too small
    // to path around.
    const gates = gateOpenings([node(1, north(0), { barrier: "gate" })]);
    expect(
      splitAtGates([north(0), north(2)], gates, DEFAULT_BARRIER_THICKNESS_M),
    ).toEqual([]);
  });

  it("emits no fragment too small to be a barrier, between two gates just over a gap apart", () => {
    // THE CASE THE MERGE TEST ABOVE DOES NOT REACH, because that one uses gates
    // CLOSER than one gap. Gates 5.2 m apart give cuts [-2.5, 2.5] and
    // [2.7, 7.7], which do not overlap — so a naive filter emits the 0.2 m of
    // wall between them: a visible stub floating in the middle of a 7.7 m
    // opening, and a ~0.2 x 0.5 m quad in the index that a step between two cell
    // centres can still hit. That is precisely the "drawn and unusable" outcome
    // GATE_GAP_M is bounded from below to prevent, arriving from the other side.
    const gates = gateOpenings([
      node(1, north(0), { barrier: "gate" }),
      node(2, north(5.2), { barrier: "gate" }),
    ]);
    const wall2: readonly LatLng[] = [
      north(0),
      north(5.2),
      north(50),
      north(100),
    ];

    for (const part of splitAtGates(
      wall2,
      gates,
      DEFAULT_BARRIER_THICKNESS_M,
    )) {
      expect(lengthM(part)).toBeGreaterThan(DEFAULT_BARRIER_THICKNESS_M);
    }
  });

  it("never emits a line with fewer than two points", () => {
    // A one-point "line" can be neither drawn nor indexed, and both consumers
    // assume at least a direction.
    const gates = gateOpenings([
      node(1, north(0), { barrier: "gate" }),
      node(2, north(100), { barrier: "gate" }),
    ]);
    for (const part of splitAtGates(wall, gates, DEFAULT_BARRIER_THICKNESS_M)) {
      expect(part.length).toBeGreaterThanOrEqual(2);
    }
  });
});
