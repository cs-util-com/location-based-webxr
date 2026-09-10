/**
 * Zip Coverage Embed — write a recording's H3 coverage into its `session.json`.
 *
 * The map-centric browser indexes legacy recordings (those predating the
 * `h3Cells` field) by reading their full GPS path — slow, and repeated on every
 * folder open. This primitive lets a one-time "upgrade" embed the derived
 * coverage **inside the recording's own `session.json`**, so the recording
 * indexes instantly on every future open in this app *and any other reader*
 * (the portability the user asked for; O3 — in-zip rewrite).
 *
 * It is a pure transform `(zip, cells, resolution) -> zip`: it reads
 * `session.json`, decides whether there is anything to do, and re-emits the
 * archive through `rebuildZipWithEntries` (the package's ONE re-emit loop,
 * DEC-H3 — this module used to carry its own copy). It never mutates
 * anything in place — the caller (the RecorderApp backfill) owns the safe
 * write-then-verify-then-overwrite protocol around it — and it keeps its
 * skip-and-return-input semantics on top of the rebuild's throw: a backfill
 * over many recordings wants "left untouched", not an exception per file.
 *
 * @see ./zip-coverage-embed.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-1924-progressive-map-browser-indexing-and-backfill-followup.md (B3)
 */

import {
  BlobReader,
  TextWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js';
import { createLogger } from '../utils/logger';
import { rebuildZipWithEntries } from './zip-rebuild.js';

const log = createLogger('ZipCoverageEmbed');

/**
 * Return a new zip blob identical to `zip` except its `session.json` gains
 * `h3Cells` + `h3Resolution`.
 *
 * **Skips (returns the input blob unchanged, by reference) when:**
 *   - the zip has no `session.json` (nothing to embed into);
 *   - `session.json` is present but unparseable (never write over a broken one);
 *   - `session.json` already carries `h3Cells` (idempotent — re-running the
 *     upgrade is a no-op, and new recordings are skipped).
 *
 * On any unexpected read/write failure it also returns the input untouched —
 * it never emits a partial zip. Callers can detect a skip via reference
 * equality (`result === zip`).
 *
 * Built on `rebuildZipWithEntries` (store mode), so every non-`session.json`
 * entry is re-emitted with byte-identical uncompressed content.
 */
export async function embedCoverageInSessionJson(
  zip: Blob,
  h3Cells: string[],
  h3Resolution: number
): Promise<Blob> {
  let sessionName: string;
  let session: Record<string, unknown>;
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const entries = await reader.getEntries();
    const sessionEntry = entries.find(
      (e): e is FileEntry => !e.directory && e.filename.endsWith('session.json')
    );
    if (!sessionEntry) {
      log.warn('No session.json found; leaving zip untouched');
      return zip;
    }
    sessionName = sessionEntry.filename;
    try {
      const parsed: unknown = JSON.parse(
        await sessionEntry.getData(new TextWriter())
      );
      // `JSON.parse` succeeds on `null`, `3` and `"text"`, and this
      // function promises to return the input untouched on ANY unexpected
      // read - a backfill over many recordings wants that rather than an
      // exception per file. Reading `.h3Cells` off a non-object threw
      // from outside every `try` here, so one odd recording aborted the
      // whole backfill (PR #444 review).
      //
      // Merging into a non-object would also be destructive: the spread
      // would produce a fresh object and overwrite whatever the file
      // actually held.
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        // Arrays included, and a test of this caught that they were not:
        // `typeof [] === 'object'`, so an array passed the first check and
        // then `{ ...[1, 2], h3Cells }` produced `{ 0: 1, 1: 2, ... }` -
        // a rewritten file, which is the destructive half of this bug
        // rather than the throwing half.
        log.warn('session.json is not an object; leaving zip untouched');
        return zip;
      }
      session = parsed as Record<string, unknown>;
    } catch (err) {
      log.warn('session.json unparseable; leaving zip untouched', err);
      return zip;
    }
  } catch (err) {
    log.warn('Failed to read zip for coverage embed; leaving untouched', err);
    return zip;
  } finally {
    await reader.close();
  }

  // Idempotent: a zip that already carries coverage is returned unchanged.
  if (session.h3Cells !== undefined) {
    return zip;
  }

  const merged = { ...session, h3Cells, h3Resolution };
  try {
    return await rebuildZipWithEntries(zip, [
      { path: sessionName, data: JSON.stringify(merged) },
    ]);
  } catch (err) {
    // Never leave a partial: the rebuild abandoned its output, keep the original.
    log.warn('Failed to re-emit zip; leaving original untouched', err);
    return zip;
  }
}
