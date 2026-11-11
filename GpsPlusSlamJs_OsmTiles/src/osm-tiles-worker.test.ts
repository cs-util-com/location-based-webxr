import { describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import worker, { type QueueBatch } from "./osm-tiles-worker";
import { FakeBucket, FakeQueue } from "./testing/fake-bindings";
import type { FillMessage } from "./bindings";

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
});
