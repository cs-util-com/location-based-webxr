/**
 * Why this test matters: the rebuild is what turns "the creator measured
 * the code" into a hosted zip a visitor can open. It must add or replace
 * exactly the named entries, keep every other entry byte-identical (a
 * recorder zip's photos and action stream ride through it), keep STORE
 * mode (the range reader depends on it), accept whatever entry names the
 * hosted archive already had (M1 review #2), and THROW on failure rather
 * than hand back the input - a creator who uploads the old zip believing
 * it is the new one has lost the measuring session with no error anywhere.
 */

import {
  BlobReader,
  BlobWriter,
  TextReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';

import { packFilesAsZip, ZipPackagingError } from './pack-files-as-zip';
import { readStoredCentralDirectory } from '../test-utils/zip-central-directory';
import { rebuildZipWithEntries } from './zip-rebuild';

async function entryBytes(zip: Blob): Promise<Map<string, Uint8Array>> {
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const out = new Map<string, Uint8Array>();
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      out.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    return out;
  } finally {
    await reader.close();
  }
}

const PHOTO = new Uint8Array(512).map((_, i) => (i * 7) % 256);
/** Larger than zip.js's 512 KiB chunk, so the carried-entry path is proven
 *  across chunk boundaries (M1 review #11). */
const BIG = new Uint8Array(1_200_000).map((_, i) => (i * 31 + 7) % 256);

async function recordingLikeZip(): Promise<Blob> {
  return packFilesAsZip([
    { path: 'session.json', data: '{"odomCoordVersion":2}' },
    { path: 'actions/000001.json', data: '[{"type":"x"}]' },
    { path: 'images/frame_000001.jpg', data: PHOTO },
  ]);
}

