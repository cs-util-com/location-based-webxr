# ground-wait.ts

## Purpose

A wait for the 3D view's ground: "Put on the ground" pressed while the
ground under the selection has not loaded reads it again until it has,
rather than put something at a wrong height. It gives up after a while
and stops when called off.

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

## Examples

```ts
const stop = new AbortController();
const got = await waitForGround(() => groundEdit({ ... }), { signal: stop.signal });
if (got.kind === "ground") write(got.value);
```

## Tests

`ground-wait.test.ts` (fake timers): at once, after a few reads, the timeout, an abort during the wait (and no read after it), and a signal aborted before the wait.
