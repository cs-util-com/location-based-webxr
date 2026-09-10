/**
 * `rebuildZipWithEntries` - a new zip from an existing one plus entries
 * added or replaced by path. The Tour Viewer's finish step writes the
 * measured code (`qr/<id>.json`), the content manifest (`tour.json`) and
 * the captured photos into the zip the creator hosted; the coverage embed
 * (`zip-coverage-embed.ts`) replaces `session.json` through the same loop.
 *
 * It is a pure transform `(zip, entries) -> zip`: every entry of the input
 * is read and re-emitted uncompressed through the store-mode writer, so
 * untouched entries stay byte-identical and the archive stays range-
 * readable. Unlike the coverage embed's wrapper it NEVER returns the input
 * on failure - it throws. The caller here is a creator about to upload the
 * result over the hosted file, and an old zip handed back as "rebuilt"
 * would lose the measuring session silently.
 *
 * Two rules from the M1 review of the guided-setup plan:
 * - Carried entries are read into BLOBS, not `Uint8Array`s: a browser keeps
 *   Blobs off the JS heap, so the peak cost is the output archive, not the
 *   input twice over (review #1; a recorder zip is hundreds of photos).
 * - An archive that opened is re-emitted as it is, whatever its entry
 *   names (review #2): a duplicate name or a `./` segment in a hosted zip
 *   is not the creator's fault, and a rebuild that refused it would
 *   dead-end the setup. Duplicate names in the input collapse to the LAST
 *   occurrence, which is what readers resolve.
 * - New entries are validated, but under the ARCHIVE'S OWN convention: in
 *   a zip whose entries carry a leading `./`, a new path with that prefix
 *   is following the archive rather than inventing a traversal segment, so
 *   it is checked with the prefix removed. Everything else about the name
 *   is checked as usual, and duplicates are compared on the normalised
 *   form so `./x` and `x` cannot both be written.
 * - That convention also decides WHERE a new name lands: it joins its
 *   neighbours under the prefix when every existing entry carries one, and
 *   is otherwise written exactly as the caller spelled it. A mixed archive
 *   has no convention to guess at.
 */

import {
  BlobReader,
  BlobWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js';

import {
  assertSafeNewZipPaths,
  assertWritableZipData,
  writeStoreZip,
  ZipPackagingError,
  type ZipEntryInput,
} from './pack-files-as-zip.js';

/**
 * The prefix some zip tools put on every entry. An archive written that way
 * is legal and this module has always re-emitted it; what changed in r665
 * is that a CALLER following the same convention for a NEW entry is no
 * longer refused.
 */
const DOT_SLASH = './';

/** Does this archive write ANY entry with a leading `./`? Enough to accept
 *  a new path that carries one: the caller derived that prefix from the
 *  archive rather than inventing it. */
function archiveUsesDotSlash(archiveNames: readonly string[]): boolean {
  return archiveNames.some((name) => name.startsWith(DOT_SLASH));
}

/** Does EVERY entry carry it? A stricter question, and the one that decides
 *  whether an unprefixed NEW name is moved under the prefix. A mixed
 *  archive has no convention to follow, so nothing is guessed there: the
 *  name is written as the caller spelled it. */
function archiveIsAllDotSlash(archiveNames: readonly string[]): boolean {
  return (
    archiveNames.length > 0 &&
    archiveNames.every((name) => name.startsWith(DOT_SLASH))
  );
}

/**
 * The path as the rules should see it: with the archive's own `./` prefix
 * removed, when the archive uses one. Everything else is left alone - this
 * is a tolerance for ONE known convention, not a normaliser.
 */
function underArchiveConvention(path: string, dotSlash: boolean): string {
  return dotSlash && path.startsWith(DOT_SLASH)
    ? path.slice(DOT_SLASH.length)
    : path;
}

/** Two new entries at the same path would be written twice. The shared path
 *  checker cannot see this once archive-derived names are filtered out of
 *  it, so the rebuild states the rule for itself - and compares the
 *  NORMALISED form, because `./session.json` and `session.json` are one
 *  file to every reader and would otherwise both be written. */
function assertNoDuplicateNewPaths(
  entries: readonly ZipEntryInput[],
  dotSlash: boolean
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = underArchiveConvention(entry.path, dotSlash);
    if (seen.has(key)) {
      throw new ZipPackagingError(
        `rebuildZipWithEntries: entry '${entry.path}' is a duplicate entry path`
      );
    }
    seen.add(key);
  }
}

