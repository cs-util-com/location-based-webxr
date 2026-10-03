# scan-open.ts

## Purpose

Step 4's scan-to-open policy (TourViewer scan-to-open plan,
`GpsPlusSlamJs_Docs/docs/2026-09-27-0725-tour-viewer-creator-scan-to-open-plan.md`
§2, §9, §13). The printed code carries the tour's link, so the first code
the creator's camera reads with no tour open opens the tour it names; no link
is pasted. Once a tour is open there is no wrong code (§13, owner): a code of
another tour is one more reference for the open tour, measured into it,
never a switch. Per detection it decides whether to open, and it says what
the panel should report about the code in view.

## Public API

- `createScanOpen(deps): ScanOpen`
  - `deps.ctx` - the session (reads `session`, `arSessionGeneration`,
    `mintedLevel`, `mintedLevelTour`).
  - `deps.resolve(text)` - which tour a code names (`codeResolver(proxy)` =
    `resolveCodeTour` bound to the open path's proxy base).
  - `deps.open(url)` - `archive-open`'s open; resolves an `OpenOutcome`
    (`opened`, `superseded`, or `failed` with the framework's reject cause
    or `"other"`), never rejects (a rejection is treated as `other`).
  - `deps.isOpening()` - any open in flight, including a step-1 open.
  - `deps.now()`, `deps.render()`.
- `ScanOpen.onDetection(text)` - a detection in the creator's AR session.
- `ScanOpen.status(text | null): CodeTourStatus` - `quiet`, `opening`,
  `not-a-tour`, `failed {cause, retrying}`, `measured-for-another {label}`,
  `added-to-open-tour`, `unknown`; `qr-author-mode.ts`'s `codeTourLine`
  words it. No status locks Save.
- `ScanOpen.tourOf(text)` - the normalised link of the tour a code names,
  once read; the mint records it (`ctx.mintedLevelTour`).

## Invariants & assumptions

- **State is minimal.** What a code names is a fact, cached for the page
  (marked "resolving" before the first await, so frames never start a
  second read). Everything else is derived on each call from the session.
  The only kept state is the last failed attempt per tour, tagged with
  `arSessionGeneration`, so a new AR session starts afresh without a
  session-end hook.
- **Opens only with no tour open.** Once a tour is open, a code of another
  tour is `added-to-open-tour` and a link that cannot be compared is
  `unknown`; both are measured into the open tour like its own codes. To
  edit another tour: step 1's link, or reload and scan its code first
  (plan §13, which superseded the switching rules of §9 #3, §11, §12 #1).
- **One open at a time:** none starts while `isOpening()` (the open path's
  own flag, set before its first await). A code is acted on as soon as it
  is read, while it is still the code in view (milestone review #9).
- **Retries (§9 #7):** only `missing`, `cors` and `offline` (fixable while
  standing at the poster; `offline` was split out of `cors` by tour kit
  plan K0), after 10 s, then 20, then every 30 s (milestone review #10).
  Anything else is final for the AR session.
- **Work before any tour (§9 #4):** with no tour open, a level measured from
  a code that named tour X waits for X; a code of another tour is
  `measured-for-another`, not an open - and Save stays on, so a new
  measurement can replace that level (milestone review #6). A level whose
  code named no tour binds nothing.
- **Quiet while a tour is open** about codes that name no tour (a
  third-party code near the poster, §9 #15), and about codes still being
  read.

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

- opening once, on the first sighting, however many frames arrive, and none
  while a step-1 open is in flight;
- a code naming no tour, with and without a tour open;
- the pre-open level bound to its tour, a stale binding, one bound to none;
- retry with backoff (10 s, 20 s, then capped at 30 s), `cors` and `offline` retried, no
  retry for `corrupt`, a rejecting open, a superseded open not counted,
  afresh in a new AR session;
- with a tour open: its own code quiet, a code of another tour added (never
  an open, however long in view), an uncomparable code `unknown`;
- `tourOf`.
