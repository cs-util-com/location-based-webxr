/**
 * `?qrperf` URL switch for the QR pipeline performance instrument.
 * See qrperf-params.ts.md.
 */

/** Which instrument runs. `off` is the default and changes nothing. */
type QrPerfMode = "off" | "native" | "zxing";

export interface QrPerfParams {
  mode: QrPerfMode;
  /** Run the pre-fix capture/copy behaviour, for the same-build A/B. */
  baseline: boolean;
}

/**
 * Parse `location.search`. `qrperf=1|native` -> native timings, `qrperf=zxing`
 * -> native plus a zxing comparison; anything else is `off`. `baseline=1`
 * counts only while the instrument is on.
 */
export function parseQrPerfParams(search: string): QrPerfParams {
  const params = new URLSearchParams(search);
  const raw = params.get("qrperf");
  const mode: QrPerfMode =
    raw === "1" || raw === "native"
      ? "native"
      : raw === "zxing"
        ? "zxing"
        : "off";
  const baseline = mode !== "off" && params.get("baseline") === "1";
  return { mode, baseline };
}
