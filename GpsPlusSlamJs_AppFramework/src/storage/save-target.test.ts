/**
 * Why these tests matter: saving IN PLACE writes over the user's only copy
 * of a file. The page must ask for write permission on the open's own
 * gesture, must never overwrite a file something else changed meanwhile -
 * and must not refuse a file a sync client only touched - and must say a
 * moved or deleted file apart from a changed one. Whether a touched file
 * is the same is the caller's choice (a zip's tail, or a whole-content
 * hash), and so are the sentences and the lock's policy: these tests pin
 * that each choice does what it says, for any app, not only the tour
 * editor these blocks came from.
 */
import { describe, expect, it } from 'vitest';
import { ZIP_FILE_TYPE, type DownloadFileType } from './zip-export';
import {
  DEFAULT_IN_PLACE_REFUSALS,
  InPlaceRefusal,
  SAME_FILE_TAIL_BYTES,
  createSaveTarget,
  holdLock,
  isSameFile,
  pickSaveFile,
  pickWritableFile,
  releaseUnusedPick,
  type SameFileCheck,
  type WritableFileHandle,
} from './save-target';

const JSON_TYPE: DownloadFileType = {
  description: 'Pins',
  mimeType: 'application/json',
  extension: '.json',
};

/** A file on a fake disk: its bytes and modified time, and the calls. */
function fakeHandle(initial: Uint8Array | string, name = 'file.zip') {
  const state = {
    bytes:
      typeof initial === 'string' ? new TextEncoder().encode(initial) : initial,
    modified: 1000,
    gone: false,
    failWrite: false,
    calls: [] as string[],
    permission: 'granted' as PermissionState | 'throws',
  };
  const handle = {
    kind: 'file',
    name,
    getFile: () => {
      state.calls.push('getFile');
      if (state.gone) {
        return Promise.reject(new DOMException('gone', 'NotFoundError'));
      }
      return Promise.resolve(
        new File([state.bytes.slice()], name, { lastModified: state.modified })
      );
    },
    createWritable: () => {
      state.calls.push('createWritable');
      let pending = new Uint8Array();
      return Promise.resolve({
        write: async (data: unknown) => {
          if (state.failWrite) throw new Error('the disk is full');
          pending = new Uint8Array(await (data as Blob).arrayBuffer());
        },
        close: () => {
          state.bytes = pending;
          state.modified += 1;
          return Promise.resolve();
        },
        abort: () => Promise.resolve(),
      });
    },
    requestPermission: () => {
      state.calls.push('requestPermission');
      return state.permission === 'throws'
        ? Promise.reject(new Error('no'))
        : Promise.resolve(state.permission);
    },
  } as unknown as WritableFileHandle;
  return { handle, state };
}

const text = (s: { bytes: Uint8Array }): string =>
  new TextDecoder().decode(s.bytes);

