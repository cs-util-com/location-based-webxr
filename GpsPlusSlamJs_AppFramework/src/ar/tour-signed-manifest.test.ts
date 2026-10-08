/**
 * Why this test matters: `manifest.json` is what a signature vouches for
 * (tour kit plan K1, §8 D3/D4). If the list of files and the archive can
 * disagree without the check noticing - a file added beside the listed
 * ones, a name spelled `./x` in one and `x` in the other, the same name
 * twice in the zip, a size that changed - a tour can carry content its
 * author never signed and still read as signed. Each canonicalisation rule
 * of §8 D4 is pinned here by the case it exists for.
 */

import { describe, expect, it } from 'vitest';

import {
  canonicalTourPath,
  checkEntriesAgainstManifest,
  MANIFEST_SIGNATURE_ENTRY,
  parseSignedTourManifest,
  serializeSignedTourManifest,
  signedManifestEntryOf,
  signedManifestFilesOf,
  SIGNED_MANIFEST_ENTRY,
  successorManifest,
  TourIntegrityError,
  type SignedTourManifest,
} from './tour-signed-manifest';

const H = (c: string): string => c.repeat(64);
const AUTHOR = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const manifestJson = {
  formatVersion: 1,
  seriesId: 'K7fQ2mX9pL4sT8vB1nR6wA',
  version: 3,
  createdAt: '2026-10-04T08:00:00.000Z',
  files: {
    'tour.json': { sha256: H('a'), size: 120 },
    'content/gate.jpg': { sha256: H('b'), size: 4096 },
  },
  links: [{ seriesId: 'Z9yX8wV7uT6sR5qP4oN3mL', author: AUTHOR }],
};

function manifest(extra: Record<string, unknown> = {}): SignedTourManifest {
  return parseSignedTourManifest(JSON.stringify({ ...manifestJson, ...extra }));
}

describe('canonicalTourPath', () => {
  it.each([
    ['tour.json', 'tour.json'],
    ['./tour.json', 'tour.json'],
    ['././a/./b.jpg', 'a/b.jpg'],
    ['wrap/content/x.png', 'wrap/content/x.png'],
  ])('normalises %j to %j', (name, canonical) => {
    expect(canonicalTourPath(name)).toBe(canonical);
  });

  it.each(['', '/abs', 'C:/x', 'a\\b', '../x', 'a/../b', 'a//b', 'dir/', '.'])(
    'refuses %j',
    (name) => {
      expect(canonicalTourPath(name)).toBeNull();
    }
  );
});

