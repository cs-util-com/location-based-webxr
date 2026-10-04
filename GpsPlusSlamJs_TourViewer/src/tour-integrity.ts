/**
 * The archive side of a tour's `manifest.json` (tour kit plan K1, §8 D3):
 * reading the list out of an open archive and checking the archive
 * against it in THREE TIERS, so a range-streamed tour is checked as its
 * bytes arrive rather than only after a download that may never finish:
 *
 * - TIER 1, at open (`openTourIntegrity`): the manifest is read and every
 *   file entry's name and declared size is compared with it, before any
 *   content is shown. A mismatch fails the open.
 * - TIER 2, on each entry read (`checkEntryBytes`): the entry's
 *   decompressed bytes against its SHA-256.
 * - TIER 3, when the whole archive is on the device (`checkWholeArchive`):
 *   tier 1 again on the complete copy, then every listed entry's hash.
 *
 * A failure in tier 2 or 3 is LATE - the tour may be on screen, in AR -
 * and the session turns it into "remove the content, never cache or save
 * the copy" (`tour-session.ts`).
 *
 * The format rules (canonical names, duplicates, what is listed) live in
 * the framework's `tour-signed-manifest.ts`; this module only feeds it the
 * archive. A tour without `manifest.json` is the common case today (every
 * tour made before K1): it opens as before, with nothing to check.
 */

import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import {
  verifyManifestSignature,
  type SignatureVerdict,
} from "gps-plus-slam-app-framework/ar/tour-signature";
import {
  canonicalTourPath,
  checkEntriesAgainstManifest,
  MANIFEST_SIGNATURE_ENTRY,
  parseSignedTourManifest,
  signedManifestEntryOf,
  TourIntegrityError,
  type SignedTourManifest,
  type TourFileRecord,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ByteSourceReader,
  DecompressionBudget,
  listZipEntriesCapped,
  LocalCacheByteSource,
  readZipEntryBlob,
  type ArchiveLimits,
} from "gps-plus-slam-app-framework/storage";
import { sha256Hex } from "gps-plus-slam-app-framework/utils/sha256-hex";

/** What tier 1 established about an open archive. */
export type TourIntegrity =
  | {
      /** No `manifest.json`: nothing can be checked (every tour before K1). */
      readonly kind: "none";
    }
  | {
      /** A manifest whose list the archive matches. */
      readonly kind: "listed";
      /**
       * `manifest.sig.json`'s verdict: null when the tour is not signed
       * (nobody vouches for the list), `valid` for a signature by the key
       * it names, `unsupported` when this browser cannot check Ed25519 -
       * never treated as valid. A signature that does not verify is not a
       * verdict: it fails the open.
       */
      readonly signature: SignatureVerdict | null;
      readonly manifest: SignedTourManifest;
      /** The archive name the manifest was read from. */
      readonly manifestEntry: string;
      /** SHA-256 (hex) of the manifest's exact bytes: the identity of
       *  what was checked, compared again when the whole archive arrives. */
      readonly manifestSha256: string;
      /** Each file entry's record, keyed by the entry's own filename. */
      readonly records: ReadonlyMap<string, TourFileRecord>;
    };

/** UTF-8 that is not valid UTF-8 is a malformed manifest, never a lossy
 *  read: the signature covers the bytes, the parser reads the text. */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function decodeText(
  bytes: Uint8Array,
  name: "manifest.json" | "manifest.sig.json",
): string {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    throw new TourIntegrityError(
      name === "manifest.json" ? "malformed-manifest" : "malformed-signature",
      `${name} is not valid UTF-8 text`,
    );
  }
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * TIER 1. Reads `manifest.json` (when the archive has one) through
 * `readBytes` - the session's capped reader, so the list is read the way
 * every other entry is - and checks the archive's file entries against it.
 *
 * @param entries the archive's central directory (directories included;
 *   the check ignores them)
 * @param readBytes inflates one entry under the session's caps
 * @throws TourIntegrityError when the manifest is malformed or the archive
 *   does not match it.
 */
