/**
 * Tests for the Recording Coverage Index
 *
 * Why this matters:
 * The map-centric recording browser is driven by a per-recording H3 coverage
 * index. These tests pin the two coverage sources (D2):
 *   1. metadata `h3Cells` is used verbatim WITHOUT reading the zip's GPS data
 *      (the fast path for new recordings);
 *   2. legacy recordings (no `h3Cells`) fall back to deriving coverage from the
 *      GPS path IN MEMORY — no disk cache.
 * They also pin that an empty `h3Cells` array means "no coverage" (not "legacy")
 * and that a corrupt zip degrades to empty coverage instead of aborting the
 * whole folder index.
 *
 * @see ./recording-index.ts
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1048-map-centric-recording-browser-and-h3-index-user-feedback.md (D2)
 */

import { describe, it, expect, vi } from 'vitest';
import { MockFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import { produceTestZip } from 'gps-plus-slam-app-framework/test-utils/zip-round-trip-helpers';
import { gpsPathToCoverageCells } from 'gps-plus-slam-app-framework/geo';
import {
  loadCoverageCellsForEntry,
  buildRecordingIndex,
  streamRecordingIndex,
  type RecordingCoverage,
  type IndexProgress,
} from './recording-index';
import {
  discoverScenariosFromZipMetadata,
  type SessionEntry,
} from '../storage/recording-discovery';

/** A file handle whose getFile() must never be called (asserts the fast path). */
function throwingFileHandle(filename: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name: filename,
    getFile: vi.fn(() => {
      throw new Error('getFile must not be called when h3Cells is present');
    }),
  } as unknown as FileSystemFileHandle;
}

