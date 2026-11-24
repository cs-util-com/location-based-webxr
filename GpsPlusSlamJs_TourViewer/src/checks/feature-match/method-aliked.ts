/**
 * ALIKED keypoints (512 per frame) and the LightGlue matcher, as two
 * ONNX models run by onnxruntime-web on WebGPU or WASM.
 *
 * @see method-aliked.ts.md
 */
import { resizeFrame, sizeForLongEdge, toFramePoint } from "./bench-image";
import {
  fetchBytes,
  lookupIn,
  summarizeResources,
  type DownloadRecord,
  type LoadDeps,
} from "./bench-net";
import type { BenchMethod, Features, MethodRunner } from "./bench-run";
import {
  chwInput,
  floatData,
  pairsFromMatches,
  pickName,
  stackPair,
} from "./aliked-io";

/** onnxruntime-web at a pinned version, the build with the WebGPU provider. */
export const ORT_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/ort.webgpu.min.mjs";
/** Its Wasm files, same version. */
export const ORT_WASM_DIR =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
export const ORT_PREFIX = "https://cdn.jsdelivr.net/npm/onnxruntime-web@";

export const ALIKED_EXTRACTOR_URL =
  "https://huggingface.co/kornia/raco-aliked/resolve/8f251612206a539335b62671c970bd80911495e3/raco_aliked_extractor_k512.onnx";
export const LIGHTGLUE_URL =
  "https://huggingface.co/kornia/lightglue/resolve/68c04837a6fe52a082beb1fecded7438a99c8496/lightglue_matcher_k512.onnx";

export type AlikedBackend = "webgpu" | "wasm";

/** The parts of onnxruntime-web this page uses. */
export interface OrtTensor {
  readonly data: unknown;
  readonly dims: readonly number[];
}
export interface OrtSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
  release(): Promise<void>;
}
export interface OrtApi {
  env: { wasm: { wasmPaths?: unknown; numThreads?: number } };
  InferenceSession: {
    create(
      model: Uint8Array,
      options: { executionProviders: string[] },
    ): Promise<OrtSession>;
  };
  Tensor: new (
    type: "float32",
    data: Float32Array,
    dims: readonly number[],
  ) => OrtTensor;
}

/** The module's API, or an error naming what is missing. */
export function ortApi(mod: unknown): OrtApi {
  const m = (typeof mod === "object" && mod !== null ? mod : {}) as Record<
    string,
    unknown
  >;
  const session = m.InferenceSession as { create?: unknown } | undefined;
  const env = m.env as { wasm?: unknown } | undefined;
  if (typeof session?.create !== "function") {
    throw new Error("onnxruntime-web: no InferenceSession.create");
  }
  if (typeof m.Tensor !== "function") {
    throw new Error("onnxruntime-web: no Tensor export");
  }
  if (typeof env?.wasm !== "object" || env.wasm === null) {
    throw new Error("onnxruntime-web: no env.wasm");
  }
  return m as unknown as OrtApi;
}

/** Loaded once per page: the runtime and its global settings are shared. */
const runtimes = new WeakMap<LoadDeps["importModule"], Promise<OrtApi>>();

/**
 * The onnxruntime-web WASM thread count: threads need cross-origin
 * isolation, so without it one thread; with it up to four.
 */
export function ortWasmThreads(
  isolated: boolean,
  cores: number | undefined,
): number {
  return isolated ? Math.max(1, Math.min(4, Math.floor(cores ?? 1))) : 1;
}

/** The runtime, imported and configured once per page (per `importModule`). */
export function loadOrtRuntime(deps: LoadDeps): Promise<OrtApi> {
  let p = runtimes.get(deps.importModule);
  if (!p) {
    p = deps.importModule(ORT_URL).then((mod) => {
      const ort = ortApi(mod);
      ort.env.wasm.wasmPaths = ORT_WASM_DIR;
      ort.env.wasm.numThreads = ortWasmThreads(
        globalThis.crossOriginIsolated === true,
        globalThis.navigator?.hardwareConcurrency,
      );
      return ort;
    });
    p.catch(() => runtimes.delete(deps.importModule));
    runtimes.set(deps.importModule, p);
  }
  return p;
}

/** What `extract` keeps for the matcher. */
interface AlikedPayload {
  readonly normalized: Float32Array;
  readonly descriptors: Float32Array;
  readonly dims: {
    keypoints: readonly number[];
    descriptors: readonly number[];
  };
}

