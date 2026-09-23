/**
 * Lazy zxing-wasm reader for the `?qrperf=zxing` comparison. The module and
 * its `.wasm` are loaded only when this probe is created and used, and the
 * binary is served from this site (never the library's jsDelivr default).
 * See zxing-probe.ts.md.
 */

import type { RgbaImage } from "gps-plus-slam-app-framework/ar";
import type { ReaderOptions, ReadResult } from "zxing-wasm/reader";
import type { ZxingOptionSet, ZxingProbe } from "./qrperf-instrument.js";

/** The one zxing function the probe calls. */
export interface ZxingReaderLike {
  readBarcodes(image: ImageData, options: ReaderOptions): Promise<ReadResult[]>;
}

export interface ZxingProbeOptions {
  /** Loads and instantiates the reader. Defaults to the self-hosted build. */
  load?: () => Promise<ZxingReaderLike>;
  now?: () => number;
}

const OPTION_SETS: Record<ZxingOptionSet, ReaderOptions> = {
  default: { formats: ["QRCode"], maxNumberOfSymbols: 1 },
  fast: {
    formats: ["QRCode"],
    maxNumberOfSymbols: 1,
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: false,
  },
};

/**
 * The production loader: dynamic imports keep zxing out of the demo's main
 * chunk, and Vite's `?url` gives the self-hosted `.wasm` URL under the app's
 * base path.
 */
async function loadSelfHostedReader(): Promise<ZxingReaderLike> {
  const [reader, wasm] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  const wasmUrl = wasm.default;
  await reader.prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  });
  return reader;
}

export function createZxingProbe(
  options: ZxingProbeOptions = {},
): ZxingProbe & {
  warmUp(): Promise<void>;
} {
  const load = options.load ?? loadSelfHostedReader;
  const now = options.now ?? (() => performance.now());
  let loading: Promise<ZxingReaderLike> | null = null;
  let loadMs: number | null = null;

  function ensureLoaded(): Promise<ZxingReaderLike> {
    if (!loading) {
      const t0 = now();
      loading = load().then((reader) => {
        loadMs = now() - t0;
        return reader;
      });
    }
    return loading;
  }

  return {
    loadMs: () => loadMs,
    warmUp: async () => {
      await ensureLoaded();
    },
    async decode(image: RgbaImage, set: ZxingOptionSet) {
      if (image.data.length !== image.width * image.height * 4) {
        return { ms: 0, result: null, skipped: true };
      }
      const reader = await ensureLoaded();
      // zxing duck-types ImageData: data + width + height.
      const imageData = {
        data: image.data,
        width: image.width,
        height: image.height,
        colorSpace: "srgb",
      } as ImageData;
      const t0 = now();
      const results = await reader.readBarcodes(imageData, OPTION_SETS[set]);
      const ms = now() - t0;
      const hit = results.find((r) => r.isValid);
      if (!hit) return { ms, result: null };
      const p = hit.position;
      return {
        ms,
        result: {
          corners: [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft].map(
            ({ x, y }) => ({ x, y }),
          ),
          rotationDeg: hit.rotation,
        },
      };
    },
  };
}
