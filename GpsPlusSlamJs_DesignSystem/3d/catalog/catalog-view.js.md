# catalog/catalog-view.js - the catalog in the scene

- Purpose: W5 material catalog plan, M1. One labelled sphere per catalog
  entry, in a grid floating above the city, and the CSS2D labels.
- Public API:
  - `CATALOG_LAYOUT` - origin, pitch, spheres per row, radius.
  - `catalogMaterial(entry)` - the entry's material; a custom shader gets
    its own program cache key.
  - `buildCatalog(entries, layout?)` - `{ group, dispose() }`; the group is
    named "catalog", each mesh by its entry id, casting shadows.
  - `createCatalogLabels(anchor, group, rule?)` - the overlay goes right
    after `anchor` (the canvas), so the panel stays above it; - `{ render(scene,
camera), setSize(w, h), visibleIds(), dispose() }`.
- Invariants & assumptions:
  - Off by default on the page (`catalog=1`), so the page's other tests
    never compile its programs.
  - The grid floats at the swatch height, beyond the swatch rows, clear of
    the pond and of the shadow probes.
  - Labels are HTML (not hidden behind geometry, not shown in immersive AR);
    the framework's `text-sprite.ts` is the path if AR ever needs them.
- Tests: the look-dev smoke test (every entry compiles, one program per
  distinct key, labels near and not far).
