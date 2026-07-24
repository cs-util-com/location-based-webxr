# `ar-support.ts` — AR-capability detection for the CTA device claim

## Purpose

Round-8 Z6: the CTA's strongest hook ("The demos below run on your phone
right now") is only TRUE on devices with `immersive-ar` WebXR (Android +
Chrome today). The static HTML ships the universally-true fallback ("run
on Android phones with Chrome"); this module upgrades it at load on
capable devices only — progressive enhancement, no flash of a wrong
claim, honest under no-JS.

## Public API

- `detectImmersiveArSupport(xr) → Promise<boolean>` — true iff
  `xr.isSessionSupported("immersive-ar")` resolves true. `xr` is the
  injectable `navigator.xr` slice (`XrSystemLike`); absent/malformed/
  throwing input resolves `false`, never rejects — and a never-settling `isSessionSupported` (wedged OS XR runtime, 2026-07-24) resolves `false` after `AR_SUPPORT_PROBE_TIMEOUT_MS` (3 s) instead of hanging the CTA upgrade + QR handoff.
- `applyCtaDeviceClaim(doc, supported)` — swaps the text of
  `#cta-device-claim` to `CTA_CLAIM_CAPABLE` when supported; no-op
  otherwise (missing element degrades silently).
- `CTA_CLAIM_ELEMENT_ID` / `CTA_CLAIM_CAPABLE` — the DOM contract with
  `index.html`.

## Invariants & assumptions

- **The static default in `index.html` must stay universally true** — a
  device that never runs this module must never read an overpromise.
- Defensive: `navigator.xr` is untrusted (iOS Safari: undefined;
  SecurityError in cross-origin frames) — every path yields a boolean.
- Wired in `main.ts` boot as fire-and-forget (`void …then(…)`); the page
  never blocks on the detection.

## Examples

```ts
void detectImmersiveArSupport((navigator as { xr?: XrSystemLike }).xr).then(
  (supported) => applyCtaDeviceClaim(document, supported),
);
```

## Tests

`ar-support.test.ts` — missing/malformed/rejecting `navigator.xr`, the
true/false mirror, the claim swap on capable devices, the untouched
default otherwise, and the missing-element degrade.
