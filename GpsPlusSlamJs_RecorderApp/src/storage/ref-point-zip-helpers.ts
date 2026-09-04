/**
 * Shared helpers for parsing reference-point JSON files out of session ZIPs.
 *
 * Used by `ref-point-recovery.ts` (produces full `RefPointDefinition`s to
 * rebuild OPFS state after a browser data clear) and `ref-point-loader.ts`.
 * A second caller, `ref-point-importer.ts`, was deleted 2026-09-04 (no
 * production callers); the helper stays because two callers remain.
 *
 * The flows previously open-coded the same `entries.forEach` /
 * parse / validate / try-catch loop. Centralising it here keeps the error-
 * reporting format and zip-reader lifecycle consistent across callers.
 */

import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js';
import type { RefPointDefinition } from './ref-point-loader';

/** Case-insensitive `.zip` file-name check. */
export function isZipFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

/**
 * Recognize ref-point JSON entries inside a session ZIP.
 * Expected path: `refPoints/{id}.json` (anything else is skipped).
 *
 * Module-private: only `extractRefPointEntriesFromZip` (below) consumes it.
 */
function isRefPointEntry(entryPath: string): boolean {
  return (
    entryPath.startsWith('refPoints/') &&
    entryPath.endsWith('.json') &&
    entryPath !== 'refPoints/'
  );
}

/**
 * Base shape check for `RefPointDefinition`: validates `id`/`name`/
 * `createdAt`/`observations[]` exist with the right primitive types.
 *
 * Does **not** validate observation contents — callers that need stricter
 * checks (e.g. the on-disk loader requires every observation to have a
 * valid `arPose` and `gpsPoint`) should layer their own predicate on top.
 */
export function isRefPointDefinitionShape(
  value: unknown
): value is RefPointDefinition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.createdAt === 'number' &&
    Array.isArray(obj.observations)
  );
}

/**
 * Walk every ref-point JSON entry inside `zipBlob`, validate it via
 * `validate`, then transform it via `toItem`. Per-entry parse/validation
 * failures and IO errors are collected into `errors` (one string per failure
 * in the form `"${zipFileName}/${entryName}: <reason>"`) so the caller can
 * keep going even when individual files are malformed.
 *
 * `toItem` may return `null` to silently drop a definition without raising
 * an error (e.g. the importer drops definitions with no observations).
 *
 * The underlying `ZipReader` is always closed before returning, even on
 * exception inside the loop body.
 */
export async function extractRefPointEntriesFromZip<T>(
  zipBlob: Blob,
  zipFileName: string,
  validate: (value: unknown) => value is RefPointDefinition,
  toItem: (def: RefPointDefinition) => T | null
): Promise<{ items: T[]; errors: string[] }> {
  const items: T[] = [];
  const errors: string[] = [];

  const zipReader = new ZipReader(new BlobReader(zipBlob));

  try {
    const entries = await zipReader.getEntries();

    for (const entry of entries) {
      if (entry.directory) continue;
      if (!isRefPointEntry(entry.filename)) continue;

      try {
        const textWriter = new TextWriter();
        const jsonText = await entry.getData(textWriter);

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch (parseErr) {
          errors.push(
            `${zipFileName}/${entry.filename}: Invalid JSON - ${(parseErr as Error).message}`
          );
          continue;
        }

        if (!validate(parsed)) {
          errors.push(
            `${zipFileName}/${entry.filename}: Invalid ref point schema`
          );
          continue;
        }

        const mapped = toItem(parsed);
        if (mapped !== null) {
          items.push(mapped);
        }
      } catch (entryErr) {
        errors.push(
          `${zipFileName}/${entry.filename}: ${(entryErr as Error).message}`
        );
      }
    }
  } finally {
    await zipReader.close();
  }

  return { items, errors };
}
