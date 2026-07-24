# mode-detection.ts

## Purpose

Decide whether the demo runs the live AR path or the desktop-replay path, from a
single signal: whether the browser supports an `immersive-ar` WebXR session.

## Public API

- **`detectArSupport(xr?): Promise<boolean>`** — `true` iff the framework's timeout-guarded `probeImmersiveArSupport` confirms `immersive-ar` support
  resolves truthy. `xr` defaults to `navigator.xr`; injectable for tests.
- **`XrLike`** — the structural subset of `XRSystem` probed (`isSessionSupported?`).
- **`applyModeEntry(arSupported, { startArButton, fileRow }): void`** — sets the
  mode screen to show EXACTLY ONE entry path: `arSupported` → Start AR shown +
  file-row hidden; otherwise → Start AR hidden + file-row shown. `ModeEntryElements`
  is structural (`{ hidden: boolean }` each), so tests pass plain objects.

## Invariants & assumptions

- **Defensive:** a missing `navigator.xr`, a missing `isSessionSupported`, or a
  throwing/rejecting probe all resolve to `false` (offer replay, never crash on
  startup). Every non-`true` branch is test-pinned.
- `detectArSupport` is pure/async; no DOM, no side effects.
- **Either-or entry:** `applyModeEntry` is the single place that decides which of
  the two controls is visible — the file-row defaults visible in `index.html`, so
  the desktop path still works if AR detection never resolves.

## Tests

- `mode-detection.test.ts` — `detectArSupport`: absent xr, missing method,
  supported→true (with the `'immersive-ar'` argument asserted), unsupported→false,
  rejecting probe→false. `applyModeEntry`: both branches (capable → only Start AR;
  desktop → only file-row).
