/**
 * The worker boundary's bookkeeping, driven through an in-process transport.
 *
 * WHY THESE TESTS MATTER. Every failure mode here is a HANG or a LEAK, not a
 * wrong answer — and neither shows up as a failing assertion anywhere else. A
 * reply that is not correlated leaves a promise pending forever; a worker error
 * that is not turned into a rejection does the same; an abort listener that is
 * not removed keeps a resolver (and everything it closes over) alive for the life
 * of the page. A demo that silently stops is indistinguishable from a slow fetch,
 * which is the single hardest thing to debug in this app.
 *
 * None of it needs a real worker, which is the point of `Transport`.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createRpcClient,
  RpcAbortError,
  type Transport,
} from "./rpc-client.js";
import type { WorkerEnvelope } from "./protocol.js";

/** A transport that records what was posted and lets a test reply by hand. */
function fakeTransport() {
  const posted: WorkerEnvelope[] = [];
  let handler: ((data: unknown) => void) | undefined;
  let terminated = false;

  const transport: Transport = {
    post: (message) => {
      posted.push(message);
    },
    listen: (h) => {
      handler = h;
    },
    terminate: () => {
      terminated = true;
    },
  };

  return {
    transport,
    posted,
    get terminated() {
      return terminated;
    },
    reply: (data: unknown) => {
      if (handler === undefined) throw new Error("nothing is listening");
      handler(data);
    },
  };
}

describe("createRpcClient", () => {
  it("resolves a call with the value from the matching reply", async () => {
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);

    const promise = client.call("explain", {
      cell: "abc",
      category: "walkable",
    });
    const sent = fake.posted[0];
    expect(sent?.kind).toBe("explain");

    fake.reply({ id: sent?.id, ok: true, value: undefined });
    await expect(promise).resolves.toBeUndefined();
  });

  it("correlates replies by id, so out-of-order answers reach the right call", async () => {
    // WHY THIS TEST MATTERS. The worker finishes whatever it finishes first —
    // an `explain` resolves in microseconds while the `update` it was asked
    // during is still fetching. Without correlation the first reply to arrive
    // resolves the first promise made, so a cheap call would hand its answer to
    // an expensive one and the snapshot would be an explanation object.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);

    const first = client.call("init", {});
    const second = client.call("explain", {
      cell: "abc",
      category: "walkable",
    });
    const [a, b] = fake.posted;

    // Deliberately backwards.
    fake.reply({ id: b?.id, ok: true, value: "second" });
    fake.reply({ id: a?.id, ok: true, value: "first" });

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("rejects on a failure reply rather than leaving the call pending", async () => {
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);

    const promise = client.call("update", {
      position: { lat: 50.94, lng: 6.96 },
      category: "walkable",
    });
    fake.reply({ id: fake.posted[0]?.id, ok: false, message: "Overpass 429" });

    await expect(promise).rejects.toThrow("Overpass 429");
  });

  it("ignores foreign messages instead of crashing on them", async () => {
    // A worker's channel is shared with anything else that posts to it — a
    // bundler's HMR ping is the common one. A handler that assumes its own
    // shape throws inside an event listener, where nothing catches it.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);
    const promise = client.call("init", {});

    expect(() => {
      fake.reply(undefined);
      fake.reply("hello");
      fake.reply({ type: "vite:hmr" });
    }).not.toThrow();

    fake.reply({ id: fake.posted[0]?.id, ok: true, value: "still works" });
    await expect(promise).resolves.toBe("still works");
  });

  it("tells the WORKER about an abort, not just the caller", async () => {
    // WHY THIS TEST MATTERS, and it is the reason abort exists at all. Dropping
    // the reply on this side is easy and useless: the worker would keep
    // fetching 28-68 MB for a position the user has left. The observable
    // requirement is the outgoing `abort` message naming the superseded id.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);
    const controller = new AbortController();

    const promise = client.call(
      "update",
      { position: { lat: 50.94, lng: 6.96 }, category: "walkable" },
      { signal: controller.signal },
    );
    const target = fake.posted[0]?.id;
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(RpcAbortError);
    const abort = fake.posted.find((m) => m.kind === "abort");
    expect(abort).toBeDefined();
    expect(abort).toMatchObject({ kind: "abort", target });
  });

  it("posts nothing at all for an already-aborted signal", async () => {
    // An aborted signal should cost no work. Posting and then cancelling still
    // hands the worker a job to start and stop — and for a fetch that can mean
    // a request already on the wire.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);

    await expect(
      client.call("init", {}, { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(RpcAbortError);
    expect(fake.posted).toHaveLength(0);
  });

  it("removes the abort listener once a call settles, so nothing leaks", async () => {
    // A listener left on a long-lived signal keeps the resolver — and the
    // payload it closed over — reachable for the life of the page. Asserted
    // through the signal's own bookkeeping rather than a heap probe.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const promise = client.call("init", {}, { signal: controller.signal });
    fake.reply({ id: fake.posted[0]?.id, ok: true, value: "done" });
    await promise;

    expect(remove).toHaveBeenCalled();

    // And a later abort of the same signal must not resolve or reject anything.
    expect(() => {
      controller.abort();
    }).not.toThrow();
    expect(fake.posted.some((m) => m.kind === "abort")).toBe(false);
  });

  it("rejects everything pending when disposed, and terminates the transport", async () => {
    // A disposed client with pending calls is a page tearing down. A promise
    // that never settles there keeps whatever awaited it alive with it.
    const fake = fakeTransport();
    const client = createRpcClient(fake.transport);
    const promise = client.call("init", {});

    client.dispose();

    await expect(promise).rejects.toThrow("disposed");
    expect(fake.terminated).toBe(true);
    await expect(client.call("init", {})).rejects.toThrow("disposed");
  });
});
