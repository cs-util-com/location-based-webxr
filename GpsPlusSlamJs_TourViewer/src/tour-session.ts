/**
 * One open tour archive: the framework's `openRemoteArchive` wired to zip.js,
 * with the streaming-stats aggregation and the poisoned-cache recovery loop
 * the viewer needs.
 *
 * Poison recovery: a cached copy that no longer parses (a partial write, a
 * corrupted store) would otherwise brick the viewer for that URL forever —
 * the cache serves it on every visit and every visit fails the same way. So a
 * parse failure on a cache-served archive evicts the copy and reopens
 * remotely (`skipCache`), exactly the loop the framework's
 * `open-remote-archive.ts.md` prescribes. A parse failure on a
 * network-served archive is reported as-is: the file itself is broken.
 */

import { ZipReader, type Entry, type FileEntry } from "@zip.js/zip.js";
import {
  parseSignedTourManifest,
  signedManifestEntryOf,
  TourIntegrityError,
} from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import {
  ArchiveLimitError,
  ByteSourceReader,
  DecompressionBudget,
  LocalCacheByteSource,
  OpenRemoteArchiveError,
  DEFAULT_ARCHIVE_LIMITS,
  listZipEntriesCapped,
  loadActionsFromZip,
  readZipEntryBlob,
  type ArchiveLimits,
  openRemoteArchive,
  type ArchiveReadEvent,
  type LocalCacheStore,
  type OpenedArchive,
  type FetchImpl,
  type RecordedAction,
} from "gps-plus-slam-app-framework/storage";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import { parseQrLevelEntries } from "gps-plus-slam-app-framework/ar/qr/qr-level-archive";
import {
  readTourManifestFromEntries,
  TOUR_MANIFEST_ENTRY,
  tourManifestEntryOf,
} from "gps-plus-slam-app-framework/ar/tour-archive";
import {
  parseTourManifest,
  type TourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  checkGlbInert,
  tourMediaTypeOfEntry,
} from "gps-plus-slam-app-framework/ar/tour-media";

import { fileNameFromContentDisposition } from "./content-disposition.js";
import { tourFileKey, tourSeriesFileKey } from "./tour-file-key.js";
import {
  integrityIdentity,
  openTourIntegrity,
  TourIntegrityGuard,
  WholeArchiveCheck,
  type TourIntegrity,
  type WholeArchiveOutcome,
} from "./tour-integrity.js";

/** One archive entry as the gallery sees it (reached via `TourSession.entries`
 *  — not separately exported; knip counts a standalone export as dead). */
interface TourEntry {
  readonly filename: string;
  readonly size: number;
  readonly isImage: boolean;
}

/** Live streaming counters, updated on every read the archive serves. */
export interface StreamStats {
  networkRequests: number;
  networkBytes: number;
  cacheReads: number;
  cacheBytes: number;
  /** Where the MOST RECENT read was served from — flips to 'cache' when the
   *  background warm swaps the session onto a local copy (the archive's own
   *  `origin` field is the initial state and never changes). */
  origin: "network" | "cache";
}

export interface OpenTourOptions {
  fetchImpl?: FetchImpl;
  cacheStore?: LocalCacheStore;
  googleDriveApiKey?: string;
  /** The site worker's Drive CORS proxy base URL (precedence over the API
   *  key — see the framework's share-link). */
  corsProxyBaseUrl?: string;
  /** Fired after every read with the updated totals. */
  onStats?: (stats: Readonly<StreamStats>) => void;
  /** Overrides of the zip-bomb caps (`DEFAULT_ARCHIVE_LIMITS`), for tests;
   *  the page always opens with the defaults (tour kit plan K0). */
  limits?: Partial<ArchiveLimits>;
  /**
   * A LATE integrity failure (tour kit plan K1, §8 D3): an entry read
   * (tier 2) or the whole archive (tier 3) does not match the manifest the
   * tour opened with. By then the tour may be on screen, in AR: the page
   * removes its content. The session has already latched the failure
   * (every later read rejects) and dropped any cached copy.
   */
  onIntegrityFailure?: (err: TourIntegrityError, session: TourSession) => void;
}

