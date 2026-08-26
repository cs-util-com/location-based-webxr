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
import {
  parseQrLevel,
  type QrLevel,
} from "gps-plus-slam-app-framework/ar/qr/qr-level";

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
  /** Fired after every read with the updated totals. */
  onStats?: (stats: Readonly<StreamStats>) => void;
}

export interface TourSession {
  readonly entries: readonly TourEntry[];
  readonly archive: OpenedArchive;
  stats(): Readonly<StreamStats>;
  /** Decompress one entry to a Blob (images get their MIME type). */
  loadEntry(filename: string): Promise<Blob>;
  /**
   * The tour's authored QR levels: every `qr/<c>.json`, keyed by `<c>` (the
   * printed `&c=` discriminator). NULL-TOLERANT by design (QR-pose plan
   * M3): zero files is the common tour, and a corrupt file degrades to
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
  close(): Promise<void>;
}

/** `qr/<c>.json` → `<c>` (the level-file naming the author mode exports). */
const QR_LEVEL_ENTRY = /^qr\/([\w.-]+)\.json$/;

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
    return await buildSession(first, stats);
  } catch (err) {
    // Whatever failed to parse must not stay cached and must not keep
    // downloading. Order matters: dispose (aborts an in-flight warm), await
    // the warm settling (it may already be past the abort and about to
    // persist), THEN evict — evicting first would race a late warm put.
    first.dispose();
    await first.warmed;
    await first.evict();
    // Only a cache-served archive earns the retry: a remote parse failure
    // means the hosted file itself is broken.
    if (first.origin !== "cache") throw err;
    const second = await openArchive(url, options, onRead, true);
    try {
      return await buildSession(second, stats);
    } catch (retryErr) {
      second.dispose();
      await second.warmed;
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
    onRead,
    skipCache,
  });
}

async function buildSession(
  archive: OpenedArchive,
  stats: StreamStats,
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
  return {
    entries,
    archive,
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
    loadQrLevels: async () => {
      const levels = new Map<string, QrLevel>();
      for (const [filename, entry] of byName) {
        const match = QR_LEVEL_ENTRY.exec(filename);
        if (match?.[1] === undefined) continue;
        try {
          const text = await entry.getData(new TextWriter());
          levels.set(match[1], parseQrLevel(JSON.parse(text)));
        } catch {
          // Null-tolerant: a corrupt level file means "this code has no
          // level", never a broken archive.
        }
      }
      return levels;
    },
    loadRecordingActions: async () => {
      // `includes`, not `startsWith`: the framework's own parser tolerates a
      // wrapping folder (`<name>/actions/…`), and this pre-check must not be
      // stricter than the parser it guards (milestone review, finding 10).
      if (![...byName.keys()].some((name) => name.includes("actions/"))) {
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
    close: async () => {
      archive.dispose();
      await reader.close();
    },
  };
}
