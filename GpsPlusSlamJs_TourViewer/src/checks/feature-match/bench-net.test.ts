import { describe, expect, it } from "vitest";

import {
  errorText,
  fetchBytes,
  formatBytes,
  summarizeResources,
} from "./bench-net";

// Why these tests matter: the download size and time of each model and
// runtime file are half of what the page measures; a 404 must become one
// readable log line, and a cache read must not pass for a network download.
describe("fetchBytes", () => {
  it("returns the bytes, their count and the time taken", async () => {
    let t = 100;
    const out = await fetchBytes("https://x.test/m.onnx", "model", {
      fetch: () => {
        t += 250;
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
      },
      now: () => t,
      lookup: () => ({
        name: "https://x.test/m.onnx",
        transferSize: 0,
        encodedBodySize: 3,
        startTime: 0,
        responseEnd: 1,
      }),
    });
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(out.record).toEqual({
      label: "model",
      bytes: 3,
      ms: 250,
      cached: true,
      files: 1,
    });
  });

  it("turns an HTTP error into an error naming the file and status", async () => {
    await expect(
      fetchBytes("https://x.test/gone.tflite", "xfeat model", {
        fetch: () => Promise.resolve(new Response("nope", { status: 404 })),
        now: () => 0,
      }),
    ).rejects.toThrow("xfeat model: HTTP 404 for https://x.test/gone.tflite");
  });
});

describe("summarizeResources", () => {
  const entry = (
    name: string,
    transferSize: number,
    encoded: number,
    s: number,
    e: number,
  ) => ({
    name,
    transferSize,
    encodedBodySize: encoded,
    startTime: s,
    responseEnd: e,
  });

  it("sums the files under a prefix and spans their time", () => {
    const r = summarizeResources(
      [
        entry("https://cdn.test/rt@1/a.js", 1300, 1000, 10, 50),
        entry("https://cdn.test/rt@1/a.wasm", 9000, 8800, 40, 300),
        entry("https://other.test/x.js", 5, 5, 0, 1),
      ],
      "https://cdn.test/rt@1/",
      "runtime",
    );
    expect(r).toEqual({
      label: "runtime",
      bytes: 10300,
      ms: 290,
      cached: false,
      files: 2,
    });
  });

  it("reports an unknown size when the browser hides one", () => {
    const r = summarizeResources(
      [entry("https://cdn.test/a", 0, 0, 0, 5)],
      "https://cdn.test/",
      "x",
    );
    expect(r?.bytes).toBeNull();
    expect(r?.cached).toBeNull();
  });

  it("marks a group read wholly from the cache", () => {
    const r = summarizeResources(
      [entry("https://cdn.test/a", 0, 70, 0, 5)],
      "https://cdn.test/",
      "x",
    );
    expect(r?.cached).toBe(true);
    expect(r?.bytes).toBe(70);
  });

  it("is null when nothing was loaded under the prefix", () => {
    expect(summarizeResources([], "https://cdn.test/", "x")).toBeNull();
  });
});

describe("errorText and formatBytes", () => {
  it("prints an error's name and message, and anything else as text", () => {
    expect(errorText(new RangeError("out of memory"))).toBe(
      "RangeError: out of memory",
    );
    expect(errorText("plain")).toBe("plain");
  });

  it("prints sizes in B, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(14540)).toBe("14.5 KB");
    expect(formatBytes(1415024)).toBe("1.42 MB");
    expect(formatBytes(null)).toBe("-");
  });
});