describe('parseSignedTourManifest', () => {
  it('reads every field, with the file paths canonical', () => {
    const parsed = manifest({
      files: { './tour.json': { sha256: H('a'), size: 0 } },
      recoveryKeyCommitment: H('c'),
    });
    expect(parsed).toEqual({
      formatVersion: 1,
      seriesId: 'K7fQ2mX9pL4sT8vB1nR6wA',
      version: 3,
      createdAt: '2026-10-04T08:00:00.000Z',
      files: { 'tour.json': { sha256: H('a'), size: 0 } },
      links: manifestJson.links,
      recoveryKeyCommitment: H('c'),
    });
  });

  it('defaults the links to none', () => {
    expect(manifest({ links: undefined }).links).toEqual([]);
  });

  it.each([
    ['not JSON', '{', /not readable JSON/],
    ['an array', '[]', /must be a JSON object/],
  ])('refuses %s', (_label, text, message) => {
    expect(() => parseSignedTourManifest(text)).toThrow(TourIntegrityError);
    expect(() => parseSignedTourManifest(text)).toThrow(message);
  });

  it.each([
    ['a newer format', { formatVersion: 2 }, /newer version of the app/],
    ['a missing format', { formatVersion: undefined }, /"formatVersion"/],
    ['a short series id', { seriesId: 'abc' }, /"seriesId"/],
    ['a version of 0', { version: 0 }, /"version"/],
    ['a fractional version', { version: 1.5 }, /"version"/],
    ['a bad timestamp', { createdAt: 'soon' }, /"createdAt"/],
    ['files that are not an object', { files: [] }, /"files"/],
    [
      'an unsafe file path',
      { files: { '../x': { sha256: H('a'), size: 1 } } },
      /"files" names an unsafe path "\.\.\/x"/,
    ],
    [
      'the same file under two spellings',
      {
        files: {
          'a.jpg': { sha256: H('a'), size: 1 },
          './a.jpg': { sha256: H('a'), size: 1 },
        },
      },
      /"files" lists "a\.jpg" twice/,
    ],
    [
      'the manifest listing itself',
      { files: { 'manifest.json': { sha256: H('a'), size: 1 } } },
      /must not list manifest\.json or manifest\.sig\.json/,
    ],
    [
      'the signature listed',
      { files: { './manifest.sig.json': { sha256: H('a'), size: 1 } } },
      /must not list manifest\.json or manifest\.sig\.json/,
    ],
    [
      'a hash that is not lowercase SHA-256 hex',
      { files: { 'a.jpg': { sha256: H('A'), size: 1 } } },
      /"files\.a\.jpg\.sha256"/,
    ],
    [
      'a negative size',
      { files: { 'a.jpg': { sha256: H('a'), size: -1 } } },
      /"files\.a\.jpg\.size"/,
    ],
    ['links that are not an array', { links: {} }, /"links"/],
    [
      'a link whose author is not an Ed25519 did:key',
      { links: [{ seriesId: 'Z9yX8wV7uT6sR5qP4oN3mL', author: 'did:web:x' }] },
      /"links\[0\]\.author"/,
    ],
    [
      'a recovery commitment that is not a SHA-256',
      { recoveryKeyCommitment: 'abc' },
      /"recoveryKeyCommitment"/,
    ],
  ])('refuses %s', (_label, extra, message) => {
    expect(() => manifest(extra)).toThrow(TourIntegrityError);
    expect(() => manifest(extra)).toThrow(message);
  });

  it('a malformed manifest is an integrity failure of kind "malformed-manifest"', () => {
    expect(() => manifest({ version: 0 })).toThrow(
      expect.objectContaining({ kind: 'malformed-manifest' })
    );
  });

  it('shows the first 64 links of a manifest that lists more, and stays valid (K1 milestone review R8)', () => {
    // Why: a signed list with a 65th link is not a modified tour. Failing
    // the whole manifest worded an honest (if long) list as tampering; the
    // reader shows the first 64 and ignores the rest, unread.
    const many = Array.from({ length: 70 }, (_, i) => ({
      seriesId: `Series${String(i).padStart(16, '0')}`,
      author: AUTHOR,
    }));
    many[66] = { seriesId: 'bad', author: 'not a did' }; // past the cap: never read
    const parsed = manifest({ links: many });
    expect(parsed.links).toHaveLength(64);
    expect(parsed.links[63]?.seriesId).toBe(many[63]?.seriesId);
  });

  it('the writer refuses more than 64 links, so the app never writes a list it would cut', () => {
    const tooMany = Array.from({ length: 65 }, () => ({
      seriesId: 'Z9yX8wV7uT6sR5qP4oN3mL',
      author: AUTHOR,
    }));
    expect(() =>
      serializeSignedTourManifest({ ...manifest(), links: tooMany })
    ).toThrow(/at most 64/);
  });

  it('serialize then parse is the identity', () => {
    const parsed = manifest();
    expect(
      parseSignedTourManifest(serializeSignedTourManifest(parsed))
    ).toEqual(parsed);
  });
});

describe('signedManifestEntryOf', () => {
  it('finds the manifest at the root, or in the shallowest wrapping folder', () => {
    expect(signedManifestEntryOf(['tour.json', 'manifest.json'])).toBe(
      'manifest.json'
    );
    expect(
      signedManifestEntryOf([
        'w/x/manifest.json',
        'w/manifest.json',
        'w/tour.json',
      ])
    ).toBe('w/manifest.json');
    expect(signedManifestEntryOf(['./manifest.json'])).toBe('./manifest.json');
    expect(signedManifestEntryOf(['tour.json'])).toBeNull();
    expect(signedManifestEntryOf(['notmanifest.json'])).toBeNull();
  });
});

