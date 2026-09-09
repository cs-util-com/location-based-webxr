/**
 * Why these tests matter. This store is a safety net for work that cannot
 * be redone - a creator's walk around a site, placing pins and photos at
 * real places. Two things must hold, and both are about FAILURE rather
 * than success:
 *
 * 1. It never throws into its caller. A store that throws turns "your work
 *    is also saved" into "your tap failed", which is worse than no net.
 * 2. A failed write leaves the PREVIOUS content intact rather than a
 *    truncated file. `close()` is what commits an OPFS writable, so a
 *    hand-rolled write that closes on the error path swaps a half-written
 *    file over a good one - and a draft that reads back corrupt is
 *    indistinguishable from lost work.
 *
 * A fake directory handle keeps these in node, as the OSM tile store's own
 * tests do; the real OPFS path is exercised by the app's e2e.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  createDraftFileStore,
  openDraftNamespace,
} from './opfs-draft-store.js';
import { fileNameFor } from './opfs-file-names.js';

/** A directory handle backed by a Map, with injectable failures. */
function fakeDirectory(
  options: { failWrite?: boolean; failList?: boolean } = {}
) {
  const files = new Map<string, Blob>();
  const removed: string[] = [];
  const handle = {
    files,
    removed,
    getFileHandle(name: string, opts?: { create?: boolean }) {
      if (!files.has(name) && opts?.create !== true) {
        return Promise.reject(
          Object.assign(new Error('not found'), { name: 'NotFoundError' })
        );
      }
      return Promise.resolve({
        getFile() {
          const blob = files.get(name);
          return blob === undefined
            ? Promise.reject(new Error('not found'))
            : Promise.resolve(blob);
        },
        createWritable() {
          let staged: Blob | undefined;
          return Promise.resolve({
            write(data: Blob | string) {
              if (options.failWrite === true)
                return Promise.reject(new Error('quota'));
              staged = typeof data === 'string' ? new Blob([data]) : data;
              return Promise.resolve();
            },
            close() {
              // Only a successful close commits - the whole point.
              if (staged !== undefined) files.set(name, staged);
              return Promise.resolve();
            },
            abort() {
              staged = undefined;
              return Promise.resolve();
            },
          });
        },
      });
    },
    // A fake async iterator has nothing to await; the SHAPE is the point,
    // because that is what the store consumes.
    // eslint-disable-next-line @typescript-eslint/require-await
    async *keys() {
      if (options.failList === true) throw new Error('listing broke');
      for (const name of files.keys()) yield name;
    },
    removeEntry(name: string) {
      removed.push(name);
      files.delete(name);
      return Promise.resolve();
    },
  };
  return handle as unknown as FileSystemDirectoryHandle & typeof handle;
}

describe('the draft file store', () => {
  it('round-trips text and bytes under a key', async () => {
    const dir = fakeDirectory();
    const store = createDraftFileStore(dir);
    expect(await store.put('meta', '{"a":1}')).toBe(true);
    expect(
      await store.put('photo/1', new Blob([new Uint8Array([1, 2, 3])]))
    ).toBe(true);
    expect(await store.getText('meta')).toBe('{"a":1}');
    const bytes = await (await store.getBlob('photo/1'))?.arrayBuffer();
    expect(Array.from(new Uint8Array(bytes ?? new ArrayBuffer(0)))).toEqual([
      1, 2, 3,
    ]);
  });

  it('keeps a key with a slash in ONE flat file, so a key cannot escape the directory', async () => {
    // A tour URL is a caller-supplied string full of slashes and dots. If
    // it became a path, `../` would become a traversal.
    const dir = fakeDirectory();
    const store = createDraftFileStore(dir);
    await store.put('../../etc/passwd', 'x');
    const names = [...dir.files.keys()];
    expect(names).toHaveLength(1);
    expect(names[0]).not.toContain('/');
    // ...and it still round-trips, which listing depends on.
    expect(await store.keys()).toEqual(['../../etc/passwd']);
  });

  it('reports a failed write instead of throwing, and leaves the previous content', async () => {
    // The invariant that makes this a safety net rather than a hazard: the
    // creator's placement already happened in memory, so a storage problem
    // must cost the NEWEST draft entry, never an older good one and never
    // the tap itself.
    const dir = fakeDirectory();
    const store = createDraftFileStore(dir);
    await store.put('obj', 'first');
    const failing = createDraftFileStore(fakeDirectory({ failWrite: true }));
    expect(await failing.put('obj', 'second')).toBe(false);
    // The original store is untouched, and a re-read gets the good value.
    expect(await store.getText('obj')).toBe('first');
  });

  it('reads a missing key as undefined rather than an error', async () => {
    // Most tours have no draft. That is the normal state, not a fault.
    const store = createDraftFileStore(fakeDirectory());
    expect(await store.getText('nothing')).toBeUndefined();
    expect(await store.getBlob('nothing')).toBeUndefined();
  });

  it('lists nothing rather than throwing when the directory cannot be read', async () => {
    const store = createDraftFileStore(fakeDirectory({ failList: true }));
    expect(await store.keys()).toEqual([]);
  });

  it('ignores files it did not write', async () => {
    // OPFS directories are shared ground; anything without our escaping is
    // not ours to hand back as a key.
    const dir = fakeDirectory();
    dir.files.set('session.json', new Blob(['{}']));
    dir.files.set(fileNameFor('mine'), new Blob(['x']));
    expect(await createDraftFileStore(dir).keys()).toEqual(['mine']);
  });

  it('clears the whole namespace in one call when it owns a directory', async () => {
    // A spent draft is deleted wholesale; removing the directory is one
    // call rather than one per placed object.
    const parent = fakeDirectory();
    const dir = fakeDirectory();
    const store = createDraftFileStore(dir, parent, 'ns');
    await store.put('a', 'x');
    await store.clear();
    expect(parent.removed).toEqual(['ns']);
  });

  it('clears file by file when it does not own the directory', async () => {
    const dir = fakeDirectory();
    const store = createDraftFileStore(dir);
    await store.put('a', 'x');
    await store.put('b', 'y');
    await store.clear();
    expect(dir.files.size).toBe(0);
  });

  it('reports no store at all when OPFS refuses, instead of throwing', async () => {
    // A browser without OPFS, blocked site data, a quota wall at directory
    // creation: the app must boot and author normally with no draft.
    const refusing = {
      getDirectoryHandle: vi.fn().mockRejectedValue(new Error('denied')),
    } as unknown as FileSystemDirectoryHandle;
    expect(
      await openDraftNamespace(refusing, 'https://h/t.zip')
    ).toBeUndefined();
  });
});
