/**
 * SIFT (the plain-JS sift.js) matched by LightGlue: COLMAP's
 * `sift-lightglue.onnx` export run by onnxruntime-web on WebGPU or WASM.
 * The model comes through the site's same-origin mirror route, because
 * GitHub release downloads send no CORS headers; its sha256 is checked
 * against the pinned value before a session is created.
 *
 * @see method-sift-lightglue.ts.md
 */
import { toGray } from "./bench-image";
import {
  fetchBytes,
  lookupIn,
  summarizeResources,
  type DownloadRecord,
  type LoadDeps,
} from "./bench-net";
import type { BenchMethod, Features, MethodRunner } from "./bench-run";
import { pairsFromMatches, pickName } from "./aliked-io";
import {
  loadOrtRuntime,
  ORT_PREFIX,
  type AlikedBackend,
  type OrtApi,
  type OrtSession,
} from "./method-aliked";
import { SIFT_URL, siftApi } from "./method-sift";
import {
  lightGlueSiftFeeds,
  lightGlueSiftFrame,
  type LightGlueSiftFrame,
  type SiftKeypoints,
} from "./sift-lightglue-io";

/**
 * The site worker's mirror of the pinned model (same origin); the mirror
 * reads COLMAP's 3.13.0 release asset (45,806,253 bytes).
 */
export const SIFT_LIGHTGLUE_PATH = "/api/model/sift-lightglue.onnx";
/** The pinned file's sha256, as COLMAP's own download check lists it. */
export const SIFT_LIGHTGLUE_SHA256 =
  "e0500228472b43f92b3d36881a09b3310d3b058b56187b246cc7b9ab6429096e";
/** Keypoints per frame unless the page asks otherwise. */
const SIFT_LIGHTGLUE_MAX_FEATURES = 512;

export interface SiftLightGlueOptions {
  /** The model URL; the mirror route on this page's origin by default. */
  readonly modelUrl?: string;
  /** The expected sha256 (hex); the pinned model's by default. */
  readonly sha256?: string;
  readonly maxFeatures?: number;
}

const DIM = 128;

/** Lower-case hex sha256 of the bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** The mirror route on this page's origin (relative when there is none). */
function defaultModelUrl(): string {
  const base = globalThis.location?.href;
  return base ? new URL(SIFT_LIGHTGLUE_PATH, base).href : SIFT_LIGHTGLUE_PATH;
}

async function matchWith(
  ort: OrtApi,
  session: OrtSession,
  a: Features,
  b: Features,
): Promise<Int32Array> {
  if (a.count === 0 || b.count === 0) {
    return new Int32Array(0);
  }
  const feeds = lightGlueSiftFeeds(
    a.payload as LightGlueSiftFrame,
    b.payload as LightGlueSiftFrame,
  );
  const ins = session.inputNames;
  const out = await session.run(
    Object.fromEntries(
      feeds.map((f, i) => [
        pickName(ins, f.name, i),
        new ort.Tensor("float32", f.data, f.dims),
      ]),
    ),
  );
  const m = out[pickName(session.outputNames, "matches0", 0)];
  if (!m) {
    throw new Error("SIFT LightGlue: no matches0 output");
  }
  return pairsFromMatches(
    m.data as ArrayLike<number | bigint>,
    a.count,
    b.count,
  );
}

/** SIFT keypoints matched by the SIFT LightGlue model, on one backend. */
export function siftLightGlueMethod(
  backend: AlikedBackend,
  deps: LoadDeps,
  options: SiftLightGlueOptions = {},
): BenchMethod {
  const max = options.maxFeatures ?? SIFT_LIGHTGLUE_MAX_FEATURES;
  const expected = (options.sha256 ?? SIFT_LIGHTGLUE_SHA256).toLowerCase();
  return {
    id: `sift-lightglue-${backend}`,
    label: `SIFT + LightGlue (onnxruntime-web) ${backend}`,
    async init(): Promise<MethodRunner> {
      const url = options.modelUrl ?? defaultModelUrl();
      const ort = await loadOrtRuntime(deps);
      const detect = siftApi(await deps.importModule(SIFT_URL));
      const net = { fetch: deps.fetch, now: deps.now, lookup: lookupIn(deps) };
      const model = await fetchBytes(url, "SIFT LightGlue matcher", net);
      const tHash = deps.now();
      const hash = await sha256Hex(model.bytes);
      const hashMs = deps.now() - tHash;
      if (hash !== expected) {
        throw new Error(
          `SIFT LightGlue matcher: sha256 ${hash.slice(0, 12)}... of ${String(model.bytes.byteLength)} bytes is not the pinned model's ${expected.slice(0, 12)}... (wrong file from ${url})`,
        );
      }
      const t0 = deps.now();
      const session = await ort.InferenceSession.create(model.bytes, {
        executionProviders: [backend],
      });
      const initMs = deps.now() - t0;
      const downloads: DownloadRecord[] = [model.record];
      for (const [prefix, label] of [
        [ORT_PREFIX, "onnxruntime-web runtime"],
        [SIFT_URL, "sift.js"],
      ] as const) {
        const r = summarizeResources(deps.resources(), prefix, label);
        if (r) {
          downloads.push(r);
        }
      }
      return {
        backend: `${backend} (execution provider)`,
        downloads,
        initMs,
        notes: [
          `max ${String(max)} SIFT keypoints per frame (sift.js, main thread), RootSIFT descriptors, sigma scales, orientations in (-pi, pi]`,
          `init = session created; model sha256 checked in ${hashMs.toFixed(0)} ms (not in init)`,
        ],
        extract: (frame) => {
          const r = detect(toGray(frame), frame.width, frame.height, max);
          const lg = lightGlueSiftFrame(
            r as unknown as SiftKeypoints,
            max,
            frame.width,
            frame.height,
          );
          const x = new Float32Array(lg.count);
          const y = new Float32Array(lg.count);
          for (let i = 0; i < lg.count; i++) {
            x[i] = lg.keypoints[i * 2]!;
            y[i] = lg.keypoints[i * 2 + 1]!;
          }
          return Promise.resolve({
            count: lg.count,
            descriptorBytes: lg.count * DIM * 4,
            x,
            y,
            payload: lg,
          });
        },
        match: (a, b) => matchWith(ort, session, a, b),
        dispose: () => {
          void session.release();
        },
      };
    },
  };
}
