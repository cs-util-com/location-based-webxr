# `mesh/poi-symbols-a.ts` — the eleven symbols from prototype gallery A

## Purpose

Geometry for the eleven kinds whose winning symbol came from source A, the
largest of the five galleries in the stage-0c port (DEC-S15).

**Source:** [`poi-symbol-gallery-a.html`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/poi-prototypes/poi-symbol-gallery-a.html),
checked in beside the plan. The previous round's ports cite a filename in a
Downloads folder that no longer exists; twenty-nine shipped models have a
provenance nobody can now open. That is the mistake this avoids.

## Public API

- `A_SYMBOLS: ReadonlyMap<string, (b: MeshBuilder) => void>` — keyed by the
  `key=value` kind each symbol was picked for.

A **map rather than eleven exports**, so `poi-models.ts` looks a kind up and
throws when it is missing. A silently absent symbol is a marker that quietly
falls back to the generic pin, which reads as a data gap rather than a build
error.

## Invariants & assumptions

- **A symbol is NOT a marker.** These are geometry at the source's own size and
  datum, with the source's own colours. `symbolModel` in `poi-models.ts` fits
  each into the shared 0.9 × 1.1 m envelope and stands it on the shared column
  (DEC-S21), so nothing here knows about 0.9 m, 2.5 m or the column.
- **A's palette is copied verbatim, not mapped onto the house constants.** The
  invariant worth holding is that **no port invents a colour**, not that every
  port stays inside a subset chosen for a different source — the lesson from the
  last port, where asserting our subset flagged ten legitimate prototype
  colours. A also states its own rule (mineral structure, at most one saturated
  accent per symbol), and that is the rule the owner was judging.

### A's conventions, and every one of them is a way to get a port wrong

Learned once and applied eleven times, which is why the port is batched by
source file rather than by kind:

- **`box(w, h, d)` is CENTRED on its placement `y`;** ours takes a BASE. Every
  `y` here is the source's minus half its height. The commonest conversion, and
  the first thing to check when a part sits wrong.
- **`cyl(rTop, rBottom, h, sides)` is TOP-radius first** and centred; ours is
  `prism(bottom, top, …)` from a base. Both swapped, and **no assertion can
  catch an inverted taper** — a cask that tapers the wrong way is still a cask.
  This one has to be read.
- **`tor` is upright in XY and every use rotates it flat with `rx:90`.** Ours is
  authored flat, so that rotation disappears rather than being repeated.
- **`extr` outlines are absolute, not centred**: placing at `y` translates.
- **Rotations are degrees** in the source, radians here.
- **Two combined rotations are a three.js `Euler` in `XYZ` order, which applies
  Z FIRST.** Our stack applies the innermost push first, so those are NESTED
  with `rotateZ` inside. Flattening them into one push applies X first and
  differs by a second-order term — small at these angles, and wrong in a way
  nobody would later find.

### Two deliberate departures

- **`leisure=garden` is A1 and A2 COMBINED** (DEC-S10), at the owner's request:
  a rake and trowel standing in a flower bed. They occupy different volumes, so
  it is a composition rather than a pile, and it degrades in the right order —
  at 300 m the flowers go first and the rake's vertical stroke survives.
  - **It is the heaviest marker in the registry (~910 triangles)** precisely
    because it is two symbols in one. Named in `poi-models.test.ts` rather than
    hidden under a loose bound, and it is the first place to look if the marker
    layer needs triangles back.
- **`amenity=doctors` was not in the owner's pick list.** Chosen because all
  five galleries independently made their variant 1 a stethoscope, so taking A's
  adds no sixth vocabulary. Its two tubes are where `sweptTube`'s polyline
  approximation is most visible; the four-point drop is the one to inspect if it
  reads as kinked.

## Examples

```ts
const build = A_SYMBOLS.get("amenity=pharmacy");
const symbol = fittedSymbol(composed(build)); // 0.9 m capsule, base at y = 0
```

## Tests

No test file of its own — these are geometry, and the assertions that matter
apply to every model however it was authored:

- `poi-models.contract.test.ts` — the family-S block: the marker lands inside
  the envelope, the symbol has geometry that stands alone with its base at zero,
  its bounding box does not depend on the column, and it fits the span clamp.
- `poi-models.test.ts` — the registry-wide contract, including the winding
  guard that covers every triangle of every model, and the triangle ceiling that
  names `leisure=garden` as the outlier.
- `poi-symbol-primitives.test.ts` — the builders these compose from.
