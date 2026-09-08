# archive-open.ts

## Purpose

The open path: the paste-a-link form and the `?qr=` boot, the streaming
session's lifetime (open, teardown), the live stats panel, the progressive
gallery, and the Storage section's clear-cache control. Transport policy is
the framework's (`openRemoteArchive`) and `tour-session.ts`'s; this is the
DOM glue, its own module since the flows plan M6.

## Public API

- `wireArchiveOpen({ ctx, dom, cacheStore, corsProxyBaseUrl, hooks }): ArchiveOpen`
  - `ArchiveOpenDom { form; linkInput; openButton; statsPanel; statsHeadline; statsDetail; errorBox; gallery; storagePanel; clearCacheButton }`
  - `cacheStore: BoundedLocalCacheStore | undefined` - undefined = no local
    copies (`?nocache=1`, no Cache API); the Storage section then hides.
  - `ArchiveOpen.boot()` - the `?qr=` launch (bare-name payloads resolve
    under the GeoTales raw-GitHub prefix); the caller catches into the
    error box. The only returned entry point (M6 review #6): the
    interactive open is the form listener, and both run the module-private
    `openUrl` - tear down the previous session (which also clears
    `levelByText`), open, render stats, stream the gallery, call
    `hooks.tryPlaceTour()` and `hooks.presentTourForPrint(url)`, load the
    levels (with a `.catch`).

## Invariants & assumptions

- Session-state fields it owns: `session`, `currentLevels`,
  `openGeneration`; a successful open re-derives the scan gate for a
  running session (`hooks.startScanGate`) and its level load's outcome
  reaches the gate either way (`hooks.reconsiderScanGate(levels)` or
  `"unavailable"` on a failed read, M5 review #1);
  `teardownSession` resets the gate (`hooks.resetScanGate`), the seven
  viewer QR/line fields (a lock, its vote count, an unknown or unusable
  code and a failed image placement describe the CLOSING tour - PR #434
  review) and the placement fields the
  closing tour owned (`imagePlanes`, `imagePlanesLoading`,
  `planesRunGeneration` bump, `placementAttempted`, `joinDeclined`,
  `placement`) and the QR controller's level cache.
- **Async-UI rule:** the open button shows "Opening…" BEFORE the first
  await (PR #357 review) and restores only for the generation that owns
  it; the teardown runs INSIDE the try (PR #365 review).
- The gallery streams SEQUENTIALLY; a newer open supersedes an in-flight
  fill per entry; object URLs are revoked on teardown.
- **Clear-cache settles once the store is durably empty, without waiting
  for the warm download** (flows plan M2): `size()` is read FIRST (the open
  session's eviction drops its own copy from the index - review #3), then
  `archive.evict()` (aborts the warm, awaits only a recovery write), then
  `clear()`. Label: "Clearing…" → `clearCacheLabel(count)` → "Clear cache"
  after 2 s; a click during the transient clears the revert timer.
- A rejecting level parse says so in the error box and leaves the
  placement path alive (flows plan review #8).

## Examples

```ts
const archive = wireArchiveOpen({
  ctx,
  dom,
  cacheStore,
  corsProxyBaseUrl: DRIVE_PROXY_BASE_URL,
  hooks,
});
archive.boot().catch((err) => {
  errorBox.textContent = describeOpenError(err);
});
```

## Tests

`playwright-tests/streaming.spec.js` (range streaming, the 200 fallback,
the cached revisit, the changed-ETag refetch, clear cache, clear cache
during a held warm, the hidden Storage section under `?nocache=1`),
`launch-and-errors.spec.js` (the `?qr=` boot, both async-UI states, the
error paths). The logic beneath: `tour-session.test.ts`,
`stats-view.test.ts`, `open-errors.test.ts`, `tour-flow.test.ts`
(`clearCacheLabel`).
