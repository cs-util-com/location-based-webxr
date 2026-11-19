# `worker/mesh-transfer.ts`

## Purpose

The transfer list of a worker reply: which buffers move to the page instead
of being copied. Its own module so the list is testable without a worker.

## Public API

`transferablesOf(kind, value) -> Transferable[]`

- `update` with a full mesh: every chunk's positions, normals, indices, the
  shell attributes and, for a time-of-day build, every `lookColours` buffer.
- Anything else (terrain, init, explain, a regions-only update): `[]`.

## Invariants & assumptions

- Only buffers the worker does not keep are listed: transferring detaches them.
  The terrain `heights` stay in worker state and are never listed.
- `colors` is deliberately not transferred (the comment in the code says why).
- Each listed buffer is distinct in a real reply: buildings and roads are
  different chunks with their own buffers.

## Examples

```ts
self.postMessage(reply, transferablesOf(kind, result));
```

## Tests

`worker/worker-round-trip.test.ts`: the look buffers are listed and `colors`
is not, `structuredClone` with the list delivers them intact, and the source
buffers are detached afterwards.
