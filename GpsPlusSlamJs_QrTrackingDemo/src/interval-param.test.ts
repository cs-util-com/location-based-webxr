import { describe, expect, it } from "vitest";
import { QR_CAPTURE_INTERVAL_CONSTRAINTS } from "gps-plus-slam-app-framework/ar/qr/qr-capture-cadence";
import { parseIntervalParam } from "./interval-param";

const { min, max } = QR_CAPTURE_INTERVAL_CONSTRAINTS;

describe("parseIntervalParam", () => {
  // Why this test matters: the field test measures a faster detection rate by
  // URL (QR near-frontal pose plan, M1) without changing the default; an
  // absent value must leave the default in charge.
  it("returns undefined when the param is absent", () => {
    expect(parseIntervalParam("")).toBeUndefined();
    expect(parseIntervalParam("?qrperf=1")).toBeUndefined();
  });

  it("accepts an in-range value, flooring fractions", () => {
    expect(parseIntervalParam("?interval=60")).toBe(60);
    expect(parseIntervalParam("?qrperf=1&interval=250.9")).toBe(250);
    expect(parseIntervalParam(`?interval=${min}`)).toBe(min);
    expect(parseIntervalParam(`?interval=${max}`)).toBe(max);
  });

  // Why this test matters: the bounds are the framework's, shared with the
  // Recorder's slider; a URL typo must not run the detector at 1 ms (frames
  // only queue) or at 0 (a throttle that never fires).
  it("rejects out-of-range, non-numeric and empty values", () => {
    for (const bad of [
      `?interval=${min - 1}`,
      `?interval=${max + 1}`,
      "?interval=0",
      "?interval=-100",
      "?interval=fast",
      "?interval=",
      "?interval=NaN",
      "?interval=Infinity",
    ]) {
      expect(parseIntervalParam(bad), bad).toBeUndefined();
    }
  });
});
