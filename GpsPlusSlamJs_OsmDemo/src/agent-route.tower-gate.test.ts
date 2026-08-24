/**
 * The NPC walks through a gate the mapper attached to the path (DEC-A2).
 *
 * Why this test matters:
 * This is the reported case, end to end and on REAL geometry rather than a
 * synthetic wall. At the Tower of London a footpath runs through the curtain
 * wall and the agent could not follow it, because `barrier-gates.ts` opened a
 * barrier only where a gate node is an exact vertex of the barrier's own way —
 * and OSM puts this gate on the path instead.
 *
 * WHY THE FIXTURE IS INLINE REAL DATA rather than a corpus site. The Tower is
 * OUTSIDE the `london-tower-bridge` extract: that fixture is centred on the
 * bridge (bbox north 51.50668, west -0.07616) and the gate sits at 51.50737 /
 * -0.07638, beyond it on both axes. Re-capturing a larger extract would move
 * every count in `site-barriers.test.ts` for one case, so the three real
 * elements are inlined instead — the wall trimmed to the 29 vertices around the
 * gate, which is still 157 m of it.
 *
 * THE CONTROL IS THE SAME GEOMETRY WITHOUT THE GATE NODE. Without it the wall
 * must still block, or this test would pass on a wall that was never solid — the
 * fixture trap this package keeps finding.
 *
 * Source: OSM way 509001534 (`barrier=city_wall`), way 55342479
 * (`highway=footway`, `bridge=yes`, `layer=1`), node 25620776
 * (`barrier=gate`, "Groups Entrance to the Tower").
 */

import { describe, expect, it } from "vitest";
import { enuFrameAt, type LatLng, type OsmFeature } from "gps-plus-slam-osm";

import { planRoute } from "./agent-route.js";

/** The gate node: 0.17 m off the wall, and a vertex of the bridge. */
const GATE: LatLng = { lat: 51.5073654, lng: -0.0763826 };

/** Way 509001534, the 29 vertices of the curtain wall around the gate. */
const WALL: readonly LatLng[] = [
  { lat: 51.5071785, lng: -0.0749854 },
  { lat: 51.5071555, lng: -0.0749874 },
  { lat: 51.5071572, lng: -0.0750544 },
  { lat: 51.5071809, lng: -0.0750528 },
  { lat: 51.507192, lng: -0.075348 },
  { lat: 51.5071938, lng: -0.0753962 },
  { lat: 51.5071929, lng: -0.0753718 },
  { lat: 51.507194, lng: -0.0753981 },
  { lat: 51.5071997, lng: -0.075541 },
  { lat: 51.5072006, lng: -0.075562 },
  { lat: 51.5071779, lng: -0.075565 },
  { lat: 51.5071811, lng: -0.0756417 },
  { lat: 51.5072037, lng: -0.0756388 },
  { lat: 51.5072072, lng: -0.0757272 },
  { lat: 51.5074482, lng: -0.0767361 },
  { lat: 51.5074316, lng: -0.0767465 },
  { lat: 51.5074341, lng: -0.0767568 },
  { lat: 51.5073707, lng: -0.0767968 },
  { lat: 51.5073671, lng: -0.0767908 },
  { lat: 51.5073627, lng: -0.0767865 },
  { lat: 51.5073577, lng: -0.0767841 },
  { lat: 51.5073525, lng: -0.0767839 },
  { lat: 51.5073475, lng: -0.0767857 },
  { lat: 51.5073429, lng: -0.0767895 },
  { lat: 51.507339, lng: -0.0767951 },
  { lat: 51.5073362, lng: -0.076802 },
  { lat: 51.5073345, lng: -0.0768098 },
  { lat: 51.5073341, lng: -0.076818 },
  { lat: 51.507335, lng: -0.076826 },
];

/** Way 55342479 — the approach bridge, with the gate node as a vertex. */
const BRIDGE: readonly LatLng[] = [GATE, { lat: 51.5072646, lng: -0.0764434 }];

/** 18 m either side of the wall, on the normal through the gate. */
const OUTSIDE: LatLng = { lat: 51.5072144, lng: -0.0764757 };
const INSIDE: LatLng = { lat: 51.5075164, lng: -0.0762895 };

const FRAME = enuFrameAt(GATE);
const flat = { frame: FRAME, field: undefined };

const wallFeature: OsmFeature = {
  type: "way",
  id: 509001534,
  geometry: [...WALL],
  tags: { barrier: "city_wall", historic: "citywalls" },
};
const bridgeFeature: OsmFeature = {
  type: "way",
  id: 55342479,
  geometry: [...BRIDGE],
  tags: { highway: "footway", bridge: "yes", layer: "1" },
};
const gateFeature: OsmFeature = {
  type: "node",
  id: 25620776,
  position: GATE,
  tags: { barrier: "gate", name: "Groups Entrance to the Tower" },
};

/** Metres from the gate to the nearest point of a route. */
function nearestApproachM(route: { position: LatLng }[]): number {
  const gate = FRAME.toEnu(GATE);
  return Math.min(
    ...route.map((step) => {
      const at = FRAME.toEnu(step.position);
      return Math.hypot(at.x - gate.x, at.y - gate.y);
    }),
  );
}

describe("the Tower of London gate", () => {
  it("lets the agent through, and the route uses the gate", () => {
    const route = planRoute(
      [wallFeature, bridgeFeature, gateFeature],
      OUTSIDE,
      INSIDE,
      flat,
    );

    expect(route).toBeDefined();
    // IT WENT THROUGH THE GATE rather than round the end of the trimmed wall.
    // The wall is 157 m long here, so a route round it would stay tens of metres
    // away; GATE_GAP_M is 6, so the opening itself is 6 m wide.
    expect(nearestApproachM(route!)).toBeLessThan(6);
  });

  /**
   * THE CONTROL, and it is what stops this passing on a wall that never blocked.
   * The same wall and the same path, with the gate node removed — the agent must
   * NOT get through. DEC-R12-1's rule fails towards a solid barrier, and this is
   * the assertion that keeps it doing so.
   */
  it("blocks the agent when the gate node is absent", () => {
    const route = planRoute(
      [wallFeature, bridgeFeature],
      OUTSIDE,
      INSIDE,
      flat,
    );

    // ONE UNCONDITIONAL ASSERTION covering both acceptable outcomes: no route at
    // all, or one that went the long way round the wall's end. Branching to a
    // different `expect` per case would make whichever branch stops occurring
    // silently untested.
    const approachM = route === undefined ? Infinity : nearestApproachM(route);
    expect(approachM).toBeGreaterThan(6);
  });
});
