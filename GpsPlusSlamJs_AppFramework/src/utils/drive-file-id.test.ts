/**
 * The one Google Drive file-id parser (Tour Viewer M0c follow-up F3, root
 * CLAUDE.md DEC-H3).
 *
 * Why these tests matter: four modules read a Drive file id from a link -
 * the share-link normaliser, the QR launch URL's short form, the Tour
 * Viewer's print spelling and its tour label - each with its own coverage.
 * A spelling one of them missed printed a code under another identity or
 * opened nothing. One parser, one table of every spelling Drive and this
 * app hand out.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { driveFileId } from './drive-file-id';

const ID = '1A4mU8eV16aaIvy6Msd76RC3_cbbftRkX';

describe('driveFileId', () => {
  it.each([
    [
      'the desktop copy-link',
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    ],
    [
      'the phone share',
      `https://drive.google.com/file/d/${ID}/view?usp=drivesdk`,
    ],
    [
      'the newer copy-link',
      `https://drive.google.com/file/d/${ID}/view?usp=drive_link`,
    ],
    ['the bare address', `https://drive.google.com/file/d/${ID}`],
    ['the editor', `https://drive.google.com/file/d/${ID}/edit`],
    ['open?id=', `https://drive.google.com/open?id=${ID}`],
    [
      'open?id= from Drive for desktop',
      `https://drive.google.com/open?id=${ID}&usp=drive_fs`,
    ],
    ['uc?id=', `https://drive.google.com/uc?id=${ID}&export=download`],
    [
      'the usercontent download',
      `https://drive.usercontent.google.com/download?id=${ID}&confirm=t`,
    ],
    [
      'the Drive API',
      `https://www.googleapis.com/drive/v3/files/${ID}?alt=media`,
    ],
    [
      'the site worker proxy',
      `https://gps.csutil.com/api/drive-proxy?id=${ID}`,
    ],
  ])('reads the id from %s', (_label, link) => {
    expect(driveFileId(link)).toBe(ID);
  });

  it('resolves a relative proxy path against a base', () => {
    expect(
      driveFileId(`/api/drive-proxy?id=${ID}`, 'https://gps.csutil.com/tour/')
    ).toBe(ID);
    expect(driveFileId(`/api/drive-proxy?id=${ID}`)).toBeNull();
  });

  it.each([
    ['another host', 'https://example.com/file/d/abc/view'],
    ['a Drive folder', 'https://drive.google.com/drive/folders/abc'],
    ['a Drive link without an id', 'https://drive.google.com/open'],
    ['an empty id', 'https://drive.google.com/open?id='],
    ['an id outside Drive alphabet', 'https://drive.google.com/open?id=a%20b'],
    ['not a link', 'not a link'],
    ['?id= on another host', 'https://example.com/?id=abc'],
  ])('is null for %s', (_label, link) => {
    expect(driveFileId(link)).toBeNull();
  });

  it('accepts a URL object as well as a string', () => {
    expect(driveFileId(new URL(`https://drive.google.com/file/d/${ID}`))).toBe(
      ID
    );
  });

  // The property every caller relies on: an id it hands back can go into a
  // path or a query unescaped.
  it('only ever returns ids of letters, digits, - and _ (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (tail) => {
        const id = driveFileId(
          `https://drive.google.com/open?id=${encodeURIComponent(tail)}`
        );
        expect(id === null || /^[\w-]+$/.test(id)).toBe(true);
      })
    );
  });
});