export interface TourSession {
  readonly entries: readonly TourEntry[];
  /** For a file-opened tour (`openTourFile`) `archive.url` is its content
   *  key (`tour-file-key.ts`), not a link. */
  readonly archive: OpenedArchive;
  /** True when the tour was opened from a file on this device (tour kit
   *  plan K0): no network, nothing to stream or cache. */
  readonly fromFile: boolean;
  /** True when the zip carries an action stream (`actions/` entries) the
   *  capture-geo join can try to read - the same pre-check
   *  `loadRecordingActions` applies, exposed synchronously for the page's
   *  flow copy (tour-flow). */
  readonly hasRecording: boolean;
  /**
   * The folder the tour's `tour.json` sits under, with its trailing slash
   * (`""` for a flat zip, `"mytour/"` for one produced by re-zipping a
   * folder - the shape `tour-archive.ts` tolerates). The ONE place that
   * prefix is derived: the finish step writes content entries under it and
   * `loadContentEntry` reads them back through it (PR #435 review).
   */
  readonly manifestWrap: string;
  /**
   * The archive's one decompression allowance (tour kit plan K0). Every
   * read below charges it; the creator's Finish passes it to the rebuild
   * when the rebuild's input is this archive, so the whole session -
   * reads and rebuild - shares one total (K0 milestone review R1).
   */
  readonly budget: DecompressionBudget;
  /**
   * What tier 1 established at open (tour kit plan K1, §8 D3): `none` for a
   * tour without `manifest.json` (every tour before K1), else the manifest
   * the archive's names and sizes matched. An archive that does not match
   * its manifest never becomes a session: the open rejects.
   */
  readonly integrity: TourIntegrity;
  /**
   * Tier 3's outcome: `checked` once a complete copy (the warm download,
   * an eager download, a saved copy, the file) was hashed as a whole and
   * carried the same manifest; `failed` on a late failure; `not-checked`
   * when no complete copy came (no cache, an aborted warm), which leaves
   * tier 2 as the only check.
   */
  readonly wholeArchiveCheck: Promise<WholeArchiveOutcome>;
  /** The late failure, once tier 2 or 3 found one; every read then rejects
   *  with it. */
  integrityFailure(): TourIntegrityError | null;
  stats(): Readonly<StreamStats>;
  /** Decompress one entry to a Blob (images get their MIME type). */
  loadEntry(filename: string): Promise<Blob>;
  /** Decompress one entry as UTF-8 text under the text cap
   *  (`maxTextEntryBytes`): text lives on the JS heap, a Blob need not
   *  (K0 milestone review R10). */
  loadEntryText(filename: string): Promise<string>;
  /**
   * One `content/<id>.<ext>` entry named the way the MANIFEST names it.
   * The manifest can only carry the unwrapped name (the parser pins that
   * shape), so this joins `manifestWrap` before the exact-name lookup.
   */
  loadContentEntry(image: string): Promise<Blob>;
  /**
   * The tour's authored QR levels: every `qr/<id>.json`, keyed by `<id>` —
   * the hash of the printed code's decoded text (`qrCodeId`). NULL-TOLERANT
   * by design: zero files is the common tour, and a corrupt file degrades to
   * "that code has no level" — it must never brick the whole archive.
   */
  loadQrLevels(): Promise<ReadonlyMap<string, QrLevel>>;
  /**
   * The recording's action stream, range-streamed and parsed — the input
   * to the capture-geo join's gates and replay. NULL when the archive has
   * no readable action stream (a hand-built zip is a normal tour): null
   * means "keep the ring", never an error.
   */
  loadRecordingActions(): Promise<readonly RecordedAction[] | null>;
  /**
   * `session.json`, parsed — the join's era gate reads
   * `odomCoordVersion`. NULL when absent/corrupt (legacy or hand-built
   * zip): the join declines, the tour still works.
   */
  loadSessionMeta(): Promise<{ odomCoordVersion?: unknown } | null>;
  /**
   * `tour.json`, parsed (guided-setup plan M3) - the creator's placed
   * content. NULL when the archive has none (every recorder zip); a
   * manifest that exists but is broken REJECTS, the framework's rule for
   * this file (unlike a single bad level, it is the whole placement).
   */
  loadTourManifest(): Promise<TourManifest | null>;
  /**
   * The WHOLE archive as one Blob - the rebuild's input (DEC-N6). The
   * warmed local copy when the cache has it (keyed by the NORMALISED url
   * the archive actually used, plan review #5), else one range read of
   * the full size through the session (`?nocache=1`, no Cache API).
   */
  readWholeArchive(): Promise<Blob>;
  /**
   * The hosted file's name as its host sends it (`content-disposition`),
   * or null: an offline cache hit, or a host that sends none. Read from the
   * open's own requests - the probe's HEAD - never an extra one (Drive
   * replace plan §5 #8). Drive offers "Replace" only for the same name.
   */
  hostedFileName(): string | null;
  close(): Promise<void>;
}

