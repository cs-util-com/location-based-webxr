# `mesh/poi-symbols-c.ts` — the ten winners from prototype gallery C

## Purpose

Geometry for the ten kinds whose winner came from source C — eight symbols and
two real-world props (stage 0c, batch C).

**Source:** [`poi-symbol-gallery-c.html`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/poi-prototypes/poi-symbol-gallery-c.html).
The most self-documenting of the five: every variant carries a `note` giving its
own design intent, and those are quoted in the code where they say something a
reader would otherwise have to guess.

## Public API

- `C_SYMBOLS` — the eight family-S winners: `cafe`, `fast_food`,
  `kindergarten`, `community_centre`, `hospital`, `toilets`,
  `place_of_worship`, `attraction`.
- `C_PROPS` — the two family-L winners: `picnic_table`, `bench`.

## Invariants & assumptions

- **TWO MAPS, because C won in both families**, and they take different routes
  into the registry. A symbol is fitted into the 0.9 m envelope and stood on a
  column; a prop is real-world geometry whose height falls out of the mesh.
  Merging them into one map would push that choice to the call site, which is
  the sort of per-entry judgement that eventually gets one wrong.
- **`amenity=fast_food` is a symbol and the other two references are props.**
  C draws the burger on a column and it is the exemplar the whole family is
  calibrated against; a bench on a 1.6 m column would be absurd. DEC-S3 keeps
  family L at real-world scale.
  - **This discharges DEC-S8 rather than cancelling it.** That decision asked
    for the shipped 4.3 m burger to be re-scaled to 2.5 m; adopting a
    symbol-scale drawing does the same job.

### C's conventions, and how they differ from A's

Three of these would each be a silent defect if carried over from batch A:

- **Rotations are RADIANS**, where A's are degrees — a factor of 57.
- **`tor(r, t, arc, ts, rs)` takes its ARC THIRD**, where A's takes it fifth. A
  mis-read gives a full ring where a handle belongs: recognisable, wrong, and
  not something any assertion catches.
- **C's torus is UPRIGHT in XY** and is laid flat with `r:[PI/2,0,0]`. Ours is
  authored flat, so that rotation disappears for a flat hoop — but an upright
  one needs **`rotateX(-PI/2)`, negative**, because the positive quarter turn
  sweeps our arc the other way round and hangs the café cup's half-torus handle
  off the far side.
- `box` and `cyl` are centred and `cyl` is top-radius first, exactly as A's.

### Three helpers reproduced rather than imported

`crossOutline`, `starOutline` and `arcRingOutline` are C's `crossPts`,
`starPts` and `arcRing`. The last is traced — out along the outer radius and
back along the inner — because the package has no curve support and the arch
over the church bell is the only place a curved outline is needed.

### The defect this batch found

**C's bench legs reach 5 mm BELOW zero** — 0.45 m boxes centred at 0.22 — which
is invisible in a gallery that draws them on a pad and half a centimetre of
buried leg in the scene. `propFrom` grounds every port for exactly this reason.
It is the same defect the previous round met with D's picnic-table A-frames, and
it was caught the same way: by the registry-wide contract test, not by review.

## Examples

```ts
const build = C_SYMBOLS.get("amenity=hospital");
const symbol = fittedSymbol(composed(build)); // 0.9 m medic cross
```

## Tests

No test file of its own — geometry is covered by the registry-wide contract,
which applies to every model however it was authored:

- `poi-models.contract.test.ts` — the family-S block, and the building-scale
  list that **shrank twice** as this batch landed (`amenity=hospital` and
  `amenity=place_of_worship` left it).
- `poi-models.test.ts` — the winding guard over every triangle, the ground
  contract that caught the bench, the per-family triangle ceiling, and the
  bench's own dimensions.
