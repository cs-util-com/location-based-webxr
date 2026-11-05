# globe-city-worker.ts

## Purpose

The globe editor's city worker shell: the Globe package's worker core
(`createCityWorkerCore` from `gps-plus-slam-globe/city-worker`) wired to
the Osm library's city API, to the browser's persistent tile store
(`openPersistentOsmStore`, an in-memory store where none opens) and to
the worker's `postMessage`. The data parse and the city's build run here,
off the page's main thread.

## Public API

- `CITY_WORKER_USER_AGENT` - how the editor identifies itself to the
  Overpass operators.
- The worker's messages are the core's: `{ kind: "load", id, target,
zoom, heightsUrl?, firstRings? }` and `{ kind: "abort", id }`; replies
  `progress`, `city`, `settled`, `finished` (see the core's sidecar in the
  Globe package).

## Invariants & assumptions

- Made by `editor3d-globe.ts` as
  `new Worker(new URL("./globe-city-worker.ts", import.meta.url), { type: "module" })`,
  so Vite bundles it with its imports.
- All logic and validation are the core's; this file only wires it.

## Examples

```ts
const worker = new Worker(new URL("./globe-city-worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage({ kind: "load", id: 1, target: { lat, lng }, zoom: 12 });
```

## Tests

`globe-city-worker.test.ts`: the shell answers a load whose target is no
place with the core's refusal. The full path (Overpass and heights
routed) runs in `../../playwright-tests/editor3d-globe-buildings.spec.js`.
