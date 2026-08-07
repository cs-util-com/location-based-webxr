# chromium-camera-access-workaround.ts

## Purpose

Mitigates the Android Chrome renderer crash triggered by the WebXR
`camera-access` optional feature (three.js [#33404](https://github.com/mrdoob/three.js/issues/33404)
/ [crbug.com/507508099](https://crbug.com/507508099)). Called once at app
bootstrap, before any `requestSession()`.

## Public API

- `applyChromiumProjectionLayerWorkaround(options?: { userAgent?: string }): ChromiumProjectionLayerWorkaroundResult`
  — applies the workaround and returns which prototype members were changed.
  - **Always** deletes `XRWebGLBinding.prototype.createProjectionLayer`
    (three.js r184) and `XRRenderState.prototype.layers` (three.js r158),
    forcing three.js onto the `XRWebGLLayer` fallback.
  - **Additionally** monkeypatches `XRSession.prototype.updateRenderState` to
    persist the `baseLayer` across calls, but **only** when the detected
    Chrome build is inside the affected window
    `[BASELAYER_WINDOW_MIN .. BASELAYER_WINDOW_MAX]`.
- `needsBaseLayerPersistence(userAgent: string): boolean` — predicate for the
  baseLayer window (inclusive bounds). False for non-Chromium UAs.
- `parseChromeVersion(userAgent: string): ChromeVersion | null` — parses
  `Chrome/` or `CriOS/` four-part versions.
- `BASELAYER_WINDOW_MIN = [148, 0, 7778, 12]`,
  `BASELAYER_WINDOW_MAX = [149, 0, 7821, 0]` — inclusive bounds of the window
  that additionally needs the baseLayer patch. The lower bound is the tracker's
  `148.0.7778.12` figure; on-device, `148.0.7778.215` (inside the window) needs
  both workarounds.
- Types: `ChromeVersion`, `ChromiumProjectionLayerWorkaroundResult`
  (`deletedCreateProjectionLayer`, `deletedRenderStateLayers`,
  `patchedUpdateRenderState`, `detectedChromeVersion`).

## Invariants & assumptions

- **Empirical on-device matrix (authoritative):** Chrome 148 (e.g.
  `148.0.7778.215`) needs BOTH the deletes and the baseLayer patch; Chrome 150
  (e.g. `150.0.7871.3`) needs the deletes ONLY (it still crashes without them —
  the platform "Fixed" status did not remove that need). Hence the deletes are
  unconditional and the baseLayer patch is window-gated.
- On every call the helper logs the applied combination via
  `createLogger('chromium-camera-access').info('applied workaround', result)`,
  so the runtime console / in-app log panel shows the detected Chrome version
  and which patches ran (key for confirming fresh framework code on-device).
- Idempotent — safe to call repeatedly. The `updateRenderState` wrap is marked
  with `__gpsBaseLayerPersistencePatch` so it is applied at most once.
- The persisted `baseLayer` is tracked **per `XRSession` instance** via a
  `WeakMap` keyed on the call's `this`, not a single shared closure variable.
  This prevents a previous session's `baseLayer` from leaking into a later
  session (a stale `XRWebGLLayer` re-supplied to a different session throws
  `InvalidStateError`), and lets entries be collected with their sessions.
- Safe where the prototypes don't exist (desktop, jsdom): the corresponding
  result flags stay `false`.
- Must run before three.js reads the prototype members (i.e. before session
  setup). Defensive: guards every global/prototype access.
- The baseLayer patch is restricted to the detected Chrome window to avoid
  breaking projection-layer devices (e.g. Quest), per upstream warnings.

## Examples

```ts
import { applyChromiumProjectionLayerWorkaround } from 'gps-plus-slam-app-framework/ar';

// At bootstrap, before initAR():
const result = applyChromiumProjectionLayerWorkaround();
console.log(result.detectedChromeVersion, result.patchedUpdateRenderState);
```

## Tests

`chromium-camera-access-workaround.test.ts` (jsdom):

- deletes always apply (incl. Chrome 150), idempotency, no-op when globals
  absent;
- `parseChromeVersion` standard / CriOS / non-Chromium / empty;
- `needsBaseLayerPersistence` window boundaries (inclusive min/max, ±1 patch,
  non-Chromium);
- baseLayer persistence wraps `updateRenderState` and carries `baseLayer`
  through on Chrome 148, but not on Chrome 150 or unknown UAs; wrap is
  idempotent; persisted `baseLayer` is isolated per `XRSession` instance.