export interface RebuildZipOptions {
  /** Called after each carried-over entry is read (`done` = entries read
   *  so far, `total` = the entry count the OUTPUT will have), and once more
   *  with `done === total` after the archive is written. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Re-emit `zip` with `entries` added, replacing any existing entry at the
 * same path. Directory entries of the input are dropped (paths stay
 * implied by file names, as every writer in this package does).
 *
 * @throws {ZipPackagingError} when `zip` is not a readable archive, when a
 *   NEW entry path is unsafe or duplicated or its data is not writable, or
 *   when writing fails. Nothing partial is ever returned.
 */
export async function rebuildZipWithEntries(
  zip: Blob,
  entries: readonly ZipEntryInput[],
  options: RebuildZipOptions = {}
): Promise<Blob> {
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const all = lastOccurrences(
      (await reader.getEntries()).filter((e): e is FileEntry => !e.directory)
    );
    // Validate only the names this call INVENTS. A caller replacing an
    // existing entry has to name it, and the only name that works is the
    // archive's own - so validating that name applied the module's own rule
    // backwards and refused to write back a name it had just read. The live
    // case was the coverage backfill: it finds `session.json` by suffix, so
    // it tolerates `./session.json`, and then could not re-emit it - the
    // recording was skipped with a log line and no other trace (PR #438
    // review). Re-emitting a name the input already carried is no new
    // hazard; inventing one is, and that is still refused.
    const archiveNameList = all.map((e) => e.filename);
    const dotSlash = archiveUsesDotSlash(archiveNameList);
    const allDotSlash = archiveIsAllDotSlash(archiveNameList);
    // Which archive entry each name REFERS to, keyed on the normalised
    // form. One map rather than a bare name set, because every downstream
    // question is the same question - "does the archive already hold this
    // file?" - and asking it three different ways is what let `./x` and
    // `x` both be written (PR #439 review #1).
    const archiveByName = new Map(
      all.map((e) => [underArchiveConvention(e.filename, dotSlash), e.filename])
    );
    // Every new entry lands under the archive's convention, and the rule is
    // applied to ALL of them rather than only to the ones the archive
    // already holds (PR #440 review): a caller that names an existing file
    // either way replaces rather than duplicates, and a genuinely new file
    // goes in prefixed like its neighbours instead of leaving a flat name
    // in an otherwise `./`-written archive - the mixed archive this
    // module's own suffix-based finders exist to cope with.
    //
    // Moving a new name requires EVERY existing entry to carry the prefix,
    // not merely one of them. An archive that is already mixed has no
    // convention to follow, so nothing is guessed there and the name is
    // written as the caller spelled it. An existing test of exactly that
    // shape is what caught the wider rule.
    const targeted = entries.map((e) => {
      const key = underArchiveConvention(e.path, dotSlash);
      const existing = archiveByName.get(key);
      if (existing !== undefined) return { ...e, path: existing };
      // A genuinely new name. Under a uniformly `./`-written archive it
      // joins its neighbours; anywhere else it is written EXACTLY as the
      // caller spelled it - `e.path`, not `key`, which is the caller's
      // path with the prefix already stripped off by the lookup above.
      // Writing `key` in a mixed archive silently un-prefixed a path the
      // caller had supplied, and that is a live route: the Tour Viewer
      // builds each photo's path from the prefix it found the manifest at,
      // and the reader looks it up by exact name (PR #441 review).
      return {
        ...e,
        path: allDotSlash ? DOT_SLASH + key : e.path,
      };
    });
    assertSafeNewZipPaths(
      targeted
        .filter(
          (e) => !archiveByName.has(underArchiveConvention(e.path, dotSlash))
        )
        // ...checked under the archive's own convention, because the Tour
        // Viewer's finish builds each new photo's path from the prefix it
        // found the manifest at. In a `./`-written zip that prefix is
        // `./`, so `./content/<id>.jpg` is a path this call INVENTS, is
        // refused for its `.` segment, and dead-ends the creator's setup
        // at the moment they have finished walking. Replacing an existing
        // entry was fixed first (PR #438); this is the other half.
        .map((e) => ({
          ...e,
          path: underArchiveConvention(e.path, dotSlash),
        })),
      'rebuildZipWithEntries'
    );
    // The relaxation above is about the SHAPE of a name and nothing else.
    // Duplicates among the new entries, and payloads that cannot be
    // written, still apply to every one of them - a name the archive
    // happens to carry says nothing about the bytes behind it.
    assertNoDuplicateNewPaths(entries, dotSlash);
    assertWritableZipData(entries, 'rebuildZipWithEntries');
    const replaced = new Set(targeted.map((e) => e.path));
    const existing = all.filter((e) => !replaced.has(e.filename));
    const total = existing.length + targeted.length;
    const carried: ZipEntryInput[] = [];
    for (const entry of existing) {
      carried.push({
        path: entry.filename,
        data: await entry.getData(new BlobWriter()),
      });
      options.onProgress?.(carried.length, total);
    }
    const out = await writeStoreZip(
      [...carried, ...targeted],
      'rebuildZipWithEntries'
    );
    options.onProgress?.(total, total);
    return out;
  } catch (err) {
    if (err instanceof ZipPackagingError) throw err;
    throw new ZipPackagingError(
      `rebuildZipWithEntries: reading the archive failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    );
  } finally {
    await reader.close();
  }
}

/** Input order, each name once, the LAST occurrence kept. */
function lastOccurrences(entries: readonly FileEntry[]): FileEntry[] {
  const byName = new Map<string, FileEntry>();
  for (const entry of entries) byName.set(entry.filename, entry);
  return [...byName.values()];
}
