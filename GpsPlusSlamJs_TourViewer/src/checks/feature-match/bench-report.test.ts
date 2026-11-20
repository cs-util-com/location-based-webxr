import { describe, expect, it } from "vitest";

import {
  formatReport,
  hasJspi,
  tableRows,
  UNKNOWN_DEVICE,
  type DeviceInfo,
} from "./bench-report";
import type { MethodResult } from "./bench-run";
import { summarize } from "./bench-stats";

const device: DeviceInfo = {
  userAgent: "Mozilla/5.0 (Linux; Android 16) Chrome/151",
  model: "Phone X",
  platformVersion: "16.0.0",
  hardwareConcurrency: 8,
  deviceMemoryGb: 8,
  crossOriginIsolated: false,
  jspi: true,
  screen: "412x915 @2.625",
  webgpu: "qualcomm adreno-7xx; features: shader-f16",
};

const ok: MethodResult = {
  id: "xfeat-webgpu-fp16",
  label: "XFeat (LiteRT.js) webgpu fp16",
  backend: "webgpu (fully accelerated)",
  downloads: [
    {
      label: "xfeat_fp16.tflite",
      bytes: 1415024,
      ms: 812.4,
      cached: false,
      files: 1,
    },
    {
      label: "LiteRT.js runtime",
      bytes: null,
      ms: 2100,
      cached: null,
      files: 3,
    },
  ],
  initMs: 640.2,
  notes: ["fixed model input 640x480; smaller frames are padded"],
  sizes: [
    {
      longEdge: 320,
      width: 320,
      height: 240,
      extract: summarize([12, 13, 14]),
      match: summarize([30]),
      keypoints: 512,
      descriptorBytes: 131072,
      matches: 210,
      correct: 190,
      sample: null,
      error: null,
    },
    {
      longEdge: 640,
      width: 640,
      height: 480,
      extract: summarize([]),
      match: summarize([]),
      keypoints: Number.NaN,
      descriptorBytes: Number.NaN,
      matches: Number.NaN,
      correct: Number.NaN,
      sample: null,
      error: "RangeError: out of memory",
    },
  ],
  error: null,
};

const failed: MethodResult = {
  id: "aliked-wasm",
  label: "ALIKED + LightGlue (onnxruntime-web) wasm",
  backend: "-",
  downloads: [],
  initMs: Number.NaN,
  notes: [],
  sizes: [],
  error: "init: Error: extractor: HTTP 404 for https://x.test/a.onnx",
};

// Why these tests matter: the copied log is the page's only output that
// leaves the phone; it must carry the device and every number, and a
// failure must read as a failure, never as a blank or a zero.
describe("formatReport", () => {
  const text = formatReport({
    startedAt: "2026-11-19T21:00:00.000Z",
    device,
    input: "synthetic 640x480 (seed 1)",
    sizes: [320, 640],
    runs: 5,
    results: [ok, failed],
    errors: ["camera: NotAllowedError: Permission denied"],
  });

  it("carries the device facts and the settings", () => {
    expect(text).toContain(
      "user agent: Mozilla/5.0 (Linux; Android 16) Chrome/151",
    );
    expect(text).toContain("model: Phone X, platform version: 16.0.0");
    expect(text).toContain(
      "cores: 8, memory: 8 GB, cross-origin isolated: no, JSPI: yes",
    );
    expect(text).toContain("webgpu: qualcomm adreno-7xx; features: shader-f16");
    expect(text).toContain(
      "sizes (long edge): 320, 640; runs: 5 after 1 warm-up",
    );
    expect(text).toContain("ERROR camera: NotAllowedError: Permission denied");
  });

  it("carries every number of a method", () => {
    expect(text).toContain("backend: webgpu (fully accelerated), init 640 ms");
    expect(text).toContain(
      "download xfeat_fp16.tflite: 1.42 MB, 812 ms (network)",
    );
    expect(text).toContain("download LiteRT.js runtime: - in 3 files, 2100 ms");
    expect(text).toContain(
      "@320 (320x240): extract 13.0 / 14.0 ms | match 30.0 / 30.0 ms | kp 512 | desc 131.1 KB/frame | matches 210 | correct 190",
    );
    expect(text).toContain("@640 (640x480): ERROR RangeError: out of memory");
    expect(text).toContain(
      "note: fixed model input 640x480; smaller frames are padded",
    );
  });

  it("names a method that failed to load", () => {
    expect(text).toContain(
      "## ALIKED + LightGlue (onnxruntime-web) wasm\nERROR init: Error: extractor: HTTP 404 for https://x.test/a.onnx",
    );
  });
});

describe("tableRows", () => {
  it("gives one row per size and one per failed method", () => {
    const rows = tableRows([ok, failed]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      size: "320x240",
      extract: "13.0 / 14.0",
      keypoints: "512",
      matches: "210",
      correct: "190",
      error: "",
    });
    expect(rows[1]).toMatchObject({
      extract: "- / -",
      keypoints: "-",
      error: "RangeError: out of memory",
    });
    expect(rows[2]).toMatchObject({ size: "-", error: failed.error });
  });
});

// Why these tests matter: a browser without WebAssembly made the JSPI probe
// throw and ended the whole run, SIFT included; device facts are optional.
describe("hasJspi", () => {
  it("is false without WebAssembly or without Suspending", () => {
    expect(hasJspi(undefined)).toBe(false);
    expect(hasJspi({})).toBe(false);
  });

  it("is true when WebAssembly has Suspending", () => {
    expect(hasJspi({ Suspending: () => undefined })).toBe(true);
  });
});

describe("UNKNOWN_DEVICE", () => {
  it("reads as dashes in the report", () => {
    const text = formatReport({
      startedAt: "t",
      device: UNKNOWN_DEVICE,
      input: "x",
      sizes: [320],
      runs: 1,
      results: [],
      errors: [],
    });
    expect(text).toContain("model: -, platform version: -");
    expect(text).toContain("webgpu: -");
  });
});
