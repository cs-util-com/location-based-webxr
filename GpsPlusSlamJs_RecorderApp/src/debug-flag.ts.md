# debug-flag.ts

## Purpose

The recorder's developer-UI gate: `?debug=1` (or `=true`) in the page URL. The first surface behind it is the in-recording settings wheel (2026-09-02, rotation-first search plan D8); future developer overlays hang off the same flag. Without it those surfaces are not rendered at all, so an ordinary user's HUD is unchanged.

## Public API

- `debugUiEnabledFromSearch(search)` → `boolean` — true iff the `debug` query parameter is `1` or `true`, case-insensitively and with surrounding whitespace trimmed. Everything else (absent, empty, `0`, `false`, `yes`) is false.

## Invariants & assumptions

- **Off is the default for everyone.** The flag is read from `location.search` at start-up and never persisted; a reload keeps it only because the URL keeps it.
- Pure over the search string (no `window` access), same shape as the AnchorStarter's `coldStartOverrideEnabledFromSearch`, so it is testable without a DOM.

## Example

```ts
if (debugUiEnabledFromSearch(location.search)) mountDebugWheel(...);
```

## Tests

`debug-flag.test.ts` — off without the parameter, on for `1`/`true` in any case with whitespace, off for every other value.
