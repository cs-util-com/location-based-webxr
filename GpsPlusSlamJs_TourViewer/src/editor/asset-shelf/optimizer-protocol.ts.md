# optimizer-protocol.ts

**Purpose:** the message shapes between the page and the asset optimizer's module Worker, shared by `optimizer-client.ts` and `asset-optimizer.worker.ts` (types only, no DOM).

## Public API

- `OptimizerInbound` (page to Worker): `run { job, kind, payload, settings }`, `cancel { job }`.
- `OptimizerOutbound` (Worker to page): `progress { job, fraction }`, `done { job, blob, extension, width?, height? }`, `kept { job, reason }`, `failed { job, reason }`.

## Invariants

- `job` is the page's correlation id; every answer echoes it.
- `payload` is whatever the page-side optimizer hands over: the file's Blob, or data it prepared on the page (a sound's decoded samples, since decoding audio is not available in a Worker).
- The page validates every answer field by field (`optimizer-client.ts`); these types are not trusted at runtime.

## Tests

Shapes only; exercised by `optimizer-client.test.ts` with a fake Worker.