describe('pickWritableFile', () => {
  it('filters the open dialog to the file type it is given', async () => {
    const asked: unknown[] = [];
    await pickWritableFile(
      {
        showOpenFilePicker: (options) => {
          asked.push(options);
          return Promise.resolve([]);
        },
      },
      JSON_TYPE
    );
    expect(asked).toEqual([
      {
        types: [
          { description: 'Pins', accept: { 'application/json': ['.json'] } },
        ],
        multiple: false,
      },
    ]);
  });

  it('is unavailable without the picker or where this page may not use it', async () => {
    expect(await pickWritableFile({}, JSON_TYPE)).toEqual({
      kind: 'unavailable',
    });
    for (const err of [
      new DOMException('iframe', 'SecurityError'),
      new TypeError('no'),
    ]) {
      expect(
        await pickWritableFile(
          { showOpenFilePicker: () => Promise.reject(err) },
          JSON_TYPE
        )
      ).toEqual({ kind: 'unavailable' });
    }
  });

  it('treats a dismissed or a refused second picker as a cancel', async () => {
    for (const name of ['AbortError', 'NotAllowedError']) {
      expect(
        await pickWritableFile(
          {
            showOpenFilePicker: () =>
              Promise.reject(new DOMException('no', name)),
          },
          JSON_TYPE
        )
      ).toEqual({ kind: 'cancelled' });
    }
  });

  it('asks for write permission before it reads the file', async () => {
    const { handle, state } = fakeHandle('{}', 'pins.json');
    const outcome = await pickWritableFile(
      { showOpenFilePicker: () => Promise.resolve([handle]) },
      JSON_TYPE
    );
    expect(state.calls.slice(0, 2)).toEqual(['requestPermission', 'getFile']);
    expect(outcome).toMatchObject({ kind: 'picked', writable: true });
  });

  it('opens a file it may not write, and says one it can no longer read', async () => {
    for (const permission of ['denied', 'prompt', 'throws'] as const) {
      const { handle, state } = fakeHandle('{}');
      state.permission = permission;
      expect(
        await pickWritableFile(
          { showOpenFilePicker: () => Promise.resolve([handle]) },
          JSON_TYPE
        )
      ).toMatchObject({ kind: 'picked', writable: false });
    }
    const { handle, state } = fakeHandle('{}');
    state.gone = true;
    expect(
      await pickWritableFile(
        { showOpenFilePicker: () => Promise.resolve([handle]) },
        JSON_TYPE
      )
    ).toMatchObject({ kind: 'unreadable' });
  });
});

