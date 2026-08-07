# ar-crash-isolation.ts

## Purpose

Diagnostic flags for isolating pre-recording AR startup crashes: type, defaults, and validator for the gates that affect XR session negotiation and frame-loop behavior (dom-overlay, camera access, depth-sensing feature, CSS3D renderer, camera-texture acquisition, Chromium projection-layer workaround). Extracted from the recorder settings catalog (`state/recording-options.ts`, 2026-07-11 G-1 move) because the framework itself consumes the group in `webxr-session.ts` and on `enable-gps-ar.ts`'s public param.

## Public API

- `ArCrashIsolationOptions` — six boolean flags:
  - `enableDomOverlay` — request the `dom-overlay` XR session feature.
  - `enableCameraAccess` — request the `camera-access` XR session feature.
  - `enableDepthSensingFeature` — request the `depth-sensing` XR session feature.
  - `enableCss3dRenderer` — create/drive the CSS3D renderer manager during the session.
  - `enableCameraTextureAcquisition` — acquire the raw camera GL texture each frame.
  - `applyChromiumProjectionLayerWorkaround` — apply the Chromium WebXR camera-access tab-crash workaround at bootstrap (see `chromium-camera-access-workaround.ts`). Default `true`; opt-out exists because forcing `XRWebGLLayer` may break unaffected devices (e.g. Quest).
- `DEFAULT_AR_CRASH_ISOLATION: ArCrashIsolationOptions` — all flags `true`.
- `validateArCrashIsolationOptions(rawOptions?: Partial<ArCrashIsolationOptions> | null): ArCrashIsolationOptions` — boolean-or-default per field; never throws. The container itself is normalized too: a `null`/`undefined`/non-object container yields the full defaults (PR #185 review — a persisted blob may lack the key entirely).

## Invariants & Assumptions

- Input to the validator is untrusted (persisted localStorage / external callers): any non-boolean value falls back to the default, so a corrupt stored value can never disable an XR feature silently or crash session negotiation.
- The validator is a spec table over `utils/validate-option-fields.ts` (2026-07-27). It previously hand-rolled a local `boolOr` plus a six-field object literal "so it stays dependency-free"; the primitive now lives in the framework itself, so that reason is gone — and the spec table is **exhaustive over the type**, meaning a new flag is a compile error until its validation is declared, where the literal would have silently dropped it.
- All defaults are `true` (full feature set) — turning a flag OFF is always the diagnostic opt-out.
- The recorder's `RecordingOptions.arCrashIsolation` group embeds this type; its catalog (`GpsPlusSlamJs_RecorderApp/src/state/recording-options.ts`) spreads `DEFAULT_AR_CRASH_ISOLATION` into its own defaults and delegates group validation here, so the two stay in lockstep by construction.

## Examples

```typescript
import {
  DEFAULT_AR_CRASH_ISOLATION,
  validateArCrashIsolationOptions,
} from 'gps-plus-slam-app-framework/ar/ar-crash-isolation';

// Normalize untrusted input (missing/corrupt fields fall back to defaults)
const flags = validateArCrashIsolationOptions({ enableCss3dRenderer: false });
// → { ...DEFAULT_AR_CRASH_ISOLATION, enableCss3dRenderer: false }
```

## Tests

- `ar-crash-isolation.test.ts` — pins the validator's never-throws contract directly: nullish/non-object containers → full defaults; corrupt fields → per-field fallback.
- `webxr-session.test.ts` — pins the isolation defaults/validator behavior through `initAR`'s session-feature negotiation.
- `GpsPlusSlamJs_RecorderApp/src/state/recording-options.test.ts` — exercises the validator via the recorder catalog's `validateRecordingOptions` (schema evolution, corrupt persisted values, save/load round-trips).