describe('checkEntriesAgainstManifest (tier 1: names and sizes)', () => {
  const file = (filename: string, uncompressedSize: number) => ({
    filename,
    uncompressedSize,
  });
  const listed = manifest();
  const exact = [
    file('tour.json', 120),
    file('content/gate.jpg', 4096),
    file(SIGNED_MANIFEST_ENTRY, 999),
    file(MANIFEST_SIGNATURE_ENTRY, 99),
  ];

  function kindOf(run: () => unknown): string | null {
    try {
      run();
      return null;
    } catch (err) {
      return err instanceof TourIntegrityError ? err.kind : 'other';
    }
  }

  it('accepts an archive that is exactly the listed files, and maps each entry to its record', () => {
    const records = checkEntriesAgainstManifest(exact, listed, 'manifest.json');
    expect(records.get('content/gate.jpg')).toEqual({
      sha256: H('b'),
      size: 4096,
    });
    expect(records.has('manifest.json')).toBe(false);
  });

  it('ignores directory entries', () => {
    const withDirs = [
      ...exact,
      { filename: 'content/', uncompressedSize: 0, directory: true },
    ];
    expect(() =>
      checkEntriesAgainstManifest(withDirs, listed, 'manifest.json')
    ).not.toThrow();
  });

  it('reads names relative to the manifest folder, with ./ normalised', () => {
    const wrapped = [
      file('./w/tour.json', 120),
      file('w/./content/gate.jpg', 4096),
      file('w/manifest.json', 1),
    ];
    const records = checkEntriesAgainstManifest(
      wrapped,
      listed,
      'w/manifest.json'
    );
    expect(records.get('./w/tour.json')?.sha256).toBe(H('a'));
  });

  it.each([
    ['an extra file', [...exact, file('content/evil.jpg', 1)], 'unlisted-file'],
    [
      'a file outside the manifest folder',
      [
        file('w/tour.json', 120),
        file('w/content/gate.jpg', 4096),
        file('x.jpg', 1),
      ],
      'unlisted-file',
    ],
    ['a missing file', exact.slice(1), 'missing-file'],
    [
      'a changed size',
      [file('tour.json', 121), ...exact.slice(1)],
      'size-mismatch',
    ],
    [
      'the same name twice',
      [...exact, file('tour.json', 120)],
      'duplicate-name',
    ],
    [
      'the same file under two spellings',
      [...exact, file('./tour.json', 120)],
      'duplicate-name',
    ],
    ['an unsafe name', [...exact, file('../up.jpg', 1)], 'unsafe-name'],
  ])('refuses %s', (_label, entries, kind) => {
    const folder = (entries as { filename: string }[]).some((e) =>
      e.filename.startsWith('w/')
    )
      ? 'w/manifest.json'
      : 'manifest.json';
    expect(
      kindOf(() => checkEntriesAgainstManifest(entries, listed, folder))
    ).toBe(kind);
  });
});

describe('successorManifest (K1 milestone review R7)', () => {
  // Why this matters: a writer that changes a tour (the creator's Finish)
  // used to DROP manifest.json, and with it the series id's only home: the
  // next version was a stranger to the phones that knew the series, and a
  // file-opened draft lost its key. The successor keeps the series, counts
  // the version up and lists exactly the files the new archive holds.
  const base = manifest();
  const record = { sha256: H('c'), size: 7 };

  it('keeps the series, counts the version up, and lists the new files relative to the manifest folder', () => {
    const next = successorManifest(base, 'mytour/manifest.json', {
      removed: ['mytour/content/gate.jpg'],
      written: new Map([
        ['mytour/tour.json', record],
        ['./mytour/qr/abc.json', record],
      ]),
      createdAt: '2026-10-05T09:00:00.000Z',
    });
    expect(next).toEqual({
      ...base,
      version: base.version + 1,
      createdAt: '2026-10-05T09:00:00.000Z',
      files: { 'tour.json': record, 'qr/abc.json': record },
    });
    // It is a valid manifest the writer accepts.
    expect(parseSignedTourManifest(serializeSignedTourManifest(next))).toEqual(
      next
    );
  });

  it('starts from the given files when a later Finish rebuilds from an earlier one', () => {
    const next = successorManifest(base, 'manifest.json', {
      baseFiles: { 'a.jpg': record },
      removed: [],
      written: new Map([['b.jpg', record]]),
      createdAt: '2026-10-05T09:00:00.000Z',
    });
    expect(next.version).toBe(base.version + 1);
    expect(Object.keys(next.files).sort()).toEqual(['a.jpg', 'b.jpg']);
  });

  it.each([
    ['outside the manifest folder', 'other/tour.json'],
    ['an unsafe name', 'mytour/../x.json'],
    ['the manifest itself', 'mytour/manifest.json'],
  ])('refuses to list a written name %s', (_label, name) => {
    expect(() =>
      successorManifest(base, 'mytour/manifest.json', {
        removed: [],
        written: new Map([[name, record]]),
        createdAt: '2026-10-05T09:00:00.000Z',
      })
    ).toThrow();
  });
});

describe('signedManifestFilesOf', () => {
  it('names the manifest and the signature next to it, as the archive spells them', () => {
    expect(
      signedManifestFilesOf([
        'w/tour.json',
        './w/manifest.json',
        'w/./manifest.sig.json',
        'other/manifest.sig.json',
      ])
    ).toEqual(['./w/manifest.json', 'w/./manifest.sig.json']);
    expect(signedManifestFilesOf(['tour.json'])).toEqual([]);
  });
});
