/**
 * DINOv2-S/14 as a global-descriptor timing arm of the speed test: one
 * forward pass per frame through onnxruntime-web, the CLS token taken as
 * the descriptor, and the cosine of the pair's two descriptors reported as
 * a sanity value. No retrieval: this arm only measures cost on a device.
 *
 * @see method-dino.ts.md
 */
import { formatMs } from "./bench-stats";
import {
  fetchBytes,
  lookupIn,
  summarizeResources,
  type DownloadRecord,
  type LoadDeps,
} from "./bench-net";
import type { Frame } from "./bench-image";
import type { LoadedTimingArm, TimingArm, TimingStep } from "./bench-timing";
import { pickName } from "./aliked-io";
import {
  clsVector,
  cosine,
  DINO_CROP,
  dinoInput,
  floatValues,
} from "./dino-io";
import {
  loadOrtRuntime,
  ORT_PREFIX,
  type AlikedBackend,
} from "./method-aliked";

/**
 * onnx-community/dinov2-small at a pinned revision (an ONNX export of the
 * original DINOv2 weights, which are Apache-2.0; the export's card names
 * no licence of its own).
 */
const DINO_BASE =
  "https://huggingface.co/onnx-community/dinov2-small/resolve/8b1f705a3a7f6f062f6bdd21986c1583d3ef105d/onnx/";

export type DinoVariant = "int8" | "q4f16";

/** The pinned files and their sizes in bytes (checked after the download). */
export const DINO_MODELS: Readonly<
  Record<DinoVariant, { readonly url: string; readonly bytes: number }>
> = {
  int8: { url: `${DINO_BASE}model_int8.onnx`, bytes: 24_446_700 },
  q4f16: { url: `${DINO_BASE}model_q4f16.onnx`, bytes: 13_908_222 },
};

/** The DINOv2 arm for one variant on one backend. */
export function dinoTimingArm(
  variant: DinoVariant,
  backend: AlikedBackend,
  deps: LoadDeps,
  input: { readonly a: Frame; readonly b: Frame },
  options: { readonly bytes?: number } = {},
): TimingArm {
  const model = DINO_MODELS[variant];
  const expectedBytes = options.bytes ?? model.bytes;
  return {
    id: `dinov2-${variant}-${backend}`,
    label: `DINOv2-S/14 ${variant} (onnxruntime-web) ${backend}`,
    group: backend,
    reference: false,
    async load(): Promise<LoadedTimingArm> {
      const ort = await loadOrtRuntime(deps);
      const net = { fetch: deps.fetch, now: deps.now, lookup: lookupIn(deps) };
      const file = await fetchBytes(model.url, `DINOv2 ${variant}`, net);
      if (file.bytes.byteLength !== expectedBytes) {
        throw new Error(
          `DINOv2 ${variant}: ${String(file.bytes.byteLength)} bytes, not the pinned ${String(expectedBytes)} (wrong file from ${model.url})`,
        );
      }
      const t0 = deps.now();
      const session = await ort.InferenceSession.create(file.bytes, {
        executionProviders: [backend],
      });
      const startupMs = deps.now() - t0;
      const inName = pickName(session.inputNames, "pixel_values", 0);
      const outName = pickName(session.outputNames, "last_hidden_state", 0);
      const dims = [1, 3, DINO_CROP, DINO_CROP];
      const forward = async (x: Float32Array): Promise<Float32Array> => {
        const out = await session.run({
          [inName]: new ort.Tensor("float32", x, dims),
        });
        const o = out[outName];
        if (!o) {
          throw new Error(`DINOv2: no ${outName} output`);
        }
        return clsVector(floatValues(o.data), o.dims);
      };
      const downloads: DownloadRecord[] = [file.record];
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
        startupMs,
        notes: [
          `input ${String(DINO_CROP)}x${String(DINO_CROP)} (shortest edge 256, centre crop), descriptor = CLS token of last_hidden_state`,
          "a run = preprocess both frames + one forward pass per frame",
        ],
        async step(): Promise<TimingStep> {
          const t1 = deps.now();
          const xa = dinoInput(input.a);
          const xb = dinoInput(input.b);
          const t2 = deps.now();
          const da = await forward(xa);
          const t3 = deps.now();
          const db = await forward(xb);
          const t4 = deps.now();
          const c = cosine(da, db);
          return {
            phases: [
              { name: "preprocess", ms: t2 - t1 },
              { name: "forward A", ms: t3 - t2 },
              { name: "forward B", ms: t4 - t3 },
            ],
            note: `cosine A-B ${Number.isFinite(c) ? c.toFixed(4) : "-"}, forward ${formatMs(t3 - t2)} ms`,
          };
        },
        dispose: () => {
          session.release().catch(() => undefined);
        },
      };
    },
  };
}
