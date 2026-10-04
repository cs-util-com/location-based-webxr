/**
 * `manifest.json`, the list of a tour archive's files that a signature
 * vouches for (tour kit plan K1, §4.1, §8 D3/D4/G7): every file's SHA-256
 * and size, the tour's series id and version number (their one place,
 * G7), links to other series, and a reserved recovery-key commitment.
 * `manifest.sig.json` (`tour-signature.ts`) signs the exact bytes of this
 * file; this module reads it and checks an archive's entry list against
 * it. Pure: no I/O, no crypto, no zip library (entry NAMES and SIZES in).
 *
 * THE CANONICALISATION RULES (§8 D4), because a signature over a list is
 * only as strong as the agreement on what the list's names mean:
 * - a path is taken relative to the manifest's own folder, with `./`
 *   segments normalised away (`./a/./b` is `a/b`): re-zipping a folder may
 *   add or drop a wrapping folder and a leading `./`;
 * - any other unusual name (absolute, a drive letter, a backslash, `..`, an
 *   empty segment) is refused outright in a signed archive;
 * - the same canonical name twice is refused - in the zip (two entries a
 *   reader could pick between) and in the list (two records for one file);
 * - directory entries are ignored (a re-zip may or may not add them);
 * - the manifest and its signature are never listed in `files` (a file
 *   cannot contain its own hash, and the signature is made after it).
 *
 * The hashes are of the DECOMPRESSED bytes read through the same zip.js
 * path the reader uses (the K0 capped readers): what is checked is what a
 * visitor is shown, not whatever compression a host or a re-zip chose.
 */

import { isDidKeyEd25519 } from '../utils/did-key.js';
import { isFiniteNumber, isRecord } from '../utils/json-guards.js';

/** The list's entry name, in the tour's folder. */
export const SIGNED_MANIFEST_ENTRY = 'manifest.json';
/** The signature's entry name, next to the list. */
export const MANIFEST_SIGNATURE_ENTRY = 'manifest.sig.json';
/** The format of `manifest.json` this module reads. */
const SIGNED_MANIFEST_FORMAT = 1;
/**
 * Links to other series one manifest may carry. The castle example links
 * none to two; 64 is a list a phone screen can still show, and the bound
 * keeps a crafted file from filling the page with links. Reverses for a
 * creator who links more than 64 of their own series from one tour (none
 * exists yet: K2 creates the first keys).
 */
const MAX_SERIES_LINKS = 64;

export interface TourFileRecord {
  /** Lowercase hex SHA-256 of the decompressed bytes. */
  readonly sha256: string;
  /** Decompressed size in bytes. */
  readonly size: number;
}

/** A link to another series (§1.2: a creator links their own tours). */
interface TourSeriesLink {
  readonly seriesId: string;
  /** The linked series' author, as an Ed25519 `did:key`. */
  readonly author: string;
}

export interface SignedTourManifest {
  /** `SIGNED_MANIFEST_FORMAT`, the one format this module reads. */
  readonly formatVersion: 1;
  /** Random, stable across every version of one tour. */
  readonly seriesId: string;
  /** Grows with every published version (the rollback check is K3's). */
  readonly version: number;
  readonly createdAt: string;
  /** Canonical path (relative to the manifest's folder) -> record. */
  readonly files: Readonly<Record<string, TourFileRecord>>;
  readonly links: readonly TourSeriesLink[];
  /**
   * RESERVED (K-D2, K-D8): the SHA-256 (hex) of the spare key's `did:key`,
   * named in advance so a stolen main key can later be replaced by it.
   * Read and shape-checked; nothing acts on it until the rotation step.
   */
  readonly recoveryKeyCommitment?: string;
}

export type TourIntegrityKind =
  | 'malformed-manifest'
  | 'newer-format'
  | 'malformed-signature'
  | 'bad-signature'
  | 'unsafe-name'
  | 'duplicate-name'
  | 'unlisted-file'
  | 'missing-file'
  | 'size-mismatch'
  | 'hash-mismatch';

/**
 * The archive does not match what its manifest (or its signature) says -
 * a hard "modified, do not trust" failure (§4.2). The message is the
 * technical detail; the page words the failure for a visitor.
 */
export class TourIntegrityError extends Error {
  override readonly name = 'TourIntegrityError';
  readonly kind: TourIntegrityKind;

