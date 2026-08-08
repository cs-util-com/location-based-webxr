# `barrier-gates.ts`

**Purpose.** Decides where a mapped gate opens a solid barrier, and cuts the barrier's centreline there. The narrow answer (DEC-R12-1) to the eighth testing session's report that ways cross barriers with no opening.

## Public API

- `GATE_GAP_M` — how much barrier a gate removes, metres, centred on the node. **6.**
- `GateOpenings` — `{ opensAt(position): boolean; size: number }`. Built once per feature set.
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
- **Measured reach, per site** — barriers whose geometry the rule changes: Cologne 12, Heidelberg 8, Sylt 12, Westminster 10, Tower Bridge 2, Manhattan 1, **Berlin 0, Tokyo 0**. The rule is a complete no-op at two of eight sites, by decision; it fails towards a solid barrier, which reads as OSM tagging rather than as a defect.

## Examples

```ts
import { gateOpenings, splitAtGates } from "./barrier-gates.js";

const gates = gateOpenings(features);
const lines = barrierCentrelines(feature, gates); // splits internally
```

`barrierCentrelines` takes `gates` as a **required** argument, and that is the point: a gap cut in the drawn band but not in the index is an agent detouring through a visible opening; a gap cut in the index but not in the band is an agent walking through a visible wall. An optional argument would let one of the two consumers quietly omit it.

## Tests

- `barrier-gates.test.ts` — the accepted tag set (and the two exclusions), exact-coordinate matching, and every split shape: middle, end, merged, swallowed, none.
- `barrier-gates.property.test.ts` — the claim that matters: **for any bearing and any position on the H3 lattice, some step crosses the wall at the gate**, while the same wall still blocks every crossing step at its far end and blocks everywhere when no gate is mapped. This is where `GATE_GAP_M` is justified.
- `testdata/sites/site-barriers.test.ts` — the per-site reach as literal counts, so a rule that silently becomes a no-op cannot pass for one that works.
