# `mesh/poi-symbols-bde.ts` — the last six winners, from galleries B, D and E

## Purpose

Geometry for the six kinds whose winner came from one of the three small
sources: four from B (`school`, `post_office`, `bank`, `sports_centre`), one
from D (`bar`) and one from E (`post_box`). Completes stage 0c's 27.

**Sources:** `poi-symbol-gallery-b.html`, `-d.html`, `-e.html` under
`GpsPlusSlamJs_Docs/docs/poi-prototypes/`.

## Public API

- `B_SYMBOLS`, `D_SYMBOLS`, `E_SYMBOLS` — one map per source, keyed by kind.

## Invariants & assumptions

- **ONE FILE FOR THREE SOURCES, unlike A and C.** The batching rule exists
  because port cost is dominated by learning a file's conventions, paid once per
  source however many models come from it. Two of these sources contribute a
  single model, so three files plus three sidecars would be more ceremony than
  content. The conventions are still written down per source, and the maps stay
  separate so provenance is never in doubt.
- **Three more placement conventions, agreeing on almost nothing:**
  - **B** uses one array, `[x, y, z, rx, ry, rz, sx, sy, sz]` — position first,
    radians, and an optional **non-uniform scale our transform stack has no
    equivalent for**.
  - **D** uses loose trailing arguments `(…, x, y, z, rx, ry, rz)`, and its
    sphere is an **icosahedron** rather than a UV sphere — a different facet
    pattern that ours cannot reproduce and does not need to on a 0.1 m olive.
  - **E** uses `[x, y, z]` centre arrays with separate `size` arrays and
    trailing rotations.
  - All three centre boxes and cylinders and take the cylinder's **top radius
    first**, which is the one convention every gallery shares and the one our
    `prism` inverts.

### Three departures worth knowing

- **`amenity=bank`'s pediment is re-expressed, not replayed.** B draws it as a
  three-sided cylinder rotated a quarter turn and then scaled `(1.65, 1, 0.60)`.
  We have no non-uniform scale — adding one means an inverse-transpose for the
  normals, real work for one part — and a triangular prism **is** an extruded
  triangle, so it is built as one at the dimensions that composition produces:
  0.86 wide, 0.23 tall, 0.18 deep, pointing up. Stated because deriving the
  orientation from three chained transforms is easy to get mirrored and
  impossible to notice afterwards.
- **`amenity=bar` is D1 alone**, though the owner picked D1 and D3 (DEC-S11).
  They are the same idea twice — a violet martini bowl and a magenta tumbler —
  and combining them puts two 0.7 m glass shapes side by side, a blob at orbit
  distance. It would also destroy what D3 was drawn for: D's own note calls it
  _"a rectangular profile distinct from the pub mug"_, a profile that exists
  only while it is alone. Overrulable in one line.
- **`amenity=post_box` is E1, the German yellow box — NOT the British pillar box
  the owner asked for in the voice note.** E2 is that. The pick stands as
  written; this is the one winner that contradicts an explicit spoken request,
  so it is the one to check first when the set is reviewed.

## Examples

```ts
const build = B_SYMBOLS.get("leisure=sports_centre");
const symbol = fittedSymbol(composed(build)); // 0.9 m dumbbell
```

## Tests

Covered by the registry-wide contract, like the other ported sources. **This
batch is the one that emptied the building-scale list**: with `bank` and
`sports_centre` ported, no kind in the registry is 8 m any more, so
`poi-models.contract.test.ts` now asserts that list is `[]` — kept as a guard in
the other direction, and `poi-building-overlap.ts` became inert. See its test
file for the two containment cases that are owed to stage 1.
