# author-mode-flag.ts

## Purpose

Boot-time parser for `?author=1` — QD-1 put authoring INSIDE the TourViewer,
hidden behind this flag so the passerby UI stays clean.

## Public API

- `authorModeEnabledFromSearch(search: string): boolean` — pure; pass
  `location.search`.

## Invariants & assumptions

- Strict `author === "1"` (this app's `?nocache=1` convention): author mode
  is an opt-in power tool, so absent/`"true"`/garbage all stay viewer mode —
  a passerby scanning a printed QR must never land in author mode.
- Read ONCE at boot; mode switching is a page reload by design (the AR
  controller refuses `enable()` while a session runs, so a live flip could
  never take effect anyway).

## Examples

```ts
const authorMode = authorModeEnabledFromSearch(location.search); // ?author=1 → true
```

## Tests

`author-mode-flag.test.ts` — the strict-match table plus a fast-check
property over arbitrary query strings.
