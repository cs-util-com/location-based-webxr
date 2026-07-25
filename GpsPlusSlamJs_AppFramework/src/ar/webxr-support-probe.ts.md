# webxr-support-probe.ts

## Purpose

The one place the framework (and consumer apps) ask the browser whether WebXR immersive-ar is supported — with the never-answers failure mode handled. On 2026-07-24 a wedged OS XR runtime made `navigator.xr.isSessionSupported('immersive-ar')` never settle (while `'inline'` resolved instantly); every caller that awaited it bare hung its app's entire boot (the recorder never reached its replay-mode switch; the wayfinding demo never built its canvas).

## Public API

- `probeImmersiveArSupportOutcome(options?): Promise<ImmersiveArProbeOutcome>` — `'supported' | 'unsupported' | 'error' | 'timeout'`. Missing `navigator.xr` / missing `isSessionSupported` / a `false` answer → `'unsupported'`; a rejection → `'error'`; no answer within the timeout → `'timeout'` (logged as a warning). Options: `xr` (defaults to `navigator.xr`; pass explicitly in tests — an explicit `undefined` is respected), `timeoutMs` (default `WEBXR_SUPPORT_PROBE_TIMEOUT_MS`).
- `probeImmersiveArSupport(options?): Promise<boolean>` — convenience: `true` only on a positive confirmation.
- `WEBXR_SUPPORT_PROBE_TIMEOUT_MS` = 3000 — on healthy platforms the call resolves in milliseconds; only a wedged runtime reaches this.
- `XrSystemLike` — the structural subset of `XRSystem` probed.

## Invariants & assumptions

- Never hangs, never throws — every failure mode resolves.
- The outcome distinction matters to the permission checker's user guidance: only a confirmed `'unsupported'` earns the "install ARCore" message; `'error'`/`'timeout'` keep the transient "refresh and try again" framing.
- Consumers: `sensors/permission-checker.ts` (`checkWebXRSupport`), `ar/webxr-session.ts` (`isWebXRSupported`), and the Wayfinding/Physics demos' `mode-detection.ts` (via the published `ar/webxr-support-probe` deep path).

## Example

```ts
import { probeImmersiveArSupport } from 'gps-plus-slam-app-framework/ar/webxr-support-probe';
const arAvailable = await probeImmersiveArSupport(); // false after ≤3 s even on a wedged runtime
```

## Tests

`webxr-support-probe.test.ts` — missing API/fn, positive, negative, rejection (`'error'`), never-settling (`'timeout'`, fake timers), and the caller-provided timeout.
