/**
 * Tests for write-file-or-abort.ts
 *
 * Why these tests matter: every assertion here corresponds to a way the
 * hand-rolled copies of this pattern went wrong (or could have). The File
 * System Access API commits a partial write if you `close()` a failed stream
 * and leaks the handle's lock if you do neither — both silent, both surfacing
 * later as unrelated corruption. So the failure path is pinned harder than the
 * success path:
 * - abort (never close) on a failed write, so the temp is discarded;
 * - abort on a failed close too — the swap itself can fail;
 * - the ORIGINAL error reaches the caller, not an abort error masking it;
 * - an abort that itself throws never escapes.
 */

import { describe, it, expect, vi } from 'vitest';
import { writeFileOrAbort } from './write-file-or-abort.js';

/** Minimal writable-stream double recording which lifecycle calls happened. */
function makeWritable(
  overrides: {
    write?: () => Promise<void>;
    close?: () => Promise<void>;
    abort?: () => Promise<void>;
  } = {}
) {
  return {
    write: vi.fn(overrides.write ?? (() => Promise.resolve())),
    close: vi.fn(overrides.close ?? (() => Promise.resolve())),
    abort: vi.fn(overrides.abort ?? (() => Promise.resolve())),
  };
}

function makeHandle(writable: ReturnType<typeof makeWritable>) {
  return {
    createWritable: vi.fn(() => Promise.resolve(writable)),
  } as unknown as FileSystemFileHandle;
}

describe('writeFileOrAbort', () => {
  it('writes then closes on the success path, and never aborts', async () => {
    const writable = makeWritable();
    await writeFileOrAbort(makeHandle(writable), 'payload');

    expect(writable.write).toHaveBeenCalledWith('payload');
    expect(writable.close).toHaveBeenCalledTimes(1);
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it('accepts a Blob as well as a string', async () => {
    const writable = makeWritable();
    const blob = new Blob(['zip bytes']);
    await writeFileOrAbort(makeHandle(writable), blob);

    expect(writable.write).toHaveBeenCalledWith(blob);
  });

  // The mistake that commits corruption: close() after a failed write swaps the
  // partial temp over a previously good file.
  it('aborts and does NOT close when write() fails', async () => {
    const boom = new Error('write exploded');
    const writable = makeWritable({ write: () => Promise.reject(boom) });

    await expect(
      writeFileOrAbort(makeHandle(writable), 'payload')
    ).rejects.toBe(boom);

    expect(writable.abort).toHaveBeenCalledTimes(1);
    expect(writable.close).not.toHaveBeenCalled();
  });

  // close() performs the atomic swap, so it can fail on its own (quota, disk).
  // The stream still needs aborting or the lock leaks.
  it('aborts when close() fails, and surfaces the close error', async () => {
    const boom = new Error('close exploded');
    const writable = makeWritable({ close: () => Promise.reject(boom) });

    await expect(
      writeFileOrAbort(makeHandle(writable), 'payload')
    ).rejects.toBe(boom);

    expect(writable.abort).toHaveBeenCalledTimes(1);
  });

  // If abort's failure escaped, it would replace the real diagnostic with a
  // misleading one.
  it('swallows an abort() failure and still throws the original error', async () => {
    const original = new Error('the real cause');
    const writable = makeWritable({
      write: () => Promise.reject(original),
      abort: () => Promise.reject(new Error('abort also failed')),
    });

    await expect(
      writeFileOrAbort(makeHandle(writable), 'payload')
    ).rejects.toBe(original);
  });

  it('normalizes a non-Error throw so callers can rely on instanceof Error', async () => {
    // `prefer-promise-reject-errors` is disabled for exactly two lines here:
    // rejecting with a non-Error is the precondition under test. The lint rule
    // is right about production code — that is WHY the helper normalizes — and
    // must stay on everywhere else.
    const stringThrower = makeWritable({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      write: () => Promise.reject('just a string'),
    });
    await expect(
      writeFileOrAbort(makeHandle(stringThrower), 'payload')
    ).rejects.toThrow('just a string');

    const junkThrower = makeWritable({
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      write: () => Promise.reject({ weird: true }),
    });
    await expect(
      writeFileOrAbort(makeHandle(junkThrower), 'payload')
    ).rejects.toThrow('File write failed');
  });

  // createWritable() itself can reject (no permission, handle gone). There is
  // no stream yet, so there is nothing to abort — the error must simply escape.
  it('propagates a createWritable() failure without touching the stream', async () => {
    const boom = new Error('no permission');
    const handle = {
      createWritable: vi.fn(() => Promise.reject(boom)),
    } as unknown as FileSystemFileHandle;

    await expect(writeFileOrAbort(handle, 'payload')).rejects.toBe(boom);
  });
});