async function extractWith(
  ort: OrtApi,
  extractor: OrtSession,
  frame: Parameters<MethodRunner["extract"]>[0],
): Promise<Features> {
  const size = sizeForLongEdge(
    frame.width,
    frame.height,
    Math.max(frame.width, frame.height),
    32,
  );
  const sized = resizeFrame(frame, size.width, size.height);
  const input = new ort.Tensor("float32", chwInput(sized), [
    1,
    3,
    size.height,
    size.width,
  ]);
  const out = await extractor.run({
    [pickName(extractor.inputNames, "images", 0)]: input,
  });
  const names = extractor.outputNames;
  const kp = out[pickName(names, "keypoints", 0)]!;
  const nk = out[pickName(names, "normalized_keypoints", 1)]!;
  const desc = out[pickName(names, "descriptors", 2)]!;
  const kpData = floatData(kp.data, "ALIKED keypoints");
  const count = kp.dims[1] ?? 0;
  const descDim = desc.dims[2] ?? 0;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = toFramePoint(kpData[i * 2]!, size.width, frame.width);
    y[i] = toFramePoint(kpData[i * 2 + 1]!, size.height, frame.height);
  }
  const payload: AlikedPayload = {
    normalized: floatData(nk.data, "ALIKED normalized keypoints"),
    descriptors: floatData(desc.data, "ALIKED descriptors"),
    dims: { keypoints: nk.dims, descriptors: desc.dims },
  };
  return { count, descriptorBytes: count * descDim * 4, x, y, payload };
}

async function matchWith(
  ort: OrtApi,
  matcher: OrtSession,
  a: Features,
  b: Features,
): Promise<Int32Array> {
  const pa = a.payload as AlikedPayload;
  const pb = b.payload as AlikedPayload;
  const k = pa.dims.keypoints[1] ?? 0;
  const d = pa.dims.descriptors[2] ?? 0;
  const ins = matcher.inputNames;
  const out = await matcher.run({
    [pickName(ins, "normalized_keypoints", 0)]: new ort.Tensor(
      "float32",
      stackPair(pa.normalized, pb.normalized),
      [2, 1, k, 2],
    ),
    [pickName(ins, "descriptors", 1)]: new ort.Tensor(
      "float32",
      stackPair(pa.descriptors, pb.descriptors),
      [2, 1, k, d],
    ),
  });
  const m = out[pickName(matcher.outputNames, "matches0", 0)]!;
  return pairsFromMatches(
    m.data as ArrayLike<number | bigint>,
    a.count,
    b.count,
  );
}

/** ALIKED + LightGlue on one backend. */
export function alikedMethod(
  backend: AlikedBackend,
  deps: LoadDeps,
): BenchMethod {
  return {
    id: `aliked-lightglue-${backend}`,
    backend,
    label: `ALIKED + LightGlue (onnxruntime-web) ${backend}`,
    async init(): Promise<MethodRunner> {
      const ort = await loadOrtRuntime(deps);
      const net = { fetch: deps.fetch, now: deps.now, lookup: lookupIn(deps) };
      const ex = await fetchBytes(
        ALIKED_EXTRACTOR_URL,
        "ALIKED extractor",
        net,
      );
      const lg = await fetchBytes(LIGHTGLUE_URL, "LightGlue matcher", net);
      const t0 = deps.now();
      const opts = { executionProviders: [backend] };
      const extractor = await ort.InferenceSession.create(ex.bytes, opts);
      let matcher: OrtSession;
      try {
        matcher = await ort.InferenceSession.create(lg.bytes, opts);
      } catch (e) {
        await extractor.release();
        throw e;
      }
      const initMs = deps.now() - t0;
      const downloads: DownloadRecord[] = [ex.record, lg.record];
      const lib = summarizeResources(
        deps.resources(),
        ORT_PREFIX,
        "onnxruntime-web runtime",
      );
      if (lib) {
        downloads.push(lib);
      }
      return {
        backend: `${backend} (execution provider)`,
        downloads,
        initMs,
        notes: [
          "512 keypoints per frame (fixed by the export); frame resized to multiples of 32",
          "matches = LightGlue's own output; init = both sessions created",
        ],
        extract: (frame) => extractWith(ort, extractor, frame),
        match: (a, b) => matchWith(ort, matcher, a, b),
        dispose: () => {
          extractor.release().catch(() => undefined);
          matcher.release().catch(() => undefined);
        },
      };
    },
  };
}
