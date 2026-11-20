/**
 * XFeat (Apache-2.0 LiteRT export) run by LiteRT.js on WebGPU or WASM,
 * fp16 or fp32 weights, decoded host-side and matched by mutual nearest
 * neighbour on cosine similarity.
 *
 * @see method-xfeat.ts.md
 */
import { toGray } from "./bench-image";
import { mutualNearestFloat } from "./bench-mnn";
import {
  fetchBytes,
  lookupIn,
  summarizeResources,
  type DownloadRecord,
  type LoadDeps,
} from "./bench-net";
import type { BenchMethod, Features, MethodRunner } from "./bench-run";
import {
  decodeXFeat,
  denseMap,
  halfToFloat,
  xfeatInput,
  xfeatInputSize,
  type DenseMap,
} from "./xfeat-decode";

/** LiteRT.js at a pinned version; jsDelivr rewrites its one bare import. */
export const LITERT_URL =
  "https://cdn.jsdelivr.net/npm/@litertjs/core@2.6.0/+esm";
/** The folder of LiteRT.js's own Wasm files, same version. */
const LITERT_WASM_DIR =
  "https://cdn.jsdelivr.net/npm/@litertjs/core@2.6.0/wasm/";
/** Everything LiteRT.js loads lives under this prefix. */
const LITERT_PREFIX = "https://cdn.jsdelivr.net/npm/@litertjs/";

const MODEL_BASE =
  "https://huggingface.co/litert-community/xfeat-litert/resolve/f5001dcae042fa6f79e1407b6d6d1ade01a76c27/";

export type XFeatBackend = "webgpu" | "wasm";
export type XFeatPrecision = "fp16" | "fp32";

/** The pinned model file of a precision. */
export function xfeatModelUrl(precision: XFeatPrecision): string {
  return `${MODEL_BASE}${precision === "fp16" ? "xfeat_fp16.tflite" : "xfeat.tflite"}`;
}

const XFEAT_TOP_K = 1024;
const XFEAT_THRESHOLD = 0.05;
/** Cosine similarity a mutual nearest pair needs to count as a match. */
const XFEAT_MIN_SIMILARITY = 0.82;

/** The parts of LiteRT.js this page uses. */
export interface LrtTensor {
  readonly shape: ArrayLike<number>;
  readonly dtype: string;
  toTypedArray(): ArrayLike<number>;
  moveTo(destination: string): Promise<LrtTensor>;
  delete(): void;
}
interface LrtDetails {
  readonly name: string;
  readonly dtype: string;
  readonly shape: ArrayLike<number>;
}
interface LrtModel {
  getInputDetails(): readonly LrtDetails[];
  run(input: LrtTensor[]): Promise<LrtTensor[]>;
  delete(): void;
}
export interface LrtApi {
  loadLiteRt(path: string, options?: { threads?: boolean }): Promise<unknown>;
  loadAndCompile(
    model: Uint8Array,
    options: { accelerator: XFeatBackend },
  ): Promise<LrtModel>;
  Tensor: new (data: Float32Array, shape?: number[]) => LrtTensor;
}

/** The module's API, or an error naming the missing export. */
export function liteRtApi(mod: unknown): LrtApi {
  const m = (typeof mod === "object" && mod !== null ? mod : {}) as Record<
    string,
    unknown
  >;
  for (const k of ["loadLiteRt", "loadAndCompile", "Tensor"]) {
    if (typeof m[k] !== "function") {
      throw new Error(`LiteRT.js: no ${k} export`);
    }
  }
  return m as unknown as LrtApi;
}

/** Output data as float32; float16 arrives as raw 16-bit words. */
export function toFloat32(
  data: ArrayLike<number>,
  dtype: string,
): Float32Array {
  if (data instanceof Float32Array) {
    return data;
  }
  if (dtype === "float16" && data instanceof Uint16Array) {
    return Float32Array.from(data, halfToFloat);
  }
  return Float32Array.from(data);
}

function tryMap(
  o: { data: Float32Array; shape: ArrayLike<number> },
  channels: number,
): DenseMap | null {
  try {
    return denseMap(o.data, o.shape, channels);
  } catch {
    return null;
  }
}

/**
 * The three output maps told apart by channel count (64 descriptor, 65
 * keypoint logits, 1 reliability): exporters do not keep their order.
 */
export function xfeatMaps(
  outputs: readonly { data: Float32Array; shape: ArrayLike<number> }[],
): { feats: DenseMap; logits: DenseMap; reliability: DenseMap } {
  const find = (c: number): DenseMap => {
    for (const o of outputs) {
      const m = tryMap(o, c);
      if (m) {
        return m;
      }
    }
    const shapes = outputs.map((o) => `[${Array.from(o.shape).join(", ")}]`);
    throw new Error(
      `XFeat: no output with ${String(c)} channels (${shapes.join(" ")})`,
    );
  };
  return { feats: find(64), logits: find(65), reliability: find(1) };
}

/**
 * The runtime is loaded once per page (it installs itself globally and a
 * second load fails), so the promise is a resource cache keyed by the
 * loader: a test with its own fake loader gets its own runtime.
 */
