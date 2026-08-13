# `ar-hud.ts`

## Purpose

The measurement readout's surface: the element, the cadence, and the two ways
both go wrong.

## Invariants & assumptions

- **It lives inside `#ar-root`**, for the reason [`ar-toast.ts`](ar-toast.ts.md)
  records: WebXR composites only the dom-overlay root's subtree over the camera
  feed, so a readout anywhere else is invisible for exactly the session it is
  measuring.
- **It is SAMPLED, not written per frame.** The values change every frame; the
  DOM does not need to. Writing `textContent` at display rate inside the XR
  frame callback puts layout on the critical path of the thing being measured —
  **the instrument would change the reading.** At `AR_HUD_SAMPLE_MS = 500` a
  60 fps session writes once per 30 frames.
  - The first sample is always accepted, because half a second of blank readout
    at session start is half a second spent wondering whether it works.
  - Identical text is not rewritten: `textContent` invalidates layout even when
    the string is unchanged, and most samples are unchanged in most fields.
- **Nothing measured means nothing attached.** `#ar-root` is `position: fixed;
inset: 0` and hidden only while `:empty`, so an always-attached readout keeps
  a full-viewport, click-eating layer over the whole page whenever AR is not
  running — a regression this demo has shipped once (`ar-mode.ts`). It attaches
  on the first non-empty sample and detaches when there is nothing to say.
- **`aria-hidden`, unlike the toast.** It changes twice a second forever;
  announcing that makes the page unusable with a screen reader, and these are a
  developer instrument rather than user-facing content.
- **The clock is a parameter of `sample`**, so the cadence is testable without
  fake timers and the caller can pass the XR frame's own `elapsed`.
- **`dispose()` can be followed by more samples.** It runs on both AR exits, and
  a HUD that could not restart would make the second session of a page silently
  instrument-free.

## Public API

- `AR_HUD_SAMPLE_MS` — 500.
- `createArHud(root): ArHud` — `root` must be the element passed to `initAR`.
- `ArHud` — `{ sample(measurements, nowMs), dispose() }`.

## Examples

```ts
const hud = createArHud(container);

// `elapsed` is PAGE-relative, so the window has to be opened from the first
// frame's value rather than from zero — see `frame-loop.ts.md`.
let windowOpenedAtS: number | undefined;
let framesThisWindow = 0;

registerXrFrameUpdate(({ elapsed }) => {
  windowOpenedAtS ??= elapsed;
  framesThisWindow += 1;
  const windowS = elapsed - windowOpenedAtS;

  // `sample` returns whether it ACCEPTED the sample. Discarding that is what
  // makes an averaged fps impossible: the caller cannot know when to reset its
  // counters, so it either never resets or resets on frames the HUD ignored.
  const wrote = hud.sample(
    { fps: windowS > 0 ? framesThisWindow / windowS : undefined, ...live },
    elapsed * 1000,
  );
  if (wrote === true) {
    framesThisWindow = 0;
    windowOpenedAtS = elapsed;
  }
});
```

**This example used to read `fps: dt > 0 ? 1 / dt : undefined` and drop
`sample`'s return value** — a single-frame reciprocal, which is the thing this
module's own invariant list says it is not. On a phone that flickers between
plausible and alarming with no way to tell a sustained drop from a hiccup, which
is the only question the number exists to answer.

## Tests

`ar-hud.test.ts` — writes into the root; stays OUT of it while empty; leaves it
empty again when the numbers go; ignores a sample inside the window and takes
the next one after it; accepts the FIRST sample immediately; is `aria-hidden`;
and disposes without becoming unusable.
