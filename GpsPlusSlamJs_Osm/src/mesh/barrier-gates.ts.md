# `barrier-gates.ts`

**Purpose.** Decides where a mapped gate opens a solid barrier, and cuts the barrier's centreline there. The narrow answer (DEC-R12-1) to the eighth testing session's report that ways cross barriers with no opening.

## Public API

- `GATE_GAP_M` — how much barrier a gate removes, metres, centred on the node. **6.**
- `GATE_ON_BARRIER_M` — how far off a barrier a gate node may sit and still open it, **1 m** (DEC-A2). Only ever used together with the crossing test below.
- `GateOpenings` — `{ opensAt(position): boolean; size: number; offBarrier: OffBarrierGate[] }`. Built once per feature set.
- `OffBarrierGate` (module-private) — `{ position, throughWays }`: a gate node with the geometries of the ways that have a vertex at it. Reachable through `GateOpenings.offBarrier`; not exported, because nothing outside constructs one.
- `gateOpenings(features): GateOpenings` — the gate and entrance **nodes** in a feature list.
- `NO_GATES: GateOpenings` — the pre-DEC-R12-1 behaviour, for callers with no feature list. Passing it is a statement, not a default.
- `splitAtGates(line, gates, minPieceM): readonly (readonly LatLng[])[]` — `line` with a gap removed around every gate **on** it. `[line]` when there is no gate; `[]` when the line is short enough to be swallowed by its own gate. `minPieceM` is the shortest surviving piece worth keeping — callers pass the feature own `thicknessM`.

## Invariants & assumptions

- **A gap opens ONLY at a mapped gate or entrance node, never at a way crossing.** Measured over the corpus: `retaining_wall` is the largest crossing kind at two of six original sites, and a road crossing one in plan is normally running above or below the embankment it holds up. The `layer` tag that would separate those cases is absent at three of six. An invented opening lets an agent walk through a wall that is really there, which is the louder failure.
- **The accepted tag set** (DEC-R12-7) is `barrier` ∈ {`gate`, `lift_gate`, `swing_gate`, `kissing_gate`, `stile`, `cycle_barrier`, `entrance`} **or any `entrance=*`**. `barrier=bollard` is excluded: measured over the corpus it bought exactly one extra opening, and it is the one candidate that is street furniture rather than a way through. `barrier=entrance` is included as the strongest member — it is the tag that means literally "a gap in a barrier". On the `entrance` key the check is a value test too: `entrance=no` and `entrance=none` are excluded, because a presence test opened a wall at the one node OSM took the trouble to deny.
- **Nodes only.** A gap is a point on a barrier; a `barrier=gate` mapped as a way is a gate drawn as a line, and treating its vertices as openings would cut the wall it is attached to.
- **"On the barrier's own way" is EXACT coordinate identity, not proximity and not node-id membership.** `OsmWay` carries inlined geometry and explicitly no node references (`out geom` exists to avoid resolving them), and Overpass emits the same node's coordinates identically wherever they appear — the same fact `positionsEqual` relies on for ring stitching. An epsilon here would be the "plausible-but-wrong" match that docstring warns about: a gate _near_ a wall it is not part of. A gate lying between two vertices of a way therefore opens nothing, and that is correct: a node that belongs to a way IS a vertex of it.
- **Overlapping gaps merge, and a stranded sliver is dropped.** Two gate nodes a metre apart are one gateway mapped twice, and merging is what stops a sliver between them. Gates JUST OVER a gap apart — 0 m and 5.2 m — do not merge and leave 0.2 m of wall stranded in the middle of a 7.7 m opening: a visible stub in the gap and a quad in the index a step can still hit. So the surviving pieces are filtered by LENGTH against the barrier own thickness, not by point count — the stranded piece has two perfectly good points.
- **`GATE_GAP_M` is bounded from below by the pathfinder, not by typicality.** Blocking is a property of the STEP between two res-13 cell centres, whose spacing is ~6 m, so a gap much narrower than that is drawn and unusable — a visible opening the agent walks around, which reads as a pathfinding bug rather than as a width constant. `barrier-gates.property.test.ts` states this directly and fails at 1 m. **Six rather than five, measured:** five passed the property at 40 alignments and failed roughly one run in four at 300 — about one alignment in twelve hundred with no step through the gate at all. Six passed 1 200 alignments clean. A property that is 99.9 % true is a flaky test AND a gate that occasionally does not open.
- **A gate BESIDE the barrier opens it only with corroboration** (DEC-A2). A gate node within `GATE_ON_BARRIER_M` of the centreline opens it **iff** some way with a vertex at that node also **crosses** the centreline within the same distance of the node. This is additive: every opening the exact rule above produced is produced identically, so the per-site counts can only grow.
  - **Why the conjunction is the whole design.** Each half alone is a rule this package already rejected — proximity is the "gate near a wall it is not part of" above, and a bare crossing is the measured-and-rejected "cut wherever a way crosses". Requiring both means OSM has said two independent things: _there is an opening here_ and _a route passes through here_.
  - **Why it was needed.** At the Tower of London the gate node ("Groups Entrance to the Tower") sits **0.17 m** from the curtain wall and belongs to two footways, one of which crosses the wall **0.17 m from the node** — the mapper attached the gate to the path rather than to the wall, so the exact rule could never fire and the NPC could not cross.
  - **The tolerance is sized from that case, not from taste.** A gate belonging to a different fence is metres away, not centimetres.
  - **A crossing must be near the GATE**, not anywhere along the way, or a long path would open a wall it happens to cross half a kilometre from its gate.
  - **A collinear overlap is not a crossing**: a path running _along_ a wall is not a way through it.
  - **A gate BELOW THE SURFACE opens nothing beside it**, and this was found by the corpus measurement rather than reasoned. The rule’s first version opened Cologne’s `way/160630326` (`barrier=retaining_wall`) from node 1591065517 — `entrance=yes` **`layer=-1`**, “Zugang Südturm” — an underground access on a retaining wall that nobody can walk through at ground level. `isBelowSurface` is applied to the OFF-BARRIER rule only; the exact rule is DEC-R12-1’s and is not revisited here.
