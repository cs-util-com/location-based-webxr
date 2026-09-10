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
    if (view.getUint32(localOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      throw new Error(`no local header at ${localOffset}`);
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
