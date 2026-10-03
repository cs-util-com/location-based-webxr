# globe-warm-material.ts - keeping a carrier's program warm

- Purpose: frame-hitch review 2026-10-03-2017, H4 together with H2.
  - three deletes a shader program when the last material using it is
    disposed.
  - A carrier whose every tile was unloaded therefore compiled its program
    again when it came back into the altitude band: a hitch, on a phone
    most of all.
  - The tile renderers now retire their tiles' lit materials through a
    retirer instead of disposing them.
- Public API: `createMaterialRetirer()` -> `{ retire(material), kept(),
dispose() }`.
  - `retire` keeps the material alive and frees the one kept before it.
    Retiring the kept one again is a no-op.
  - `kept()` is the material alive now, or null.
  - `dispose()` frees it (the carrier is gone for good).
- Invariants & assumptions:
  - At most one retired material is alive per retirer. Its program
    therefore survives until a newer material of the same carrier
    replaces it.
  - A kept material may still reference a texture its tile's owner
    (the overlay) has freed. It is never drawn, only kept.
- Users: `globe-surface.ts` (the globe's tiles, through
  `disposeLitMaterials`' `retire` argument) and `globe-terrain.ts` (the
  relief's tiles). Each disposes its retirer when it is disposed.
- Tests: `globe-warm-material.test.ts` (the latest kept and the one
  before freed, a repeat retire, a repeat dispose).
  `globe-terrain.test.ts` checks the last tile's material outlives its
  tile until the terrain is disposed. `globe-surface.test.ts` checks
  `disposeLitMaterials` hands its copies to a retirer when given one.
