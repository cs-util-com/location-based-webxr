/**
 * Why this test matters: both readers here guard the local-header offset
 * they take from the central directory, and the guard's own comment names
 * ZIP64 as the case it explains. It could not explain that case. ZIP64
 * parks `0xFFFFFFFF` in the central relative-offset field and puts the real
 * offset in an extra field, so `DataView.getUint32(0xFFFFFFFF)` throws
 * `RangeError: Offset is outside the bounds of the DataView` BEFORE any
 * signature comparison runs - the caller got the bare bounds error the
 * comment claimed had been replaced (PR #468 review).
 *
 * These tests pin the reachability of the message, not its wording beyond
 * the part a reader acts on. They are the reason the bounds check in front
 * of each comparison cannot be dropped as redundant: it looks redundant
 * precisely because the signature check appears to cover it.
 */

import { describe, expect, it } from 'vitest';
import { packFilesAsZip } from '../storage/pack-files-as-zip';
import {
  readStoredCentralDirectory,
  readStoredEntryBytes,
} from './zip-central-directory';

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_OFFSET_SENTINEL = 0xffffffff;

/** A real store-mode archive, so only the offset under test is synthetic. */
async function archiveBytes(): Promise<Uint8Array> {
  const blob = await packFilesAsZip([{ path: 'tour.json', data: '{"v":1}' }]);
  return new Uint8Array(await blob.arrayBuffer());
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(
    bytes.buffer as ArrayBuffer,
    bytes.byteOffset,
    bytes.byteLength
  );
}

/**
 * Rewrite the first central record's relative-offset field to the ZIP64
 * sentinel - exactly what a real ZIP64 writer puts there.
 */
function withZip64OffsetSentinel(bytes: Uint8Array): Uint8Array {
  const patched = bytes.slice();
  const view = viewOf(patched);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const centralStart = view.getUint32(eocd + 16, true);
  view.setUint32(centralStart + 42, ZIP64_OFFSET_SENTINEL, true);
  return patched;
}

describe('a central record pointing outside the archive', () => {
  it('readStoredEntryBytes names the layout instead of throwing a bounds error', async () => {
    const patched = withZip64OffsetSentinel(await archiveBytes());
    let thrown: unknown;
    try {
      readStoredEntryBytes(patched, 'tour.json');
    } catch (error) {
      thrown = error;
    }
    // The distinction IS the test: a RangeError here means the guard was
    // stepped over rather than consulted.
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect(String(thrown)).toContain('ZIP64');
  });

  it('readStoredCentralDirectory does the same', async () => {
    const patched = withZip64OffsetSentinel(await archiveBytes());
    let thrown: unknown;
    try {
      readStoredCentralDirectory(patched);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect(String(thrown)).toContain('ZIP64');
  });

  // Why this one matters: the bounds check must not swallow the ordinary
  // case the guard was written for. An in-range offset that simply is not
  // a local header still has to report itself.
  it('still reports an in-range offset that is not a local header', async () => {
    const bytes = (await archiveBytes()).slice();
    const view = viewOf(bytes);
    let eocd = -1;
    for (let i = view.byteLength - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    const centralStart = view.getUint32(eocd + 16, true);
    // Point at the central record itself: in range, wrong signature.
    view.setUint32(centralStart + 42, centralStart, true);
    expect(() => readStoredCentralDirectory(bytes)).toThrow(/no local header/);
  });
});
