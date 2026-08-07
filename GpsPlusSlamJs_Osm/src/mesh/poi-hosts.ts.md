# `mesh/poi-hosts.ts` — where a marker goes when its thing is already drawn

## Purpose

The rule behind DEC-S1 and DEC-S2: a POI whose feature is already on screen as
geometry either **moves onto it** (a symbol over a building's roof) or **gives
way to it** (an area that describes itself). Everything else stays at its node.

## Public API

- `resolvePoiPlacement(marker, enabledLayers): PoiPlacement` — the whole rule.
- `PoiPlacement` — `{at:"node"}` | `{at:"host", host, liftM, scale}` |
  `{at:"suppressed", host}`.
- `PoiHostAnchor`, `HostableMarker`, `PoiHostLayer`.
- `hostMatches(kind, host)`, `hostScale(spanM)`, `footprintAnchor(footprint)`,
  `HOST_CLEARANCE_M`.

## Invariants & assumptions

- **A PURE FUNCTION OVER PRE-RESOLVED HOSTS, and the shape is forced by the
  pipeline rather than chosen.** Two facts, both read from the code rather than
  assumed:
  - **A layer toggle does not re-run the worker.** `main.ts` rebuilds three.js
    objects from the cached payload so that toggling is cheap, so a rule needing
    the layer set cannot live in the worker — it would read a stale one.
  - **Plates are clipped to the rendered extent and built after the markers.**
    "The way exists" and "the plate is drawn" are different claims; a pool near
    the tile edge is clipped away entirely. Matching against features rather
    than drawn geometry would delete the marker and draw nothing.
- **`enabledLayers` is what the caller is DRAWING.** A host on a disabled layer
  is not a host. Suppressing against geometry nobody can see is the data loss
  DEC-S1 exists to prevent, and it is live rather than theoretical: `plates` is
  off by default (DEC-R7b-5), so the naive rule would make every swimming pool
  invisible under the shipped settings.
- **The kind rule is ASYMMETRIC, and that is DEC-S7.** Strict membership for the
  four AREA kinds, where a wrong match **deletes** a marker; any building for
  symbol kinds, where a wrong match only **moves** one onto a roof. The
  aggressive rule is used exactly where being wrong is cheap — and the strict
  reading alone would miss the case the feature exists for, a restaurant node
  inside a way tagged only `building=yes`, which is most of real OSM.
- **A building never suppresses.** A grey box does not say "restaurant"; the
  symbol above it is the only thing that does. Only self-describing areas —
  pool, pitch, parking, parking space — replace their marker.
- **Anchors are ENU, x east and y NORTH, never scene coordinates.** The
  `+y north → -z` reflection belongs to `poiMarkerPosition` in the demo. A `z`
  here would be a second, disagreeing convention on the same wire, and getting
  it wrong renders a symbol 50 m south of its building, labelled correctly —
  a data error to look at, a frame error in fact.
- **The symbol grows over a large host, clamped 1×–3×** (DEC-S6). A 0.9 m symbol
  on a 60 m hospital roof is invisible from the orbit camera; an unclamped scale
  puts a ten-metre knife and fork on a stadium. **The bounds are a guess and the
  most likely thing to look wrong first** — cheap to change, worth looking at
  specifically in the first review.
- **`footprintAnchor` uses the VERTEX mean, not the area centroid**, with a
  stated bias: a curved frontage traced with many points pulls the anchor toward
  the dense side. It stays on the roof for any convex-ish building, and for the
  L-shape where it is worst the true area centroid can fall **outside** the
  polygon — so neither is right and the cheap one is honest about it.
- **Degenerate inputs return the safe answer, never `NaN`.** A zero-span host
  scales to 1 and an empty footprint anchors at the origin, because one `NaN` in
  a transform removes the object from the scene with nothing reported.

## Examples

```ts
const placement = resolvePoiPlacement(marker, new Set(["buildings"]));
if (placement.at === "host") {
  // draw `model.symbol` at (host.x, host.topM + placement.liftM, host.y),
  // scaled by placement.scale
}
```

## Tests

`poi-hosts.test.ts` — 15 examples, weighted toward the inverse cases because
those are where a marker disappears:

- No host at all, and an empty host list, both stay at the node — the common
  case by far, and the one this rule must be invisible to.
- A café moves onto its building; a pool gives way to its plate.
- **The same pool KEEPS its marker when `plates` is off** — the assertion
  DEC-S1 exists for.
- A plate does not host a café; a building does not host a pool. Both directions
  of the asymmetry.
- Several hosts: the first enabled one wins, and disabling it falls through to
  the next rather than giving up.
- `hostScale` clamped at both ends and safe on degenerate spans.
- `footprintAnchor`'s middle, its empty case, and its stated vertex-mean bias.
