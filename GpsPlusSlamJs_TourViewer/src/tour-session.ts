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

import {
  BlobWriter,
  TextWriter,
  ZipReader,
  type FileEntry,
} from "@zip.js/zip.js";
import {
  ByteSourceReader,
  loadActionsFromZip,
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
}

export interface TourSession {
  readonly entries: readonly TourEntry[];
  readonly archive: OpenedArchive;
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
  stats(): Readonly<StreamStats>;
  /** Decompress one entry to a Blob (images get their MIME type). */
  loadEntry(filename: string): Promise<Blob>;
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
  try {
    const last = decodeURIComponent(
      new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "",
    );
    return /\.zip$/i.test(last) && !/[/\\]/.test(last) ? last : "tour.zip";
  } catch {
    return "tour.zip";
  }
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|avif)$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

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

  const first = await openArchive(url, options, onRead, false);
  try {
    return await buildSession(first, stats, options.cacheStore);
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
    const second = await openArchive(url, options, onRead, true);
    try {
      return await buildSession(second, stats, options.cacheStore);
    } catch (retryErr) {
      second.dispose();
      await second.evict();
      throw retryErr;
    }
  }
}

function openArchive(
  url: string,
  options: OpenTourOptions,
  onRead: (event: ArchiveReadEvent) => void,
  skipCache: boolean,
): Promise<OpenedArchive> {
  return openRemoteArchive(url, {
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
  });
}

async function buildSession(
  archive: OpenedArchive,
  stats: StreamStats,
  cacheStore: LocalCacheStore | undefined,
): Promise<TourSession> {
  const reader = new ZipReader(new ByteSourceReader(archive.source));
  const zipEntries = await reader.getEntries();
  const byName = new Map<string, FileEntry>();
  const entries: TourEntry[] = [];
  for (const entry of zipEntries) {
    if (entry.directory) continue; // narrows Entry to FileEntry (discriminant)
    byName.set(entry.filename, entry);
    entries.push({
      filename: entry.filename,
      size: entry.uncompressedSize,
      isImage: IMAGE_EXTENSION.test(entry.filename),
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
    hasRecording,
    manifestWrap,
    stats: () => ({ ...stats }),
    loadEntry: (filename) => {
      const entry = byName.get(filename);
      if (entry === undefined) {
        return Promise.reject(
          new Error(`tour archive has no readable entry "${filename}"`),
        );
      }
      const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
      return entry.getData(
        new BlobWriter(
          MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
        ),
      );
    },
    loadQrLevels: () =>
      // The `qr/<id>.json` convention and its null-tolerance live in the
      // framework, because the recorder WRITES what this reads and the two
      // halves drifting apart fails silently.
      parseQrLevelEntries([...byName.keys()], async (name) => {
        const entry = byName.get(name);
        if (entry === undefined) throw new Error(`missing entry: ${name}`);
        return entry.getData(new TextWriter());
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
          new ByteSourceReader(archive.source),
        );
        return loaded.map((e) => e.action);
      } catch {
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
        return JSON.parse(await entry.getData(new TextWriter())) as {
          odomCoordVersion?: unknown;
        };
      } catch {
        return null;
      }
    },
    loadContentEntry: (image) => session.loadEntry(`${manifestWrap}${image}`),
    loadTourManifest: () =>
      readTourManifestFromEntries(
        [...byName.keys()],
        async (name) => {
          const entry = byName.get(name);
          if (entry === undefined) throw new Error(`missing entry: ${name}`);
          return entry.getData(new TextWriter());
        },
        parseTourManifest,
      ),
    readWholeArchive: async () => {
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
  return session;
}
