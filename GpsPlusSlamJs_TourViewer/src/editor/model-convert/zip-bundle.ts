/**
 * A zip of a model's folder, read into the files a conversion needs: the
 * model (a `.gltf`, or a `.glb` taken as it is) and the entries its text
 * names (its data, its pictures), found as the converter finds them. In a
 * zip of several models each model reads only its own parts. Everything
 * else is listed, not read. The zip is untrusted: its directory is read under the archive
 * caps every zip read here uses, the entries it would read are counted and
 * sized against this reader's own caps before any is inflated, and a zip
 * inside it is never opened.
 *
 * @see zip-bundle.ts.md
 */
import { ArchiveLimitError } from "gps-plus-slam-app-framework/storage";
import { isMacOsMetadataName } from "gps-plus-slam-app-framework/storage/zip-reader";

import { withZipBlobDirectory } from "../../zip-blob.js";
import { ASSET_CEILING_BYTES } from "../tour-files.js";
import { resolveReference } from "./bundle-paths.js";
import { importRoleOf } from "./import-formats.js";
import { note, refusal } from "./model-import-words.js";

export interface ZipBundleOptions extends Partial<ZipBundleLimits> {
  /** The model to make, by its path in the zip (`listZipModels`, which
   *  the page queues one import each). Without it, the first by path. */
  readonly model?: string;
}

interface ZipBundleLimits {
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
  readonly files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** Entries not read and used by no model: an entry of a kind no model
   *  uses (on the zip's first model only), and in a zip of one model the
   *  parts its text does not name. */
  readonly skipped: readonly string[];
}

export type ZipBundle =
  | ({ readonly ok: true; readonly kind: "gltf" } & ZipBundleContents)
  | {
      readonly ok: true;
      readonly kind: "glb";
      readonly model: string;
      readonly glb: Uint8Array<ArrayBuffer>;
      readonly skipped: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

class Refused extends Error {}

const SYSTEM_FILES = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;

const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const isModel = (path: string) =>
  importRoleOf(path) === "primary" || /\.glb$/i.test(path);

/** The entries a model may use, the macOS and system files left out;
 *  refuses a zip that names an entry twice, and a tour's zip. */
function entriesOf(names: readonly string[], zipName: string): string[] {
  const kept = names.filter(
    (n) => !isMacOsMetadataName(n) && !SYSTEM_FILES.test(n),
  );
  const twice = kept.find((n, i) => kept.indexOf(n) !== i);
  if (twice !== undefined) {
    throw new Refused(refusal.zipNamedTwice(zipName, twice));
  }
  if (kept.some((n) => baseOf(n).toLowerCase() === "tour.json")) {
    throw new Refused(refusal.zipIsTour(zipName));
  }
  return kept;
}

/** The refusal for a zip past an archive cap, in size words. */
const archiveLimitReason = (error: ArchiveLimitError, zipName: string) =>
  error.kind === "entry-count"
    ? refusal.zipTooManyEntries(zipName, error.limit)
    : refusal.zipTooLarge(zipName, error.limit);

/**
 * The models in `zip` by path, in the order `readZipBundle` takes them:
 * one import each. None for a zip the reader refuses whole (a tour's, one
 * naming an entry twice, one it cannot read). Never rejects.
 */
export async function listZipModels(zip: Blob): Promise<string[]> {
  try {
    return await withZipBlobDirectory(zip, (dir) =>
      Promise.resolve(entriesOf(dir.names, "").filter(isModel).sort()),
    );
  } catch {
    return [];
  }
}

/** A part a `.gltf` may name: its data, a material file, a picture. */
const isPart = (path: string) => {
  const role = importRoleOf(path);
  return role === "companion" || role === "picture";
};

/** The parts `model`'s `text` names (its buffers' and pictures' uris)
 *  among `parts`, as the converter resolves them; none for a text that is
 *  no JSON (the converter then refuses it in words). */
function partsNamedBy(
  model: string,
  text: Uint8Array,
  parts: readonly string[],
): string[] {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(text));
  } catch {
    return [];
  }
  const urisOf = (key: string): unknown[] => {
    const list = (json as Partial<Record<string, unknown>> | null)?.[key];
    return Array.isArray(list)
      ? list.map((e) => (e as { uri?: unknown } | null)?.uri)
      : [];
  };
  const named = new Set<string>();
  for (const uri of [...urisOf("buffers"), ...urisOf("images")]) {
    if (typeof uri !== "string") continue;
    const ref = resolveReference(uri, model, parts);
    if (ref.kind === "file") named.add(ref.path);
  }
  return [...named];
}

