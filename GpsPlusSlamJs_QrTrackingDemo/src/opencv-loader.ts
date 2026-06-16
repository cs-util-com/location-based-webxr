/**
 * OpenCV.js loader (demo device seam) — lazily loads opencv.js and adapts the
 * loaded global to the framework's {@link CvLike}, so `seams.ts` can build an
 * `OpenCvPnpSquare` for the production PnP pose path (Step-0 conversion, see
 * `GpsPlusSlamJs_Docs/docs/2026-06-16-qr-demo-pnp-conversion-plan.md`).
 *
 * Why main-thread: the demo runs `BarcodeDetector` on the main thread and
 * `OpenCvPnpSquare.solve` is synchronous, so a worker (as `opencv-pnp.ts.md`
 * mentions for the Recorder) buys nothing here — we load opencv.js as a classic
 * `<script>` that publishes the global `cv` and resolve once its WASM runtime is
 * initialized.
 *
 * DEVICE-UNVERIFIED: the actual CDN URL/version and the runtime-init handshake
 * vary by opencv.js build and can only be confirmed on a real device/browser
 * (the rest of the demo's device seam is likewise manually verified). The pure
 * orchestration — single-flight idempotency, the injected script loader, the
 * ready/timeout handshake — is unit-tested with fakes; see `opencv-loader.test.ts`
 * and the on-device follow-up doc.
 *
 * The build MUST include `calib3d` (for `solvePnP` + `SOLVEPNP_IPPE_SQUARE`).
 */

import type { CvLike } from "gps-plus-slam-app-framework/ar";

/**
 * Pinned opencv.js URL. The versioned docs host serves a full build (calib3d
 * included). Treat as a tunable — confirm the version + that it exposes
 * `SOLVEPNP_IPPE_SQUARE` on device.
 */
export const DEFAULT_OPENCV_URL = "https://docs.opencv.org/4.10.0/opencv.js";

/** Default cap on how long to wait for the WASM runtime after the script loads. */
const DEFAULT_OPENCV_TIMEOUT_MS = 30_000;

/** The shape of the global opencv.js publishes (the slice we probe). */
interface OpenCvGlobal {
  /** Present once the WASM runtime is initialized. */
  Mat?: unknown;
  /** Emscripten hook called when the runtime is ready. */
  onRuntimeInitialized?: () => void;
  /** Newer builds expose `cv` as a thenable resolving to the module. */
  then?: (onFulfilled: (m: OpenCvGlobal) => void) => void;
}

export interface LoadOpenCvDeps {
  /** Override the script URL (default {@link DEFAULT_OPENCV_URL}). */
  url?: string;
  /** Wait cap for runtime init (default {@link DEFAULT_OPENCV_TIMEOUT_MS}). */
  timeoutMs?: number;
  /** Inject the `<script>` load; resolves on `onload`. Default: DOM injection. */
  loadScript?: (url: string) => Promise<void>;
  /** Read the published global (default: `globalThis.cv`). */
  getGlobal?: () => unknown;
}

/** Single-flight: one in-flight (or resolved) load shared by all callers. */
let inflight: Promise<CvLike> | null = null;

function domLoadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`opencv.js failed to load: ${url}`));
    document.head.appendChild(script);
  });
}

function isThenable(v: OpenCvGlobal): boolean {
  return typeof v.then === "function";
}

/** Resolve once the WASM runtime is initialized, or reject after `timeoutMs`. */
function awaitRuntime(
  cvGlobal: OpenCvGlobal,
  timeoutMs: number,
): Promise<CvLike> {
  return new Promise<CvLike>((resolve, reject) => {
    const ready = (cv: OpenCvGlobal): void => {
      if (cv.Mat) {
        resolve(cv as unknown as CvLike);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error("opencv.js runtime did not initialize in time"));
      }, timeoutMs);
      cv.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve(cv as unknown as CvLike);
      };
    };

    // Newer builds resolve `cv` as a thenable to the actual module.
    if (isThenable(cvGlobal)) {
      cvGlobal.then?.(ready);
    } else {
      ready(cvGlobal);
    }
  });
}

/**
 * Load opencv.js and return a {@link CvLike}. Idempotent: repeated calls share
 * one load. On failure the in-flight promise is cleared so a later call may
 * retry.
 */
export function loadOpenCv(deps: LoadOpenCvDeps = {}): Promise<CvLike> {
  if (inflight) return inflight;

  const {
    url = DEFAULT_OPENCV_URL,
    timeoutMs = DEFAULT_OPENCV_TIMEOUT_MS,
    loadScript = domLoadScript,
    getGlobal = () => (globalThis as { cv?: unknown }).cv,
  } = deps;

  inflight = (async () => {
    await loadScript(url);
    const cvGlobal = getGlobal() as OpenCvGlobal | undefined;
    if (!cvGlobal) {
      throw new Error("opencv.js loaded but no global `cv` was published");
    }
    return awaitRuntime(cvGlobal, timeoutMs);
  })().catch((err) => {
    inflight = null; // allow a retry after a failed load
    throw err;
  });

  return inflight;
}

/** Test-only: drop the cached load so each test starts clean. */
export function resetOpenCvLoaderForTest(): void {
  inflight = null;
}
