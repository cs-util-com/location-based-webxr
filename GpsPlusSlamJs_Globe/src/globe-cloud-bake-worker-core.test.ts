/**
 * The bakes' worker, over a fake worker.
 *
 * Why this file matters: the bakes take seconds on a slow phone, so they
 * must not run where the frames run; and a page whose worker never answers
 * must keep its old clouds rather than lose them.
 */
import { describe, expect, it } from "vitest";

import { CLOUD_BAKE_SIZES, type CloudBakes } from "./globe-cloud-bake.js";
import {
  type CloudBakeWorker,
  createCloudBakeWorkerCore,
  requestCloudBakes,
} from "./globe-cloud-bake-worker-core.js";

const fakeBakes = (): CloudBakes => ({
  shape: new Uint8Array(CLOUD_BAKE_SIZES.shape ** 3),
  detail: new Uint8Array(CLOUD_BAKE_SIZES.detail ** 3),
  domes: new Uint8Array(4 * CLOUD_BAKE_SIZES.domes ** 2),
  region: new Uint8Array(4 * CLOUD_BAKE_SIZES.region ** 2),
  blue: new Uint8Array(CLOUD_BAKE_SIZES.blue ** 2),
  lifeGain: 0.8,
  detailMean: 0.5,
});

describe("createCloudBakeWorkerCore", () => {
  // Why this test matters: a copy of 300 kB of tiles per view is what a
  // transfer exists to avoid.
  it("answers a bake with its tiles, transferred", () => {
    const posted: { message: unknown; transfer: readonly ArrayBufferLike[] }[] =
      [];
    const core = createCloudBakeWorkerCore(
      (message, transfer) => posted.push({ message, transfer }),
      fakeBakes,
    );
    core.handle({ kind: "bake" });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.message).toMatchObject({
      kind: "bakes",
      bakes: { lifeGain: 0.8 },
    });
    expect(posted[0]?.transfer).toHaveLength(5);
  });

  it("answers a failure with its reason", () => {
    const posted: unknown[] = [];
    const core = createCloudBakeWorkerCore(
      (message) => posted.push(message),
      () => {
        throw new Error("no");
      },
    );
    core.handle({ kind: "bake" });
    expect(posted).toEqual([{ kind: "failed", message: "Error: no" }]);
  });

  it("ignores anything else", () => {
    const posted: unknown[] = [];
    const core = createCloudBakeWorkerCore(
      (message) => posted.push(message),
      fakeBakes,
    );
    core.handle({ kind: "other" });
    core.handle(null);
    expect(posted).toEqual([]);
  });
});

function fakeWorker() {
  const worker = {
    onmessage: null as CloudBakeWorker["onmessage"],
    onerror: null as CloudBakeWorker["onerror"],
    posted: [] as unknown[],
    terminated: 0,
    postMessage(message: unknown) {
      this.posted.push(message);
    },
    terminate() {
      this.terminated += 1;
    },
  };
  return worker;
}

describe("requestCloudBakes", () => {
  // Why this test matters: a script that fails to load gives an empty
  // message, which would reach the page as a bare "Error".
  it("names the failure", async () => {
    const worker = {
      onmessage: null as CloudBakeWorker["onmessage"],
      onerror: null as CloudBakeWorker["onerror"],
      postMessage() {},
      terminate() {},
    };
    const asked = requestCloudBakes(worker);
    worker.onerror?.({ message: "" } as ErrorEvent);
    await expect(asked).rejects.toThrow("the cloud bake worker did not run");
  });

  it("asks the worker, resolves its tiles and ends it", async () => {
    const worker = fakeWorker();
    const bakes = fakeBakes();
    const pending = requestCloudBakes(worker);
    expect(worker.posted).toEqual([{ kind: "bake" }]);
    worker.onmessage?.({ data: { kind: "bakes", bakes } } as MessageEvent);
    await expect(pending).resolves.toBe(bakes);
    expect(worker.terminated).toBe(1);
  });

  // Why this test matters: an app bundled without the worker's file gets a
  // load error, not a reply; the old clouds must then stay.
  it("rejects on a worker that fails to load, and ends it", async () => {
    const worker = fakeWorker();
    const pending = requestCloudBakes(worker);
    worker.onerror?.({ message: "not found" } as ErrorEvent);
    await expect(pending).rejects.toThrow("not found");
    expect(worker.terminated).toBe(1);
  });

  it("rejects on a failed bake", async () => {
    const worker = fakeWorker();
    const pending = requestCloudBakes(worker);
    worker.onmessage?.({
      data: { kind: "failed", message: "no memory" },
    } as MessageEvent);
    await expect(pending).rejects.toThrow("no memory");
  });

  it("rejects a reply it does not know", async () => {
    const worker = fakeWorker();
    const pending = requestCloudBakes(worker);
    worker.onmessage?.({ data: 3 } as MessageEvent);
    await expect(pending).rejects.toThrow(RangeError);
  });
});
