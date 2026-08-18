/**
 * Zip entry path safety — shared validation for any code that writes an
 * archive entry at a caller- or author-supplied path (an asset filename, a
 * contributor-declared relative path, …).
 *
 * Extracted so every ZIP writer in this codebase rejects the same unsafe
 * shapes the same way, instead of each call site reinventing (and drifting
 * from) its own subset of checks.
 */

/** Why `path` cannot be used as a ZIP entry path, or `null` if it can. */
function unsafeZipEntryPathReason(
  path: string,
  reserved: readonly string[]
): string | null {
  if (path === '') return 'is empty';
  if (reserved.includes(path)) return `collides with reserved name '${path}'`;
  if (path.startsWith('/')) return 'is an absolute path';
  if (/^[a-zA-Z]:/.test(path)) return 'is a drive-lettered path';
  if (path.includes('\\')) return 'contains a backslash separator';
  if (path.split('/').includes('..')) return "escapes via a '..' segment";
  return null;
}

/**
 * Throw if any `path` cannot safely be used as a ZIP entry path.
 *
 * @param reserved - Paths this archive already writes for another purpose
 * (e.g. a manifest at the archive root) that a declared entry must not shadow.
 * @throws {Error} listing every problem found, not just the first — so a
 * caller building an archive from many declared paths fixes them in one pass.
 */
export function assertSafeZipEntryPaths(
  paths: readonly string[],
  reserved: readonly string[] = []
): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const reason = unsafeZipEntryPathReason(path, reserved);
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
