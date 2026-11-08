# walls.ts

## Purpose

The vertical wall strip of one ring between two heights. Shared by the
building's walls (`extrude.ts`, ground to eaves) and the full-height prism a
ridged roof falls back to (`roof.ts`, eaves to the tagged top).

## Public API

- `addWalls(builder, ring, bottomM, topM, outward): void`
  - appends two triangles per wall to `builder`;
  - `outward`: true for an outer ring, false for a courtyard, whose walls face
    into the yard;
  - adds nothing when `topM <= bottomM` or the ring has fewer than three
    corners; a repeated corner (zero-length wall) is skipped.

## Invariants and assumptions

- The ring may arrive in either winding and with a repeated closing point;
  it is normalised to counter-clockwise (reversed for a hole) before emitting.
- Normals are the outward horizontal wall normal; triangles are emitted
  reversed (`i0, i2, i1`) because the ENU frame with Y up reads a
  counter-clockwise ring as clockwise. The ENU-to-render reflection is
  `MeshBuilder`'s, separately.

## Examples

```ts
const builder = new MeshBuilder();
addWalls(builder, footprint, 0, 7, true);
addWalls(builder, courtyard, 0, 7, false);
```

## Tests

- `mesh-orientation.test.ts` (wall winding and normals for every shape),
  `extrude.test.ts`, and the prism rung in `s3db-roof-tags.test.ts`.