  constructor(kind: TourIntegrityKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Random series ids: 16-64 base64url characters (K2 writes 22: 128 bits). */
const SERIES_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The canonical form of an archive path - `./` segments dropped - or null
 * for a name a signed archive may not carry: empty, absolute, drive-
 * lettered, with a backslash, a `..` or an empty segment, or ending in `/`
 * (a directory).
 */
export function canonicalTourPath(name: string): string | null {
  if (typeof name !== 'string' || name.startsWith('/')) return null;
  if (name.includes('\\') || /^[a-zA-Z]:/.test(name)) return null;
  const segments = name.split('/').filter((s) => s !== '.');
  if (segments.length === 0) return null;
  if (segments.some((s) => s === '' || s === '..')) return null;
  return segments.join('/');
}

function malformed(message: string): never {
  throw new TourIntegrityError(
    'malformed-manifest',
    `manifest.json: ${message}`
  );
}

/** The folder part of a canonical path, with its trailing slash. */
function folderOf(canonical: string): string {
  return canonical.slice(0, canonical.lastIndexOf('/') + 1);
}

function isReservedName(relative: string): boolean {
  return (
    relative === SIGNED_MANIFEST_ENTRY || relative === MANIFEST_SIGNATURE_ENTRY
  );
}

function parseFileRecord(value: unknown, at: string): TourFileRecord {
  if (!isRecord(value)) malformed(`"${at}" must be an object`);
  const { sha256, size } = value;
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    malformed(`"${at}.sha256" must be lowercase SHA-256 hex`);
  }
  if (!Number.isSafeInteger(size) || (size as number) < 0) {
    malformed(`"${at}.size" must be an integer >= 0`);
  }
  return { sha256, size: size as number };
}

function parseFiles(value: unknown): Record<string, TourFileRecord> {
  if (!isRecord(value) || Array.isArray(value))
    malformed('"files" must be an object');
  const files: Record<string, TourFileRecord> = {};
  for (const [name, record] of Object.entries(value)) {
    const canonical = canonicalTourPath(name);
    if (canonical === null) malformed(`"files" names an unsafe path "${name}"`);
    if (isReservedName(canonical)) {
      malformed('"files" must not list manifest.json or manifest.sig.json');
    }
    if (Object.hasOwn(files, canonical)) {
      malformed(`"files" lists "${canonical}" twice`);
    }
    files[canonical] = parseFileRecord(record, `files.${canonical}`);
  }
  return files;
}

function parseLinks(value: unknown): TourSeriesLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) malformed('"links" must be an array');
  if (value.length > MAX_SERIES_LINKS) {
    malformed(`"links" may list at most ${String(MAX_SERIES_LINKS)} series`);
  }
  return value.map((link, i) => {
    const at = `links[${String(i)}]`;
    if (!isRecord(link)) malformed(`"${at}" must be an object`);
    if (typeof link.seriesId !== 'string' || !SERIES_ID.test(link.seriesId)) {
      malformed(`"${at}.seriesId" must be a series id`);
    }
    if (!isDidKeyEd25519(link.author)) {
      malformed(`"${at}.author" must be an Ed25519 did:key`);
    }
    return { seriesId: link.seriesId, author: link.author };
  });
}

function parseHeader(
  data: Record<string, unknown>
): Pick<
  SignedTourManifest,
  'formatVersion' | 'seriesId' | 'version' | 'createdAt'
> {
  const { formatVersion, seriesId, version, createdAt } = data;
  if (isFiniteNumber(formatVersion) && formatVersion > SIGNED_MANIFEST_FORMAT) {
    throw new TourIntegrityError(
      'newer-format',
      `manifest.json format ${String(formatVersion)} was made with a newer version of the app; update the app to check this tour`
    );
  }
  if (formatVersion !== SIGNED_MANIFEST_FORMAT) {
    malformed(`"formatVersion" must be ${String(SIGNED_MANIFEST_FORMAT)}`);
  }
  if (typeof seriesId !== 'string' || !SERIES_ID.test(seriesId)) {
    malformed('"seriesId" must be 16-64 base64url characters');
  }
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    malformed('"version" must be an integer >= 1');
  }
  if (
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt))
  ) {
    malformed('"createdAt" must be an ISO-8601 timestamp');
  }
  return { formatVersion, seriesId, version: version as number, createdAt };
}

/**
 * Parse the text of `manifest.json`. Unknown fields are ignored (the
 * signature covers them anyway). Throws {@link TourIntegrityError}
 * (`malformed-manifest`, or `newer-format` for a format this app does not
 * know - it cannot be checked, so it is not trusted).
 */
export function parseSignedTourManifest(text: string): SignedTourManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    malformed('not readable JSON');
  }
  if (!isRecord(data) || Array.isArray(data))
    malformed('must be a JSON object');
  const commitment = data.recoveryKeyCommitment;
  if (
    commitment !== undefined &&
    (typeof commitment !== 'string' || !SHA256_HEX.test(commitment))
  ) {
    malformed('"recoveryKeyCommitment" must be lowercase SHA-256 hex');
  }
  return {
    ...parseHeader(data),
    files: parseFiles(data.files),
    links: parseLinks(data.links),
    ...(commitment === undefined ? {} : { recoveryKeyCommitment: commitment }),
  };
}

/** The JSON text of a manifest, re-validated through the parser first. */
export function serializeSignedTourManifest(
  manifest: SignedTourManifest
): string {
  const text = JSON.stringify(manifest, null, 2);
  parseSignedTourManifest(text);
  return text;
}

