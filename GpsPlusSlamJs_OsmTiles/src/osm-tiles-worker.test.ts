import { describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import worker, { type QueueBatch } from "./osm-tiles-worker";
import { FakeBucket, FakeQueue } from "./testing/fake-bindings";
import type { FillMessage } from "./bindings";
import { listPending, markPending, markVerifying } from "./fill-state";
import { tileObjectKey } from "./tile-cell";

// Why these tests matter: the entry wires the bindings into the routes and
// the consumer. The consumer must acknowledge every message, also one whose
// fill threw: a retried message would send the operators the same request
// again, and a tile that fails is retried only through its failure record.

const CELL = latLngToCell(50.9384, 6.9598, 7);

function batch(messages: FillMessage[]): {
  batch: QueueBatch;
  acked: number[];
} {
  const acked: number[] = [];
  return {
    acked,
    batch: {
      messages: messages.map((body, i) => ({
        body,
        ack: () => {
          acked.push(i);
        },
      })),
    },
  };
}

describe("the worker entry", () => {
  it("serves requests through the routes", async () => {
    const env = { TILES: new FakeBucket(), FILL_QUEUE: new FakeQueue() };
    const response = await worker.fetch(
      new Request("https://osm-tiles.example.workers.dev/"),
      env,
    );
    expect(response.status).toBe(200);
  });

  it("acknowledges a message whose fill threw, and logs the error", async () => {
    const bucket = new FakeBucket();
    bucket.head = () => Promise.reject(new Error("R2 down"));
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b, acked } = batch([{ cell: CELL, kind: "fill", at: 1 }]);
    await worker.queue(b, env);
    expect(acked).toEqual([0]);
    expect(String(log.mock.calls[0]?.[0])).toContain("R2 down");
    log.mockRestore();
  });

  it("drops a message with an invalid cell without any request", async () => {
    const env = { TILES: new FakeBucket(), FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b, acked } = batch([
      { cell: "../x", kind: "fill", at: 1 } as FillMessage,
    ]);
    await worker.queue(b, env);
    expect(acked).toEqual([0]);
    expect(String(log.mock.calls[0]?.[0])).toContain("invalid");
    log.mockRestore();
  });

  it("runs a verify message without touching the cell's pending fill marker", async () => {
    // A verify is no fill: the cell's marker may belong to a fill queued
    // behind it, and clearing it would hide that fill from the backlog.
    const bucket = new FakeBucket();
    const key = tileObjectKey(CELL);
    await bucket.put(key, "{ cut", {
      customMetadata: { osmBase: "2026-11-11T09:00:00Z", storedAs: "raw" },
    });
    const etag = (await bucket.head(key))!.httpEtag;
    await markPending(bucket, CELL, Date.now());
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b, acked } = batch([
      { cell: CELL, kind: "verify", at: 1, etag },
    ]);
    await worker.queue(b, env);
    log.mockRestore();
    expect(acked).toEqual([0]);
    expect(bucket.objects.has(key)).toBe(false);
    expect(bucket.objects.has(`state/pending/${CELL}`)).toBe(true);
  });

  it("clears the verify's marker when it ends, and sweeps markers a killed or lost run left", async () => {
    // The report endpoint sends no second verify while a cell's marker is
    // open; a marker left behind would hold later reports back for its
    // whole stale age, and stale ones would pile up in the listing.
    const bucket = new FakeBucket();
    const key = tileObjectKey(CELL);
    await bucket.put(key, "{ cut", {
      customMetadata: { osmBase: "2026-11-11T09:00:00Z", storedAs: "raw" },
    });
    const etag = (await bucket.head(key))!.httpEtag;
    const other = latLngToCell(47.0468, 8.3745, 7);
    await markVerifying(bucket, CELL, etag, Date.now());
    await markVerifying(bucket, other, '"x"', Date.now() - 16 * 60_000);
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b } = batch([{ cell: CELL, kind: "verify", at: 1, etag }]);
    await worker.queue(b, env);
    log.mockRestore();
    expect(
      [...bucket.objects.keys()].filter((k) =>
        k.startsWith("state/verifying/"),
      ),
    ).toEqual([]);
  });

  it("runs a replace message as a fill of its cell: refetched, marker cleared", async () => {
    // Why: a replace is how a reported tile the verify cannot judge bad is
    // put right; dropped as an unknown kind, every such report would be
    // answered "replacing" and nothing would ever change.
    const bucket = new FakeBucket();
    await bucket.put(tileObjectKey(CELL), "old", {
      customMetadata: { osmBase: "2026-11-11T09:00:00Z" },
    });
    await markPending(bucket, CELL, Date.now());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("busy", { status: 504 }));
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b, acked } = batch([{ cell: CELL, kind: "replace", at: 1 }]);
    await worker.queue(b, env);
    log.mockRestore();
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(acked).toEqual([0]);
    expect(bucket.textOf(tileObjectKey(CELL))).toBe("old");
    expect(bucket.objects.has(`state/pending/${CELL}`)).toBe(false);
  });

  it("clears its pending marker when the fill ends, also when it threw", async () => {
    // The marker is the backlog the fill endpoint counts; one left behind by
    // a finished fill would make the endpoint answer busy for nothing.
    const bucket = new FakeBucket();
    bucket.head = () => Promise.reject(new Error("R2 down"));
    await markPending(bucket, CELL, Date.now());
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b } = batch([{ cell: CELL, kind: "fill", at: 1 }]);
    await worker.queue(b, env);
    log.mockRestore();
    expect(bucket.objects.has(`state/pending/${CELL}`)).toBe(false);
  });

  it("marks itself running while it fills, and sweeps the running marker a killed run left", async () => {
    // Serial consumer: when a message starts, any marker still flagged
    // running belongs to a run the runtime killed (CPU or wall limit).
    const bucket = new FakeBucket();
    const now = Date.now();
    const killed = latLngToCell(47.0468, 8.3745, 7);
    const waiting = latLngToCell(48.0, 8.0, 7);
    await markPending(bucket, killed, now - 60_000, true);
    await markPending(bucket, waiting, now - 1_000);
    await markPending(bucket, CELL, now - 2_000);
    // A stored tile makes the fill a no-op; the head call is where the
    // running state is observed.
    await bucket.put(tileObjectKey(CELL), "x");
    let seen: Awaited<ReturnType<typeof listPending>> = [];
    const head = bucket.head.bind(bucket);
    bucket.head = async (key) => {
      seen = await listPending(bucket, Date.now());
      return head(key);
    };
    const env = { TILES: bucket, FILL_QUEUE: new FakeQueue() };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { batch: b } = batch([{ cell: CELL, kind: "fill", at: 1 }]);
    await worker.queue(b, env);
    log.mockRestore();
    expect(seen.find((p) => p.cell === CELL)?.running).toBe(true);
    expect(seen.map((p) => p.cell)).not.toContain(killed);
    expect((await listPending(bucket, Date.now())).map((p) => p.cell)).toEqual([
      waiting,
    ]);
  });
});
