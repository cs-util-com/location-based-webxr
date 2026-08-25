/**
 * The conductor of range-based archive streaming: one call that runs
 * normalize → cache lookup (revalidated) → probe → fallback decision →
 * byte-source construction, plus the background warm-download that swaps a
 * ranged session onto a local copy mid-flight.
 *
 * Every consumer would otherwise hand-roll this dance from the building
 * blocks (`share-link`, `range-probe`, `remote-range-byte-source`,
 * `local-cache-byte-source`, `byte-source`); this module is the one place the
 * policy lives. It is archive-format-agnostic — zip.js enters only where a
 * caller wraps `opened.source` in a `ByteSourceReader`.
 *
 * Cache freshness: a cached copy is compared against the live file via one
 * lightweight HEAD — ETag when readable, else the CORS-safelisted
 * Last-Modified, else the size. A failed HEAD (offline, HEAD-refusing host)
 * serves the cache: availability over freshness, because the alternative
 * strands an offline visitor who HAS the bytes. A stale copy is evicted and
 * the open proceeds remote.
 */

import { SwitchableByteSource, type ByteSource } from './byte-source.js';
import {
  LocalCacheByteSource,
  requestPersistentStorage,
  type CachedArchive,
  type LocalCacheStore,
} from './local-cache-byte-source.js';
import {
  decideFallback,
  type ArchiveValidators,
  type RangeProbeRejectCause,
} from './range-probe.js';
import {
  fetchRemoteValidators,
  probeRemote,
  RemoteRangeByteSource,
  type FetchImpl,
} from './remote-range-byte-source.js';
import { normalizeShareUrl } from './share-link.js';

/** Where a read was served from — feeds a consumer's live streaming stats. */
export type ArchiveReadOrigin = 'network' | 'cache';

export interface ArchiveReadEvent {
  readonly origin: ArchiveReadOrigin;
  readonly offset: number;
  readonly length: number;
}

export interface OpenRemoteArchiveOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchImpl;
  /** Enables the cache lookup, the background warm-download and `evict()`. */
  cacheStore?: LocalCacheStore;
  /** Unlocks the Range+CORS-capable Google Drive URL form (see share-link). */
  googleDriveApiKey?: string;
  /** Observer for every read served through the returned source. */
  onRead?: (event: ArchiveReadEvent) => void;
  /** Set false to keep a ranged session remote (no background download). */
  warm?: boolean;
  /** Bypass the cache lookup — the poisoned-copy reopen path. */
  skipCache?: boolean;
}

export interface OpenedArchive {
  /** Stable byte source for the archive's whole session. */
  readonly source: ByteSource;
  readonly size: number;
  /** The normalized (share-link-resolved) URL actually used. */
  readonly url: string;
  /** How the initial bytes are served. */
  readonly origin: ArchiveReadOrigin;
  /**
   * Settles when the local-copy story settles: true once a complete local
   * copy backs `source` (immediately for cache/eager opens), false when
   * warming is off, failed, was disposed, or lost the swap.
   */
  readonly warmed: Promise<boolean>;
  /** Abort the in-flight warm download (leaving the page, opening another). */
  dispose(): void;
  /** Drop this archive's cached copy — call when a cached copy fails to parse,
   *  then reopen with `skipCache: true`. */
  evict(): Promise<void>;
}

/** A probe-level rejection, carrying the machine-readable cause. */
export class OpenRemoteArchiveError extends Error {
  override readonly name = 'OpenRemoteArchiveError';
  readonly rejectCause: RangeProbeRejectCause;

  constructor(message: string, rejectCause: RangeProbeRejectCause) {
    super(message);
    this.rejectCause = rejectCause;
  }
}

/** The probe GET budget already covers a slow full download (see
 *  remote-range-byte-source); the explicit full-download path uses the same. */
const FULL_DOWNLOAD_TIMEOUT_MS = 300_000;

export async function openRemoteArchive(
  rawUrl: string,
  options: OpenRemoteArchiveOptions = {}
): Promise<OpenedArchive> {
  const fetchImpl: FetchImpl =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = normalizeShareUrl(rawUrl, {
    googleDriveApiKey: options.googleDriveApiKey,
  });
  const store = options.cacheStore;

  const fromCache = await tryOpenFromCache(url, store, options, fetchImpl);
  if (fromCache !== null) return fromCache;

  let probe;
  try {
    probe = await probeRemote(url, fetchImpl);
  } catch (err) {
    // In a browser, a CORS block and a dead network both reject as TypeError —
    // indistinguishable. Either way the link is unusable from here.
    throw new OpenRemoteArchiveError(
      `opening ${url} failed before any HTTP status (network down or CORS-blocked): ${String(err)}`,
      'cors'
    );
  }
  return openPerDecision(url, probe, fetchImpl, store, options);
}

/** The revalidated cache lookup; null means "proceed to the network". */
async function tryOpenFromCache(
  url: string,
  store: LocalCacheStore | undefined,
  options: OpenRemoteArchiveOptions,
  fetchImpl: FetchImpl
): Promise<OpenedArchive | null> {
  if (store === undefined || options.skipCache === true) return null;
  const cached = await store.get(url);
  if (cached === undefined) return null;
  if (await isCachedCopyServable(url, cached, fetchImpl)) {
    return openLocal(url, cached, store, options, 'cache');
  }
  await store.delete(url); // stale — the author overwrote the archive
  return null;
}

