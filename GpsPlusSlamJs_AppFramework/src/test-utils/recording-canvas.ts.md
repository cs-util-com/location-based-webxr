# Recording canvas contexts (test-only helper)

## Purpose

A recording stand-in for `CanvasRenderingContext2D` and the `document.createElement` patch that hands one to every canvas a module creates under jsdom, which has no canvas backend (`getContext` returns null there). One copy for the four canvas-drawing test files of `src/visualization/` (`text-sprite`, `diamond-marker-texture`, the two `wayfinding-hud.entrance` files), which each carried their own until 2026-09-06; a wrong canvas index copied between two of them made a property test vacuous.

## Public API

- **`RecordingContext`** - the recorder's shape, named so an inferred type stays portable: every drawing call a `vi.fn()` (`clearRect`, `save`, `restore`, `translate`, `scale`, `rotate`, `beginPath`, `roundRect`, `rect`, `moveTo`, `arcTo`, `closePath`, `setLineDash`, `stroke`, `arc`, `fill`, `fillText`, `drawImage`), every state property a plain field (`lineDashOffset`, `lineWidth`, `strokeStyle`, `fillStyle`, `globalAlpha`, the four `shadow*`, `font`, `textAlign`, `textBaseline`).
- **`makeRecordingContext(overrides = {}) → RecordingContext`** - a fresh recorder; `overrides` win, and an override of `undefined` models an engine that lacks the method (the `roundRect` fallback tests).
- **`injectContexts(make = makeRecordingContext) → RecordingContext[]`** - patches `document.createElement` so every canvas created from now on gets its own recorder from `make`, collected in creation order; `make` may return null to model a missing backend. Undo with `vi.restoreAllMocks()`.
- **`injectContext(ctx | null)`** - the one-recorder form: every canvas shares `ctx`.

## Invariants & assumptions

- Creation order is the only ordering the array carries. Tests that must tell a module's canvases apart look them up by ROLE when the order can change (the HUD creates a marker's canvases lazily, on the first entrance): the scratch canvas is the one that received `setLineDash`, the texture canvas the one that received `drawImage`. Positional indexing is what produced the copied wrong index above.
- Test-only: lives in `src/test-utils/` (excluded from `tsconfig.app.json`, named in knip's entries), is not a tsdown entry, and must never be imported by production code.

## Examples

```ts
const contexts = injectContexts();
const texture = createDiamondMarkerTexture({ ink: '#fff', accent: '#f2971f' });
texture.apply(computeDiamondEntrance(0, { reducedMotion: false }));
const scratch = contexts.find((c) => c.setLineDash.mock.calls.length > 0)!;
expect(scratch.lineDashOffset).toBe(DIAMOND_ENTRANCE.dashLength);
```

## Tests

No tests of its own; the four importing test files are its proof, and `vi.restoreAllMocks()` in their `afterEach` is what unpatches `createElement`.
