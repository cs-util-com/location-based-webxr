/**
 * Why this test matters: the manifest's entry name is the contract between
 * the creator's finish step and the visitor's open path. If the two
 * disagree, placed content is invisible with no error anywhere - the
 * failure that looks like a pass. The round trip through the writer's
 * name and the reader's match is pinned here, together with the wrapped-
 * folder tolerance and the loud-on-broken rule.
 */

import { describe, expect, it } from 'vitest';

import {
  readTourManifestFromEntries,
  TOUR_MANIFEST_ENTRY,
  tourContentEntryName,
  tourManifestEntryOf,
} from './tour-archive';
import {
  parseTourManifest,
  TourManifestValidationError,
} from './tour-manifest';

describe('tourContentEntryName', () => {
  it('builds content/<id>.<ext> from a safe id and extension', () => {
    expect(tourContentEntryName('f1', 'jpg')).toBe('content/f1.jpg');
  });

  it.each([
    ['../x', 'jpg'],
    ['a/b', 'jpg'],
    ['', 'jpg'],
    ['ok', 'JPG'],
    ['ok', '../jpg'],
    ['ok', ''],
  ])('rejects an unsafe id or extension (%s, %s)', (id, ext) => {
    expect(() => tourContentEntryName(id, ext)).toThrow(TypeError);
  });
});

describe('tourManifestEntryOf', () => {
  it('finds the root manifest, tolerates a wrapping folder, prefers the fewest segments', () => {
    expect(tourManifestEntryOf([TOUR_MANIFEST_ENTRY, 'a.jpg'])).toBe(
      'tour.json'
    );
    expect(tourManifestEntryOf(['mytour/tour.json'])).toBe('mytour/tour.json');
    expect(tourManifestEntryOf(['mytour/tour.json', 'tour.json'])).toBe(
      'tour.json'
    );
    // Depth, not string length (M1 review #12): the shorter NAME is deeper.
    expect(
      tourManifestEntryOf(['x/y/tour.json', 'averylongfoldername/tour.json'])
    ).toBe('averylongfoldername/tour.json');
    expect(tourManifestEntryOf(['nottour.json', 'tour.jsonx'])).toBeNull();
  });
});

describe('readTourManifestFromEntries', () => {
  it('returns null when the archive has no manifest (a recorder zip is normal)', async () => {
    await expect(
      readTourManifestFromEntries(
        ['session.json'],
        () => Promise.reject(new Error('must not read')),
        parseTourManifest
      )
    ).resolves.toBeNull();
  });

  it('parses the manifest the writer named', async () => {
    const text = '{"version":1,"objects":[]}';
    await expect(
      readTourManifestFromEntries(
        [TOUR_MANIFEST_ENTRY],
        (name) => {
          expect(name).toBe('tour.json');
          return Promise.resolve(text);
        },
        parseTourManifest
      )
    ).resolves.toEqual({ version: 1, objects: [] });
  });

  it('REJECTS a manifest that exists but is broken - never a silently empty tour', async () => {
    await expect(
      readTourManifestFromEntries(
        ['tour.json'],
        () => Promise.resolve('{"version":9}'),
        parseTourManifest
      )
    ).rejects.toBeInstanceOf(TourManifestValidationError);
    await expect(
      readTourManifestFromEntries(
        ['tour.json'],
        () => Promise.resolve('not json'),
        parseTourManifest
      )
    ).rejects.toThrow();
  });
});
