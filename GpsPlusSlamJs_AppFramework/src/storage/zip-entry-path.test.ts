/**
 * Why this test matters: every zip writer in this package hands
 * caller-supplied strings to `ZipWriter.add` as entry paths. A path that
 * escapes (`../`) or hides a duplicate would silently overwrite a
 * framework-owned entry or produce an archive that reads back differently
 * from what the caller declared. The rules here are the ONE rule set
 * (absorbed from community PR #321 and aligned to the stricter checks
 * `zip-export.ts` already applied), so each shape is pinned once, by name.
 */

import { describe, expect, it } from 'vitest';

import { assertSafeZipEntryPaths } from './zip-entry-path';

describe('assertSafeZipEntryPaths', () => {
  it('accepts ordinary nested paths, including spaces and inner dots, and returns nothing', () => {
    expect(() =>
      assertSafeZipEntryPaths([
        'tour.json',
        'content/a.jpg',
        'qr/abc.json',
        'images/frame 001.v2.jpg',
      ])
    ).not.toThrow();
  });

  it.each([
    ['an empty path', '', /is empty/],
    ['an absolute path', '/abs.glb', /absolute/],
    ['a drive-lettered path', 'C:/abs.glb', /drive-lettered/],
    ['a backslash separator', 'assets\\gate.png', /backslash/],
    ['a parent-directory escape', '../escape.glb', /'\.\.'/],
    ['a current-directory segment', 'assets/./gate.png', /'\.'/],
    ['an empty segment', 'assets//gate.png', /empty segment/],
    ['a trailing slash', 'assets/', /trailing/],
  ])('rejects %s', (_label, path, reason) => {
    expect(() => assertSafeZipEntryPaths([path])).toThrow(reason);
  });

  it('rejects a duplicate path instead of letting the writer overwrite silently', () => {
    expect(() =>
      assertSafeZipEntryPaths(['assets/same.bin', 'assets/same.bin'])
    ).toThrow(/assets\/same\.bin.*duplicate/);
  });

  it('names every problem in one error, not just the first', () => {
    expect(() => assertSafeZipEntryPaths(['', '/abs.glb'])).toThrow(
      /is empty.*absolute/s
    );
  });
});