const runtimes = new WeakMap<
  LoadDeps["importModule"],
  Promise<{ api: LrtApi; ms: number }>
>();

function loadRuntime(deps: LoadDeps): Promise<{ api: LrtApi; ms: number }> {
  let p = runtimes.get(deps.importModule);
  if (!p) {
    p = (async () => {
      const t0 = deps.now();
      const api = liteRtApi(await deps.importModule(LITERT_URL));
      // Threads need cross-origin isolation; without it the plain build.
      await api.loadLiteRt(LITERT_WASM_DIR, {
        threads: globalThis.crossOriginIsolated === true,
      });
      return { api, ms: deps.now() - t0 };
    })();
    // A failed load must not stick: the next run tries again.
    p.catch(() => runtimes.delete(deps.importModule));
    runtimes.set(deps.importModule, p);
  }
  return p;
}

async function runOnce(
  api: LrtApi,
  model: LrtModel,
  backend: XFeatBackend,
  input: Float32Array,
  shape: number[],
): Promise<{ data: Float32Array; shape: ArrayLike<number> }[]> {
  const owned: LrtTensor[] = [];
  try {
    let t = new api.Tensor(input, shape);
    owned.push(t);
    if (backend === "webgpu") {
      t = await t.moveTo("webgpu");
      owned.push(t);
    }
    const outs = await model.run([t]);
    owned.push(...outs);
    const result: { data: Float32Array; shape: ArrayLike<number> }[] = [];
    for (const o of outs) {
      const host = backend === "webgpu" ? await o.moveTo("wasm") : o;
      if (host !== o) {
        owned.push(host);
      }
      result.push({
        data: toFloat32(host.toTypedArray(), host.dtype),
        shape: Array.from(host.shape),
      });
    }
    return result;
  } finally {
    for (const t of owned) {
      try {
        t.delete();
      } catch {
        // A moved tensor may already be released.
      }
    }
  }
}

/** One XFeat variant: a backend and a weight precision. */
export function xfeatMethod(
  backend: XFeatBackend,
  precision: XFeatPrecision,
  deps: LoadDeps,
): BenchMethod {
  return {
    id: `xfeat-${backend}-${precision}`,
    label: `XFeat (LiteRT.js) ${backend} ${precision}`,
    async init(): Promise<MethodRunner> {
      const runtime = await loadRuntime(deps);
      const url = xfeatModelUrl(precision);
      const { bytes, record } = await fetchBytes(url, url.split("/").pop()!, {
        fetch: deps.fetch,
        now: deps.now,
        lookup: lookupIn(deps),
      });
      const t0 = deps.now();
      const model = await runtime.api.loadAndCompile(bytes, {
        accelerator: backend,
      });
      const compileMs = deps.now() - t0;
      const inDetails = model.getInputDetails()[0];
      if (!inDetails) {
        model.delete();
        throw new Error("XFeat: model has no input");
      }
      const shape = Array.from(inDetails.shape);
      const size = xfeatInputSize(shape);
      const lib = summarizeResources(
        deps.resources(),
        LITERT_PREFIX,
        "LiteRT.js runtime",
      );
      const downloads: DownloadRecord[] = [record];
      if (lib) {
        downloads.push(lib);
      }
      return {
        backend: `${backend} (requested accelerator)`,
        downloads,
        initMs: compileMs,
        notes: [
          `fixed model input ${String(size.width)}x${String(size.height)}: a smaller frame is padded, a larger or portrait one is shrunk to fit, so model time hardly changes with size`,
          `runtime load ${String(Math.round(runtime.ms))} ms (once per page); init = model compile`,
          `top ${String(XFEAT_TOP_K)} keypoints; float32 64-d descriptors, cosine mutual nearest neighbour >= ${String(XFEAT_MIN_SIMILARITY)}`,
        ],
        async extract(frame): Promise<Features> {
          const inp = xfeatInput(
            toGray(frame),
            frame.width,
            frame.height,
            size.width,
            size.height,
          );
          const outs = await runOnce(
            runtime.api,
            model,
            backend,
            inp.data,
            shape,
          );
          const maps = xfeatMaps(outs);
          const p = decodeXFeat(maps.feats, maps.logits, maps.reliability, {
            topK: XFEAT_TOP_K,
            threshold: XFEAT_THRESHOLD,
            validWidth: inp.validWidth,
            validHeight: inp.validHeight,
          });
          return {
            count: p.count,
            descriptorBytes: p.count * p.dim * 4,
            x: p.x.map((v) => (v + 0.5) / inp.scale - 0.5),
            y: p.y.map((v) => (v + 0.5) / inp.scale - 0.5),
            payload: p.desc,
          };
        },
        match: (a, b) =>
          Promise.resolve(
            mutualNearestFloat(
              a.payload as Float32Array,
              a.count,
              b.payload as Float32Array,
              b.count,
              64,
              XFEAT_MIN_SIMILARITY,
            ),
          ),
        dispose: () => model.delete(),
      };
    },
  };
}