export async function openTourIntegrity(
  entries: readonly Entry[],
  readBytes: (entry: FileEntry) => Promise<Uint8Array>,
): Promise<TourIntegrity> {
  const files = entries.filter(isFileEntry);
  const manifestEntry = signedManifestEntryOf(files.map((e) => e.filename));
  if (manifestEntry === null) {
    refuseOrphanSignature(files);
    return { kind: "none" };
  }
  const entry = files.find((e) => e.filename === manifestEntry)!;
  const bytes = await readBytes(entry);
  // The signature first: it covers the manifest's exact bytes, so nothing
  // the manifest says is believed before it is known to be the signed one.
  const signatureEntry = signatureEntryOf(files, manifestEntry);
  const signature =
    signatureEntry === undefined
      ? null
      : await verifyManifestSignature(
          bytes,
          decodeText(await readBytes(signatureEntry), "manifest.sig.json"),
        );
  const manifest = parseSignedTourManifest(decodeText(bytes, "manifest.json"));
  const records = checkEntriesAgainstManifest(entries, manifest, manifestEntry);
  return {
    kind: "listed",
    signature,
    manifest,
    manifestEntry,
    manifestSha256: await sha256Hex(bytes),
    records,
  };
}

/** `manifest.sig.json` in the manifest's own folder, if the archive has
 *  one. (Anywhere else it is an ordinary file, and tier 1 refuses it as
 *  unlisted.) */
function signatureEntryOf(
  files: readonly FileEntry[],
  manifestEntry: string,
): FileEntry | undefined {
  const canonical = canonicalTourPath(manifestEntry) ?? "";
  const folder = canonical.slice(0, canonical.lastIndexOf("/") + 1);
  const wanted = `${folder}${MANIFEST_SIGNATURE_ENTRY}`;
  return files.find((e) => canonicalTourPath(e.filename) === wanted);
}

/** A signature with no manifest to sign is not "unsigned": something was
 *  removed, and the tour is not opened. */
function refuseOrphanSignature(files: readonly FileEntry[]): void {
  const orphan = files.some(
    (e) =>
      (canonicalTourPath(e.filename) ?? "").split("/").at(-1) ===
      MANIFEST_SIGNATURE_ENTRY,
  );
  if (orphan) {
    throw new TourIntegrityError(
      "malformed-signature",
      "the archive holds manifest.sig.json but no manifest.json",
    );
  }
}

/** The identity of a tier-1 result: the manifest's hash, or null for a
 *  tour without one. Two copies of one tour have the same identity. */
export function integrityIdentity(integrity: TourIntegrity): string | null {
  return integrity.kind === "none" ? null : integrity.manifestSha256;
}

/**
 * TIER 2. One entry's decompressed bytes against its record. An entry the
 * manifest does not list (the manifest itself, its signature) and every
 * entry of a tour without a manifest pass unchecked.
 *
 * @throws TourIntegrityError `hash-mismatch`.
 */
export async function checkEntryBytes(
  integrity: TourIntegrity,
  filename: string,
  bytes: Uint8Array,
): Promise<void> {
  if (integrity.kind === "none") return;
  const record = integrity.records.get(filename);
  if (record === undefined) return;
  if (
    bytes.length !== record.size ||
    (await sha256Hex(bytes)) !== record.sha256
  ) {
    throw new TourIntegrityError(
      "hash-mismatch",
      `"${filename}" does not match the hash its manifest lists`,
    );
  }
}

/**
 * TIER 3. The complete archive checked as a whole: its central directory
 * and manifest (tier 1), then every listed entry's hash (tier 2 for all of
 * them), read through the same capped zip.js path as any open.
 *
 * @returns the complete copy's own tier-1 result; the caller compares its
 *   identity with the one the session opened with.
 * @throws TourIntegrityError for any mismatch; an `ArchiveLimitError` or a
 *   zip error when the copy cannot be read at all.
 */
export async function checkWholeArchive(
  blob: Blob,
  limits: ArchiveLimits,
): Promise<TourIntegrity> {
  const reader = new ZipReader(
    new ByteSourceReader(
      new LocalCacheByteSource(blob),
      limits.maxDirectoryBytes,
    ),
  );
  try {
    const entries = await listZipEntriesCapped(reader, limits.maxEntries);
    const budget = DecompressionBudget.forArchive(blob.size, limits);
    const read = async (entry: FileEntry, cap?: number): Promise<Uint8Array> =>
      new Uint8Array(
        await (
          await readZipEntryBlob(entry, budget, "application/octet-stream", cap)
        ).arrayBuffer(),
      );
    const integrity = await openTourIntegrity(entries, (e) =>
      read(e, limits.maxTextEntryBytes),
    );
    if (integrity.kind === "none") return integrity;
    for (const entry of entries.filter(isFileEntry)) {
      if (!integrity.records.has(entry.filename)) continue;
      await checkEntryBytes(integrity, entry.filename, await read(entry));
    }
    return integrity;
  } finally {
    await reader.close();
  }
}

