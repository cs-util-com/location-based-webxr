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
  isDefinitivelyGone,
  type ArchiveValidators,
  type RangeProbeRejectCause,
} from './range-probe.js';
import {
  fetchRemoteValidators,
  probeRemote,
  RangeIgnoredError,
  RemoteRangeByteSource,
  type FetchImpl,
} from './remote-range-byte-source.js';
import { StructuralReadError } from './structural-read-error.js';
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
  /** Base URL of the site worker's Drive CORS proxy; when set, Drive links
   *  rewrite to it (precedence over the API key — see share-link). */
  corsProxyBaseUrl?: string;
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
  /** Drop this archive's cached copy — call when a cached copy fails to
   *  parse, then reopen with `skipCache: true`. Self-sufficient: it awaits
   *  any in-flight warm/recovery download before deleting, so a late write
   *  cannot re-poison the cleared cache (no dispose-first incantation
   *  required). */
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
    corsProxyBaseUrl: options.corsProxyBaseUrl,
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
  // A definitive 404/410 is the author DELETING the archive — honoring it
  // means evicting, not serving the ghost from cache forever (PR #357
  // review). Only genuine unreachability keeps availability-over-freshness.
  if (live.kind === 'missing') return false;
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
  if (origin === 'network') {
    // The eager-local / full-download paths pulled the WHOLE archive over
    // the network before any read is served locally — without this synthetic
    // event a stats consumer shows "0 B fetched" right after downloading
    // everything, inverting its headline metric (PR #358 review #3).
    options.onRead?.({ origin: 'network', offset: 0, length: entry.blob.size });
  }
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
  const controller = new AbortController();
  // Mid-session range-ignore recovery: a host that 206'd the probe can start
  // answering range reads with 200 full bodies (CDN node variance, a backend
  // flip). That surfaces as RangeIgnoredError; instead of failing the
  // session, download the archive whole ONCE (single-flight), switch the
  // live session onto the local copy, persist it, and serve the failed read
  // from there. Declared before `switchable` and wired via a closure — the
  // recovery needs the switchable that wraps it.
  let recoveryDownload: Promise<ByteSource> | null = null;
  // Once evicted, the session may keep streaming (and keep recovering), but
  // no writer — warm or recovery, present OR FUTURE — may repersist the
  // archive: a post-evict RangeIgnoredError read used to store.put the copy
  // right back into the store the user was just told is empty (PR #359
  // review). Awaiting in evict() only covers writers that already exist.
  let evicted = false;
  const runRecoveryDownload = async (): Promise<ByteSource> => {
    const res = await fetchImpl(url, {
      // Bypass the browser HTTP cache: these bytes replace the byte source
      // and can be re-persisted — a heuristically-fresh stored response
      // would resurrect a revalidated-stale archive (PR #369 review; same
      // reasoning as fetchRemoteValidators' HEAD).
      cache: 'no-cache',
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(FULL_DOWNLOAD_TIMEOUT_MS),
      ]),
    });
    if (!res.ok) {
      throw new StructuralReadError(
        `range-ignore recovery download of ${url} failed (${res.status})`
      );
    }
    const blob = await res.blob();
    // The recovery pulled the WHOLE archive over the network; without this
    // synthetic event a stats consumer proves "how little was fetched" with
    // an inverted headline (PR #359 review — the warm-path twin of the
    // eager-local fix in openLocal).
    options.onRead?.({ origin: 'network', offset: 0, length: blob.size });
    if (blob.size !== size) {
      throw new StructuralReadError(
        `range-ignore recovery downloaded ${blob.size} bytes, expected ${size} — the file changed mid-session`
      );
    }
    const local = instrument(new LocalCacheByteSource(blob), 'cache', options);
    if (switchable.switchTo(local) && store !== undefined && !evicted) {
      await requestPersistentStorage();
      await store.put(url, {
        blob,
        ...(validators !== undefined ? { validators } : {}),
      });
    }
    // Even when the swap was refused (the warm won the race), this copy is
    // size-validated — serving the failed read from it is correct.
    return local;
  };
  const recoverToLocal = (): Promise<ByteSource> => {
    // Single-flight for SUCCESS only: a rejection resets the slot so the next
    // read retries instead of replaying a memoised transient failure forever
    // (PR #357 review). Concurrent readers still share one in-flight attempt.
    recoveryDownload ??= runRecoveryDownload().catch((err: unknown) => {
      recoveryDownload = null;
      throw err;
    });
    return recoveryDownload;
  };
  const remoteWithRecovery: ByteSource = {
    size,
    read: async (offset, length) => {
      try {
        return await remote.read(offset, length);
      } catch (err) {
        if (!(err instanceof RangeIgnoredError)) throw err;
        const local = await recoverToLocal();
        return local.read(offset, length);
      }
    },
  };
  const switchable = new SwitchableByteSource(remoteWithRecovery);
  const warmed =
    store !== undefined && options.warm !== false
      ? warmToCache(
          url,
          validators,
          fetchImpl,
          store,
          switchable,
          options,
          controller.signal,
          () => evicted
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
      // In-flight WARM and RECOVERY downloads both persist on completion;
      // deleting before they settle would let a late write re-poison the
      // cache the eviction just cleared (PR #357 review; PR #358 review #2
      // added the warm half so a bare `evict()` is self-sufficient — the
      // dispose → await warmed → evict incantation is belt-and-braces, not
      // a requirement). Await both — success or failure — then delete. The
      // latch additionally disarms writers that START after this call
      // (PR #359 review): the live session may keep recovering reads, but
      // never repersists.
      evicted = true;
      await warmed.catch(() => undefined);
      await recoveryDownload?.catch(() => undefined);
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
  signal: AbortSignal,
  isEvicted: () => boolean
): Promise<boolean> {
  try {
    // The one deliberate persistence moment (D6): before the expensive
    // download, once, never per cache write.
    await requestPersistentStorage();
    // Timeout alongside the dispose() signal: `warmed` is a public promise,
    // and a stalled connection must settle it (false) rather than leave a
    // consumer awaiting it forever (milestone review #6).
    const res = await fetchImpl(url, {
      // Bypass the browser HTTP cache: the warm's blob is store.put under
      // the FRESH validators, so stale bytes here would be pinned as
      // current forever (PR #369 review).
      cache: 'no-cache',
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(FULL_DOWNLOAD_TIMEOUT_MS),
      ]),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    // The warm pulled the WHOLE archive over the network; report it, or the
    // stats headline shows "132 KB fetched · serving from cache" after the
    // full file crossed the wire (PR #359 review).
    options.onRead?.({ origin: 'network', offset: 0, length: blob.size });
    const local = instrument(new LocalCacheByteSource(blob), 'cache', options);
    if (!switchable.switchTo(local)) return false;
    if (isEvicted()) return true; // swapped local, but never repersist
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
    // Bypass the browser HTTP cache — these bytes may be persisted as the
    // archive's local copy (PR #369 review; see runWarm).
    cache: 'no-cache',
    signal: AbortSignal.timeout(FULL_DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new OpenRemoteArchiveError(
      `full download of ${url} failed (${res.status})`,
      isDefinitivelyGone(res.status) ? 'missing' : 'unusable-link'
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
    read: async (offset, length) => {
      // Report AFTER the read settles, with the DELIVERED length: a rejected
      // read must not count as bytes fetched (on the range-ignore recovery
      // path every failed slice would otherwise be double-counted on top of
      // the recovery download), and an EOF-clamped read must report what it
      // returned, not what was asked (PR #363 review).
      const bytes = await inner.read(offset, length);
      onRead({ origin, offset, length: bytes.length });
      return bytes;
    },
  };
}
