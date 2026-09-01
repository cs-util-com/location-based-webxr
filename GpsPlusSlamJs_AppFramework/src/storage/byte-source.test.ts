import { describe, expect, it } from 'vitest';

import { SwitchableByteSource, type ByteSource } from './byte-source.js';

/**
 * Why these tests matter: the whole remote→local switch reduces to one
 * guarantee — a read that started before the switch must finish from the
 * source it started on, and only new reads see the new source. A consumer
 * (e.g. a zip.js Reader) holds a single instance for an archive's whole
 * lifetime and never learns the bytes moved from a Range fetch to a local
 * cache; that illusion is this class. The in-flight test below is the one
 * that actually protects a caller mid-fetch when a background download lands.
 */

/** A ByteSource backed by an in-memory buffer — the fake the policy is tested against. */
function memSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) =>
      Promise.resolve(bytes.slice(offset, offset + length)),
  };
}

/** A ByteSource whose single pending read is resolved by hand — models a slow
 *  remote fetch that is still in flight when the switch fires. */
function deferredSource(size: number): {
  source: ByteSource;
  resolve: (bytes: Uint8Array) => void;
} {
  let pending: ((bytes: Uint8Array) => void) | undefined;
  return {
    source: { size, read: () => new Promise((res) => (pending = res)) },
    resolve: (bytes) => pending?.(bytes),
  };
}

const REMOTE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const LOCAL = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

describe('SwitchableByteSource', () => {
  it('delegates read to its current source', async () => {
    const s = new SwitchableByteSource(memSource(REMOTE));

    expect(await s.read(2, 3)).toEqual(new Uint8Array([3, 4, 5]));
    expect(s.size).toBe(REMOTE.length);
  });

  it('routes new reads to the source it was switched to', async () => {
    const s = new SwitchableByteSource(memSource(REMOTE));

    s.switchTo(memSource(LOCAL));

    expect(await s.read(0, 3)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('ignores a second switch (idempotent — at most one swap), reporting it', async () => {
    const s = new SwitchableByteSource(memSource(REMOTE));
    const other = new Uint8Array([7, 7, 7, 7, 7, 7, 7, 7]);

    expect(s.switchTo(memSource(LOCAL))).toBe(true);
    // A duplicate warm/fallback race must not re-swap — and the caller must
    // learn its swap did not take (it must not persist bytes it did not land).
    expect(s.switchTo(memSource(other))).toBe(false);

    expect(await s.read(0, 3)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('refuses a switch to a differently-sized source (offsets would corrupt)', async () => {
    const s = new SwitchableByteSource(memSource(REMOTE));
    const wrongSize = new Uint8Array([9, 9, 9]); // e.g. a login-page redirect body

    expect(s.switchTo(memSource(wrongSize))).toBe(false);

    // Still reading from remote — and a later, correct swap must still work.
    expect(await s.read(0, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(s.switchTo(memSource(LOCAL))).toBe(true);
    expect(await s.read(0, 3)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('lets an in-flight read finish from the source it started on', async () => {
    const remote = deferredSource(REMOTE.length);
    const s = new SwitchableByteSource(remote.source);

    const inFlight = s.read(0, 3); // captured on the remote source
    s.switchTo(memSource(LOCAL)); // warm lands mid-read
    remote.resolve(new Uint8Array([1, 2, 3])); // remote answers after the swap

    expect(await inFlight).toEqual(new Uint8Array([1, 2, 3]));
  });
});
