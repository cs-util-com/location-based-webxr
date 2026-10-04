/**
 * The archive side of a tour's `manifest.json` (tour kit plan K1, §8 D3):
 * reading the list out of an open archive and checking the archive
 * against it. TIER 1 runs at open (`openTourIntegrity`): the manifest is
 * read and every file entry's name and declared size is compared with it,
 * before any content is shown; a mismatch fails the open.
 *
 * The format rules (canonical names, duplicates, what is listed) live in
 * the framework's `tour-signed-manifest.ts`; this module only feeds it the
 * archive. A tour without `manifest.json` is the common case today (every
 * tour made before K1): it opens as before, with nothing to check.
 */

import type { Entry, FileEntry } from "@zip.js/zip.js";
import {
  checkEntriesAgainstManifest,
  parseSignedTourManifest,
  signedManifestEntryOf,
  TourIntegrityError,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";

/** What tier 1 established about an open archive. */
export type TourIntegrity =
  | {
      /** No `manifest.json`: nothing can be checked (every tour before K1). */
      readonly kind: "none";
    }
  | {
      /** A manifest whose list the archive matches; nobody vouches for it. */
      readonly kind: "listed";
      readonly manifest: SignedTourManifest;
      /** The archive name the manifest was read from. */
      readonly manifestEntry: string;
      /** SHA-256 (hex) of the manifest's exact bytes: the identity of
       *  what was checked, compared again when the whole archive arrives. */
      readonly manifestSha256: string;
      /** Each file entry's record, keyed by the entry's own filename. */
      readonly records: ReadonlyMap<string, TourFileRecord>;
    };

/** UTF-8 that is not valid UTF-8 is a malformed manifest, never a lossy
 *  read: the signature covers the bytes, the parser reads the text. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function decodeManifest(bytes: Uint8Array): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    throw new TourIntegrityError(
      "malformed-manifest",
      "manifest.json is not valid UTF-8 text",
    );
  }
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * TIER 1. Reads `manifest.json` (when the archive has one) through
 * `readBytes` - the session's capped reader, so the list is read the way
 * every other entry is - and checks the archive's file entries against it.
 *
 * @param entries the archive's central directory (directories included;
 *   the check ignores them)
 * @param readBytes inflates one entry under the session's caps
 * @throws TourIntegrityError when the manifest is malformed or the archive
 *   does not match it.
 */
export async function openTourIntegrity(
  entries: readonly Entry[],
  readBytes: (entry: FileEntry) => Promise<Uint8Array>,
): Promise<TourIntegrity> {
  const files = entries.filter(isFileEntry);
  const manifestEntry = signedManifestEntryOf(files.map((e) => e.filename));
  if (manifestEntry === null) return { kind: "none" };
  const entry = files.find((e) => e.filename === manifestEntry)!;
  const bytes = await readBytes(entry);
  const manifest = parseSignedTourManifest(decodeManifest(bytes));
  const records = checkEntriesAgainstManifest(entries, manifest, manifestEntry);
  return {
    kind: "listed",
    manifest,
    manifestEntry,
    manifestSha256: await sha256Hex(bytes),
    records,
  };
}
