# keyed-chain.ts

## Purpose

Tasks run one after another PER KEY, in the order they were queued. The
creator setup queues every draft write through it: one key per tour's
meta file, one per object id within a tour (authoring plan
2026-09-28-0953, M4 review #7; the M2c review's filed #7).

## Public API

- `createKeyedChain(): KeyedChain`
  - `run(key, task) -> Promise<T>` - runs `task` once every task queued
    earlier under `key` has settled; resolves or rejects with the task's
    own outcome.
  - `pendingKeys() -> number` - keys with a task queued or running.

## Invariants & assumptions

- **Call order is landing order, per key.** A task starts only after the
  previous one under its key settled, however long that one takes. This
  is what keeps a placement's slow write from landing after a quick
  delete of the same object, and a multi-step operation (the claim of a
  rejected id, then the write) from interleaving with another one on the
  same id.
- **A failure does not stall or reorder the queue.** The rejection goes
  to the task's own caller; the next task runs as usual.
- **Different keys never wait for each other**, so a stalled write blocks
  only its own object or meta.
- **Bounded**: a key is forgotten when its last queued task settles, so
  the map holds only work in flight.
- A task always starts asynchronously (at least one microtask later),
  even with nothing queued before it.
- Kept in the Tour Viewer, not the framework: it has one consumer. The
  framework's `persistence-middleware` and `bounded-local-cache-store`
  keep single (unkeyed) queues of their own; a second keyed user is the
  moment to promote this to `gps-plus-slam-app-framework/src/utils/`.

## Examples

```ts
const writes = createKeyedChain();
void writes.run(`object:${id}`, () => writeDraftObject(store, object));
// Lands after the write above, however slow that one is:
void writes.run(`object:${id}`, () => removeDraftObject(store, id));
```

## Tests

`keyed-chain.test.ts`: a slow first task holds the second, a failure goes
to its caller and the queue continues, keys are independent, drained keys
are forgotten, and a property that every key's tasks land in call order
for any mix of costs and failures.
