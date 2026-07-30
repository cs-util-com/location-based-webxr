# `worker/rpc-client.ts`

## Purpose

Turns a message channel into awaitable, abortable function calls. All the
bookkeeping `postMessage` does not give you: correlation, failure-to-rejection,
cancellation that reaches the worker, and cleanup.

## Public API

- `createRpcClient(transport): RpcClient`
  - `call(kind, payload, { signal? })` — resolves with the worker's value, rejects
    with `Error(message)` on `ok: false`, rejects with `RpcAbortError` if the
    signal fires. Typed by `WorkerCalls[kind]`.
  - `dispose()` — rejects every pending call, then terminates the transport.
- `workerTransport(worker, onFatal): Transport` — adapts a real `Worker`.
  `onFatal` is **required**, not optional.
- `RpcAbortError` — so a caller can distinguish "superseded" from "failed".
- `Transport` — `{ post, listen, terminate }`. The seam that makes all of this
  testable without a worker.

## Invariants & assumptions

- **Every failure mode here is a hang or a leak, never a wrong answer.** That is
  why the tests are worth their length — none of these surface as a failing
  assertion anywhere else.
- **Replies are matched by id.** The worker finishes what it finishes first: an
  `explain` resolves in microseconds while the `update` it was requested during
  is still fetching. Without correlation the cheap call's answer would resolve the
  expensive call's promise.
- **Foreign messages are ignored, not assumed.** The channel is shared with
  whatever else posts to it (a bundler's HMR ping is the usual one), and throwing
  inside a `message` listener is uncatchable by the caller.
- **Abort posts to the worker, it does not merely drop the reply.** Dropping the
  reply locally is easy and useless — the worker would keep pulling 28–68 MB for a
  position the user has left. `DemoPipeline` checks the signal **per tile**, which
  is the granularity where the saving actually is.
- **An already-aborted signal posts nothing.** Posting and immediately cancelling
  still hands the worker a job to start and stop, and for a fetch that can mean a
  request already on the wire.
- **The abort listener is removed on every settle path.** Left attached to a
  long-lived signal it keeps the resolver, and everything it closed over, alive
  for the life of the page.
- **`onFatal` is required because the tempting default is silence.** A worker that
  dies (syntax error in its module graph, OOM) fires `error` and then never
  replies to anything, so every pending call hangs. There is no id to correlate,
  so it cannot reject one call — the caller must surface it. In this app it
  becomes `fetchFailed`, since a dead worker means no data.

## Examples

```ts
const client = createRpcClient(
  workerTransport(new Worker(url, { type: "module" }), (m) => report(m)),
);
const { snapshot, mesh } = await client.call("update", { position, category });
```

## Tests

`rpc-client.test.ts` — 8 examples: resolution, out-of-order correlation,
failure-to-rejection, foreign messages, abort reaching the worker, no-post for a
pre-aborted signal, listener cleanup, and dispose. The abort-post and
listener-removal assertions were **mutation-checked**: deleting either line fails
exactly one test and nothing else.
