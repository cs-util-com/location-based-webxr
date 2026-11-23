import { describe, expect, it } from "vitest";

import { webGpuProbe } from "./webgpu-probe";

// Why these tests matter: the page and the worker each pick WebGPU or WASM
// from this answer; `navigator.gpu` without an adapter, or a throwing
// request, must read as "no WebGPU", and the adapter is asked only once.
describe("webGpuProbe", () => {
  it("answers true only for an adapter, and asks once", async () => {
    let asked = 0;
    const has = webGpuProbe(() => ({
      requestAdapter: () => {
        asked++;
        return Promise.resolve({});
      },
    }));
    expect(await has()).toBe(true);
    expect(await has()).toBe(true);
    expect(asked).toBe(1);
  });

  it("answers false without navigator.gpu, without an adapter, or on a throw", async () => {
    expect(await webGpuProbe(() => undefined)()).toBe(false);
    expect(
      await webGpuProbe(() => ({
        requestAdapter: () => Promise.resolve(null),
      }))(),
    ).toBe(false);
    expect(
      await webGpuProbe(() => ({
        requestAdapter: () => Promise.reject(new Error("lost")),
      }))(),
    ).toBe(false);
  });
});
