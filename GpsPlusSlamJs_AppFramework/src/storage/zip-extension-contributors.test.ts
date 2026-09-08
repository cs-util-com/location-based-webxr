/**
 * Tests for the ZIP extension-contributor seam (Iter 2 of the AppFramework /
 * RecorderApp boundary cleanup).
 *
 * Why these tests matter: framework-owned zip code (`zip-export.ts` /
 * `zip-reader.ts`) must let consumers append + read app-specific subdirs
 * (recorder will plug `refPoints/` through this seam in Iter 3) without
 * forking the framework.
 *
 * @see GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BlobReader, ZipReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { installOPFSMocks } from '../test-utils/browser-mocks';
import {
  initOpfsStorage,
  resetOpfsStorage,
  setSessionHandles,
  getAppRootHandle,
  writeAction,
  writeSessionMetadata,
  type SessionMetadata,
} from './opfs-storage';
import { formatTimestamp } from './file-system-utils';
import { exportSessionAsZip, type ZipExportContributor } from './zip-export';
import { loadEntriesFromSubdir } from './zip-reader';

async function unzipAsMap(blob: Blob): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new BlobReader(blob));
  const out = new Map<string, Uint8Array>();
  for (const entry of await reader.getEntries()) {
    if (!entry.directory && entry.getData) {
      out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
  }
  await reader.close();
  return out;
}

async function makeFlatSession(
  name = 'recording-' + formatTimestamp(new Date())
): Promise<string> {
  await initOpfsStorage();
  const root = getAppRootHandle()!;
  const sessions = await root.getDirectoryHandle('sessions', { create: true });
  const session = await sessions.getDirectoryHandle(name, { create: true });
  const actions = await session.getDirectoryHandle('actions', { create: true });
  const frames = await session.getDirectoryHandle('frames', { create: true });
  setSessionHandles(session, actions, frames);

  const metadata: SessionMetadata = {
    version: 1,
    startedAt: '2026-05-04T10:00:00.000Z',
    endedAt: '2026-05-04T10:01:00.000Z',
    contextTag: 'iter2-test',
    actionCount: 1,
    frameCount: 0,
    userAgent: 'test',
  };
  await writeSessionMetadata(metadata);
  await writeAction({ type: 'noop' }, 1);
  return name;
}

describe('zip-export — ZipExportContributor seam', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  it('ignores an empty contributors list and produces the framework-only zip', async () => {
    // Why: backwards compatibility — no consumer must change to keep working.
    const sessionName = await makeFlatSession();
    const { blob, fileCount } = await exportSessionAsZip(sessionName, {
      contributors: [],
    });
    const files = await unzipAsMap(blob);
    expect(files.has('session.json')).toBe(true);
    expect(files.has('actions/000001.json')).toBe(true);
    // session.json + actions/000001.json
    expect(fileCount).toBe(2);
  });

  it('appends contributor files under their declared subdir', async () => {
    // Why: this is the production path the recorder will use in Iter 3 to own
    // its `refPoints/` section without modifying the framework.
    const sessionName = await makeFlatSession();
    const contributor: ZipExportContributor = {
      subdir: 'extras',
      async contribute(addFile) {
        await addFile(
          'one.json',
          new Blob(['{"id":1}'], { type: 'application/json' })
        );
        await addFile(
          'nested/two.json',
          new Blob(['{"id":2}'], { type: 'application/json' })
        );
        return 2;
      },
    };

    const { blob, fileCount } = await exportSessionAsZip(sessionName, {
      contributors: [contributor],
    });
    const files = await unzipAsMap(blob);

    expect(files.has('extras/one.json')).toBe(true);
    expect(files.has('extras/nested/two.json')).toBe(true);
    // session.json + 1 action + 2 contributor files
    expect(fileCount).toBe(4);
    expect(new TextDecoder().decode(files.get('extras/one.json'))).toBe(
      '{"id":1}'
    );
  });

  it('rejects a contributor whose subdir contains a slash', async () => {
    // Why: the subdir is a single path segment so contributors cannot escape
    // their namespace and overwrite framework-owned sections like `actions/`.
    const sessionName = await makeFlatSession();
    const contributor: ZipExportContributor = {
      subdir: 'bad/segment',
      contribute() {
        return Promise.resolve(0);
      },
    };
    await expect(
      exportSessionAsZip(sessionName, {
        contributors: [contributor],
      })
    ).rejects.toThrow(/single path segment/);
  });

  it('rejects two contributors fighting over the same subdir', async () => {
    // Why: detect misconfiguration loudly; otherwise the second contributor's
    // files would silently land alongside the first's with no way to tell.
    const sessionName = await makeFlatSession();
    const make = (): ZipExportContributor => ({
      subdir: 'extras',
      contribute() {
        return Promise.resolve(0);
      },
    });
    await expect(
      exportSessionAsZip(sessionName, {
        contributors: [make(), make()],
      })
    ).rejects.toThrow(/Duplicate ZipExportContributor.subdir/);
  });

  it('rejects a contributor that tries to write an absolute path', async () => {
    // Why: prevents accidental rooting outside the contributor subdir.
    const sessionName = await makeFlatSession();
    const contributor: ZipExportContributor = {
      subdir: 'extras',
      async contribute(addFile) {
        await addFile('/escape.json', new Blob(['{}']));
        return 1;
      },
    };
    await expect(
      exportSessionAsZip(sessionName, {
        contributors: [contributor],
      })
    ).rejects.toThrow(/is unsafe.*absolute/);
  });

  it('rejects a contributor that tries to escape its subdir via traversal segments', async () => {
    // Why: without this check a contributor could write
    // `../actions/000001.json` and overwrite framework-owned files inside
    // the ZIP. The framework prepends the subdir but does not normalize the
    // resulting path, so `..` segments must be rejected at the seam.
    const sessionName = await makeFlatSession();
    const makeContributor = (badPath: string): ZipExportContributor => ({
      subdir: 'extras',
      async contribute(addFile) {
        await addFile(badPath, new Blob(['{}']));
        return 1;
      },
    });

    for (const badPath of [
      '../escape.json',
      'a/../../escape.json',
      './escape.json',
      'sub\\escape.json',
    ]) {
      await expect(
        exportSessionAsZip(sessionName, {
          contributors: [makeContributor(badPath)],
        })
      ).rejects.toThrow(/is unsafe.*(backslash|segment)/);
    }
  });
});

describe('zip-reader — loadEntriesFromSubdir', () => {
  let cleanup: () => void;

  beforeEach(() => {
    const mocks = installOPFSMocks();
    cleanup = mocks.cleanup;
  });

  afterEach(() => {
    cleanup();
    resetOpfsStorage();
  });

  it('round-trips contributor-written files (writer + reader symmetry)', async () => {
    // Why: this is the core behavioral contract of the Iter 2 seam — what the
    // writer puts into a subdir, the reader hands back without the consumer
    // having to know zip.js details.
    const sessionName = await makeFlatSession();
    const contributor: ZipExportContributor = {
      subdir: 'refPointsLike',
      async contribute(addFile) {
        await addFile('a.json', new Blob(['"a"']));
        await addFile('b.json', new Blob(['"b"']));
        return 2;
      },
    };
    const { blob } = await exportSessionAsZip(sessionName, {
      contributors: [contributor],
    });
    const data = new Uint8Array(await blob.arrayBuffer());

    const entries = await loadEntriesFromSubdir(data, 'refPointsLike');

    expect(entries.map((e) => e.relativePath)).toEqual(['a.json', 'b.json']);
    expect(entries[0]!.fullPath).toBe('refPointsLike/a.json');
    expect(await entries[0]!.getText()).toBe('"a"');
    expect(await entries[1]!.getText()).toBe('"b"');
  });

  it('returns [] when the requested subdir is absent', async () => {
    // Why: graceful degradation for older zips (and for sessions where a
    // contributor produced no output).
    const sessionName = await makeFlatSession();
    const { blob } = await exportSessionAsZip(sessionName);
    const data = new Uint8Array(await blob.arrayBuffer());

    const entries = await loadEntriesFromSubdir(data, 'missing');
    expect(entries).toEqual([]);
  });

  it('rejects an invalid subdir argument', async () => {
    // Why: symmetry with the writer's subdir validation prevents accidental
    // path-traversal-shaped mistakes from silently returning empty.
    const sessionName = await makeFlatSession();
    const { blob } = await exportSessionAsZip(sessionName);
    const data = new Uint8Array(await blob.arrayBuffer());

    await expect(loadEntriesFromSubdir(data, 'a/b')).rejects.toThrow(
      /single path segment/
    );
    await expect(loadEntriesFromSubdir(data, '')).rejects.toThrow(
      /single path segment/
    );
  });
});
