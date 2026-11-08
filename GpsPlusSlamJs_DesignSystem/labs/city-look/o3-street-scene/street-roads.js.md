# street-roads.js

Purpose: O3's road ribbons, in two join styles the owner compares on his phone (owner, 2026-11-08: "Erst Gehrungs-Streifen im Labor", before any library M4a):

- `discs`: the library's shape (a quad per segment, an 8-segment round disc at the joins, DEC-R2-13) with the disc dropped only at near-straight interior points. The owner judged it buggy on curves: the dropped discs leave a sawtooth of notches on the outer side.
- `mitre`: one continuous strip per way with mitre joins and a bevel beyond a mitre limit, the standard way of stroking a polyline (map renderers, SVG `stroke-linejoin: miter`). Discs stay at ends and junctions only.

Both share the vertical order by class and the per-vertex data for the kerb-edge shading. Pure: no three.js, no DOM.

## Public API

- `ROAD_PARAMS`: disc segments 8, `straightDeg` 10, rank step 2 cm, disc drop 1 cm, tie lift up to 8 mm, edge widths 0.22 m (car) and 0.08 m (path), `mitreLimit` 2, `kerbTaperM` 1 (the kerb fade length beside a junction, mitre style).
- `JOIN_STYLES`: `["discs", "mitre"]`.
- `mitreStrip(points, half, { breaks, mitreLimit })`: one way's strip. Returns counter-clockwise ENU triangles (each vertex `{ x, y, offset }`, offset +-half), the indices that take a disc (ends, `breaks`, fallbacks), and counts of mitres, bevels and fallbacks plus `maxOvershootM` (the furthest a mitre corner reaches past the round join, `h / cos(t/2) - h`).
- `SIDEWALK_RGB` (0xc6b49c) and `streetColour(tags, base)`: a `footway=sidewalk` way is lighter than a path but stays warm (the class wins, DEC-R7b-4); everything else keeps `base`.
- `rankOf(tags)`: paths 0, track and service 1, residential, living_street and unclassified 2, everything else 3.
- `isStreetWay(feature)`: `roads.ts`'s `isRoad` for ways (no tunnels, covered or areas).
- `turnDegrees(a, b, c)`, `wedgeGapM(half, deg)` (the outer chord `2 h sin(t/2)`), `junctionKeys(ways)`.
- `pushTriangle(out, rgb, a, b, c)`: winds every triangle to face up; a vertex is `[x, y, height, offset, half, edge]` in ENU metres.
- `rgbOf(packed)`: raw /255, as the library's chunk meshes.
- `buildRibbons(ways, { widthOf, colourOf, straightDeg, maxGapM, joinStyle, mitreLimit })` returns `{ positions, colours, street, stats }`. `stats` holds ways, points, discs kept and dropped, quad, join (bevel) and disc triangles, the widest notch and the total notch area, and for the mitre style mitres, bevels, fallbacks and the largest overshoot. `joinStyle` defaults to `"discs"`; `straightDeg` and `maxGapM` apply to it only. RangeError for an unknown style.

## Invariants

- `straightDeg: 0` reproduces today's triangle count exactly (checked against Heidelberg: 8,884 both ways).
- Ends and junctions (points shared by two ways, or visited twice) always keep their disc.
- `maxGapM` keeps a disc whose dropping would open a chord wider than it, so wide roads keep their joins at angles where narrow paths lose them.
- Deterministic: the tie lift comes from a hash of the OSM key.
- Consecutive duplicate points are dropped before building.
- `joinStyle: "discs"` is the output from before the mitre style existed, byte for byte (pinned by digests in the mitre test).
- Mitre style:
  - A mitre joins at the point on the bisector of the two segment normals, `h / cos(t/2)` from the centre, shared by both segments: no wedge, no notch, no overlap at the join.
  - Above `mitreLimit` (the ratio `1 / cos(t/2)`; 2 bevels turns over 120 degrees, 1.5 over 96) the outer side is bevelled: its two plain corners plus one fill triangle. The inner side keeps the mitre point.
  - **Inner-side guard: a disc fallback, not a clamp.** Where the inner mitre point would run more than half way along either neighbouring segment (`h tan(t/2) > len / 2`, or a hairpin), the point takes a disc and the strip breaks there, as at a junction. Why not clamp: a clamped inner point no longer lies on both edge lines, so the strip there is not a stroke of the centre line any more and the kerb shading goes wrong; and the half-length budget is what guarantees that two joins on one short segment can never cross, which a per-join clamp does not. The fallback is rare on real data and costs 8 triangles where it fires.
  - Every strip vertex lies on an edge line and carries offset +-half, so the kerb edge runs continuously along the whole strip, with no line across the road at interior points.
  - Triangles: 2 per segment, 1 per bevel, 8 per disc.
  - **Kerb fade at junctions (the dark lines across the road).** The dark lines in the discs style are kerb shading, not geometry: they vanish with kerb edges off. Where a way runs into another, the way drawn on top keeps its kerb edges inside the other's surface, and every junction disc carries a kerb ring. The mitre style therefore cuts each way at `reach` and `reach + kerbTaperM` from each of its junction nodes (collinear cuts; a cut within 5 cm of a point or another cut is skipped) and scales the kerb width from 0 at the node, through 0 up to `reach`, to full at `reach + kerbTaperM`. `reach` is the largest half width of the OTHER ways at that node (its own half for a self-visit), so the kerb starts where the crossing road's surface ends. Junction discs carry no kerb ring. Cost: about 1,900 extra triangles in Heidelberg (5,164 to 7,060). Not covered: ways that overlap without a shared node keep a faint line, and footway kerbs over pedestrian areas are unchanged. The discs style is untouched.

## Example

```js
const built = buildRibbons(ways, {
  widthOf: roadWidthM,
  colourOf: roadColour,
  straightDeg: 10,
  maxGapM: 0.1,
});
```

## Tests

- `street-roads.test.mjs` (`node --test`): today's count at 0, straight ways, bends, junctions, winding, determinism, sidewalk colour, ranks, the chord formula, the gap limit.
- `street-roads-mitre.test.mjs`: the discs style's digests, a straight way, the near-straight curve with no notch (the owner's defect), mitre against bevel at 90 and 130 degrees, the disc fallback, a junction, edge offsets, the kerb fade at a T junction, and a seeded property test over 750 random polylines at limits 1.05-4 (no folded triangle, every segment's half-width rectangle covered, every mitred outer wedge covered, triangles = 2 per segment + bevels).
