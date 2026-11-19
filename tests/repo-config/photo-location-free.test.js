// Repo-meta test: no tracked JPEG carries a location.
//
// Why this test matters: a phone photo carries where it was taken in its
// metadata (an Exif GPS block, often an XMP copy too), and nothing in a diff
// shows it: the picture looks the same with or without it. A photo committed
// to this public repository with its metadata publishes that place for good.
// So every tracked JPEG is read here at the byte level (jpeg-location.js),
// and the failure names the file only, never a value from it: the fix is to
// strip the photo's metadata before committing it.
//
// Coverage limits: tracked files only (a new photo counts once it is added),
// JPEG only (PNG, HEIC, WebP and MP4 are not read), and by extension. A file
// that cannot be read as a JPEG fails too, since a file nobody could check is
// not a clean one; so does one with a metadata segment of a kind outside the
// reader's allowlist (jpeg-location.js.md).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { jpegLocation } from './jpeg-location.js';
import { repoRoot, trackedFiles } from './tracked-tree.js';

describe('tracked photos carry no location', () => {
  it('no tracked JPEG has an Exif GPS block or an XMP location', () => {
    const photos = trackedFiles(':(icase)*.jpg', ':(icase)*.jpeg');
    /** @type {string[]} */
    const problems = [];
    for (const file of photos) {
      const result = jpegLocation(readFileSync(join(repoRoot, file)));
      if (!result.readable) problems.push(`${file}: could not be read (${result.reason})`);
      else if (result.exifGps) problems.push(`${file}: has an Exif GPS block`);
      else if (result.xmpGps) problems.push(`${file}: has a location in its XMP`);
    }
    expect(problems, 'strip these photos of their metadata before committing them').toEqual([]);
  });
});
