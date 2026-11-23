/**
 * SIFT in plain JavaScript (Splat.js `sift.js`, MIT), loaded at runtime
 * from a pinned commit and matched by mutual nearest neighbour.
 *
 * @see method-sift.ts.md
 */
import { toGray } from "./bench-image";
import { mutualNearestBytes } from "./bench-mnn";
import { summarizeResources, type LoadDeps } from "./bench-net";
import type { BenchMethod, Features, MethodRunner } from "./bench-run";

/** sift.js at a pinned commit; one file, no imports. */
export const SIFT_URL =
  "https://cdn.jsdelivr.net/gh/arrival-space/splat.js@a84620c05f210a304b2d8de1d5c9f19d3657126f/src/sfm/sift.js";

/**
 * The same keypoint budget as XFeat, for a fair count. sift.js caps its
 * detections, then adds a keypoint per extra dominant orientation, so the
 * result is cut to this budget again.
 */
export const SIFT_MAX_FEATURES = 1024;

const DIM = 128;

/** What `detectSift` returns. */
export interface SiftResult {
  readonly n: number;
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  readonly desc: Uint8Array;
}

type DetectSift = (
  gray: Float32Array,
  width: number,
  height: number,
  maxFeatures: number,
) => SiftResult;

/**
 * The module's `detectSift`, or an error naming what is missing (a
 * changed or wrong file must be one log line, not a crash later).
 */
export function siftApi(mod: unknown): DetectSift {
  const fn =
    typeof mod === "object" && mod !== null
      ? (mod as { detectSift?: unknown }).detectSift
      : undefined;
  if (typeof fn !== "function") {
    throw new Error("sift.js: no detectSift export");
  }
  return fn as DetectSift;
}

/**
 * A detector result as benchmark features, checked for size and cut to the
 * first `max` keypoints (sift.js orders them strongest first).
 */
export function siftFeatures(r: SiftResult, max = Infinity): Features {
  if (
    !Number.isInteger(r.n) ||
    r.n < 0 ||
    r.x.length < r.n ||
    r.y.length < r.n
  ) {
    throw new Error(`sift.js: malformed result (n=${String(r.n)})`);
  }
  if (!(r.desc instanceof Uint8Array) || r.desc.length < r.n * DIM) {
    throw new Error("sift.js: descriptor buffer too short");
  }
  const n = Math.min(r.n, max);
  return {
    count: n,
    descriptorBytes: n * DIM,
    x: Float32Array.from({ length: n }, (_, i) => r.x[i]!),
    y: Float32Array.from({ length: n }, (_, i) => r.y[i]!),
    payload: r.desc.subarray(0, n * DIM),
  };
}

/** The SIFT method; its backend names the thread it runs in. */
export function siftMethod(
  deps: LoadDeps,
  place: "main thread" | "worker" = "main thread",
): BenchMethod {
  return {
    id: "sift",
    label: "SIFT (plain JS)",
    async init(): Promise<MethodRunner> {
      const t0 = deps.now();
      const detect = siftApi(await deps.importModule(SIFT_URL));
      const initMs = deps.now() - t0;
      const download = summarizeResources(
        deps.resources(),
        SIFT_URL,
        "sift.js",
      );
      return {
        backend: `js (${place})`,
        downloads: download === null ? [] : [download],
        initMs,
        notes: [
          `max ${String(SIFT_MAX_FEATURES)} features; uint8 descriptors, L2 mutual nearest neighbour`,
          "init = module import, download included",
        ],
        extract: (frame) =>
          Promise.resolve(
            siftFeatures(
              detect(
                toGray(frame),
                frame.width,
                frame.height,
                SIFT_MAX_FEATURES,
              ),
              SIFT_MAX_FEATURES,
            ),
          ),
        match: (a, b) =>
          Promise.resolve(
            mutualNearestBytes(
              a.payload as Uint8Array,
              a.count,
              b.payload as Uint8Array,
              b.count,
              DIM,
            ),
          ),
        dispose: () => undefined,
      };
    },
  };
}