/** One range read is budgeted for a slice (a 20 s timeout in the
 *  transport), not a whole archive: the full read goes in slices of this
 *  size, each its own request with its own budget, gathered into one Blob
 *  without a second copy (M3 review #4). */
const FULL_READ_SLICE_BYTES = 4 * 1024 * 1024;

/** Exported for its unit test (a fake source with a small slice); the
 *  session always reads with the default slice. */
export async function readArchiveInSlices(
  archive: Pick<OpenedArchive, "size" | "source">,
  sliceBytes: number = FULL_READ_SLICE_BYTES,
): Promise<Blob> {
  const parts: BlobPart[] = [];
  for (let offset = 0; offset < archive.size; offset += sliceBytes) {
    const length = Math.min(sliceBytes, archive.size - offset);
    const bytes = await archive.source.read(offset, length);
    // A view over the same buffer, not a copy; the typing only needs to know
    // it is not a SharedArrayBuffer.
    parts.push(
      new Uint8Array(
        bytes.buffer as ArrayBuffer,
        bytes.byteOffset,
        bytes.byteLength,
      ),
    );
  }
  return new Blob(parts, { type: "application/zip" });
}

/** The hosted file's name, so the replace step is a same-name upload:
 *  the last path segment when it ends in `.zip` (decoded), else
 *  `tour.zip` (a Drive id or a proxy route says nothing useful). */
export function archiveFileName(url: string): string {
  return zipNameOf(url) ?? "tour.zip";
}

/** The link's last path segment when it is a real `.zip` name (decoded,
 *  no path separator in it), else null. */
function zipNameOf(url: string): string | null {
  try {
    const last = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    return /\.zip$/i.test(last) && !/[/\\]/.test(last) ? last : null;
  } catch {
    return null;
  }
}

/** Resolves relative links (the same-origin Drive proxy route) for parsing. */
const LABEL_BASE = "https://label.invalid";
const DRIVE_HOSTS: ReadonlySet<string> = new Set([
  "drive.google.com",
  "drive.usercontent.google.com",
]);

/**
 * What the creator's panel calls a tour, so they can see a scan opened the
 * RIGHT one (scan-to-open plan §9 #11): a real `.zip` name, else a Drive
 * file by the start of its id (every Drive spelling and the proxy route
 * agree on it), else the host and the start of the last path segment.
 * Short by design - it shares a line with the live readout on a phone.
 */
export function tourLabel(url: string): string {
  const zip = zipNameOf(url);
  if (zip !== null) return cut(zip, 24);
  let parsed: URL;
  try {
    parsed = new URL(url, LABEL_BASE);
  } catch {
    return "the tour";
  }
  const driveId = driveFileId(parsed);
  if (driveId !== null) return `Google Drive file ${cut(driveId, 10)}`;
  const host = parsed.origin === LABEL_BASE ? "" : cut(parsed.hostname, 40);
  const last = parsed.pathname.split("/").filter(Boolean).at(-1);
  const tail = last === undefined ? "" : cut(last, 12);
  if (host === "") return tail === "" ? "the tour" : tail;
  return tail === "" ? host : `${host}/${tail}`;
}

