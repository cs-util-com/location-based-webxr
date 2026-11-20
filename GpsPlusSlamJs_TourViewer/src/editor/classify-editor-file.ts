import { ArchiveLimitError } from "gps-plus-slam-app-framework/storage";
import { tourManifestEntryOf } from "gps-plus-slam-app-framework/ar/tour-archive";
import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  MAX_IDENTITY_BYTES,
  readDebugBundle,
  type DebugBundleFound,
} from "../debug-bundle.js";
import { describeOpenError } from "../open-errors.js";
import { recordingEntryNames } from "../tour-read-set.js";
import { withZipBlobDirectory } from "../zip-blob.js";
import { NOT_A_TOUR, NOT_A_ZIP } from "./editor-open.js";

/** What a file given to the editor is, read from its zip directory. */
export type EditorFileKind =
  /** A tour: it carries a `tour.json` or printed codes. */
  | { readonly kind: "tour"; readonly file: File }
  /** A scan: a debug bundle (with whose tour it was saved from) or a plain
   *  Recorder recording. Shown while editing, never part of the tour. */
  | {
      readonly kind: "scan";
      readonly file: File;
      readonly scan: DebugBundleFound;
    }
  /** Neither, and why in words. */
  | { readonly kind: "neither"; readonly file: File; readonly reason: string };

/**
 * Sorts a file into tour, scan or neither, before anything is opened. Only
 * the zip's central directory is read, plus a scan's small identity entry
 * (`readDebugBundle` caps it), so a large recording sorts in the time its
 * directory takes. A tour that also carries a walk is a tour: the walk is
 * the tour's own. Never rejects: the file is untrusted.
 */
export async function classifyEditorFile(file: File): Promise<EditorFileKind> {
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return { kind: "neither", file, reason: NOT_A_ZIP };
  }
  try {
    return await withZipBlobDirectory(file, async (dir) => {
      const names = dir.names;
      const isTour =
        tourManifestEntryOf(names) !== null ||
        names.some((name) => qrLevelIdFromEntryName(name) !== null);
      if (isTour) return { kind: "tour", file };
      if (recordingEntryNames(names).length === 0) {
        return { kind: "neither", file, reason: NOT_A_TOUR };
      }
      // The identity entry inflated under its own small cap: a directory
      // can understate it, and the archive's budget alone would let it
      // inflate to tens of MiB before its size is looked at.
      const read = await readDebugBundle(
        names,
        (name) => dir.read(name, MAX_IDENTITY_BYTES),
        { sizeOf: (name) => dir.sizeOf(name) },
      );
      if (read.kind === "refused") {
        return { kind: "neither", file, reason: read.reason };
      }
      return { kind: "scan", file, scan: read };
    });
  } catch (err) {
    // A cap words itself; anything else is a damaged zip, said as the
    // open says a file that is no zip (it refuses it in its own words).
    return {
      kind: "neither",
      file,
      reason:
        err instanceof ArchiveLimitError ? describeOpenError(err) : NOT_A_ZIP,
    };
  }
}

/** Every file of a list, sorted in the list's order. Never rejects. */
export function classifyEditorFiles(
  files: readonly File[],
): Promise<EditorFileKind[]> {
  return Promise.all(files.map((file) => classifyEditorFile(file)));
}
