# catalog/catalog-view.js - the catalog in the scene

- Purpose: W5 material catalog plan, M1. One labelled sphere per catalog
  entry, in a grid floating above the city, and the CSS2D labels.
- Public API:
  - `CATALOG_LAYOUT` - origin, pitch, spheres per row, radius.
  - `catalogMaterial(entry)` - the entry's material; a custom shader gets
    its own program cache key.
  - `buildCatalog(entries, layout?)` - `{ group, dispose() }`; the group is
    named "catalog", each mesh by its entry id, casting and receiving
    shadows (a sphere's shadow lands on its neighbours).
  - `createCatalogLabels(anchor, group, rule?)` - the overlay goes right
    after `anchor` (the canvas), so the panel stays above it; only
    labels whose anchor is inside the camera frustum compete for the rule's
    K (an off-screen anchor counts as infinitely far; round-3 review,
    finding 1); - `{ render(scene,
camera), setSize(w, h), visibleIds(), dispose() }`.
- Invariants & assumptions:
  - On by default on the page since round 3 (plan 2026-09-27-0532,
    DEC-FB3-5; `catalog=0` turns it off). The smoke boot pins it off, so
    the page's other tests never compile its programs.
  - The grid floats at the stand-in scene's float height (105 m), north of
    the pond, clear of it and of the shadow probes. Since round 3 the old
    white and gold swatches are its third row (`ramp.js`, DEC-FB3-1), so
    the page has one set of spheres at one spacing.
  - Labels are HTML (not hidden behind geometry, not shown in immersive AR);
    the framework's `text-sprite.ts` is the path if AR ever needs them.
- Tests: the look-dev smoke test (every entry compiles, one program per
  distinct key, labels near and not far).