describe('loadCoverageCellsForEntry', () => {
  it('uses metadata h3Cells verbatim without reading the zip', async () => {
    // Why: the whole point of the index is to avoid unzipping GPS data when the
    // recording already carries its coverage cells.
    const cells = ['8b1fa1da1d64fff', '8b1fa1da1d4afff'];
    const getFile = vi.fn();
    const entry: SessionEntry = {
      filename: 'covered.zip',
      fileHandle: {
        kind: 'file',
        name: 'covered.zip',
        getFile,
      } as unknown as FileSystemFileHandle,
      date: null,
      h3Cells: cells,
    };

    const result = await loadCoverageCellsForEntry(entry);

    expect(result.cells).toEqual(cells);
    expect(result.backfilled).toBe(false);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('treats an empty h3Cells array as "no coverage", not legacy', async () => {
    // Why: a recording with no GPS fixes legitimately has an empty coverage set.
    // It must NOT trigger a backfill read (which an `undefined` check would).
    const entry: SessionEntry = {
      filename: 'empty.zip',
      fileHandle: throwingFileHandle('empty.zip'),
      date: null,
      h3Cells: [],
    };

    const result = await loadCoverageCellsForEntry(entry);

    expect(result.cells).toEqual([]);
    expect(result.backfilled).toBe(false);
  });

  it('backfills coverage from the GPS path for legacy recordings', async () => {
    // Why: recordings without h3Cells must still be placeable. Coverage is
    // derived in memory from the GPS path (no disk cache).
    const zeroPos = { lat: 50.0, lon: 8.0 };
    const gpsEventCount = 10;
    const testZip = await produceTestZip({
      scenarioName: 'Legacy',
      zeroPos,
      gpsEventCount,
    });
    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile('2026-03-01_09-08-48utc.zip', testZip.zipData);
    const discovered = await discoverScenariosFromZipMetadata(root);
    const entry = discovered.scenarioSessions.get('Legacy')![0]!;
    expect(entry.h3Cells).toBeUndefined(); // precondition: legacy

    const result = await loadCoverageCellsForEntry(entry);

    // produceTestZip writes recordGpsEvent coords at zeroPos + (i+1)*0.0001.
    const knownPath = Array.from({ length: gpsEventCount }, (_, i) => ({
      lat: zeroPos.lat + (i + 1) * 0.0001,
      lng: zeroPos.lon + (i + 1) * 0.0001,
    }));
    expect(result.backfilled).toBe(true);
    expect(result.cells.length).toBeGreaterThan(0);
    expect(result.cells).toEqual(gpsPathToCoverageCells(knownPath));
  });

  it('degrades to empty coverage when the zip cannot be read', async () => {
    // Why: one corrupt legacy zip must not abort the whole folder index.
    const entry: SessionEntry = {
      filename: 'corrupt.zip',
      fileHandle: throwingFileHandle('corrupt.zip'),
      date: null,
      // h3Cells undefined → backfill path → getFile throws
    };

    const result = await loadCoverageCellsForEntry(entry);

    expect(result.cells).toEqual([]);
    expect(result.backfilled).toBe(true);
  });
});

describe('buildRecordingIndex', () => {
  it('indexes a folder mixing metadata-carrying and legacy recordings', async () => {
    // Why: a real folder has both new recordings (h3Cells in metadata) and old
    // ones (need backfill). The index must resolve coverage for both, flagging
    // which ones were backfilled.
    const metaCells = ['8b1fa1da1d64fff', '8b1fa1da1d4afff'];
    const coveredZip = await produceTestZip({
      scenarioName: 'Covered',
      h3Cells: metaCells,
    });
    const legacyZip = await produceTestZip({ scenarioName: 'Legacy' });

    const root = new MockFSDirectoryHandle('Recordings');
    root.addFile(
      'Covered-session-2026-03-01_09-00-00utc.zip',
      coveredZip.zipData
    );
    root.addFile(
      'Legacy-session-2026-03-02_09-00-00utc.zip',
      legacyZip.zipData
    );

    const index = await buildRecordingIndex(root);

    expect(index).toHaveLength(2);
    const covered = index.find((r) => r.scenario === 'Covered')!;
    const legacy = index.find((r) => r.scenario === 'Legacy')!;

    expect(covered.cells).toEqual(metaCells);
    expect(covered.backfilled).toBe(false);

    expect(legacy.backfilled).toBe(true);
    expect(legacy.cells.length).toBeGreaterThan(0);
  });

  it('returns an empty index for a folder with no recordings', async () => {
    const root = new MockFSDirectoryHandle('Empty');
    root.addFile('notes.txt', 'nothing here');

    const index = await buildRecordingIndex(root);

    expect(index).toEqual([]);
  });
});

describe('streamRecordingIndex', () => {
  /**
   * Build a folder mixing `count.meta` metadata-carrying recordings and
   * `count.legacy` legacy recordings (no h3Cells). Returns the root handle.
   */
  async function makeMixedFolder(count: {
    meta: number;
    legacy: number;
  }): Promise<MockFSDirectoryHandle> {
    const root = new MockFSDirectoryHandle('Recordings');
    for (let i = 0; i < count.meta; i++) {
      const zip = await produceTestZip({
        scenarioName: 'Covered',
        h3Cells: ['8b1fa1da1d64fff'],
      });
      root.addFile(`Covered-${i}-2026-03-01_09-00-00utc.zip`, zip.zipData);
    }
    for (let i = 0; i < count.legacy; i++) {
      const zip = await produceTestZip({ scenarioName: 'Legacy' });
      root.addFile(`Legacy-${i}-2026-03-02_09-00-00utc.zip`, zip.zipData);
    }
    return root;
  }

  it('emits every recording exactly once and reports the correct total', async () => {
    // Why: progressive streaming must place every recording once — no drops,
    // no duplicates — and onTotal must equal the zip count so the progress UI
    // can show "N / total".
    const root = await makeMixedFolder({ meta: 2, legacy: 2 });
    const emitted: RecordingCoverage[] = [];
    let total = -1;
    await streamRecordingIndex(root, {
      onTotal: (t) => {
        total = t;
      },
      onRecording: (rec) => emitted.push(rec),
    });

    expect(total).toBe(4);
    expect(emitted).toHaveLength(4);
    // Each filename appears exactly once.
    const names = emitted.map((r) => r.entry.filename).sort();
    expect(new Set(names).size).toBe(4);
  });

  it('emits metadata-present recordings before legacy ones', async () => {
    // Why: the metadata fast path needs no I/O, so those recordings must appear
    // first/instantly; legacy backfill (every GPS file) streams in afterwards.
    const root = await makeMixedFolder({ meta: 2, legacy: 2 });
    const order: boolean[] = []; // true = backfilled (legacy)
    await streamRecordingIndex(root, {
      onRecording: (rec) => order.push(rec.backfilled),
    });

    expect(order).toHaveLength(4);
    // All non-backfilled (metadata) emissions precede the first backfilled one.
    const firstLegacy = order.indexOf(true);
    const lastMeta = order.lastIndexOf(false);
    expect(lastMeta).toBeLessThan(firstLegacy);
  });

  it('reports monotonically increasing progress ending at total', async () => {
    // Why: the progress pill must count up smoothly to total and never regress.
    const root = await makeMixedFolder({ meta: 1, legacy: 3 });
    const progress: IndexProgress[] = [];
    await streamRecordingIndex(root, {
      onRecording: () => {},
      onProgress: (p) => progress.push({ ...p }),
    });

    expect(progress.length).toBe(4);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]!.done).toBe(progress[i - 1]!.done + 1);
      expect(progress[i]!.total).toBe(4);
    }
    expect(progress.at(-1)!.done).toBe(4);
  });

  it('does not emit any recording when the signal is already aborted', async () => {
    // Why: opening a new folder while one is still indexing must not paint the
    // old folder's tours. onTotal may still fire (discovery already ran), but no
    // recordings stream in.
    const root = await makeMixedFolder({ meta: 2, legacy: 2 });
    const controller = new AbortController();
    controller.abort();
    const emitted: RecordingCoverage[] = [];
    let total = -1;
    await streamRecordingIndex(root, {
      onTotal: (t) => {
        total = t;
      },
      onRecording: (rec) => emitted.push(rec),
      signal: controller.signal,
    });

    expect(total).toBe(4);
    expect(emitted).toHaveLength(0);
  });

  it('stops emitting once the signal is aborted mid-stream', async () => {
    // Why: closing the browser mid-index must stop adding tours to a torn-down
    // map. Aborting during the (sequential, instant) metadata phase determinist
    // -ically halts before the next emission.
    const root = await makeMixedFolder({ meta: 4, legacy: 0 });
    const controller = new AbortController();
    const emitted: RecordingCoverage[] = [];
    await streamRecordingIndex(root, {
      onRecording: (rec) => {
        emitted.push(rec);
        controller.abort(); // abort after the very first emission
      },
      signal: controller.signal,
    });

    // The metadata loop checks the signal before each emission, so exactly one
    // recording is emitted before the abort takes effect.
    expect(emitted).toHaveLength(1);
  });

  it('buildRecordingIndex collects the full stream', async () => {
    // Why: buildRecordingIndex must stay a faithful await-all wrapper over the
    // stream so non-progressive callers and existing tests keep working.
    const root = await makeMixedFolder({ meta: 2, legacy: 1 });
    const index = await buildRecordingIndex(root);
    expect(index).toHaveLength(3);
  });
});
