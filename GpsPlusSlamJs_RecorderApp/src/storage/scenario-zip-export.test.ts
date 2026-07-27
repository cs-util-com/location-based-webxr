/**
 * Scenario ZIP Export Tests
 *
 * The recorder owns the `scenarios/{name}/{session}/` → ZIP resolution; the
 * framework owns the ZIP schema (via `exportSessionHandleAsZip`). These tests
 * pin the recorder's path resolution + error messages and prove the round-trip
 * packages the framework-owned session tree plus a contributor subdir.
 *
 * Carved out of the framework's `zip-export.ts` scenario branch in Iter 7C of
 * the AppFramework / RecorderApp boundary migration (see
 * gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BlobReader, ZipReader } from '@zip.js/zip.js';
import {
  initStorage,
  ScenarioWrappingStorageBackend,
  resetScenarioStorage,
} from './scenario-storage';
import {
  exportScenarioSessionAsZip,
  syncScenarioSessionToExternalZip,
} from './scenario-zip-export';
import type { MockOPFSDirectoryHandle } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';
import { installOPFSMocks } from 'gps-plus-slam-app-framework/test-utils/browser-mocks';

async function unzip(blob: Blob): Promise<Set<string>> {
  const reader = new ZipReader(new BlobReader(blob));
  const names = new Set<string>();
  for (const entry of await reader.getEntries()) {
    if (!entry.directory) names.add(entry.filename);
  }
  await reader.close();
  return names;
}

/** Create a scenario session with one action + metadata, return its name. */
async function seedScenarioSession(scenarioName: string): Promise<string> {
  const backend = new ScenarioWrappingStorageBackend();
  const { sessionName } = await backend.createSession(
    new Date(Date.UTC(2026, 2, 1, 10, 0, 0)),
    scenarioName
  );
  await backend.writeAction({ type: 'gpsData/setZeroPos' }, 1);
  await backend.writeSessionMetadata({
    version: 1,
    startedAt: '2026-03-01T10:00:00.000Z',
    endedAt: '2026-03-01T10:05:00.000Z',
    contextTag: scenarioName,
    actionCount: 1,
    frameCount: 0,
    userAgent: 'test',
  });
  return sessionName;
}

describe('scenario-zip-export', () => {
  let _opfsRoot: MockOPFSDirectoryHandle;
  let cleanup: () => void;

  beforeEach(async () => {
    resetScenarioStorage();
    const mocks = installOPFSMocks();
    _opfsRoot = mocks.root;
    cleanup = mocks.cleanup;
    await initStorage();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exports a scenario session, including a contributor subdir', async () => {
    const sessionName = await seedScenarioSession('ExportSc');

    const { blob, fileCount } = await exportScenarioSessionAsZip(
      'ExportSc',
      sessionName,
      {
        contributors: [
          {
            subdir: 'refPoints',
            async contribute(addFile) {
              await addFile(
                '8a1.json',
                new Blob(['{}'], { type: 'application/json' })
              );
              return 1;
            },
          },
        ],
      }
    );

    // session.json + 1 action + 1 contributor file
    expect(fileCount).toBe(3);
    const names = await unzip(blob);
    expect(names.has('session.json')).toBe(true);
    expect(names.has('actions/000001.json')).toBe(true);
    expect(names.has('refPoints/8a1.json')).toBe(true);
  });

  it('throws a clear error for a non-existent scenario', async () => {
    await expect(
      exportScenarioSessionAsZip('NopeSc', 'recording-2026-03-01_10-00-00utc')
    ).rejects.toThrow(/scenario.*not found/i);
  });

  it('throws a clear error for a non-existent session in a real scenario', async () => {
    await seedScenarioSession('RealSc');
    await expect(
      exportScenarioSessionAsZip('RealSc', 'recording-does-not-exist')
    ).rejects.toThrow(/session.*not found/i);
  });

  it('syncScenarioSessionToExternalZip writes the blob to the file handle', async () => {
    const sessionName = await seedScenarioSession('SyncSc');

    const chunks: Blob[] = [];
    const fakeFileHandle = {
      createWritable: () =>
        Promise.resolve({
          write: (b: Blob) => {
            chunks.push(b);
            return Promise.resolve();
          },
          close: () => Promise.resolve(),
        }),
    } as unknown as FileSystemFileHandle;

    const result = await syncScenarioSessionToExternalZip(
      fakeFileHandle,
      'SyncSc',
      sessionName
    );

    // `result.blob` is built deep inside @zip.js/zip.js's `BlobWriter` (the
    // framework owns the ZIP schema). Assert "is a Blob" via the cross-realm-safe
    // `toStringTag` check rather than `toBeInstanceOf(Blob)`: depending on how the
    // framework module is resolved, the `Blob` constructor that produced the value
    // can differ from the jsdom test realm's global `Blob`, so `instanceof` fails
    // on a genuine Blob (the CI failure). `Object.prototype.toString` reads
    // `Symbol.toStringTag`, which is 'Blob' for both Node-native and jsdom Blobs.
    expect(Object.prototype.toString.call(result.blob)).toBe('[object Blob]');
    expect(result.blob.type).toBe('application/zip');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(chunks).toHaveLength(1);
    // Reference identity: the exact blob returned is the one written to the
    // handle (realm-independent — the assertion that actually pins the behavior).
    expect(chunks[0]).toBe(result.blob);
  });
  /**
   * Why this test matters: until 2026-07-27 this call site was a bare
   * createWritable/write/close with NO abort guard — the one drifted copy of a
   * pattern its three siblings got right. That matters more here than
   * anywhere: the crash-safety sync overwrites the SAME external file
   * repeatedly while recording, and createWritable() commits its temp on
   * close(). A failed write followed by close() would therefore replace the
   * last good backup with a partial ZIP, and skipping both would leak the
   * handle lock so every later sync fails. This pins abort-not-close.
   */
  it('aborts the writable (never closes it) when the external write fails', async () => {
    const sessionName = await seedScenarioSession('AbortSc');

    const abort = vi.fn(() => Promise.resolve());
    const close = vi.fn(() => Promise.resolve());
    const writeFailure = new Error('disk full');
    const fakeFileHandle = {
      createWritable: () =>
        Promise.resolve({
          write: () => Promise.reject(writeFailure),
          close,
          abort,
        }),
    } as unknown as FileSystemFileHandle;

    await expect(
      syncScenarioSessionToExternalZip(fakeFileHandle, 'AbortSc', sessionName)
    ).rejects.toBe(writeFailure);

    // close() would commit the partial ZIP over the previous good export.
    expect(abort).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });
});
