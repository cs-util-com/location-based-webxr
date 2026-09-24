# `vite.config.ts`

## Purpose

Vite development and build configuration for `GpsPlusSlamJs_RealisticSunLightingDemo`.

## Public API

Exports the default Vite configuration pinning dev-server port 5193 as allocated in `docs/dev-server-ports.md`.

## Invariants

- Server port must match 5193.
- `host: true` enables network listening for mobile device USB debugging and LAN testing.

## Examples

```bash
pnpm run dev
```

## Tests

Covered by repository configuration guard `tests/repo-config/dev-server-ports.test.js`.