function openPerDecision(
  url: string,
  probe: Awaited<ReturnType<typeof probeRemote>>,
  fetchImpl: FetchImpl,
  store: LocalCacheStore | undefined,
  options: OpenRemoteArchiveOptions
): Promise<OpenedArchive> | OpenedArchive {
  const decision = decideFallback(probe);
  switch (decision.mode) {
    case 'ranges':
      return openRanged(url, decision.size, probe.validators, options, store);
    case 'eager-local':
      return openLocal(
        url,
        {
          blob: new Blob([decision.body as BlobPart]),
          validators: probe.validators,
        },
        store,
        options,
        'network',
        { persist: true }
      );
    case 'full-download':
      return openFullDownload(url, probe.validators, fetchImpl, store, options);
    case 'reject':
      throw new OpenRemoteArchiveError(
        `opening ${url} rejected by the range probe (${decision.cause})`,
        decision.cause
      );
  }
}

/** Freshness: any readable, differing signal ⇒ stale; no reachable HEAD ⇒
 *  serve the cache (availability over freshness, documented above). */
async function isCachedCopyServable(
  url: string,
  cached: CachedArchive,
  fetchImpl: FetchImpl
): Promise<boolean> {
  const live = await fetchRemoteValidators(url, fetchImpl);
  if (live === null) return true;
  return cachedCopyMatchesLive(cached, live);
}

function cachedCopyMatchesLive(
  cached: CachedArchive,
  live: { size: number | null; validators?: ArchiveValidators }
): boolean {
  const cv = cached.validators ?? {};
  const lv = live.validators ?? {};
  if (cv.etag !== undefined && lv.etag !== undefined) {
    return cv.etag === lv.etag;
  }
  if (cv.lastModified !== undefined && lv.lastModified !== undefined) {
    return cv.lastModified === lv.lastModified;
  }
  return live.size === null || live.size === cached.blob.size;
}

/** Serve a complete local blob; persist it first when asked to. */
async function openLocal(
  url: string,
  entry: CachedArchive,
  store: LocalCacheStore | undefined,
  options: OpenRemoteArchiveOptions,
  origin: ArchiveReadOrigin,
  behavior: { persist?: boolean } = {}
): Promise<OpenedArchive> {
  if (behavior.persist === true && store !== undefined) {
    await requestPersistentStorage();
    await store.put(url, entry);
  }
  return {
    source: instrument(new LocalCacheByteSource(entry.blob), 'cache', options),
    size: entry.blob.size,
    url,
    origin,
    warmed: Promise.resolve(true),
    dispose: () => undefined,
    evict: async () => {
      await store?.delete(url);
    },
  };
}

function openRanged(
  url: string,
  size: number,
  validators: ArchiveValidators | undefined,
  options: OpenRemoteArchiveOptions,
  store: LocalCacheStore | undefined
): OpenedArchive {
  const fetchImpl: FetchImpl =
    options.fetchImpl ?? ((input, init) => fetch(input, init));
  const remote = instrument(
    new RemoteRangeByteSource(url, size, fetchImpl),
    'network',
    options
  );
  const switchable = new SwitchableByteSource(remote);
  const controller = new AbortController();
  const warmed =
    store !== undefined && options.warm !== false
      ? warmToCache(
          url,
          validators,
          fetchImpl,
          store,
          switchable,
          options,
          controller.signal
        )
      : Promise.resolve(false);
  return {
    source: switchable,
    size,
    url,
    origin: 'network',
    warmed,
    dispose: () => controller.abort(),
    evict: async () => {
      await store?.delete(url);
    },
  };
}

/**
 * Background full download → one-shot switch → persist. The order is the
 * point: the swap is only persisted when it actually TOOK — `switchTo`
 * returning false means the downloaded bytes mismatch the session's size
 * (the file changed mid-session, a redirect body) and caching them would
 * poison every later visit.
 */
async function warmToCache(
  url: string,
  validators: ArchiveValidators | undefined,
  fetchImpl: FetchImpl,
  store: LocalCacheStore,
  switchable: SwitchableByteSource,
  options: OpenRemoteArchiveOptions,
  signal: AbortSignal
): Promise<boolean> {
  try {
    // The one deliberate persistence moment (D6): before the expensive
    // download, once, never per cache write.
    await requestPersistentStorage();
    const res = await fetchImpl(url, { signal });
    if (!res.ok) return false;
    const blob = await res.blob();
    const local = instrument(new LocalCacheByteSource(blob), 'cache', options);
    if (!switchable.switchTo(local)) return false;
    await store.put(url, {
      blob,
      ...(validators !== undefined ? { validators } : {}),
    });
    return true;
  } catch {
    return false; // aborted by dispose(), or the download failed — stay remote
  }
}

async function openFullDownload(
  url: string,
  validators: ArchiveValidators | undefined,
  fetchImpl: FetchImpl,
  store: LocalCacheStore | undefined,
  options: OpenRemoteArchiveOptions
): Promise<OpenedArchive> {
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FULL_DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new OpenRemoteArchiveError(
      `full download of ${url} failed (${res.status})`,
      res.status === 404 ? 'missing' : 'unusable-link'
    );
  }
  const blob = await res.blob();
  return openLocal(
    url,
    { blob, ...(validators !== undefined ? { validators } : {}) },
    store,
    options,
    'network',
    { persist: true }
  );
}

/** Wrap a source so every served read reports to the caller's observer. */
function instrument(
  inner: ByteSource,
  origin: ArchiveReadOrigin,
  options: OpenRemoteArchiveOptions
): ByteSource {
  const onRead = options.onRead;
  if (onRead === undefined) return inner;
  return {
    size: inner.size,
    read: (offset, length) => {
      onRead({ origin, offset, length });
      return inner.read(offset, length);
    },
  };
}
