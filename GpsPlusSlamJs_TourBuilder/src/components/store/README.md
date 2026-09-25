# src/components/store — the Component-3 demo page

The standalone demo for the shared store contract (TASK.md §2.3 component 3).
The contract itself — types, validator, slices, selectors, factories — lives at
the `src/` root in `src/store/` (see `src/store/README.md`); this directory holds only
the demo page that exercises it, keeping the layout "one runnable demo per
component" like every other `src/components/<name>/`.

`demo.ts` builds both real store factories (`createViewingStore` /
`createAuthoringStore`) in the browser — which also smoke-proves they construct
through the framework — and wires a button per action (load/clear tour, visit a
waypoint, zone transitions, the authoring draft actions). Each panel re-renders
its app slices as formatted JSON on every dispatch via `store.subscribe()`; the
framework base slices are hidden to keep the state readable.

No Three.js, no GPS. Run it via `pnpm dev` → `/components/store/`.

Tests live with the contract (`src/store/store.test.ts`,
`src/store/parse-tour-json.test.ts`), not here — the demo is manual-verification
only, like the other view layers.
