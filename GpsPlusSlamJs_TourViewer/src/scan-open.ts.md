# scan-open.ts

## Purpose

Step 4's scan-to-open policy (TourViewer scan-to-open plan,
`GpsPlusSlamJs_Docs/docs/2026-09-27-0725-tour-viewer-creator-scan-to-open-plan.md`
§2, §9). The printed code carries the tour's link, so the first code the
creator's camera reads opens the tour it names; no link is pasted. Per
detection it decides whether to open, switch tours, wait, or stay put, and it
says what the panel should report about the code in view.

## Public API

- `createScanOpen(deps): ScanOpen`
  - `deps.ctx` - the session (reads `session`, `arSessionGeneration`,
    `mintedLevel`, `mintedLevelTour`, `placedObjects`, `finishing`,
    `rebuiltZip`, `rebuiltZipDelivered`).
  - `deps.resolve(text)` - which tour a code names (`codeResolver(proxy)` =
    `resolveCodeTour` bound to the open path's proxy base).
  - `deps.open(url)` - `archive-open`'s open; resolves an `OpenOutcome`
    (`opened`, `superseded`, or `failed` with the framework's reject cause
    or `"other"`), never rejects (a rejection is treated as `other`).
  - `deps.isOpening()` - any open in flight, including a step-1 open.
  - `deps.now()`, `deps.render()`.
- `ScanOpen.onDetection(text)` - a detection in the creator's AR session.
- `ScanOpen.status(text | null): CodeTourStatus` - `quiet`, `opening`,
  `not-a-tour`, `failed {cause, retrying}`, `other-tour`, `other-link`,
  `unknown`;
  `qr-author-mode.ts`'s `codeTourLine` words it.
- `ScanOpen.tourOf(text)` - the normalised link of the tour a code names,
  once read; the mint records it (`ctx.mintedLevelTour`).

## Invariants & assumptions

- **State is minimal.** What a code names is a fact, cached for the page
  (marked "resolving" before the first await, so frames never start a
  second read). Everything else is derived on each call from the session.
  The only kept state is the last failed attempt per tour, tagged with
  `arSessionGeneration`, so a new AR session starts afresh without a
  session-end hook.
- **One open at a time:** none starts while `isOpening()` or a scan-started
  open is in flight.
- **Retries (§9 #7):** only `missing` and `cors` (fixable while standing at
  the poster), after 10 s, then 20, 40, ... capped at 120 s. Anything else is
  final for the AR session.
- **Only a scan-opened tour switches** (owner decision, plan §2): a tour
  the creator opened by its link in step 1 is their explicit choice - the
  case step 1 was kept for is an old print naming another link - so a code
  of another tour is `other-link`: measured into the open tour, Save on,
  never a switch (`ctx.tourOpenedBy`).
- **Switching tours (§9 #3):** a code of another tour opens it only when
  the open tour was scan-opened and nothing unfinished would be lost: no finish running, no placed objects,
  and no measured level unless its rebuilt zip was handed off at least once.
  Otherwise `other-tour`, and `creator-setup` keeps Save off for that code.
- **Work before any tour (§9 #4):** with no tour open, a level measured from
  a code that named tour X waits for X; a code of another tour is
  `other-tour`, not an open. A level whose code named no tour binds nothing.
- **Quiet while a tour is open** about codes that name no tour (a
  third-party code near the poster, §9 #15), and about codes still being
  read.
- `unknown` (a link that cannot be compared) never switches and never locks.

## Examples

```ts
const scanOpen = createScanOpen({
  ctx,
  resolve: codeResolver(corsProxyBaseUrl),
  open: (url) => openUrl(url, "measure-step"),
  isOpening: () => opening,
  now: () => performance.now(),
  render: () => hooks.renderAuthorReadout(),
});
scanOpen.onDetection(event.text); // from the author pipeline
codeTourLine(scanOpen.status(ctx.lastDetectedText)); // in the readout
```

## Tests

`scan-open.test.ts`, with a fake resolver, open and clock:

- opening once however many frames arrive;
- a code naming no tour, with and without a tour open;
- the pre-open level bound to its tour, and one bound to none;
- retry with backoff (10 s, then 20 s), no retry for `corrupt`, afresh in a
  new AR session;
- the open tour's own code, switching when nothing is unfinished, and
  staying put for placements, an unfinished level, an undelivered zip, a
  running finish;
- an uncomparable code;
- `tourOf`.

Three mutations of the policy (switching ignoring unfinished work, ignoring
the pre-open bound, retrying `corrupt`) each fail the suite (checked
2026-09-27).
