/**
 * Zip entry path safety - the ONE rule set for any code that writes an
 * archive entry at a caller- or author-supplied path (a contributor's
 * relative path, a manifest name, a captured photo's file name).
 *
 * Absorbed from community PR #321 (`assertSafeZipEntryPaths`) and hardened
 * per its review (`GpsPlusSlamJs_Docs/docs/2026-08-26-1215-pr-321-zip-qr-
 * packaging-review.md`): the PR's validator was laxer than the checks
 * `zip-export.ts` already applied inline (`.` segments), and skipped empty
 * segments and trailing slashes. This module carries the union of both rule
 * sets and `zip-export.ts` calls it, so a writer cannot drift from the
 * validator it claims to share (DEC-H3). The PR's `reserved` parameter is
 * gone: a manifest is an ordinary entry (DEC-N12), and nothing in
 * production ever passed a reserved name (M1 review #13).
 */

/** Why `path` cannot be used as a ZIP entry path, or `null` if it can. */
function unsafeZipEntryPathReason(path: string): string | null {
  if (path === '') return 'is empty';
  if (path.startsWith('/')) return 'is an absolute path';
  if (/^[a-zA-Z]:/.test(path)) return 'is a drive-lettered path';
  if (path.includes('\\')) return 'contains a backslash separator';
  if (path.endsWith('/'))
    return 'has a trailing slash (a directory, not a file)';
  const segments = path.split('/');
  if (segments.includes('..')) return "escapes via a '..' segment";
  if (segments.includes('.')) return "contains a '.' segment";
  if (segments.includes('')) return 'contains an empty segment';
  return null;
}

/**
 * Throw if any `path` cannot safely be used as a ZIP entry path, or if two
 * are the same.
 *
 * @throws {Error} listing EVERY problem found, not just the first - a caller
 *   building an archive from many declared paths fixes them in one pass.
 */
export function assertSafeZipEntryPaths(paths: readonly string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const reason = unsafeZipEntryPathReason(path);
    if (reason !== null) {
      problems.push(`'${path}' ${reason}`);
    } else if (seen.has(path)) {
      problems.push(`'${path}' is a duplicate entry path`);
    }
    seen.add(path);
  }
  if (problems.length > 0) {
    throw new Error(`unsafe zip entry path(s): ${problems.join('; ')}`);
  }
}
