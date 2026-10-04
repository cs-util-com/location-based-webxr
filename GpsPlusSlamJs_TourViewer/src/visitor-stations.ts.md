# visitor-stations.ts

## Purpose

The visitor's stations, composed (tour kit plan K4): the station guide
(`station-guide.ts`), the story panel (`scene-view.ts`), the AR stage
(`scene-stage.ts`) and the one sound channel (`scene-audio.ts`), wired to
the page's session object, store and seams. Glue: the behaviour is tested
in those modules, the composition in `playwright-tests/stations.spec.js`.

## Public API

- `wireVisitorStations({ ctx, mode, arStore, seams, dom, now, schedule }):
VisitorStations` - `{ tick, codeLocked, unlockAudio, stop }` (properties,
  handed to the hooks unbound).

## Invariants & assumptions

- The tour is read from the session object each time: `ctx.tourManifest`
  (settled) for the stations, the order and the assets, `ctx.currentLevels`
  for a code-only station's spot, `ctx.ignoredCodes` for the D20 veto,
  `ctx.movedCodeChecks` (its `snapshot()` through `checkHadItsWindow`) for
  the guide's hold of a code lock (K4 review R1), and the store's zero for
  the visitor's raw fix position.
- Placement is allowed for a visitor with a live session
  (`ctx.placementUnsubscribe`) and a gate that allows it
  (`gateAllowsPlacement`, DEC-N3): the stations wait behind the scan gate
  like the tour's other content.
- Media are read through `ctx.session.loadContentEntry` (K0's allowlist and
  `.glb` check, K1's per-entry hash check), ahead of time as the visitor
  approaches (`station-prefetch.ts`; the story's own reads go through the
  same cache). The cache lives with the open tour's manifest
  (`ctx.tourManifest`, by identity): kept across AR sessions, dropped when
  the tour closes or another opens (K4 review R15). A figure is decoded by the framework's
  `decodeFrameTexture`, one at a time through a `keyed-chain` key and at
  `decodeDivisor(asset size)` (the decode cap); a model by
  `seams.loadGlbModel`.
- The breadcrumbs (`breadcrumbs.ts`) follow the guide's `onGuide`, one
  trail for the page.
- The assets by id are built once per manifest (K4 review R13).
- A choice button is a `.btn` with `data-testid="scene-choice"`.
- `stop()` stops the story and the HUD; the guide keeps the progress with
  the open tour, and the prefetch its cache unless the tour closed.

## Examples

```ts
const stations = wireVisitorStations({
  ctx,
  mode,
  arStore,
  seams,
  dom,
  now,
  schedule,
});
hooks.tickStations = stations.tick;
```

## Tests

- `playwright-tests/stations.spec.js` (the composition).
