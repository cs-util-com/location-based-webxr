import { afterEach, describe, expect, it, vi } from "vitest";

describe("globe-city-worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // Why: the shell is the only place the core meets the worker's message
  // loop; a load for a place that is not a place must come back as the
  // core's refusal (a failed city, then the end), so the page never waits
  // on a load that will not start. Nothing is fetched for it.
  it("wires the core to the worker's messages: a target that is no place is refused", async () => {
    const posted: unknown[] = [];
    const scope: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: (message: unknown) => void;
    } = {
      onmessage: null,
      postMessage: (message) => posted.push(message),
    };
    vi.stubGlobal("self", scope);
    await import("./globe-city-worker.js");
    expect(scope.onmessage).toBeTypeOf("function");
    scope.onmessage?.({
      data: {
        kind: "load",
        id: 7,
        target: { lat: Number.NaN, lng: 7 },
        zoom: 12,
      },
    });
    expect(posted).toEqual([
      expect.objectContaining({ id: 7, kind: "city", ok: false }),
      { id: 7, kind: "finished", outcome: "invalid-target" },
    ]);
  });
});