/**
 * The model in `zip` (called `zipName` in the words), with what it needs;
 * or the reason there is none, in words. Rejects only when `signal` is
 * aborted.
 */
export async function readZipBundle(
  zip: Blob,
  zipName: string,
  options: ZipBundleOptions = {},
  signal?: AbortSignal,
): Promise<ZipBundle> {
  const { model: asked, ...limits } = options;
  const caps = { ...DEFAULT_LIMITS, ...limits };
  signal?.throwIfAborted();
  try {
    return await withZipBlobDirectory(zip, async (dir) => {
      const names = entriesOf(dir.names, zipName);
      const models = names.filter(isModel).sort();
      const model =
        asked === undefined ? models[0] : models.find((m) => m === asked);
      if (model === undefined) throw new Refused(refusal.zipNoModel(zipName));
      const glb = /\.glb$/i.test(model);
      const files = new Map<string, Uint8Array<ArrayBuffer>>();
      let taken = 0;
      const read = async (name: string): Promise<void> => {
        signal?.throwIfAborted();
        // The directory may understate a size: the read itself is capped
        // at what the bundle has left (a cap is at least one byte; the sum
        // below holds the bundle's cap even then).
        const budget = Math.max(1, caps.maxBytes - taken);
        let blob: Blob;
        try {
          blob = await dir.read(name, budget);
        } catch (error) {
          if (
            error instanceof ArchiveLimitError &&
            error.kind === "entry-bytes" &&
            error.limit === budget
          ) {
            const seen = taken + (error.observed ?? budget + 1);
            throw new Refused(refusal.tooLarge(zipName, seen, caps.maxBytes));
          }
          throw error;
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        taken += data.length;
        if (taken > caps.maxBytes) {
          throw new Refused(refusal.tooLarge(zipName, taken, caps.maxBytes));
        }
        files.set(name, data);
      };
      const refuseIfDeclaredPast = (list: readonly string[]) => {
        const declared = list.reduce((sum, n) => sum + (dir.sizeOf(n) ?? 0), 0);
        if (declared > caps.maxBytes) {
          throw new Refused(refusal.tooLarge(zipName, declared, caps.maxBytes));
        }
      };
      // The model's text first: it says which parts the model needs.
      refuseIfDeclaredPast([model]);
      if (!glb) await read(model);
      const parts = names.filter(isPart);
      const wanted = glb
        ? [model]
        : [model, ...partsNamedBy(model, files.get(model)!, parts)];
      // An entry of a kind no model uses is named once, on the zip's first
      // model; a part this model does not name may be another model's, so
      // it is named only when the zip holds no other model.
      const first = model === models[0];
      const skipped = names.filter(
        (n) =>
          !wanted.includes(n) &&
          !models.includes(n) &&
          (isPart(n) ? models.length === 1 : first),
      );
      if (wanted.length > caps.maxFiles) {
        throw new Refused(
          refusal.zipTooManyFiles(zipName, wanted.length, caps.maxFiles),
        );
      }
      refuseIfDeclaredPast(wanted);
      for (const name of wanted) {
        if (!files.has(name)) await read(name);
      }
      signal?.throwIfAborted();
      return glb
        ? {
            ok: true,
            kind: "glb",
            model,
            glb: files.get(model)!,
            skipped,
          }
        : { ok: true, kind: "gltf", model, files, skipped };
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Refused) return { ok: false, reason: error.message };
    if (error instanceof ArchiveLimitError) {
      return { ok: false, reason: archiveLimitReason(error, zipName) };
    }
    return { ok: false, reason: refusal.zipUnreadable(zipName) };
  }
}

/** The notes a model made from `bundle` carries: the entries it did not
 *  use (`used`: the files the model carries, its
 *  own text aside). */
export function zipBundleNotes(
  bundle: Pick<ZipBundleContents, "model" | "files" | "skipped">,
  used: readonly string[],
): string[] {
  const notes: string[] = [];
  const unused = [
    ...[...bundle.files.keys()].filter(
      (n) => n !== bundle.model && !used.includes(n),
    ),
    ...bundle.skipped,
  ];
  if (unused.length > 0) notes.push(note.unusedFiles(unused));
  return notes;
}