describe('rebuildZipWithEntries', () => {
  it('adds new entries and keeps every existing entry byte-identical', async () => {
    const input = await recordingLikeZip();
    const out = await rebuildZipWithEntries(input, [
      { path: 'qr/abc123.json', data: '{"version":1}' },
      { path: 'tour.json', data: '{"version":1,"objects":[]}' },
    ]);
    const before = await entryBytes(input);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual([
      'actions/000001.json',
      'images/frame_000001.jpg',
      'qr/abc123.json',
      'session.json',
      'tour.json',
    ]);
    for (const [name, bytes] of before) {
      expect(after.get(name)).toEqual(bytes);
    }
    expect(new TextDecoder().decode(after.get('tour.json'))).toBe(
      '{"version":1,"objects":[]}'
    );
  });

  it('carries a multi-chunk entry byte-identical (Blob-backed, off the JS heap)', async () => {
    const input = await packFilesAsZip([{ path: 'images/big.jpg', data: BIG }]);
    const out = await rebuildZipWithEntries(input, [
      { path: 'tour.json', data: '{}' },
    ]);
    expect((await entryBytes(out)).get('images/big.jpg')).toEqual(BIG);
  });

  it('replaces an entry that already exists at the same path, once', async () => {
    const input = await packFilesAsZip([
      { path: 'tour.json', data: '{"version":1,"objects":[]}' },
      { path: 'content/a.jpg', data: PHOTO },
    ]);
    const out = await rebuildZipWithEntries(input, [
      { path: 'tour.json', data: '{"version":1,"objects":[{"id":"a"}]}' },
    ]);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual(['content/a.jpg', 'tour.json']);
    expect(new TextDecoder().decode(after.get('tour.json'))).toContain(
      '"id":"a"'
    );
    const central = readStoredCentralDirectory(
      new Uint8Array(await out.arrayBuffer())
    );
    expect(central.filter((e) => e.name === 'tour.json')).toHaveLength(1);
  });

  it('keeps STORE mode for carried-over and new entries alike', async () => {
    const out = await rebuildZipWithEntries(await recordingLikeZip(), [
      { path: 'tour.json', data: '{}' },
    ]);
    const central = readStoredCentralDirectory(
      new Uint8Array(await out.arrayBuffer())
    );
    expect(central).toHaveLength(4);
    for (const entry of central) expect(entry.stored).toBe(true);
  });

  it('accepts a zero-entry input archive (the starter zip after a fresh pack)', async () => {
    const out = await rebuildZipWithEntries(await packFilesAsZip([]), [
      { path: 'tour.json', data: '{}' },
    ]);
    expect([...(await entryBytes(out)).keys()]).toEqual(['tour.json']);
  });

  it('re-emits an archive whose existing names would fail the author-path rules, collapsing a duplicate name to its last occurrence (M1 review #2)', async () => {
    // Hand-built: a `./`-prefixed name and the same name twice - legal ZIP,
    // produced by real tools, and not the creator's fault.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./odd.txt', new TextReader('odd'));
    await writer.add('twice.txt', new TextReader('first'));
    // zip.js refuses a duplicate name; the rebuild must cope with one from
    // another tool, so the second add is attempted and its refusal ignored.
    await writer
      .add('twice.txt', new TextReader('second'))
      .catch(() => undefined);
    const input = await writer.close();
    const out = await rebuildZipWithEntries(input, [
      { path: 'tour.json', data: '{}' },
    ]);
    const after = await entryBytes(out);
    expect(after.has('./odd.txt')).toBe(true);
    expect(after.has('tour.json')).toBe(true);
    const twice = after.get('twice.txt');
    expect(twice).toBeDefined();
    // Whichever copies zip.js let through, exactly ONE survives.
    const central = readStoredCentralDirectory(
      new Uint8Array(await out.arrayBuffer())
    );
    expect(central.filter((e) => e.name === 'twice.txt')).toHaveLength(1);
  });

  it('REPLACES an archive-derived name the author rules would refuse (PR #438 review)', async () => {
    // The rule this module already states - "an archive that opened is
    // re-emitted as it is, whatever its entry names" - was applied to
    // CARRIED entries only. A caller that replaces an existing entry has to
    // name it, and the name it must use is the archive's own; that name
    // then went through the NEW-entry validation and was refused.
    //
    // The live case: the coverage backfill finds session.json by suffix, so
    // it deliberately tolerates an entry named `./session.json` - and then
    // could not write it back, because a leading `.` segment is exactly
    // what the new-path rules reject. The recording was silently skipped
    // with a log line.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./session.json', new TextReader('{"a":1}'));
    await writer.add('keep.txt', new TextReader('keep'));
    const input = await writer.close();

    const out = await rebuildZipWithEntries(input, [
      { path: './session.json', data: '{"a":2}' },
    ]);
    const after = await entryBytes(out);
    // Replaced in place, at the name the archive used - not moved.
    expect(new TextDecoder().decode(after.get('./session.json'))).toBe(
      '{"a":2}'
    );
    expect(after.has('keep.txt')).toBe(true);
  });

  it("ADDS a new entry under the archive's own ./ convention (the finish's photos)", async () => {
    // Why this test matters: replacing an entry by the name the archive
    // already carries was the first half of this fix. This is the other,
    // and it is the one that dead-ends a creator. The Tour Viewer's finish
    // builds each captured photo's path from the prefix it found the
    // manifest at, so in a `./`-written zip it invents
    // `./content/<id>.jpg` - a path no archive entry carries yet, refused
    // for its `.` segment, throwing at the exact moment the creator has
    // finished walking their tour. A new path that follows the archive's
    // own convention is not a traversal attempt.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./tour.json', new TextReader('{"version":1}'));
    await writer.add('./content/old.jpg', new TextReader('old'));
    const input = await writer.close();

    const out = await rebuildZipWithEntries(input, [
      { path: './tour.json', data: '{"version":2}' },
      { path: './content/new.jpg', data: PHOTO },
      { path: './qr/abc123.json', data: '{"version":1}' },
    ]);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual([
      './content/new.jpg',
      './content/old.jpg',
      './qr/abc123.json',
      './tour.json',
    ]);
    expect(new TextDecoder().decode(after.get('./tour.json'))).toBe(
      '{"version":2}'
    );
    expect(after.get('./content/new.jpg')).toEqual(PHOTO);
  });

  it('REPLACES a ./ entry when the caller names it without the prefix', async () => {
    // Why this test matters: the tolerance was applied to the duplicate
    // check but not to the archive lookup, so a caller naming the file the
    // other way round got BOTH entries written - `./session.json` carried
    // through untouched and `session.json` added beside it. Every reader,
    // including this package's own suffix-based finders, treats those as
    // one file, so the archive would silently carry two versions of it and
    // which one wins is the extractor's choice.
    //
    // The rule is that the archive's convention decides: a file the archive
    // already holds is replaced IN PLACE, at the archive's own name,
    // whichever way the caller spells it.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./session.json', new TextReader('{"a":1}'));
    await writer.add('./keep.txt', new TextReader('keep'));
    const input = await writer.close();

    const out = await rebuildZipWithEntries(input, [
      { path: 'session.json', data: '{"a":2}' },
    ]);
    const after = await entryBytes(out);
    expect([...after.keys()].sort()).toEqual(['./keep.txt', './session.json']);
    expect(new TextDecoder().decode(after.get('./session.json'))).toBe(
      '{"a":2}'
    );
  });

  it('does NOT extend that tolerance to a FLAT archive', async () => {
    // Why: the tolerance is for following the archive's convention, not a
    // hole in the path rules. A zip whose entries are flat gives a caller
    // no reason to write `./anything`, and the `.` segment is refused
    // exactly as before.
    const input = await packFilesAsZip([{ path: 'tour.json', data: '{}' }]);
    await expect(
      rebuildZipWithEntries(input, [{ path: './content/a.jpg', data: PHOTO }])
    ).rejects.toThrow(ZipPackagingError);
  });

  it('refuses ./x and x together, which are one file to every reader', async () => {
    // Why this test matters: the two are different STRINGS, so a duplicate
    // check on the raw path lets both through - and the output then carries
    // two entries that every extractor, and this package's own suffix-based
    // finders, treat as one file. The check compares the normalised form.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./session.json', new TextReader('{"a":1}'));
    const input = await writer.close();

    await expect(
      rebuildZipWithEntries(input, [
        { path: './session.json', data: '{"a":2}' },
        { path: 'session.json', data: '{"a":3}' },
      ])
    ).rejects.toThrow(/duplicate entry path/);
  });

  it('still THROWS on an unsafe name the archive does NOT already carry', async () => {
    // The other half, and the reason the validation exists: re-emitting a
    // name the input already had is no new hazard, but INVENTING one is.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('keep.txt', new TextReader('keep'));
    const input = await writer.close();
    await expect(
      rebuildZipWithEntries(input, [{ path: '../escape.json', data: '{}' }])
    ).rejects.toThrow(/unsafe zip entry path/);
  });
  it('still refuses a duplicate or an unwritable payload among archive-derived names', async () => {
    // The relaxation is about the SHAPE of a name and nothing else. Both
    // of these were briefly let through when the filter that skips the
    // path rules skipped the other two checks with them.
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    await writer.add('./session.json', new TextReader('{}'));
    const input = await writer.close();
    await expect(
      rebuildZipWithEntries(input, [
        { path: './session.json', data: '{}' },
        { path: './session.json', data: '{}' },
      ])
    ).rejects.toThrow(/duplicate entry path/);
    await expect(
      rebuildZipWithEntries(input, [
        { path: './session.json', data: undefined as unknown as string },
      ])
    ).rejects.toThrow(/no writable data/);
  });
  it('reports progress as entries READ over the count the output will have (a replacement is not counted twice)', async () => {
    const seen: [number, number][] = [];
    await rebuildZipWithEntries(
      await recordingLikeZip(),
      [
        { path: 'session.json', data: '{"replaced":true}' },
        { path: 'tour.json', data: '{}' },
      ],
      { onProgress: (done, total) => seen.push([done, total]) }
    );
    // 3 existing - 1 replaced + 2 new = 4 in the output.
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [4, 4],
    ]);
  });

  it('THROWS on an unsafe new path, an unwritable payload, and a non-zip input - never returns the input', async () => {
    const input = await recordingLikeZip();
    await expect(
      rebuildZipWithEntries(input, [{ path: '../evil', data: 'x' }])
    ).rejects.toBeInstanceOf(ZipPackagingError);
    await expect(
      rebuildZipWithEntries(input, [
        { path: 'tour.json', data: undefined as unknown as string },
      ])
    ).rejects.toThrow(/no writable data/);
    await expect(
      rebuildZipWithEntries(new Blob(['not a zip at all']), [
        { path: 'tour.json', data: '{}' },
      ])
    ).rejects.toBeInstanceOf(ZipPackagingError);
  });
});
