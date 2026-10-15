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
- `meshCursorFromSearch(search: string): boolean` - the creator's ring on
  a mesh of the surroundings (polish round M5, Q-Mesh): ON unless `mesh` is
  `0` or `false` (trimmed, any case - the debug flag's `1`/`true`
  mirrored). The default since the owner's phone test of 2026-10-15
  (mesh-cursor smoothing plan 2026-10-15-0944); the old `?mesh=1` links
  keep working, and any other value (a typo) keeps it on.

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
property over random query strings against `URLSearchParams.has`; the
mesh flag on by default, off for `0`/`false` only.
