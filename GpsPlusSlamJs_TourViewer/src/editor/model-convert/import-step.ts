/**
 * The model converter's Worker step: the files of one import (a `.gltf`
 * with the loose files dropped with it, or a zip) made into one `.glb`
 * for the tour. A model it cannot make is answered as `kept` with the
 * refusal in words (nothing is added, and the same files would be refused
 * again); a hand-over that is no import, and anything that throws, fails
 * the run. Runs in `model-import.worker.ts`; pure enough to test in node.
 *
 * @see import-step.ts.md
 */
import {
  stoppedError,
  type WorkerStepAnswer,
  type WorkerStepControl,
} from "../asset-shelf/optimizer-protocol.js";
import { ASSET_CEILING_BYTES } from "../tour-files.js";
import { repackGltf } from "./gltf-repack.js";
import { refusal } from "./model-import-words.js";
import { readZipBundle, zipBundleNotes } from "./zip-bundle.js";

/** What the page hands the converter for one import. */
export type ImportPayload =
  | {
      readonly format: "gltf";
      /** The `.gltf`'s path among `files`. */
      readonly name: string;
      /** The model's text and every loose file it may name, by path. */
      readonly files: readonly { readonly path: string; readonly blob: Blob }[];
    }
  | {
      readonly format: "zip";
      readonly name: string;
      readonly zip: Blob;
      /** The model to make, by its path in the zip (`listZipModels`);
       *  without it the first by path. */
      readonly model?: string;
    };

export interface ImportStepLimits {
  /** The loose files together, before any is read. */
  readonly maxBytes: number;
}

const DEFAULT_LIMITS: ImportStepLimits = Object.freeze({
  maxBytes: ASSET_CEILING_BYTES,
});

const NO_IMPORT = "the converter was handed no files it can read";

function importPayloadOf(payload: unknown): ImportPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Partial<Record<string, unknown>>;
  if (typeof p.name !== "string") return null;
  if (p.format === "zip") {
    const fit =
      p.zip instanceof Blob &&
      (p.model === undefined || typeof p.model === "string");
    return fit ? (p as ImportPayload) : null;
  }
  if (p.format !== "gltf" || !Array.isArray(p.files)) return null;
  const files = p.files as unknown[];
  const fit = files.every((f) => {
    if (typeof f !== "object" || f === null) return false;
    const e = f as Partial<Record<string, unknown>>;
    return typeof e.path === "string" && e.blob instanceof Blob;
  });
  return fit ? (p as ImportPayload) : null;
}

const glbBlob = (bytes: Uint8Array<ArrayBuffer>): Blob =>
  new Blob([bytes], { type: "model/gltf-binary" });

/** The step: `payload` as one tour model, or the refusal in words. */
export async function convertImport(
  payload: unknown,
  _settings: unknown,
  control: WorkerStepControl,
  limits: Partial<ImportStepLimits> = {},
): Promise<WorkerStepAnswer> {
  const input = importPayloadOf(payload);
  if (input === null) throw new Error(NO_IMPORT);
  const caps = { ...DEFAULT_LIMITS, ...limits };
  if (control.signal.aborted) throw stoppedError();
  control.progress(0);
  if (input.format === "zip") return convertZip(input, control);

  const total = input.files.reduce((sum, f) => sum + f.blob.size, 0);
  if (total > caps.maxBytes) {
    return {
      type: "kept",
      reason: refusal.tooLarge(input.name, total, caps.maxBytes),
    };
  }
  // A dropped folder arrives flat, by file name: two files of one name
  // (textures/diffuse.png, normals/diffuse.png) cannot be told apart, so
  // neither is taken first-wins.
  const paths = input.files.map((f) => f.path);
  const twice = paths.find((p, i) => paths.indexOf(p) !== i);
  if (twice !== undefined) {
    return { type: "kept", reason: refusal.namedTwice(input.name, twice) };
  }
  const files = new Map<string, Uint8Array>();
  let read = 0;
  for (const { path, blob } of input.files) {
    files.set(path, new Uint8Array(await blob.arrayBuffer()));
    if (control.signal.aborted) throw stoppedError();
    read += blob.size;
    control.progress(total > 0 ? (0.8 * read) / total : 0.8);
  }
  const result = repackGltf(input.name, files);
  if (!result.ok) return { type: "kept", reason: result.reason };
  control.progress(1);
  // Every loose model of a drop is handed all its parts, so a part this
  // model did not use may be another's: the runner names the parts no
  // model of the drop used, from `used`.
  return {
    type: "done",
    blob: glbBlob(result.glb),
    extension: "glb",
    conversion: { notes: [...result.notes], used: [...result.used] },
  };
}

async function convertZip(
  input: Extract<ImportPayload, { format: "zip" }>,
  control: WorkerStepControl,
): Promise<WorkerStepAnswer> {
  const bundle = await readZipBundle(
    input.zip,
    input.name,
    input.model === undefined ? {} : { model: input.model },
    control.signal,
  );
  if (!bundle.ok) return { type: "kept", reason: bundle.reason };
  control.progress(0.8);
  if (bundle.kind === "glb") {
    const notes = zipBundleNotes(
      { ...bundle, files: new Map([[bundle.model, bundle.glb]]) },
      [],
    );
    control.progress(1);
    return {
      type: "done",
      blob: glbBlob(bundle.glb),
      extension: "glb",
      conversion: { notes, used: [] },
    };
  }
  const result = repackGltf(bundle.model, bundle.files);
  if (!result.ok) return { type: "kept", reason: result.reason };
  control.progress(1);
  return {
    type: "done",
    blob: glbBlob(result.glb),
    extension: "glb",
    conversion: {
      notes: [...result.notes, ...zipBundleNotes(bundle, [...result.used])],
      used: [...result.used],
    },
  };
}
