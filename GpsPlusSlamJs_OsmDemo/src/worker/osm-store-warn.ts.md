# worker/osm-store-warn.ts - the worker's tile-store warnings, on the logger

- Purpose: the framework's `OpfsOsmBlobStore` no longer imports the logger
  (so it loads in the design system's no-build labs; round-5 plan
  `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md` §3.6) and
  warns through an injected `warn`. This is the worker's `warn`: the
  framework logger tagged `OsmBlobStore`, so a failed cache write or listing
  is logged, buffered and reported as a Sentry Issue exactly as before.
- Public API: `osmStoreWarn(message, details)` (an `OsmBlobStoreWarn`).
- Invariants: `demo-worker.ts` opens its store with
  `openOsmStore({ warn: osmStoreWarn })`. The globe lab's prefetch cannot
  load the logger (it imports `@sentry/browser`) and keeps the store's
  `console.warn` default.
- Example: `const store = await openOsmStore({ warn: osmStoreWarn });`
- Tests: `osm-store-warn.test.ts` - the warning lands in the logger's buffer
  under `OsmBlobStore` at WARN, and a source-text check that the worker
  passes it (the worker cannot be instantiated in a unit test; the same
  trade as `plate-clip-call-site.test.ts`).
