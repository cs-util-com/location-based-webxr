/**
 * Why these tests matter: the probe decides between a refusal, a warning
 * and a start, from whatever the browser reports; a browser that throws
 * or reports nothing must end in a refusal, never in an exception that
 * leaves the page blank. And production's trainer must never pretend to
 * train.
 */
import { describe, expect, it } from "vitest";

import {
  createUnavailableTrainer,
  type GpuAdapterLike,
  probeWebGpu,
} from "./trainer-adapter.js";

const gpuWith = (adapter: GpuAdapterLike | null) => ({
  requestAdapter: () => Promise.resolve(adapter),
});

describe("probeWebGpu", () => {
  it("refuses without WebGPU, without an adapter, and on a software adapter", async () => {
    expect((await probeWebGpu(undefined)).kind).toBe("no-webgpu");
    expect((await probeWebGpu(gpuWith(null))).kind).toBe("no-webgpu");
    expect(
      (await probeWebGpu(gpuWith({ info: { isFallbackAdapter: true } }))).kind,
    ).toBe("no-webgpu");
    expect((await probeWebGpu(gpuWith({ isFallbackAdapter: true }))).kind).toBe(
      "no-webgpu",
    );
  });

  it("refuses when the request throws or rejects", async () => {
    const throws = {
      requestAdapter: (): Promise<null> => {
        throw new Error("blocked");
      },
    };
    const rejects = {
      requestAdapter: () => Promise.reject(new Error("refused")),
    };
    expect((await probeWebGpu(throws)).kind).toBe("no-webgpu");
    expect((await probeWebGpu(rejects)).kind).toBe("no-webgpu");
  });

  it("tells built-in graphics from a graphics card", async () => {
    const kindOf = async (info: GpuAdapterLike["info"]) =>
      (await probeWebGpu(gpuWith(info === undefined ? {} : { info }))).kind;
    expect(await kindOf({ vendor: "intel" })).toBe("integrated");
    expect(await kindOf({ description: "AMD Radeon(TM) Integrated" })).toBe(
      "integrated",
    );
    expect(await kindOf({ vendor: "nvidia" })).toBe("ready");
    // Why: Intel also makes graphics cards (Arc, the Xe-HPG family);
    // calling one built-in graphics sent the person using it to Windows settings
    // for nothing. Intel's integrated families stay integrated.
    expect(await kindOf({ vendor: "intel", architecture: "xe-hpg" })).toBe(
      "ready",
    );
    expect(await kindOf({ vendor: "intel", architecture: "xe2-hpg" })).toBe(
      "ready",
    );
    expect(await kindOf({ vendor: "intel", architecture: "xe-lpg" })).toBe(
      "integrated",
    );
    expect(await kindOf({ vendor: "intel", architecture: "gen-12lp" })).toBe(
      "integrated",
    );
    expect(await kindOf(undefined)).toBe("ready");
  });
});

describe("createUnavailableTrainer", () => {
  it("probes the real card but refuses to train or judge", async () => {
    const t = createUnavailableTrainer(gpuWith({ info: { vendor: "nvidia" } }));
    expect(t.kind).toBe("unavailable");
    expect((await t.probe()).kind).toBe("ready");
    await expect(
      t.trainWindow({} as never, {} as never, new AbortController().signal),
    ).rejects.toThrow(/not available/);
    expect(() => t.judge({} as never, {} as never)).toThrow(/not available/);
  });
});
