import { describe, expect, it } from 'vitest';

import { assertSafeZipEntryPaths } from './zip-entry-path.js';

describe('assertSafeZipEntryPaths', () => {
  it('rejects an empty path', () => {
    expect(() => assertSafeZipEntryPaths([''])).toThrow(/empty/);
  });

  it('rejects a path colliding with a reserved name', () => {
    expect(() => assertSafeZipEntryPaths(['tour.json'], ['tour.json'])).toThrow(
      /tour\.json/
    );
  });

  it('allows a path that does not collide with a reserved name', () => {
    expect(() =>
      assertSafeZipEntryPaths(['assets/a.png'], ['tour.json'])
    ).not.toThrow();
  });

  it.each([
    ['a parent-directory escape', '../escape.glb'],
    ['an absolute path', '/abs.glb'],
    ['a drive-lettered path', 'C:/abs.glb'],
    ['a backslash separator', 'assets\\gate.png'],
  ])('rejects %s', (_label, path) => {
    expect(() => assertSafeZipEntryPaths([path])).toThrow();
  });

  it('rejects a duplicate path instead of silently overwriting an entry', () => {
    expect(() =>
      assertSafeZipEntryPaths(['assets/same.bin', 'assets/same.bin'])
    ).toThrow(/assets\/same\.bin/);
  });

  it('names every problem in one error, not just the first', () => {
    expect(() => assertSafeZipEntryPaths(['', '/abs.glb'])).toThrow(
      /is empty.*is an absolute path/s
    );
  });
});
