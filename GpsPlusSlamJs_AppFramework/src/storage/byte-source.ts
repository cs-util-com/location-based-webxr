/**
 * The swappable byte-source seam behind range-based ZIP streaming.
 *
 * A `ByteSource` is random-access over one archive: "give me bytes
 * [offset, offset+length)". A zip.js `Reader` (see `zip-byte-source-reader.ts`)
 * reads an archive's whole lifetime through a single instance of one of these;
 * the reader never learns whether the bytes came from an HTTP Range fetch or a
 * local cache. That indirection is what lets a consumer swap remote→local
 * mid-session.
 *
 * `SwitchableByteSource` holds the *current* source and flips it atomically
 * once, e.g. after a background download has warmed a local copy.
 */

/** Random-access byte source over a single archive. */
export interface ByteSource {
  /** Total archive size in bytes (fixed for the archive's lifetime). */
  readonly size: number;
  /**
   * Read `length` bytes starting at `offset`.
   *
   * ⚠️ **The two implementations DISAGREE past EOF, and this seam does not
   * yet make them agree** (PR #383 review). A read where
   * `offset + length > size` THROWS `StructuralReadError` in
   * `RemoteRangeByteSource`, while `LocalCacheByteSource` returns a SHORT
   * buffer, because `blob.slice` clamps silently. Since
   * {@link SwitchableByteSource} swaps one for the other mid-session (warm
   * download, range-ignore recovery), the same read can throw before the
   * swap and succeed after it.
   *
   * Callers must therefore not rely on either behaviour today. Which one
   * becomes the contract is an open decision - `open-remote-archive.ts`
   * reasons as though clamping were it, which is part of why this is worth
   * settling rather than picking here. See
   * `2026-08-30-1120-byte-source-eof-contract-followup.md`.
   */
  read(offset: number, length: number): Promise<Uint8Array>;
}

/**
 * A `ByteSource` whose backing can be swapped once, atomically, without the
 * reader above it noticing. The size is fixed at construction — every source
 * represents the same archive.
 */
export class SwitchableByteSource implements ByteSource {
  readonly size: number;
  #current: ByteSource;
  #switched = false;

  constructor(initial: ByteSource) {
    this.#current = initial;
    this.size = initial.size;
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    return this.#current.read(offset, length);
  }

  /**
   * Swap the backing source. Only reads started *after* this see `next`, and
   * only the *first successful* call takes effect — a duplicate swap must not
   * re-fire. A source of a different size is refused (not counted as the one
   * swap): every parsed zip offset is anchored to `this.size`, so mismatched
   * bytes (redirect page, truncated body) would silently corrupt every later
   * read.
   *
   * Returns whether the swap took effect. A caller that just warmed a local
   * copy must know: `false` on a size mismatch means the downloaded bytes are
   * WRONG for this archive and must not be persisted to a cache.
   */
  switchTo(next: ByteSource): boolean {
    if (this.#switched || next.size !== this.size) return false;
    this.#switched = true;
    this.#current = next;
    return true;
  }
}