/** The `manifest.json` entry among `names` - the shallowest one, like
 *  `tour.json` (a wrapping folder is tolerated) - or null when there is
 *  none. A name that is not canonical-safe never counts. */
export function signedManifestEntryOf(names: Iterable<string>): string | null {
  let found: string | null = null;
  let foundDepth = Number.POSITIVE_INFINITY;
  for (const name of names) {
    const canonical = canonicalTourPath(name);
    if (canonical === null) continue;
    if (
      canonical !== SIGNED_MANIFEST_ENTRY &&
      !canonical.endsWith(`/${SIGNED_MANIFEST_ENTRY}`)
    ) {
      continue;
    }
    const depth = canonical.split('/').length;
    if (depth < foundDepth) {
      found = name;
      foundDepth = depth;
    }
  }
  return found;
}

/** One zip entry as tier 1 sees it (zip.js `Entry` has these fields). */
export interface TourArchiveEntryInfo {
  readonly filename: string;
  readonly directory?: boolean;
  readonly uncompressedSize: number;
}

/** The canonical name of every file entry, refusing unsafe and repeated
 *  names. */
function canonicalEntries(
  entries: readonly TourArchiveEntryInfo[]
): Map<string, TourArchiveEntryInfo> {
  const byCanonical = new Map<string, TourArchiveEntryInfo>();
  for (const entry of entries) {
    if (entry.directory === true || entry.filename.endsWith('/')) continue;
    const canonical = canonicalTourPath(entry.filename);
    if (canonical === null) {
      throw new TourIntegrityError(
        'unsafe-name',
        `the archive holds an entry with an unsafe name "${entry.filename}"`
      );
    }
    if (byCanonical.has(canonical)) {
      throw new TourIntegrityError(
        'duplicate-name',
        `the archive holds "${canonical}" twice`
      );
    }
    byCanonical.set(canonical, entry);
  }
  return byCanonical;
}

/** The manifest's record for one canonical entry name; `'reserved'` for
 *  the manifest and its signature themselves. Throws `unlisted-file` for a
 *  name outside the manifest's folder or not in its list. */
function listedRecord(
  canonical: string,
  folder: string,
  manifest: SignedTourManifest
): { relative: string; record: TourFileRecord } | 'reserved' {
  const relative = canonical.startsWith(folder)
    ? canonical.slice(folder.length)
    : null;
  if (relative !== null && isReservedName(relative)) return 'reserved';
  if (relative === null || !Object.hasOwn(manifest.files, relative)) {
    throw new TourIntegrityError(
      'unlisted-file',
      `the archive holds "${canonical}", which its manifest does not list`
    );
  }
  return { relative, record: manifest.files[relative]! };
}

/**
 * TIER 1 (§8 D3): the archive's file entries against the manifest - every
 * entry listed, every listed file present, every declared size equal -
 * before any content is shown. Returns each entry's record keyed by the
 * entry's OWN filename, which is what the readers look up on every read
 * (tier 2). Throws {@link TourIntegrityError}.
 *
 * @param manifestEntryName the archive name `manifest.json` was read from;
 *   its folder is the one every path is relative to.
 */
export function checkEntriesAgainstManifest(
  entries: readonly TourArchiveEntryInfo[],
  manifest: SignedTourManifest,
  manifestEntryName: string
): Map<string, TourFileRecord> {
  const folder = folderOf(canonicalTourPath(manifestEntryName) ?? '');
  const records = new Map<string, TourFileRecord>();
  const seen = new Set<string>();
  for (const [canonical, entry] of canonicalEntries(entries)) {
    const listed = listedRecord(canonical, folder, manifest);
    if (listed === 'reserved') continue;
    if (listed.record.size !== entry.uncompressedSize) {
      throw new TourIntegrityError(
        'size-mismatch',
        `"${listed.relative}" is ${String(entry.uncompressedSize)} bytes, the manifest says ${String(listed.record.size)}`
      );
    }
    seen.add(listed.relative);
    records.set(entry.filename, listed.record);
  }
  const missing = Object.keys(manifest.files).find((name) => !seen.has(name));
  if (missing !== undefined) {
    throw new TourIntegrityError(
      'missing-file',
      `the manifest lists "${missing}", which the archive does not hold`
    );
  }
  return records;
}

/**
 * The archive's own names of `manifest.json` and, next to it,
 * `manifest.sig.json` - what a writer that CHANGES any file of a tour must
 * drop, because the list (and a signature over it) would then no longer
 * match. Empty for a tour without a manifest.
 */
export function signedManifestFilesOf(names: Iterable<string>): string[] {
  const all = [...names];
  const manifest = signedManifestEntryOf(all);
  if (manifest === null) return [];
  const canonical = canonicalTourPath(manifest) ?? '';
  const signature = `${folderOf(canonical)}${MANIFEST_SIGNATURE_ENTRY}`;
  return [
    manifest,
    ...all.filter((name) => canonicalTourPath(name) === signature),
  ];
}
