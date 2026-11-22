/**
 * A zip of a model's folder, read into the files a conversion needs: the
 * model (a `.gltf`, or a `.glb` taken as it is) and every entry a `.gltf`
 * may name (its data, its parts, its pictures). Everything else is listed,
 * not read. The zip is untrusted: its directory is read under the archive
 * caps every zip read here uses, the entries it would read are counted and
 * sized against this reader's own caps before any is inflated, and a zip
 * inside it is never opened.
 *
 * @see zip-bundle.ts.md
 */
import { isMacOsMetadataName } from "gps-plus-slam-app-framework/storage/zip-reader";

import { withZipBlobDirectory } from "../../zip-blob.js";
import { ASSET_CEILING_BYTES } from "../tour-files.js";
import { importRoleOf } from "./import-formats.js";
import { note, refusal } from "./model-import-words.js";

export interface ZipBundleLimits {
  /** Entries a model may bring along (model files, parts, pictures). */
  readonly maxFiles: number;
  /** Their bytes together, as the directory declares and as inflated. */
  readonly maxBytes: number;
}

const DEFAULT_LIMITS: ZipBundleLimits = Object.freeze({
  maxFiles: 1000,
  maxBytes: ASSET_CEILING_BYTES,
});

/** What a bundle names besides its model, for the notes. */
export interface ZipBundleContents {
  /** The model's path in the zip. */
  readonly model: string;
  /** Every entry read, by its path (the model's own text included). */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The other models in the zip, not made. */
  readonly others: readonly string[];
  /** Entries not read: no model uses their kind. */
  readonly skipped: readonly string[];
}

export type ZipBundle =
  | ({ readonly ok: true; readonly kind: "gltf" } & ZipBundleContents)
  | {
      readonly ok: true;
      readonly kind: "glb";
      readonly model: string;
      readonly glb: Uint8Array;
      readonly others: readonly string[];
      readonly skipped: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

class Refused extends Error {}

const SYSTEM_FILES = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const isModel = (path: string) =>
  importRoleOf(path) === "primary" || /\.glb$/i.test(path);

/** A part a `.gltf` may name: its data, a material file, a picture. */
const isPart = (path: string) => {
  const role = importRoleOf(path);
  return role === "companion" || role === "picture";
};

/**
 * The model in `zip` (called `zipName` in the words), with what it needs;
 * or the reason there is none, in words. Rejects only when `signal` is
 * aborted.
 */
export async function readZipBundle(
  zip: Blob,
  zipName: string,
  limits: Partial<ZipBundleLimits> = {},
  signal?: AbortSignal,
): Promise<ZipBundle> {
  const caps = { ...DEFAULT_LIMITS, ...limits };
  signal?.throwIfAborted();
  try {
    return await withZipBlobDirectory(zip, async (dir) => {
      const names = [...new Set(dir.names)].filter(
        (n) => !isMacOsMetadataName(n) && !SYSTEM_FILES.test(n),
      );
      if (names.some((n) => baseOf(n).toLowerCase() === "tour.json")) {
        throw new Refused(refusal.zipIsTour(zipName));
      }
      const models = names.filter(isModel).sort();
      const model = models[0];
      if (model === undefined) throw new Refused(refusal.zipNoModel(zipName));
      const others = models.slice(1);
      const glb = /\.glb$/i.test(model);
      const wanted = glb
        ? [model]
        : names.filter((n) => n === model || isPart(n));
      const skipped = names.filter(
        (n) => !wanted.includes(n) && !others.includes(n),
      );
      if (wanted.length > caps.maxFiles) {
        throw new Refused(
          refusal.zipTooManyFiles(zipName, wanted.length, caps.maxFiles),
        );
      }
      const declared = wanted.reduce((sum, n) => sum + (dir.sizeOf(n) ?? 0), 0);
      if (declared > caps.maxBytes) {
        throw new Refused(refusal.tooLarge(zipName, declared, caps.maxBytes));
      }
      const files = new Map<string, Uint8Array>();
      let taken = 0;
      for (const name of wanted) {
        signal?.throwIfAborted();
        // The directory may understate a size: the read itself is capped
        // at what the bundle has left.
        const blob = await dir.read(name, Math.max(1, caps.maxBytes - taken));
        const data = new Uint8Array(await blob.arrayBuffer());
        taken += data.length;
        files.set(name, data);
      }
      signal?.throwIfAborted();
      return glb
        ? {
            ok: true,
            kind: "glb",
            model,
            glb: files.get(model)!,
            others,
            skipped,
          }
        : { ok: true, kind: "gltf", model, files, others, skipped };
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Refused) return { ok: false, reason: error.message };
    return { ok: false, reason: refusal.zipUnreadable(zipName) };
  }
}

/** The notes a model made from `bundle` carries: the models not made, and
 *  the entries it did not use (`used`: the files the model carries, its
 *  own text aside). */
export function zipBundleNotes(
  bundle: Pick<ZipBundleContents, "model" | "files" | "others" | "skipped">,
  used: readonly string[],
): string[] {
  const notes: string[] = [];
  if (bundle.others.length > 0) {
    notes.push(note.otherModels(bundle.model, bundle.others));
  }
  const unused = [
    ...[...bundle.files.keys()].filter(
      (n) => n !== bundle.model && !used.includes(n),
    ),
    ...bundle.skipped,
  ];
  if (unused.length > 0) notes.push(note.unusedFiles(unused));
  return notes;
}
