# debug-flag.ts

## Purpose

The apps' developer-UI gate: `?debug=1` (or `=true`) in the page URL. Behind it: the RecorderApp's in-recording settings wheel (2026-09-02, rotation-first search plan D8) and the TourViewer's QR readout (QR near-frontal pose plan §66). Moved here from the RecorderApp so both apps read the flag by one rule (DEC-H3, plan §67 #3). Without it those surfaces are not rendered at all, so an ordinary user's screen is unchanged.

## Public API

- `debugUiEnabledFromSearch(search)` → `boolean` — true iff the `debug` query parameter is `1` or `true`, case-insensitively and with surrounding whitespace trimmed. Everything else (absent, empty, bare `?debug`, `0`, `false`, `yes`) is false.

## Invariants & assumptions

- **Off is the default for everyone.** The flag is read from `location.search` at start-up and never persisted; a reload keeps it only because the URL keeps it.
- Pure over the search string (no `window` access), same shape as the AnchorStarter's `coldStartOverrideEnabledFromSearch`, so it is testable without a DOM.
- **Deep-imported** as `gps-plus-slam-app-framework/utils/debug-flag`, never through the `/utils` barrel (which feeds the root export surface); it has its own `tsdown` entry.

## Example

```ts
import { debugUiEnabledFromSearch } from 'gps-plus-slam-app-framework/utils/debug-flag';

if (debugUiEnabledFromSearch(location.search)) mountDebugWheel(...);
```

## Tests

`debug-flag.test.ts` — off without the parameter, on for `1`/`true` in any case with whitespace, off for every other value.
