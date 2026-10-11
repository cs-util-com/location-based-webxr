import { describe, expect, it, vi } from 'vitest';
import type * as ZipJs from '@zip.js/zip.js';

import { ArchiveLimitError } from './archive-limits';
import { loadSessionMetadata, MAX_ACTION_FILE_SIZE } from './zip-reader';

/**
 * Why this test matters (K0 milestone review R11): `session.json` is read
 * under a count of the bytes ACTUALLY inflated, capped at `maxFileSize`.
 * With zip.js 2.11.2 that count is never the FIRST guard: the declared-size
 * check refuses an entry declaring more than `maxFileSize`, and zip.js
 * refuses output past whatever smaller size it declares (pinned in
 * `capped-zip-entries.test.ts`). So no real archive can show the count
 * working. This file replaces zip.js's reader with one whose entry
 * understates its size and inflates without that check - the zip.js the
 * count exists for (an upgrade that drops the check, a codec path without
 * it) - and proves the count alone stops the read. It fails if the count
 * is removed: the 2 MiB of zeros would then reach `JSON.parse`.
 */

const INFLATED = 2 * 1024 * 1024;

vi.mock('@zip.js/zip.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ZipJs>();
  class UncheckedZipReader {
    getEntries(): Promise<unknown[]> {
      return Promise.resolve([
        {
          filename: 'session.json',
          directory: false,
          offset: 0,
          uncompressedSize: 10,
          // zip.js's contract for a WritableStream writer (what the
          // counted read passes): write every chunk, then close it.
          async getData(writable: WritableStream<Uint8Array>): Promise<void> {
            const writer = writable.getWriter();
            const chunk = new Uint8Array(64 * 1024);
            try {
              for (let done = 0; done < INFLATED; done += chunk.length) {
                await writer.write(chunk);
              }
              await writer.close();
            } catch (err) {
              await writer.abort(err).catch(() => undefined);
              throw err;
            }
          },
        },
      ]);
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
  }
  return { ...actual, ZipReader: UncheckedZipReader };
});

describe('loadSessionMetadata counts the bytes it inflates', () => {
  it('stops an entry that understates its size at maxFileSize, without zip.js', async () => {
    const err = await loadSessionMetadata(new Uint8Array(22)).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('entry-bytes');
    expect((err as ArchiveLimitError).limit).toBe(MAX_ACTION_FILE_SIZE);
  });
});
