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

/** The same keypoint budget as the learned methods, for a fair count. */
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

/** A detector result as benchmark features, checked for size. */
export function siftFeatures(r: SiftResult): Features {
  const n = r.n;
  if (!Number.isInteger(n) || n < 0 || r.x.length < n || r.y.length < n) {
    throw new Error(`sift.js: malformed result (n=${String(n)})`);
  }
  if (!(r.desc instanceof Uint8Array) || r.desc.length < n * DIM) {
    throw new Error("sift.js: descriptor buffer too short");
  }
  return {
    count: n,
    descriptorBytes: n * DIM,
    x: Float32Array.from({ length: n }, (_, i) => r.x[i]!),
    y: Float32Array.from({ length: n }, (_, i) => r.y[i]!),
    payload: r.desc.subarray(0, n * DIM),
  };
}

/** The SIFT method; runs on the main thread. */
export function siftMethod(deps: LoadDeps): BenchMethod {
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
        backend: "js (main thread)",
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
