# `mesh/poi-variants-hybrid.ts`

> **Pruned to the winners (DEC-R7b-2a, round 8).** This file was one of
> seven candidate sets the owner compared in the gallery. They chose, the winners
> were adopted into `POI_MODELS`, and every kind in this file that LOST was
> deleted. What remains is the geometry the demo actually renders, so this is now
> a model source rather than a variant source. The registry that used to consume
> it (`poi-variants.ts`) is gone; `poi-models.ts` imports the map directly.

## Purpose

Models the owner asked to be **combined** from two prototypes, rather than picked
from one. Source letter `H`.

One entry so far — `leisure=park`: _"Bei dem Park ist die Variante D am besten.
Am besten die Variante D mit dem, mit der Bank von Variante P."_ D's grass, path
and trees, with P's bench instead of D's.

See [`poi-models.ts.md`](./poi-models.ts.md) for how this builder reaches the
scene — the `poi-variants.ts` registry that used to assemble it was deleted with
the losing models (DEC-R7b-2a) — and
[`poi-variants-d.ts.md`](./poi-variants-d.ts.md) /
[`poi-variants-p.ts.md`](./poi-variants-p.ts.md) for the two parents.

## Public API

- `H_VARIANTS: ReadonlyMap<string, () => MeshData>` — one builder per kind, at
  the DOMINANT parent's scale (D's, here). The registry grounds and rescales.

There is no hybrid palette: a hybrid paints with its parents' palettes, which
live in their own files.

## Invariants & assumptions

- **`H` is not a file.** Every other source letter names a downloaded prototype;
  this one names a request, so no prototype file contains its model.
- **The parents are IMPORTED, not copied.** `parkGroundD` and `benchP` are
  exported from their own files for exactly this, and each is still used by its
  own source's model. A copied bench would drift into two different benches
  under one name.
- **The graft point is the seam, and the split follows it.** `parkGroundD` is
  D's park _minus its bench_, so D's park is "ground + D's bench" and the hybrid
  is "ground + P's bench". Neither is a subset of the other's code.
- **A hybrid is a VARIANT, not an edit to its parent.** If D's park quietly
  gained P's bench, the gallery's D row would no longer be D, and the next
  verdict would be cast on a model nobody had judged. Both rows stand.

### The scale graft, which is not a taste decision

`BENCH_SCALE = 0.34`. The two sources are at different scales: D's park is a
0.8 m plate carrying a 0.26 m bench; P's bench is 0.78 m long and would span the
entire plate. The registry then scales the park to the shipped 4.56 m — a factor
of about 6.4 — so a raw graft would render a **five-metre bench**. At 0.34 the
seat lands near 1.8 m in the world.

No test pins the graft on its own: the registry contract in `poi-models.test.ts`
bounds the whole model's size, not the bench's, so a bench dropped in raw is
caught only by eye.

## Examples

```ts
const build = H_VARIANTS.get("leisure=park");
const mesh = scaledToHeight(
  groundedMesh(build!()),
  markerHeightFor("leisure=park"),
);
```

## Tests

- `poi-models.test.ts` — the registry contract every adopted model meets, run
  by iterating `POI_MODELS` (base at `y = 0`, finite positions and normals,
  outward winding, height matching the shipped model, plausible size, low
  polygon count, per-face painting aligned).
  Nothing asserts that the hybrid is **both** parents (D's ground, P's bench);
  a hybrid that is silently just one parent looks entirely correct.
