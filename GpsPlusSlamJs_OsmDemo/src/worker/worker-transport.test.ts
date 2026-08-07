/**
 * `workerTransport` — the adapter, and the failure it exists to make visible.
 *
 * WHY THIS FILE IS SEPARATE FROM `rpc-client.test.ts`. That file drives the client
 * through a FAKE transport, which is what makes the correlation and abort logic
 * testable. This one tests the adapter itself, and specifically the one path a fake
 * transport can never reach: a worker-level `error`.
 *
 * WHY THAT PATH IS THE MOST IMPORTANT ONE HERE. A worker that dies — a syntax error
 * anywhere in its module graph, an OOM, a `self.close()` — fires `error` and then
 * **never replies to anything again**. Every pending call hangs forever. There is no
 * request id on an `error` event, so nothing can be rejected; the only correct
 * behaviour is to tell the caller out-of-band. `onFatal` is therefore a REQUIRED
 * parameter, because the default anyone would reach for is silence, and silence
 * here is a demo that stops with no explanation — indistinguishable from a slow
 * fetch, which is the hardest thing to diagnose in this app.
 *
 * This was untested when the worker landed. It is exactly the kind of gap that
 * stays open once a round moves on, which is why it is being closed now.
 */

import { describe, expect, it, vi } from "vitest";

import { workerTransport } from "./rpc-client.js";

/**
 * A `Worker` stand-in built on `EventTarget`, so `dispatchEvent` really drives the
 * listeners the adapter attached.
 *
 * Cast at the boundary rather than implementing all of `Worker`: the adapter uses
 * exactly `postMessage`, `addEventListener` and `terminate`, and a fake that
 * implemented the rest would be pretending to a fidelity it does not have.
 */
function fakeWorker() {
  const target = new EventTarget();
  const posted: unknown[] = [];
  let terminated = false;
  const worker = {
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    terminate: () => {
      terminated = true;
    },
  };
  return {
    worker: worker as unknown as Worker,
    target,
    posted,
    get terminated() {
      return terminated;
    },
  };
}

describe("workerTransport", () => {
  it("reports a worker-level error through onFatal", () => {
    // THE POINT OF THE FILE. Without this the demo hangs silently on a dead
    // worker: no reply arrives, so no promise settles, so nothing is reported.
    const fake = fakeWorker();
    const onFatal = vi.fn();
    const transport = workerTransport(fake.worker, onFatal);
    transport.listen(() => undefined);

    fake.target.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "Cannot find module './missing.js'",
      }),
    );

    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0]?.[0]).toContain("missing.js");
  });

  it("does not treat an error as a reply", () => {
    // An `error` event carries no request id, so it must not be routed into the
    // correlation map — doing so would resolve or reject an arbitrary call.
    const fake = fakeWorker();
    const received: unknown[] = [];
    const transport = workerTransport(fake.worker, vi.fn());
    transport.listen((data) => received.push(data));

    fake.target.dispatchEvent(new Event("error"));

    expect(received).toHaveLength(0);
  });

  it("forwards messages to the listener, and posts through to the worker", () => {
    const fake = fakeWorker();
    const received: unknown[] = [];
    const transport = workerTransport(fake.worker, vi.fn());
    transport.listen((data) => received.push(data));

    fake.target.dispatchEvent(
      Object.assign(new Event("message"), { data: { id: 1, ok: true } }),
    );
    expect(received).toEqual([{ id: 1, ok: true }]);

    transport.post({ id: 2, kind: "init", payload: {} });
    expect(fake.posted).toEqual([{ id: 2, kind: "init", payload: {} }]);
  });

  it("terminates the underlying worker", () => {
    const fake = fakeWorker();
    const transport = workerTransport(fake.worker, vi.fn());
    transport.terminate();
    expect(fake.terminated).toBe(true);
  });
});
