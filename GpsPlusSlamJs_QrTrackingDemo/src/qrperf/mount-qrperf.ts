/**
 * DOM glue for the `?qrperf` instrument: builds it from the URL params, keeps
 * the on-screen report fresh, wires "Copy JSON", feeds XR frame intervals and
 * warms zxing up in `zxing` mode. Verified by the demo e2e; the logic it
 * composes is unit-tested in the sibling modules. See mount-qrperf.ts.md.
 */

import { registerXrFrameUpdate } from "gps-plus-slam-app-framework/ar/xr-frame-loop";
import { copyReport } from "./copy-report.js";
import {
  createQrPerfInstrument,
  type QrPerfInstrument,
} from "./qrperf-instrument.js";
import type { QrPerfParams } from "./qrperf-params.js";
import { createZxingProbe } from "./zxing-probe.js";

/** How often the on-screen report is re-rendered. */
const REPORT_REFRESH_MS = 500;

export interface MountedQrPerf {
  instrument: QrPerfInstrument;
  dispose(): void;
}

export interface QrPerfDom {
  log: HTMLElement;
  copy: HTMLButtonElement;
}

/** Mount the instrument, or return `null` (and touch nothing) when it is off. */
export function mountQrPerf(
  params: QrPerfParams,
  dom: QrPerfDom,
): MountedQrPerf | null {
  if (params.mode === "off") return null;

  const probe = params.mode === "zxing" ? createZxingProbe() : undefined;
  const instrument = createQrPerfInstrument({
    ...params,
    ...(probe ? { zxing: probe } : {}),
  });
  let loadError: string | null = null;
  if (probe) {
    // Load while the user points the phone, so the first frames are compared.
    probe.warmUp().catch((err: unknown) => {
      // Shown on screen: the phone run has no console to read.
      loadError = err instanceof Error ? err.message : String(err);
    });
  }

  const render = (): void => {
    const lines = instrument.report();
    if (loadError) lines.unshift(`zxing load FAILED: ${loadError}`);
    dom.log.textContent = lines.join("\n");
  };
  const timer = setInterval(render, REPORT_REFRESH_MS);
  const unregister = registerXrFrameUpdate(({ dt }) =>
    instrument.onXrFrame(dt),
  );
  const onCopy = (): void => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    void copyReport(
      dom.copy,
      instrument.json(),
      clipboard ? (text) => clipboard.writeText(text) : undefined,
    );
  };
  dom.copy.addEventListener("click", onCopy);
  dom.log.hidden = false;
  dom.copy.hidden = false;
  render();

  return {
    instrument,
    dispose() {
      clearInterval(timer);
      unregister();
      dom.copy.removeEventListener("click", onCopy);
    },
  };
}
