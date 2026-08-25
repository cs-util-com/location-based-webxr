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

import { BlobWriter, ZipReader, type FileEntry } from "@zip.js/zip.js";
import {
  ByteSourceReader,
  openRemoteArchive,
  type ArchiveReadEvent,
  type LocalCacheStore,
  type OpenedArchive,
  type FetchImpl,
} from "gps-plus-slam-app-framework/storage";

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
  close(): Promise<void>;
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
  };
  const onRead = (event: ArchiveReadEvent): void => {
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
    close: async () => {
      archive.dispose();
      await reader.close();
    },
  };
}
