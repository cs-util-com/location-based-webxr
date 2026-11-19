import { tourManifestEntryOf } from "gps-plus-slam-app-framework/ar/tour-archive";
import { qrLevelIdFromEntryName } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  MAX_IDENTITY_BYTES,
  readDebugBundle,
  type DebugBundleFound,
} from "../debug-bundle.js";
import { describeOpenError } from "../open-errors.js";
import { isRecordedFrameName, recordingEntryNames } from "../tour-read-set.js";
import { withZipBlobDirectory, type ZipBlobDirectory } from "../zip-blob.js";
import { NOT_A_TOUR, NOT_A_ZIP } from "./editor-open.js";

/** What a file given to the editor is, read from its zip directory. */
export type EditorFileKind =
  /** A tour: it carries a `tour.json` or printed codes. Its title and
   *  station count when its `tour.json` read cheaply (`readTourSummary`),
   *  else null. */
  | {
      readonly kind: "tour";
      readonly file: File;
      readonly title: string | null;
      readonly stations: number | null;
    }
  /** A scan: a debug bundle (with whose tour it was saved from) or a plain
   *  Recorder recording. Shown while editing, never part of the tour. */
  | {
      readonly kind: "scan";
      readonly file: File;
      readonly scan: DebugBundleFound;
      /** Its camera captures: the frame images its directory names. */
      readonly captures: number;
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
      if (isTour)
        return { kind: "tour", file, ...(await readTourSummary(dir)) };
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
      return {
        kind: "scan",
        file,
        scan: read,
        captures: names.filter(isRecordedFrameName).length,
      };
    });
  } catch (err) {
    return { kind: "neither", file, reason: describeOpenError(err) };
  }
}

/** The largest `tour.json` read for a tour's title and station count: a
 *  tour's manifest is a few kB; past this the row names it only as a tour. */
export const TOUR_SUMMARY_MAX_BYTES = 256 * 1024;

/** A title shown longer than this is cut, with an ellipsis. */
const TITLE_MAX_CHARS = 80;

const NO_SUMMARY = { title: null, stations: null } as const;

/**
 * A tour's title and station count from its `tour.json`, read under
 * {@link TOUR_SUMMARY_MAX_BYTES} (declared and inflated). Null fields for
 * printed codes only, an oversized, unreadable or odd manifest: the row
 * then says "Tour". Never throws. Not a validation: the open reads the
 * manifest properly and may still refuse it.
 */
async function readTourSummary(
  dir: ZipBlobDirectory,
): Promise<{ title: string | null; stations: number | null }> {
  const entry = tourManifestEntryOf(dir.names);
  if (entry === null) return NO_SUMMARY;
  const size = dir.sizeOf(entry);
  if (size === undefined || size > TOUR_SUMMARY_MAX_BYTES) return NO_SUMMARY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await (await dir.read(entry, TOUR_SUMMARY_MAX_BYTES)).text(),
    );
  } catch {
    return NO_SUMMARY;
  }
  if (typeof parsed !== "object" || parsed === null) return NO_SUMMARY;
  const { title, stations } = parsed as Record<string, unknown>;
  const trimmed = typeof title === "string" ? title.trim() : "";
  return {
    title:
      trimmed === ""
        ? null
        : trimmed.length > TITLE_MAX_CHARS
          ? `${trimmed.slice(0, TITLE_MAX_CHARS - 1)}…`
          : trimmed,
    stations: Array.isArray(stations) ? stations.length : null,
  };
}

/** Every file of a list, sorted in the list's order. Never rejects. */
export function classifyEditorFiles(
  files: readonly File[],
): Promise<EditorFileKind[]> {
  return Promise.all(files.map((file) => classifyEditorFile(file)));
}
