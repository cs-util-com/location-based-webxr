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
 * Two files with the same entries are the same tour, whatever they are
 * called; a finished tour (a changed `tour.json`) is a new one, exactly as
 * a re-uploaded zip is new content behind the same link.
 */

/** The fields of a zip entry the key reads (zip.js `Entry` has them). */
export interface TourFileKeyEntry {
  readonly filename: string;
  readonly directory?: boolean;
  readonly uncompressedSize: number;
  readonly crc32?: number;
}

/** Every file-opened tour's key starts with this; a link never does. */
export const TOUR_FILE_KEY_PREFIX = "local-file:";

/** True for a key made by {@link tourFileKey}. */
export function isTourFileKey(key: string): boolean {
  return typeof key === "string" && key.startsWith(TOUR_FILE_KEY_PREFIX);
}

/**
 * `local-file:<32 hex digits>` - the first 128 bits of the SHA-256 of the
 * sorted entry list. Directory entries are left out (re-zipping a folder
 * may or may not add them). Rejects when WebCrypto is unavailable (an
 * insecure origin), which the caller reports like any failed open.
 */
export async function tourFileKey(
  entries: readonly TourFileKeyEntry[],
): Promise<string> {
  const lines = entries
    .filter((e) => e.directory !== true)
    .map(
      (e) =>
        `${e.filename}\u0000${String(e.uncompressedSize)}\u0000${String(e.crc32 ?? "")}`,
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
