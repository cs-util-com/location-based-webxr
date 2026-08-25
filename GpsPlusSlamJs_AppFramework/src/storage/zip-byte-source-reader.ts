/**
 * Adapts a {@link ByteSource} to a zip.js `Reader`.
 *
 * This is the whole reason zip.js sees a `ByteSource` at all: it parses the
 * central directory and decompresses entries, while every actual byte read is
 * delegated to the source beneath — which may be a remote Range fetch or a
 * local cache, and may switch between them mid-session without zip.js ever
 * noticing (see `SwitchableByteSource`).
 */

import { Reader } from '@zip.js/zip.js';

import type { ByteSource } from './byte-source.js';

export class ByteSourceReader extends Reader<ByteSource> {
  readonly #source: ByteSource;

  constructor(source: ByteSource) {
    super(source);
    this.#source = source;
    this.size = source.size;
  }

  override readUint8Array(index: number, length: number): Promise<Uint8Array> {
    // zip.js may request past EOF near the central directory — clamp to
    // remaining, and resolve empty reads locally: a zero-length request must
    // never reach the source (a remote source would turn it into an invalid
    // HTTP Range header).
    const clamped = Math.max(0, Math.min(length, this.size - index));
    if (clamped === 0) return Promise.resolve(new Uint8Array(0));
    return this.#source.read(index, clamped);
  }
}
