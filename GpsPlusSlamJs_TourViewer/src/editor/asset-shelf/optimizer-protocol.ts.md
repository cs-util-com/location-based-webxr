# optimizer-protocol.ts

**Purpose:** the message shapes between the page and the asset optimizer's module Worker, shared by `optimizer-client.ts` and `asset-optimizer.worker.ts` (types only, no DOM).

## Public API

- `OptimizerInbound` (page to Worker): `run { job, kind, payload, settings }`, `cancel { job }`.
- `OptimizerOutbound` (Worker to page): `progress { job, fraction }`, `done { job, blob, extension, width?, height? }`, `kept { job, reason }`, `failed { job, reason }`.
- `inboundOf(data)`: `data` as an `OptimizerInbound`, or null for a non-object, an unknown type, a job that is no whole number, a run of no known kind, or a run without settings. The Worker ignores what it returns null for.

## Invariants

- `job` is the page's correlation id; every answer echoes it.
- `payload` is whatever the page-side optimizer hands over: the file's Blob, or data it prepared on the page (a sound's decoded samples, since decoding audio is not available in a Worker).
- Neither side trusts these types at runtime: the Worker checks what it receives (`inboundOf`), the page every answer field by field (`optimizer-client.ts`).

## Tests

`optimizer-protocol.test.ts`: `inboundOf` takes a run and a cancel and ignores every other shape. The answers are exercised by `optimizer-client.test.ts` with a fake Worker.