describe('pickSaveFile', () => {
  const handle = { kind: 'file', name: 'pins.json' } as FileSystemFileHandle;

  it('opens the dialog before it returns, filtered to the file type', async () => {
    const asked: unknown[] = [];
    const picked = pickSaveFile(
      {
        showSaveFilePicker: (options) => {
          asked.push(options);
          return Promise.resolve(handle);
        },
      },
      'pins.json',
      JSON_TYPE
    );
    expect(asked).toEqual([
      {
        suggestedName: 'pins.json',
        types: [
          { description: 'Pins', accept: { 'application/json': ['.json'] } },
        ],
      },
    ]);
    await expect(picked).resolves.toEqual({ kind: 'picked', handle });
  });

  it('is cancelled only by a dismissal, unavailable for anything else', async () => {
    const answer = (fail: () => Promise<FileSystemFileHandle>) =>
      pickSaveFile({ showSaveFilePicker: fail }, 'a.zip', ZIP_FILE_TYPE);
    await expect(
      answer(() => Promise.reject(new DOMException('x', 'AbortError')))
    ).resolves.toEqual({ kind: 'cancelled' });
    for (const err of [
      new DOMException('x', 'SecurityError'),
      new DOMException('x', 'NotAllowedError'),
      new TypeError('x'),
    ]) {
      await expect(answer(() => Promise.reject(err))).resolves.toEqual({
        kind: 'unavailable',
      });
    }
    await expect(
      answer(() => {
        throw new TypeError('thrown, not rejected');
      })
    ).resolves.toEqual({ kind: 'unavailable' });
    await expect(pickSaveFile({}, 'a.zip', ZIP_FILE_TYPE)).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  // Why: a documented change from the move into the framework. A picker
  // that throws an AbortError at once, before it returns a promise, used to
  // read as unavailable in the Tour Viewer's copy (and so offered a
  // download); the synchronous throw now goes through the same classifier
  // as a rejection, so a dismissal is a dismissal however it arrives.
  it('reads a synchronous AbortError from the picker call as cancelled', async () => {
    await expect(
      pickSaveFile(
        {
          showSaveFilePicker: () => {
            throw new DOMException('dismissed', 'AbortError');
          },
        },
        'a.zip',
        ZIP_FILE_TYPE
      )
    ).resolves.toEqual({ kind: 'cancelled' });
  });
});

describe('releaseUnusedPick', () => {
  it("says the caller's sentence for a picked file, and nothing otherwise", async () => {
    const handle = { kind: 'file', name: 'pins.json' } as FileSystemFileHandle;
    const say = (name: string) => `Nothing was written into ${name}.`;
    expect(
      await releaseUnusedPick(Promise.resolve({ kind: 'picked', handle }), say)
    ).toBe('Nothing was written into pins.json.');
    expect(await releaseUnusedPick(null, say)).toBeNull();
    for (const kind of ['cancelled', 'unavailable'] as const) {
      expect(
        await releaseUnusedPick(Promise.resolve({ kind }), say)
      ).toBeNull();
    }
  });
});

describe('createSaveTarget', () => {
  for (const check of ['tail', 'hash'] as const) {
    describe(`with the ${check} check`, () => {
      it('writes in place and checks against what it wrote', async () => {
        const { handle, state } = fakeHandle('version one');
        const target = await createSaveTarget(handle, await handle.getFile(), {
          check,
        });
        expect(await target.check()).toBe('same');
        await target.write(new Blob(['version two']));
        expect(text(state)).toBe('version two');
        expect(await target.check()).toBe('same');
      });

      it('refuses a file something else changed, and writes nothing', async () => {
        const { handle, state } = fakeHandle('version one');
        const target = await createSaveTarget(handle, await handle.getFile(), {
          check,
        });
        state.bytes = new TextEncoder().encode('another program');
        state.modified += 5;
        await expect(target.write(new Blob(['mine']))).rejects.toMatchObject({
          kind: 'changed',
        });
        expect(text(state)).toBe('another program');
      });

      it('accepts a touched file of the same content, refuses one of other content', async () => {
        const { handle, state } = fakeHandle('version one');
        const target = await createSaveTarget(handle, await handle.getFile(), {
          check,
        });
        state.modified += 60_000;
        expect(await target.check()).toBe('same');
        state.bytes = new TextEncoder().encode('version ONE');
        state.modified += 1;
        expect(await target.check()).toBe('changed');
      });

      it('says a gone file apart from a changed one', async () => {
        const { handle, state } = fakeHandle('v');
        const target = await createSaveTarget(handle, await handle.getFile(), {
          check,
        });
        state.gone = true;
        expect(await target.check()).toBe('gone');
        const err = await target
          .write(new Blob(['x']))
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InPlaceRefusal);
        expect((err as InPlaceRefusal).kind).toBe('gone');
      });

      it('keeps its baseline when a write fails', async () => {
        const { handle, state } = fakeHandle('version one');
        const target = await createSaveTarget(handle, await handle.getFile(), {
          check,
        });
        state.failWrite = true;
        await expect(target.write(new Blob(['two']))).rejects.toThrow(
          /disk is full/
        );
        expect(await target.check()).toBe('same');
      });
    });
  }

  // Why: the tail is a zip's rule - its central directory at the end names
  // every entry with its checksum. A JSON file's end says nothing about its
  // start, so a change outside the tail must be caught by the hash.
  it('the hash catches a change the tail cannot see, in a large file', async () => {
    const size = SAME_FILE_TAIL_BYTES + 1024;
    const outcome = async (check: SameFileCheck) => {
      const { handle, state } = fakeHandle(new Uint8Array(size));
      const target = await createSaveTarget(handle, await handle.getFile(), {
        check,
      });
      const edited = new Uint8Array(size);
      edited[0] = 1;
      state.bytes = edited;
      state.modified += 1;
      return target.check();
    };
    expect(await outcome('tail')).toBe('same');
    expect(await outcome('hash')).toBe('changed');
  });

  it("refuses content over maxBytes with the caller's sentence, else the default", async () => {
    const { handle, state } = fakeHandle('version one');
    const said = await createSaveTarget(handle, await handle.getFile(), {
      check: 'hash',
      maxBytes: 5,
      refusals: { 'too-large': 'Too many pins.' },
    });
    await expect(said.write(new Blob(['far too long']))).rejects.toMatchObject({
      kind: 'too-large',
      message: 'Too many pins.',
    });
    expect(text(state)).toBe('version one');
    const plain = await createSaveTarget(handle, await handle.getFile(), {
      check: 'hash',
      maxBytes: 5,
    });
    await expect(plain.write(new Blob(['far too long']))).rejects.toMatchObject(
      {
        message: DEFAULT_IN_PLACE_REFUSALS['too-large'],
      }
    );
    await plain.write(new Blob(['fits']));
    expect(text(state)).toBe('fits');
  });

  it('has no size limit unless one is given', async () => {
    const { handle, state } = fakeHandle('a');
    const target = await createSaveTarget(handle, await handle.getFile(), {
      check: 'tail',
    });
    await target.write(new Blob([new Uint8Array(SAME_FILE_TAIL_BYTES * 2)]));
    expect(state.bytes.length).toBe(SAME_FILE_TAIL_BYTES * 2);
  });

  it('rejects an unknown check and a negative or NaN limit', async () => {
    const { handle } = fakeHandle('a');
    const opened = await handle.getFile();
    await expect(
      createSaveTarget(handle, opened, {
        check: 'size' as unknown as SameFileCheck,
      })
    ).rejects.toThrow(RangeError);
    for (const maxBytes of [-1, Number.NaN]) {
      await expect(
        createSaveTarget(handle, opened, { check: 'tail', maxBytes })
      ).rejects.toThrow(RangeError);
    }
  });
});

describe('isSameFile', () => {
  const named = (name: string) => ({ kind: 'file', name }) as FileSystemHandle;

  it("is the handle's answer where it gives one, else the same name", async () => {
    const asks = Object.assign(named('a.json'), {
      isSameEntry: (other: FileSystemHandle) =>
        Promise.resolve(other.name === 'b.json'),
    });
    expect(
      await isSameFile({ name: 'a.json', handle: asks }, named('b.json'))
    ).toBe(true);
    const cannotTell = Object.assign(named('a.json'), {
      isSameEntry: () => Promise.reject(new DOMException('x', 'SecurityError')),
    }) as FileSystemHandle;
    for (const handle of [null, named('a.json'), cannotTell]) {
      expect(
        await isSameFile({ name: 'a.json', handle }, named('a.json'))
      ).toBe(true);
      expect(
        await isSameFile({ name: 'a.json', handle }, named('b.json'))
      ).toBe(false);
    }
  });
});

describe('holdLock', () => {
  /** A Web Locks stand-in: exclusive, `ifAvailable`, released on demand. */
  function fakeLocks() {
    const held = new Set<string>();
    const locks = {
      request: (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => unknown
      ) => {
        if (held.has(name)) return Promise.resolve(callback(null));
        held.add(name);
        return Promise.resolve(callback({ name, mode: 'exclusive' })).finally(
          () => held.delete(name)
        );
      },
    } as unknown as LockManager;
    return { held, locks };
  }
  const grant = { prefix: 'app/', withoutLocks: 'grant' } as const;
  const refuse = { prefix: 'app/', withoutLocks: 'refuse' } as const;

  it('holds the prefixed name for one holder until it is released', async () => {
    const { locks, held } = fakeLocks();
    const first = await holdLock(locks, 'a', grant);
    expect(first.granted).toBe(true);
    expect(held).toEqual(new Set(['app/a']));
    expect((await holdLock(locks, 'a', refuse)).granted).toBe(false);
    expect((await holdLock(locks, 'a', grant)).granted).toBe(false);
    expect(
      (await holdLock(locks, 'a', { ...grant, prefix: 'other/' })).granted
    ).toBe(true);
    first.release();
    await first.released;
    expect((await holdLock(locks, 'a', grant)).granted).toBe(true);
  });

  // Why: the tour editor grants without Web Locks (nothing to coordinate
  // with), the recordings refuse (nothing is held, so a folder must not be
  // treated as this page's). One block, the policy the caller's.
  it('without Web Locks, or when the request fails, answers by the policy', async () => {
    const failing = {
      request: () => Promise.reject(new Error('no locks here')),
    } as unknown as LockManager;
    for (const locks of [undefined, failing]) {
      expect((await holdLock(locks, 'a', grant)).granted).toBe(true);
      expect((await holdLock(locks, 'a', refuse)).granted).toBe(false);
    }
  });
});