function driveFileId(url: URL): string | null {
  let id: string | null = null;
  if (DRIVE_HOSTS.has(url.hostname)) {
    id =
      /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ??
      url.searchParams.get("id");
  } else if (url.pathname.endsWith("/drive-proxy")) {
    id = url.searchParams.get("id");
  }
  return id === null || id === "" ? null : id;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function openTourSession(
  url: string,
  options: OpenTourOptions = {},
): Promise<TourSession> {
  const stats: StreamStats = {
    networkRequests: 0,
    networkBytes: 0,
    cacheReads: 0,
    cacheBytes: 0,
    origin: "network",
  };
  const onRead = (event: ArchiveReadEvent): void => {
    stats.origin = event.origin;
    if (event.origin === "network") {
      stats.networkRequests += 1;
      stats.networkBytes += event.length;
    } else {
      stats.cacheReads += 1;
      stats.cacheBytes += event.length;
    }
    options.onStats?.(stats);
  };

  // The hosted file's name, recorded from whichever response carries it
  // first; the session reads it through `hostedFileName`.
  let hostedName: string | null = null;
  const baseFetch: FetchImpl =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const recording: OpenTourOptions = {
    ...options,
    fetchImpl: async (input, init) => {
      const response = await baseFetch(input, init);
      hostedName ??= fileNameFromContentDisposition(
        response.headers.get("content-disposition"),
      );
      return response;
    },
  };
  const named = { hostedFileName: () => hostedName };

  const limits: ArchiveLimits = {
    ...DEFAULT_ARCHIVE_LIMITS,
    ...options.limits,
  };
  const late = options.onIntegrityFailure;
  let whole = new WholeArchiveCheck(limits);
  const first = await openArchive(url, recording, onRead, false, limits, whole);
  try {
    return await buildSession(first, stats, options.cacheStore, named, limits, {
      whole,
      ...(late === undefined ? {} : { onIntegrityFailure: late }),
    });
  } catch (err) {
    // Whatever failed to parse must not stay cached and must not keep
    // downloading: dispose (aborts the session's downloads), then evict —
    // which aborts the warm itself, awaits a recovery write and latches the
    // session so nothing repersists (flows plan M2 dropped the old
    // `await warmed` middle step, redundant since then).
    first.dispose();
    await first.evict();
    // Only a cache-served archive earns the retry: a remote parse failure
    // means the hosted file itself is broken.
    if (first.origin !== "cache") throw err;
    whole = new WholeArchiveCheck(limits);
    const second = await openArchive(
      url,
      recording,
      onRead,
      true,
      limits,
      whole,
    );
    try {
      return await buildSession(
        second,
        stats,
        options.cacheStore,
        named,
        limits,
        {
          whole,
          ...(late === undefined ? {} : { onIntegrityFailure: late }),
        },
      );
    } catch (retryErr) {
      second.dispose();
      await second.evict();
      throw retryErr;
    }
  }
}

/**
 * Open a tour from a FILE on this device (tour kit plan K0) - the way
 * around a host that does not let browsers read its files. The same
 * session as a link's (`buildSession`, the same caps) over the file's own
 * bytes: no network, no cache, no warm download, no poison retry. Its
 * `archive.url` is the content key of `tour-file-key.ts` (a file has no
 * URL), which the draft store and the scan comparisons key on;
 * `hostedFileName()` is the file's name, so a finished zip is offered
 * under the name it was opened as.
 *
 * @throws OpenRemoteArchiveError `'too-large'` above the transport cap;
 *   ArchiveLimitError past the entry cap; a plain-words Error for a file
 *   that is not a zip.
 */
export async function openTourFile(
  file: File,
  options: Pick<OpenTourOptions, "limits" | "onIntegrityFailure"> = {},
): Promise<TourSession> {
  const limits: ArchiveLimits = {
    ...DEFAULT_ARCHIVE_LIMITS,
    ...options.limits,
  };
  if (file.size > limits.maxArchiveBytes) {
    const cause = new ArchiveLimitError(
      "archive-bytes",
      limits.maxArchiveBytes,
      file.size,
    );
    throw new OpenRemoteArchiveError(
      `opening ${file.name} refused: ${cause.message}`,
      "too-large",
      { cause },
    );
  }
  const archive: OpenedArchive = {
    source: new LocalCacheByteSource(file),
    size: file.size,
    url: await fileKeyOf(file, limits),
    origin: "cache",
    warmed: Promise.resolve(true),
    dispose: () => undefined,
    evict: () => Promise.resolve(),
  };
  // Nothing streams from a file: the counters stay at zero, and the page
  // shows none for it (`fromFile`).
  const stats: StreamStats = {
    networkRequests: 0,
    networkBytes: 0,
    cacheReads: 0,
    cacheBytes: 0,
    origin: "cache",
  };
  return buildSession(
    archive,
    stats,
    undefined,
    { hostedFileName: () => file.name },
    limits,
    {
      localFile: file,
      whole: new WholeArchiveCheck(limits),
      ...(options.onIntegrityFailure === undefined
        ? {}
        : { onIntegrityFailure: options.onIntegrityFailure }),
    },
  );
}

/** The file's content key, from its central directory (walked under the
 *  same entry cap as any open). A file that is not a zip fails here, in
 *  plain words. */
async function fileKeyOf(file: File, limits: ArchiveLimits): Promise<string> {
  const reader = new ZipReader(
    new ByteSourceReader(
      new LocalCacheByteSource(file),
      limits.maxDirectoryBytes,
    ),
  );
  try {
    const entries = await listZipEntriesCapped(reader, limits.maxEntries);
    const seriesId = await seriesIdOf(entries, file.size, limits);
    return seriesId === null
      ? await tourFileKey(entries)
      : tourSeriesFileKey(seriesId);
  } catch (err) {
    if (err instanceof ArchiveLimitError) throw err;
    throw new Error(
      `"${file.name}" is not a readable tour zip (${err instanceof Error ? err.message : String(err)}).`,
      { cause: err },
    );
  } finally {
    await reader.close();
  }
}

/**
 * The series id in a file's `manifest.json`, or null without a readable
 * one (tour kit plan K1, R7). Read under the text cap with a budget of its
 * own; it is NOT verified here - tier 1 checks the manifest (and its
 * signature) when the session is built, and fails the open if it lies.
 * A manifest that does not parse falls back to the content key, and tier
 * 1 then reports it.
 */
async function seriesIdOf(
  entries: readonly Entry[],
  archiveSize: number,
  limits: ArchiveLimits,
): Promise<string | null> {
  const name = signedManifestEntryOf(entries.map((e) => e.filename));
  const entry = entries.find((e) => e.filename === name);
  if (entry === undefined || entry.directory) return null;
  const budget = DecompressionBudget.forArchive(archiveSize, limits);
  try {
    const blob = await readZipEntryBlob(
      entry,
      budget,
      "application/json",
      limits.maxTextEntryBytes,
    );
    return parseSignedTourManifest(await blob.text()).seriesId;
  } catch (err) {
    if (err instanceof ArchiveLimitError) throw err;
    return null;
  }
}

function openArchive(
  url: string,
  options: OpenTourOptions,
  onRead: (event: ArchiveReadEvent) => void,
  skipCache: boolean,
  limits: ArchiveLimits,
  whole: WholeArchiveCheck,
): Promise<OpenedArchive> {
  return openRemoteArchive(url, {
    maxArchiveBytes: limits.maxArchiveBytes,
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
    ...(options.cacheStore !== undefined
      ? { cacheStore: options.cacheStore }
      : {}),
    ...(options.googleDriveApiKey !== undefined
      ? { googleDriveApiKey: options.googleDriveApiKey }
      : {}),
    ...(options.corsProxyBaseUrl !== undefined
      ? { corsProxyBaseUrl: options.corsProxyBaseUrl }
      : {}),
    onRead,
    skipCache,
    // Tier 3 (tour kit plan K1): every complete copy is checked as a whole
    // before it backs the session or is cached.
    acceptLocalCopy: whole.accept,
  });
}

async function buildSession(
  archive: OpenedArchive,
  stats: StreamStats,
  cacheStore: LocalCacheStore | undefined,
  named: Pick<TourSession, "hostedFileName">,
  limits: ArchiveLimits,
  checks: {
    /** The whole archive when it is a file on this device (`openTourFile`). */
    readonly localFile?: Blob;
    readonly whole: WholeArchiveCheck;
    readonly onIntegrityFailure?: OpenTourOptions["onIntegrityFailure"];
  },
): Promise<TourSession> {
  const { localFile, whole } = checks;
  // The tour is untrusted input (tour kit plan K0): no single read may pass
  // the directory cap (zip.js reads a declared directory in one piece, K0
  // milestone review R4), the directory walk stops at its entry cap, and
  // every entry below is inflated under ONE budget for this archive that
  // counts the bytes actually produced.
  const reader = new ZipReader(
    new ByteSourceReader(archive.source, limits.maxDirectoryBytes),
  );
  const zipEntries = await listZipEntriesCapped(reader, limits.maxEntries);
  const budget = DecompressionBudget.forArchive(archive.size, limits);
  // Tier 1 before anything is shown: the manifest read under the text cap,
  // the archive's names and sizes against it.
  const integrity = await openTourIntegrity(
    zipEntries,
    async (entry) =>
      new Uint8Array(
        await (
          await readZipEntryBlob(
            entry,
            budget,
            "application/json",
            limits.maxTextEntryBytes,
          )
        ).arrayBuffer(),
      ),
  );
  // Tiers 2 and 3 report through one latch: the copy is dropped from the
  // cache, and the page is told (it removes the tour's content).
  const guard = new TourIntegrityGuard(integrity, (err) => {
    void archive.evict();
    checks.onIntegrityFailure?.(err, session);
  });
  /** Every entry read: capped (K0), then hashed against the manifest
   *  (tier 2) - one path, so no read can skip the check. */
  const readBlob = async (
    entry: FileEntry,
    mimeType: string,
    cap?: number,
  ): Promise<Blob> => {
    guard.assertIntact();
    return guard.checked(
      entry.filename,
      await readZipEntryBlob(entry, budget, mimeType, cap),
    );
  };
  const readText = async (
    entry: FileEntry,
    cap: number = limits.maxTextEntryBytes,
  ): Promise<string> => (await readBlob(entry, "text/plain", cap)).text();
  const byName = new Map<string, FileEntry>();
  const entries: TourEntry[] = [];
  const entryNamed = (filename: string): FileEntry => {
    const entry = byName.get(filename);
    if (entry === undefined) {
      throw new Error(`tour archive has no readable entry "${filename}"`);
    }
    return entry;
  };
  for (const entry of zipEntries) {
    if (entry.directory) continue; // narrows Entry to FileEntry (discriminant)
    byName.set(entry.filename, entry);
    entries.push({
      filename: entry.filename,
      size: entry.uncompressedSize,
      isImage: tourMediaTypeOfEntry(entry.filename)?.kind === "image",
    });
  }
  // `includes`, not `startsWith`: the framework's parser tolerates a
  // wrapping folder (`<name>/actions/…`) and this pre-check must not be
  // stricter than the parser it guards (milestone review, finding 10).
  const hasRecording = [...byName.keys()].some((name) =>
    name.includes("actions/"),
  );
  // Where `tour.json` was found, minus the file name: the prefix every
  // content entry of THIS archive shares (PR #435 review). Empty when the
  // zip is flat or carries no manifest yet.
  const manifestWrap = (
    tourManifestEntryOf([...byName.keys()]) ?? TOUR_MANIFEST_ENTRY
  ).slice(0, -TOUR_MANIFEST_ENTRY.length);
  const session: TourSession = {
    entries,
    archive,
    fromFile: localFile !== undefined,
    hasRecording,
    manifestWrap,
    hostedFileName: named.hostedFileName,
    budget,
    integrity,
    wholeArchiveCheck: whole.done,
    integrityFailure: () => guard.failure,
    stats: () => ({ ...stats }),
    loadEntry: async (filename) =>
      // The media allowlist types the Blob (tour kit plan K0); anything
      // else is plain bytes, never a type a browser renders as a page.
      readBlob(
        entryNamed(filename),
        tourMediaTypeOfEntry(filename)?.mime ?? "application/octet-stream",
      ),
    loadEntryText: async (filename) => readText(entryNamed(filename)),
    loadQrLevels: () =>
      // The `qr/<id>.json` convention and its null-tolerance live in the
      // framework, because the recorder WRITES what this reads and the two
      // halves drifting apart fails silently.
      parseQrLevelEntries([...byName.keys()], async (name) => {
        const entry = byName.get(name);
        if (entry === undefined) throw new Error(`missing entry: ${name}`);
        return readText(entry);
      }),
    loadRecordingActions: async () => {
      if (!hasRecording) {
        return null; // a hand-built tour zip is normal, not an error
      }
      try {
        // Reuses the framework parser over a SECOND reader on the same
        // range-streaming source (a few extra directory reads, no
        // re-download) — re-implementing the index-ordered parse here
        // would be the DEC-H3 drift.
        const loaded = await loadActionsFromZip(
          new ByteSourceReader(archive.source, limits.maxDirectoryBytes),
          undefined,
          budget,
          // The session's own read, so every action entry is hashed too.
          (entry, maxBytes) => readText(entry, maxBytes),
        );
        return loaded.map((e) => e.action);
      } catch (err) {
        // A cap's refusal is not "no recording": it reaches the visitor
        // through the join's error line (K0 milestone review R9).
        if (err instanceof ArchiveLimitError) throw err;
        if (err instanceof TourIntegrityError) throw err;
        return null; // corrupt stream → the join declines, the tour works
      }
    },
    loadSessionMeta: async () => {
      // `endsWith`, matching the framework's zip-coverage-embed tolerance
      // for a wrapping folder (milestone review, finding 10).
      const entry = [...byName.entries()].find(([name]) =>
        name.endsWith("session.json"),
      )?.[1];
      if (entry === undefined) return null;
      try {
        // Typed `unknown`, deliberately: this is hand-editable JSON, and a
        // declared `number` here would launder whatever the file contains
        // past the era gate's runtime check (PR #367 review).
        return JSON.parse(await readText(entry)) as {
          odomCoordVersion?: unknown;
        };
      } catch (err) {
        if (err instanceof ArchiveLimitError) throw err;
        if (err instanceof TourIntegrityError) throw err; // as above (R9)
        return null;
      }
    },
    loadContentEntry: async (image) => {
      // Placed content is ALLOWLISTED media only (tour kit plan K0, review
      // D12): a tour from any link must stay inert on this origin.
      const type = tourMediaTypeOfEntry(image);
      if (type === null) {
        throw new Error(
          `"${image}" is not a media type a tour may carry (images, .glb models, audio and video only).`,
        );
      }
      const blob = await session.loadEntry(`${manifestWrap}${image}`);
      if (type.kind !== "model") return blob;
      const check = checkGlbInert(new Uint8Array(await blob.arrayBuffer()));
      if (!check.ok) {
        throw new Error(
          `The 3D model "${image}" cannot be shown: ${check.reason}.`,
        );
      }
      return blob;
    },
    loadTourManifest: () =>
      readTourManifestFromEntries(
        [...byName.keys()],
        async (name) => {
          const entry = byName.get(name);
          if (entry === undefined) throw new Error(`missing entry: ${name}`);
          return readText(entry);
        },
        parseTourManifest,
      ),
    readWholeArchive: async () => {
      guard.assertIntact();
      // A file IS the whole archive - no copy, no slices.
      if (localFile !== undefined) return localFile;
      // `warmed` resolves false without a store or after an abort; the
      // range read below is then the honest path, not an error.
      await archive.warmed.catch(() => undefined);
      const cached = await cacheStore?.get(archive.url);
      // A copy of the wrong size is not this archive (the same check every
      // other consumer of a downloaded copy makes, M3 review #4).
      if (cached !== undefined && cached.blob.size === archive.size) {
        return cached.blob;
      }
      return readArchiveInSlices(archive);
    },
    close: async () => {
      archive.dispose();
      await reader.close();
    },
  };
  startWholeCheck(session, whole, guard, cacheStore, localFile);
  return session;
}

/**
 * Tier 3's start for a copy the open did not hand to `acceptLocalCopy`:
 * the file itself, or a SAVED copy (it may predate K1, so it is checked
 * again, in the background - the tour is already showing). A ranged
 * session's warm copy is checked inside the warm; without one, tier 3
 * never runs.
 */
function startWholeCheck(
  session: TourSession,
  whole: WholeArchiveCheck,
  guard: TourIntegrityGuard,
  cacheStore: LocalCacheStore | undefined,
  localFile: Blob | undefined,
): void {
  whole.bind(integrityIdentity(session.integrity), (err) => guard.fail(err));
  const { archive } = session;
  void archive.warmed.then(async (warmed) => {
    if (!warmed) {
      whole.notChecked();
      return;
    }
    const local =
      localFile ??
      (archive.origin === "cache"
        ? (await cacheStore?.get(archive.url))?.blob
        : undefined);
    // A network open that warmed already offered its copy to the check.
    if (local === undefined || session.integrity.kind === "none") {
      if (archive.origin === "cache") whole.notChecked();
      return;
    }
    await whole.accept(local).catch(() => undefined);
  });
}
