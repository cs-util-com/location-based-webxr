/**
 * The key a tour opened from a FILE is known by - what a link is for a
 * hosted tour: the draft store's namespace, the open tour's
 * `archive.url`, the comparison key of a scanned code (tour kit plan K0).
 *
 * A file has no URL, and its name, size and modification time are poor
 * stand-ins: the same tour downloaded twice gets a new modification time
 * (and on a phone often a new name, "tour (1).zip"), which would orphan
 * the creator's draft. So the key is a fingerprint of the CONTENT, taken
 * from what the zip's central directory already says about every entry -
 * its name, unpacked size and CRC-32 - sorted and hashed with SHA-256.
 * The compressed size is left out on purpose: the same files re-zipped at
 * another compression level are the same tour.
 * Reading it costs nothing extra (the directory is read to open the tour
 * anyway) and hashing it costs a few milliseconds even for thousands of
 * entries; hashing the whole file would mean holding a 200 MB recording
 * in memory on a phone.
 *
 * STABLE ACROSS A FINISH (K0 milestone review R7): the key leaves out the
 * files the tour kit itself writes - `tour.json`, the `qr/<id>.json` level
 * files and the `content/` media - so the recording a tour is built on
 * names it, and a Finish (or the next one) keeps the creator's draft
 * attached. Names are taken relative to a folder every entry shares, so a
 * re-zip that adds or drops a wrapping folder keeps the key too. A
 * hand-built tour has nothing but those files; its key falls back to every
 * entry, and a Finish then changes it. No tour carries an identity of its
 * own yet; K1's `seriesId` (the signed `manifest.json`) replaces this.
 */

/** The fields of a zip entry the key reads (zip.js `Entry` has them). */
export interface TourFileKeyEntry {
  readonly filename: string;
  readonly directory?: boolean;
  readonly uncompressedSize: number;
  readonly crc32?: number;
}

/** Every file-opened tour's key starts with this; a link never does. */
const TOUR_FILE_KEY_PREFIX = "local-file:";

/** What a creator's Finish writes or removes, relative to the archive's
 *  wrapping folder: the manifest, the level files, the placed media. */
const AUTHORED_ENTRY = /^(?:tour\.json|qr\/[^/]+\.json|content\/[^/]+)$/;

/** True for a key made by {@link tourFileKey}. */
export function isTourFileKey(key: string): boolean {
  return typeof key === "string" && key.startsWith(TOUR_FILE_KEY_PREFIX);
}

/** The folder every name sits in (`"mytour/"`), or `""` when they do not
 *  all share one - the shape a "compress this folder" re-zip produces. */
function sharedFolder(names: readonly string[]): string {
  const first = names[0];
  const slash = first?.indexOf("/") ?? -1;
  if (first === undefined || slash <= 0) return "";
  const folder = first.slice(0, slash + 1);
  return names.every((n) => n.startsWith(folder) && n.length > folder.length)
    ? folder
    : "";
}

/**
 * `local-file:<32 hex digits>` - the first 128 bits of the SHA-256 of the
 * sorted entry list: one line per file, `name NUL size NUL CRC-32`, names
 * relative to a shared wrapping folder, the tour kit's own files left out
 * whenever anything else remains. Directory entries are left out (re-zipping
 * a folder may or may not add them), and a name listed twice counts once,
 * as its last occurrence (what readers and the rebuild resolve). Rejects
 * when WebCrypto is unavailable (an insecure origin), which the caller
 * reports like any failed open.
 */
export async function tourFileKey(
  entries: readonly TourFileKeyEntry[],
): Promise<string> {
  const files = entries.filter((e) => e.directory !== true);
  const folder = sharedFolder(files.map((e) => e.filename));
  const byName = new Map(
    files.map((e) => [e.filename.slice(folder.length), e] as const),
  );
  const all = [...byName];
  const base = all.filter(([name]) => !AUTHORED_ENTRY.test(name));
  const lines = (base.length > 0 ? base : all)
    .map(
      ([name, e]) =>
        `${name}\u0000${String(e.uncompressedSize)}\u0000${String(e.crc32 ?? "")}`,
    )
    .sort();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines.join("\n")),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${TOUR_FILE_KEY_PREFIX}${hex.slice(0, 32)}`;
}
