# qr-hud-state.ts

## Purpose

One-line: hold the QR HUD row's **per-session** state - the newest code seen,
its short identity, and what the level lookup did for each code - so that it
can be reset when an AR session starts.

## Why it exists as a module

It was three module-level values in `main.ts` and **nothing cleared them
between AR sessions**. The accumulator behind the row IS rebuilt per session
(`wireQrRecording` creates a fresh one), so on the second session of a page
load:

- the newest-code scan found nothing, so the `newest !== latestText` guard
  never fired and the previous session's text survived;
- `qrStatusLine` then rendered that stale text against an empty accumulator,
  reading `QR abc123: visit 0.` where the honest line is
  `QR: scanning - no code seen yet.`;
- and the stale level state could append `using its saved position` for a code
  this session had never looked up.

That is the "looked like it worked" failure the row was added to end. Moving
the state here makes the reset explicit and, more importantly, testable
without standing up an AR session. Found by the PR #372 review.

## Public API

- `createQrHudState({ hashId }): QrHudState`
  - `noteNewest(text)` - record the code with the most recent detection.
    Re-notifying the same text is a **no-op**, so the id hash runs once per
    code and not once per frame. The hash is started but **not awaited**: the
    row renders immediately with a neutral label rather than blocking a frame
    callback, and a rejection costs only the short label.
  - `noteLevelState(text, state)` - record what the level lookup did.
  - `reset()` - forget everything. Called when an AR session starts.
  - `snapshot(): QrHudSnapshot` - `{ latestText, latestId, levelState? }`,
    exactly the inputs `qrStatusLine` needs besides the accumulator.
- Types `QrHudState` and `QrHudStateDeps`. `QrHudSnapshot` is deliberately NOT
  exported - callers reach it structurally through `snapshot()`, and a named
  export nothing imports is what the dead-code check flags.

## Invariants & assumptions

- **`reset()` bumps a generation counter**, and an id resolving after a reset
  is discarded. Without it the previous session's hash could land on the new
  session's state - the same class of bug as the stale text, and harder to see
  because it needs the session to end mid-hash.
- **`snapshot()` returns `levelState` only when there is one for the current
  text**, and omits the key otherwise, because `QrStatusInput.levelState`
  being absent means "this session is not looking levels up" while `undefined`
  would be indistinguishable from a lookup that returned nothing.
- **`hashId` is injected** rather than importing `qrCodeId` directly, so the
  tests control resolution timing - which is what makes the generation guard
  testable at all.
- No DOM, no store, no framework imports beyond a type. The rendering lives in
  `qr-status-line.ts` and the writing in `hud-status-rows.ts`.

## Examples

```ts
const qrHud = createQrHudState({ hashId: qrCodeId });

// on AR session start
qrHud.reset();

// per frame, from the detection fold
if (newest !== null) qrHud.noteNewest(newest);
setQrStatus(qrStatusLine({ enabled: true, accumulator, ...qrHud.snapshot() }));

// from the level source
qrHud.noteLevelState(text, state);
```

## Tests

`qr-hud-state.test.ts`: the empty opening state; the newest code recorded with
its id resolving asynchronously; one hash per code rather than per detection;
`reset()` clearing text, id and level states; a level state not surviving a
reset; an id resolving after a reset being discarded (the generation guard);
and the id being replaced rather than kept when the newest code changes.

No fixtures required.
