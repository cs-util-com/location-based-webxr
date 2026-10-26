# ground-wait.ts

## Purpose

A wait for the 3D view's ground: "Put on the ground" pressed while no
ground under the selection has loaded at all reads it again until some
has, rather than put something at no known height. It gives up after a
while and stops when called off.

## Public API

- `waitForGround(read, { everyMs?, timeoutMs?, signal? })` ->
  `Promise<GroundWaited<T>>`:
  - `{ kind: "ground", value }` - the first value of `read()` that is not
    null: at once when there is one already, else read again every
    `everyMs`;
  - `{ kind: "timeout" }` - `timeoutMs` passed with no ground;
  - `{ kind: "stopped" }` - `signal` was aborted (before or during the
    wait); nothing more is read.
- `GROUND_WAIT` (`everyMs` 250, `timeoutMs` 20000) - the defaults.

## Invariants & assumptions

- One timer at a time; every way out clears it and the abort listener,
  so a stopped or finished wait leaves nothing running.
- `read` decides what "loaded" means (here `groundEdit`, null while any
  ground it needs is missing).
- It stops at the first ground that loads, a coarse level included: the
  relief does not say which level a height comes from. On a slope the
  height put can therefore differ by a little from the finest ground,
  and the inspector's "x m up / down" note shows that once the finer
  tiles arrive (press again to settle it). It does not wait for the
  finest level.

## Examples

```ts
const stop = new AbortController();
const got = await waitForGround(() => groundEdit({ ... }), { signal: stop.signal });
if (got.kind === "ground") write(got.value);
```

## Tests

`ground-wait.test.ts` (fake timers): at once, after a few reads, the timeout, an abort during the wait (and no read after it), and a signal aborted before the wait.
