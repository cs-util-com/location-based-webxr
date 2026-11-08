# o1-quiet-greens.js

## Purpose

The entry module of the O1 "quiet greens" page, a throwaway look prototype on top of V2. It does five things:

- It keeps V2's buildings.
- It leaves out today's trees, through `omitToday: ["trees"]`.
- It draws mapped trees as muted instanced crowns read from their tags.
- Optionally, it adds trunks with a two-level LOD, and invented trees inside mapped woods, orchards and tree rows.
- It draws hedges, walls and fences in their own quiet colours and sizes.

## Public API

None; this is an entry module. It calls:

```js
startCityLook({
  ...v2Variant,
  id: "o1",
  label: "O1 quiet greens",
  buildingsFor,
  objectsFor,
  omitToday: ["trees"],
});
```

### Link parameters, on top of the harness's

The first four are page toggles:

- `trees=crown|trunk`. Crown only is the default.
- `woods=off|on`. Invented trees inside `landuse=forest`, `natural=wood` and `landuse=orchard`. Off by default.
- `treeh=8|10|12`. The default height of an untagged tree.
- `untagged=neutral|broad`. The form of a tree with no leaf type.

The rest are for sweeps:

- `lod`: the near distance, in metres.
- `wooddensity`: trees per m².
- `woodcap`: the cap on invented trees.
- `tint`: the chroma scale.

`window.__quietGreens` publishes:

- the options;
- the counts per kind;
- the barrier counts and their triangles;
- the triangles per tree at each level;
- the number of trees currently near.

## Invariants

- V2's files are not changed. Barriers are filtered out of the features handed to V2's `buildingsFor`, because V2 extrudes them in the building colour.
  - They are rebuilt with the library's own `buildBarriers`, from copies whose missing `height`/`width` are filled with `barrierStyle`'s values.
  - The navigation index is untouched. It still sees the library's 2 m default and 0.5 m thickness.
- Trees are drawn as one `InstancedMesh` per source (mapped or invented), form and level, plus the trunks.
  - Instances are sorted into near and far only when the camera has moved more than 2 m. No work runs per frame, and no geometry is rebuilt.
  - The tree meshes are not frustum culled, because their bounds would be the whole scene anyway.
- Every mesh holding invented trees carries `userData.cosmetic = true`. Mapped trees are in meshes without it.
- The harness rewrites the link with its four parameters only, and a scene change reloads through it.
  - `history.replaceState` is wrapped to keep this page's parameters.
  - A 15-second `sessionStorage` stash carries them over the scene reload. It is guarded with try/catch; without storage, a scene change just resets the toggles.

## Tests

The pure decisions are in `quiet-greens-rules.js` and its `.test.mjs`. The page was checked by screenshots and the counts it publishes. The lab smoke spec (`city-look.smoke.spec.mjs`) loads every folder with an `index.html`, so it loads this page too.