- **Measured reach, per site** — barriers whose geometry the rule changes: Cologne 12, Heidelberg 8, Sylt **13**, Westminster 10, Tower Bridge 2, Manhattan 1, **Berlin 0, Tokyo 0**. The rule is a complete no-op at two of eight sites, by decision; it fails towards a solid barrier, which reads as OSM tagging rather than as a defect.
  - **DEC-A2 added exactly ONE opening across all eight sites** — `sylt-westerland: way/740958910` (`barrier=wall`, stone). That the reach is this small is the evidence the conjunction is narrow enough to adopt.
  - **Tower Bridge is unchanged and that is not a failure**: the Tower of London is outside that extract (bbox north 51.50668 / west −0.07616; the gate is at 51.50737 / −0.07638).

## Examples

```ts
import { gateOpenings, splitAtGates } from "./barrier-gates.js";

const gates = gateOpenings(features);
const lines = barrierCentrelines(feature, gates); // splits internally
```

`barrierCentrelines` takes `gates` as a **required** argument, and that is the point: a gap cut in the drawn band but not in the index is an agent detouring through a visible opening; a gap cut in the index but not in the band is an agent walking through a visible wall. An optional argument would let one of the two consumers quietly omit it.

## Tests

- `barrier-gates.test.ts` — the accepted tag set (and the two exclusions), exact-coordinate matching, and every split shape: middle, end, merged, swallowed, none.
  - The DEC-A2 block is mostly **negative**, which is where the design lives: a gate beside the wall on a crossing way opens it (the Tower case), while the same gate with no crossing way, a crossing way with no gate, a gate too far from the wall, a gate whose way never reaches the wall, and a gate mapped as a way all leave it whole.
- `agent-route.tower-gate.test.ts` (in `GpsPlusSlamJs_OsmDemo`) — the end-to-end proof on **real** geometry: the NPC routes through the Tower gate, and the same fixture **without** the gate node still blocks it.
- `barrier-gates.property.test.ts` — the claim that matters: **for any bearing and any position on the H3 lattice, some step crosses the wall at the gate**, while the same wall still blocks every crossing step at its far end and blocks everywhere when no gate is mapped. This is where `GATE_GAP_M` is justified.
- `testdata/sites/site-barriers.test.ts` — the per-site reach as literal counts, so a rule that silently becomes a no-op cannot pass for one that works.
