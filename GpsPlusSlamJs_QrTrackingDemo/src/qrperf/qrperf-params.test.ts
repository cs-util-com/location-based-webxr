/**
 * Why these tests matter: `?qrperf` is the owner's on-phone measurement
 * switch (plan 2026-09-23 M2). A typo in the URL must never enable zxing (a
 * ~400 KB download) or the pre-fix baseline by accident, and the default must
 * stay "off" so the demo behaves exactly as before for everyone else.
 */

import { describe, expect, it } from "vitest";
import { parseQrPerfParams } from "./qrperf-params.js";

describe("parseQrPerfParams", () => {
  it("is off without the flag", () => {
    expect(parseQrPerfParams("")).toEqual({ mode: "off", baseline: false });
    expect(parseQrPerfParams("?capture=2048")).toEqual({
      mode: "off",
      baseline: false,
    });
  });

  it("reads the native and zxing modes", () => {
    expect(parseQrPerfParams("?qrperf=1").mode).toBe("native");
    expect(parseQrPerfParams("?qrperf=native").mode).toBe("native");
    expect(parseQrPerfParams("?qrperf=zxing").mode).toBe("zxing");
  });

  it("treats unknown values as off rather than guessing", () => {
    expect(parseQrPerfParams("?qrperf=zxingg").mode).toBe("off");
    expect(parseQrPerfParams("?qrperf=0").mode).toBe("off");
    expect(parseQrPerfParams("?qrperf=").mode).toBe("off");
  });

  it("honours baseline only when the instrument is on", () => {
    expect(parseQrPerfParams("?qrperf=1&baseline=1")).toEqual({
      mode: "native",
      baseline: true,
    });
    expect(parseQrPerfParams("?baseline=1").baseline).toBe(false);
    expect(parseQrPerfParams("?qrperf=1&baseline=0").baseline).toBe(false);
  });
});
