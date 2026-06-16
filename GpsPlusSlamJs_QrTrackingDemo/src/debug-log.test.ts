/**
 * Debug log — unit tests.
 *
 * Why this matters: the on-device tuning relies on the Δt-per-lock readout being
 * accurate, and the buffer must stay bounded (it appends at the detection
 * cadence for the whole session).
 */

import { describe, it, expect } from "vitest";
import {
  createDebugLog,
  formatDiagnosticsLine,
  formatStatusLine,
} from "./debug-log";

describe("createDebugLog", () => {
  it("keeps lines oldest-first and bounded to the cap", () => {
    const log = createDebugLog(3);
    log.append("a");
    log.append("b");
    log.append("c");
    log.append("d");
    expect(log.lines).toEqual(["b", "c", "d"]);
  });
});

describe("formatDiagnosticsLine", () => {
  it("shows clock, Δt, payload, depth coverage, size cm, quality, sample count, stage and reason", () => {
    expect(
      formatDiagnosticsLine({
        clockMs: 12340,
        deltaMs: 132,
        text: "https://demo/qr",
        depthCornerHits: 4,
        sizeM: 0.201,
        quality: 0.62,
        sampleCount: 0,
        status: "measuring",
        reason: "low quality 0.62 — no sample yet",
      }),
    ).toBe(
      '[12.34s Δ132ms] "https://demo/qr" d4/4 20.1cm q0.62 (0) measuring — low quality 0.62 — no sample yet',
    );
  });

  it("uses dashes for the first frame and unknown depth/size/quality, and truncates long payloads", () => {
    const line = formatDiagnosticsLine({
      clockMs: 0,
      deltaMs: null,
      text: "https://example.com/very/long/level/url",
      depthCornerHits: null,
      sizeM: null,
      quality: null,
      sampleCount: 0,
      status: "no-detection",
      reason: "no QR",
    });
    expect(line).toContain("Δ—");
    expect(line).toContain("d—"); // unknown depth coverage
    expect(line).toContain("q?"); // unknown quality
    expect(line).toContain("…"); // truncated payload
  });
});

describe("formatStatusLine", () => {
  it("stamps a status transition", () => {
    expect(formatStatusLine(5000, "tracking")).toBe("[5.00s] → tracking");
  });
});