/**
 * A session's latch for LATE failures (tiers 2 and 3). The first failure
 * is kept and reported once; from then on every read rejects with it, so
 * no content of a tour found modified can reach the screen afterwards.
 */
export class TourIntegrityGuard {
  readonly integrity: TourIntegrity;
  readonly #onFailure: (err: TourIntegrityError) => void;
  #failure: TourIntegrityError | null = null;

  constructor(
    integrity: TourIntegrity,
    onFailure: (err: TourIntegrityError) => void,
  ) {
    this.integrity = integrity;
    this.#onFailure = onFailure;
  }

  /** The late failure, once one was found. */
  get failure(): TourIntegrityError | null {
    return this.#failure;
  }

  /** Throws the latched failure, if any. */
  assertIntact(): void {
    if (this.#failure !== null) throw this.#failure;
  }

  /** Latch `err` (the first one wins) and report it once. Returns the
   *  latched error, for the caller to throw. */
  fail(err: TourIntegrityError): TourIntegrityError {
    if (this.#failure !== null) return this.#failure;
    this.#failure = err;
    this.#onFailure(err);
    return err;
  }

  /** TIER 2 on one read: `blob` is the entry's decompressed bytes. A tour
   *  without a manifest reads through without hashing. */
  async checked(filename: string, blob: Blob): Promise<Blob> {
    this.assertIntact();
    if (this.integrity.kind === "none") return blob;
    try {
      await checkEntryBytes(
        this.integrity,
        filename,
        new Uint8Array(await blob.arrayBuffer()),
      );
    } catch (err) {
      throw err instanceof TourIntegrityError ? this.fail(err) : err;
    }
    this.assertIntact();
    return blob;
  }
}

/** How tier 3 ended for a session. */
export type WholeArchiveOutcome = "checked" | "failed" | "not-checked";

/**
 * TIER 3 for one open: every complete copy of the archive (the warm
 * download, a recovery, an eager download, a saved copy, the file itself)
 * is checked as a whole and must carry the SAME manifest the session
 * opened with. `accept` is what `openRemoteArchive` calls before a copy
 * backs the session or is cached (`acceptLocalCopy`), so a copy that fails
 * is never cached. A copy can arrive before tier 1 has run (an eager
 * download is checked inside the open); its identity is then kept and
 * compared at `bind`.
 */
export class WholeArchiveCheck {
  readonly done: Promise<WholeArchiveOutcome>;
  readonly #limits: ArchiveLimits;
  #settle: (outcome: WholeArchiveOutcome) => void = () => undefined;
  #settled = false;
  /** The session's tier-1 identity; undefined until `bind`. */
  #expected: string | null | undefined = undefined;
  /** The identity of a copy accepted before `bind`. */
  #early: string | null | undefined = undefined;
  #onFailure: (err: TourIntegrityError) => void = () => undefined;

  constructor(limits: ArchiveLimits) {
    this.#limits = limits;
    this.done = new Promise((resolve) => {
      this.#settle = resolve;
    });
  }

  /** Check a complete copy. Rejects when it fails (or cannot be read), so
   *  the copy is not used or cached. */
  readonly accept = async (blob: Blob): Promise<void> => {
    let identity: string | null;
    try {
      identity = integrityIdentity(await checkWholeArchive(blob, this.#limits));
    } catch (err) {
      if (err instanceof TourIntegrityError) this.#failed(err);
      else this.#finish("not-checked");
      throw err;
    }
    if (this.#expected === undefined) {
      this.#early = identity;
      return;
    }
    this.#compare(identity);
  };

  /** Tier 1 is done: the identity the session opened with, and where a
   *  late failure is reported. */
  bind(
    expected: string | null,
    onFailure: (err: TourIntegrityError) => void,
  ): void {
    this.#expected = expected;
    this.#onFailure = onFailure;
    if (this.#early === undefined) return;
    try {
      this.#compare(this.#early);
    } catch {
      // Reported through `onFailure`; nothing else waits on this copy.
    }
  }

  /** No complete copy will come (no cache, a failed or aborted warm). */
  notChecked(): void {
    this.#finish("not-checked");
  }

  #compare(identity: string | null): void {
    if (identity === this.#expected) {
      this.#finish("checked");
      return;
    }
    const err = new TourIntegrityError(
      "hash-mismatch",
      "the archive changed while it was open: its complete copy carries another manifest",
    );
    this.#failed(err);
    throw err;
  }

  #failed(err: TourIntegrityError): void {
    this.#finish("failed");
    this.#onFailure(err);
  }

  #finish(outcome: WholeArchiveOutcome): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#settle(outcome);
  }
}
