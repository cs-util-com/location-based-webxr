# mode.ts

## Purpose

The page's mode from the launch URL (guided-setup plan DEC-N1): `?qr=`
present means a visitor arrived through a printed code, anything else is a
creator in the guided setup. Replaces the flows plan's `?author=1` flag
(`author-mode-flag.ts`, removed 2026-09-08).

## Public API

- `type ViewerMode = "creator" | "visitor"`.
- `viewerModeFromSearch(search: string): ViewerMode` - presence of the `qr`
  parameter, whatever its value.

## Invariants & assumptions

- Read once at boot in `main.ts`; switching is a page reload (the AR
  controller refuses `enable()` mid-session anyway).
- An empty or unreadable payload is still visitor mode: the boot's payload
  error belongs where the visitor is looking, not behind the creator's
  setup.

## Examples

```ts
const mode = viewerModeFromSearch(location.search); // "visitor" for ?qr=…
```

## Tests

`mode.test.ts` - visitor for any `qr` presence, creator otherwise, and a
property over random query strings against `URLSearchParams.has`.
