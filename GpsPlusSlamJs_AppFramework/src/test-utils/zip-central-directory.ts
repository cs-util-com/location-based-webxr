/**
 * A hand-rolled ZIP central-directory reader for TESTS, deliberately
 * independent of `@zip.js/zip.js`: when the library's own reader checks the
 * library's own writer, a shared misunderstanding of the format cancels
 * out. Store mode (method 0) is what the range-streaming readers depend on,
 * and this is the only reader in the package that verifies it from the
 * bytes. Kept from community PR #321's `pack-files-as-zip.test.ts`.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
/** Signature through extra-field length; the names follow it. */
const LOCAL_HEADER_FIXED_SIZE = 30;
const METHOD_STORED = 0;

export interface StoredCentralEntry {
  readonly name: string;
  /** True when BOTH the central and the local header say method 0. */
  readonly stored: boolean;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(
    bytes.buffer as ArrayBuffer,
    bytes.byteOffset,
    bytes.byteLength
  );
}

/**
 * Whether a local file header really starts at `localOffset`.
 *
 * THE RANGE IS CHECKED FIRST, and that is the whole point of the helper
 * rather than an inlined signature comparison. A ZIP64 archive parks
 * `0xFFFFFFFF` in the central relative-offset field and carries the real
 * offset in an extra field, so reading a signature at that offset throws
 * `RangeError: Offset is outside the bounds of the DataView` before any
 * comparison can run - which is exactly the bare bounds error both callers
 * claim to replace with a sentence about supported layouts. Their guards
 * could not fire for the case their own comments named (PR #468 review).
 *
 * `+ LOCAL_HEADER_FIXED_SIZE` rather than `+ 4`: a caller that gets `true`
 * goes on to read the fixed local header without re-checking.
 */
function hasLocalHeaderAt(view: DataView, localOffset: number): boolean {
  if (localOffset + LOCAL_HEADER_FIXED_SIZE > view.byteLength) return false;
  return view.getUint32(localOffset, true) === LOCAL_HEADER_SIGNATURE;
}

function findEocd(view: DataView): number {
  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new Error('not a ZIP: no end-of-central-directory record');
}

/** Parse the central directory and cross-check each local header's method. */
export function readStoredCentralDirectory(
  bytes: Uint8Array
): StoredCentralEntry[] {
  const view = viewOf(bytes);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries: StoredCentralEntry[] = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`corrupt central directory at ${at}`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (!hasLocalHeaderAt(view, localOffset)) {
      throw new Error(
        `no local header at ${localOffset} - ZIP64 or an unsupported layout`
      );
    }
    entries.push({
      name: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength)
      ),
      stored:
        view.getUint16(at + 10, true) === METHOD_STORED &&
        view.getUint16(localOffset + 8, true) === METHOD_STORED,
      compressedSize: view.getUint32(at + 20, true),
      uncompressedSize: view.getUint32(at + 24, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * The stored bytes of one entry, by name, or `undefined` when the archive
 * has no such entry.
 *
 * STORE MODE ONLY, and it throws rather than guessing if the entry is
 * deflated - the callers of this file are testing writers that pin method
 * 0 on purpose, and silently returning compressed bytes as if they were
 * content is the kind of wrong answer a test would then assert against.
 *
 * Added so a test can assert what an archive CARRIES rather than what was
 * handed to the writer (PR #465 review): a finish that de-duplicates its
 * in-memory manifest while serializing a different list would pass the
 * weaker assertion and ship duplicates.
 */
export function readStoredEntryBytes(
  bytes: Uint8Array,
  name: string
): Uint8Array | undefined {
  const view = viewOf(bytes);
  const eocd = findEocd(view);
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let i = 0; i < total; i++) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`corrupt central directory at ${at}`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const entryName = new TextDecoder().decode(
      bytes.subarray(at + 46, at + 46 + nameLength)
    );
    if (entryName === name) {
      // The sibling validates this signature before trusting anything at
      // localOffset, and this path did not (PR #466 review).
      if (!hasLocalHeaderAt(view, localOffset)) {
        throw new Error(
          `no local header at ${String(localOffset)} for ${name} - ZIP64 or an unsupported layout`
        );
      }
      if (view.getUint16(localOffset + 8, true) !== METHOD_STORED) {
        throw new Error(`entry is not stored: ${name}`);
      }
      // The LOCAL header's own name and extra lengths, which need not match
      // the central ones - the extra field routinely differs between them.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      return bytes.subarray(start, start + view.getUint32(at + 20, true));
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}
