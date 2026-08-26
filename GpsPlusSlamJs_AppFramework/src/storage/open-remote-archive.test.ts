import { describe, expect, it } from 'vitest';

import { InMemoryLocalCacheStore } from './local-cache-byte-source.js';
import {
  OpenRemoteArchiveError,
  openRemoteArchive,
  type ArchiveReadEvent,
} from './open-remote-archive.js';
import type { FetchImpl } from './remote-range-byte-source.js';

/**
 * Why these tests matter: this module IS the policy — every consumer's open
 * goes through exactly this dance, so each branch here is a user-visible
 * behavior: a cache hit that skips the network, a stale cache that must not
 * survive the author overwriting the archive at the same URL, an offline
 * visitor served from the copy they have, a warm download that must never
 * poison the cache with size-mismatched bytes, and the reject causes an app
 * turns into error messages.
 */

const ARCHIVE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const URL_ = 'https://host.example/archive.zip';

interface ServerOptions {
  etag?: string;
  headStatus?: number;
  /** false: GETs ignore Range and stream the whole body (200). */
  supportsRanges?: boolean;
  /** 'wrong-size' truncates the warm download; 'hang' resolves only on abort. */
  fullBody?: 'ok' | 'wrong-size' | 'hang';
  /** Reject every fetch — the offline / CORS-blocked case. */
  reject?: boolean;
  /** Honor Range only for the probe (bytes=0-0), then flip to 200 full-body —
   *  the mid-session CDN behavior change the recovery path exists for. */
  flipRangesAfterProbe?: boolean;
  /** First range-less GET answers 500, later ones succeed — the transient
   *  recovery-download failure that must not be memoised forever. */
  fullBodyFailFirst?: boolean;
  /** Box for a manually-resolved range-less GET — the in-flight recovery
   *  write the evict ordering must not race past. */
  deferredFullBody?: { resolve?: () => void };
}

interface Call {
  url: string;
  method: string;
  range: string | null;
}

/** Response-shaped fake (arrayBuffer/blob/cancel) with controllable headers. */
function respond(
  status: number,
  bytes: Uint8Array,
  headers: Record<string, string>
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    arrayBuffer: () =>
      Promise.resolve(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)
      ),
    blob: () => Promise.resolve(new Blob([bytes as BlobPart])),
    body: null,
  } as unknown as Response;
}

function rangeResponse(
  range: string,
  baseHeaders: Record<string, string>
): Response {
  const m = /^bytes=(\d+)-(\d+)$/.exec(range)!;
  const [start, end] = [Number(m[1]), Number(m[2])];
  const slice = ARCHIVE.slice(start, end + 1);
  return respond(206, slice, {
    ...baseHeaders,
    'content-range': `bytes ${start}-${end}/${ARCHIVE.length}`,
  });
}

/** Full GET (warm/full-download), or a range-ignoring host's 200. */
function fullBodyResponse(
  opts: ServerOptions,
  init: RequestInit | undefined,
  baseHeaders: Record<string, string>,
  tally: { fullBodyCalls: number }
): Promise<Response> {
  tally.fullBodyCalls += 1;
  if (opts.fullBodyFailFirst === true && tally.fullBodyCalls === 1) {
    return Promise.resolve(respond(500, new Uint8Array(0), baseHeaders));
  }
  if (opts.deferredFullBody !== undefined) {
    const box = opts.deferredFullBody;
    return new Promise((resolve) => {
      box.resolve = () => {
        resolve(respond(200, ARCHIVE, baseHeaders));
      };
    });
  }
  if (opts.fullBody === 'hang') {
    // Real fetch rejects immediately on an already-aborted signal — the
    // dispose-before-fetch-starts race depends on this.
    if (init?.signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new Error('aborted'))
      );
    });
  }
  const body = opts.fullBody === 'wrong-size' ? ARCHIVE.slice(0, 3) : ARCHIVE;
  return Promise.resolve(respond(200, body, baseHeaders));
}

function urlOf(input: Parameters<FetchImpl>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function fakeServer(opts: ServerOptions = {}): {
  fetchImpl: FetchImpl;
  calls: Call[];
} {
  const calls: Call[] = [];
  const tally = { fullBodyCalls: 0 };
  const fetchImpl: FetchImpl = (input, init) => {
    const range = new Headers(init?.headers).get('range');
    const method = init?.method ?? 'GET';
    calls.push({ url: urlOf(input), method, range });
    if (opts.reject === true) {
      return Promise.reject(new TypeError('fetch failed'));
    }
    const baseHeaders = {
      'content-length': String(ARCHIVE.length),
      ...(opts.etag !== undefined ? { etag: opts.etag } : {}),
    };
    if (method === 'HEAD') {
      return Promise.resolve(
        respond(opts.headStatus ?? 200, new Uint8Array(0), baseHeaders)
      );
    }
    if (range !== null && opts.supportsRanges !== false) {
      return Promise.resolve(rangedOrFlipped(opts, calls, range, baseHeaders));
    }
    return fullBodyResponse(opts, init, baseHeaders, tally);
  };
  return { fetchImpl, calls };
}

/** A 206 slice — or, once `flipRangesAfterProbe` is armed and the probe is
 *  past, the 200 whole-body answer of a host that stopped honoring Range. */
function rangedOrFlipped(
  opts: ServerOptions,
  calls: Call[],
  range: string,
  baseHeaders: Record<string, string>
): Response {
  const rangesSoFar = calls.filter((c) => c.range !== null).length;
  if (opts.flipRangesAfterProbe === true && rangesSoFar > 1) {
    return respond(200, ARCHIVE, baseHeaders);
  }
  return rangeResponse(range, baseHeaders);
}

describe('openRemoteArchive — ranged path', () => {
  it('opens via ranges and serves exact slices, reporting network reads', async () => {
    const { fetchImpl } = fakeServer({ etag: '"v1"' });
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      onRead: (e) => events.push(e),
    });

    expect(opened.size).toBe(ARCHIVE.length);
    expect(opened.origin).toBe('network');
    await expect(opened.source.read(2, 3)).resolves.toEqual(
      new Uint8Array([3, 4, 5])
    );
    expect(events).toEqual([{ origin: 'network', offset: 2, length: 3 }]);
    // No cache store: nothing to warm.
    await expect(opened.warmed).resolves.toBe(false);
  });

  it('normalizes a share link before opening', async () => {
    const { fetchImpl, calls } = fakeServer();
    await openRemoteArchive('https://github.com/u/r/blob/main/archive.zip', {
      fetchImpl,
    });

    // Every call went to the raw host, not the share page. (The first
    // version asserted only calls.length > 0 — true for any implementation
    // that fetches at all; milestone review #7.)
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url).toBe(
        'https://raw.githubusercontent.com/u/r/main/archive.zip'
      );
    }
  });
});

describe('openRemoteArchive — warm-to-cache', () => {
  it('warms in the background, switches reads to the copy, and persists it', async () => {
    const { fetchImpl } = fakeServer({ etag: '"v1"' });
    const store = new InMemoryLocalCacheStore();
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      onRead: (e) => events.push(e),
    });

    await expect(opened.warmed).resolves.toBe(true);
    await expect(opened.source.read(0, 2)).resolves.toEqual(
      new Uint8Array([1, 2])
    );
    expect(events.at(-1)).toEqual({ origin: 'cache', offset: 0, length: 2 });
    const cached = await store.get(URL_);
    expect(cached?.validators).toEqual({ etag: '"v1"' });
    expect(cached?.blob.size).toBe(ARCHIVE.length);
  });

  // Why this test matters (PR #359 review): the warm download pulls the
  // whole archive over the network but wrapped its blob as a 'cache' source,
  // so a stats consumer showed "132 KB fetched · serving from cache" after
  // 3.5 MB actually crossed the wire — the same metric inversion PR #358
  // review #3 fixed for the eager-local/full-download opens.
  it('the warm download reports its whole-archive network read', async () => {
    const { fetchImpl } = fakeServer({ etag: '"v1"' });
    const store = new InMemoryLocalCacheStore();
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      onRead: (e) => events.push(e),
    });

    await expect(opened.warmed).resolves.toBe(true);
    expect(events).toContainEqual({
      origin: 'network',
      offset: 0,
      length: ARCHIVE.length,
    });
  });

  // Why this test matters (PR #358 review #2): evict() awaited only the
  // recovery download, so a caller trusting the bare-evict() contract could
  // clear the store and have the still-running warm re-poison it moments
  // later. Self-sufficiency means NO dispose-first incantation: a bare
  // evict() lets the in-flight warm write land, then deletes it.
  it('a bare evict() waits for the in-flight warm write instead of racing past it', async () => {
    const deferredFullBody: { resolve?: () => void } = {};
    const { fetchImpl } = fakeServer({ etag: '"v1"', deferredFullBody });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
    });

    const evicting = opened.evict(); // deliberately no dispose() first
    await new Promise((resolve) => setTimeout(resolve, 10));
    deferredFullBody.resolve?.(); // the late warm write lands
    await expect(opened.warmed).resolves.toBe(true);
    await evicting;

    await expect(store.get(URL_)).resolves.toBeUndefined();
  });

  it('refuses to persist a size-mismatched warm download (cache poisoning)', async () => {
    const { fetchImpl } = fakeServer({ fullBody: 'wrong-size' });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
    });

    await expect(opened.warmed).resolves.toBe(false);
    await expect(store.get(URL_)).resolves.toBeUndefined();
    // Reads still work — from the remote source.
    await expect(opened.source.read(0, 2)).resolves.toEqual(
      new Uint8Array([1, 2])
    );
  });

  it('dispose aborts the warm download and the session stays remote', async () => {
    const { fetchImpl } = fakeServer({ fullBody: 'hang' });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
    });

    opened.dispose();
    await expect(opened.warmed).resolves.toBe(false);
    await expect(store.get(URL_)).resolves.toBeUndefined();
  });

  it('warm: false keeps the session remote by choice', async () => {
    const { fetchImpl, calls } = fakeServer();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: new InMemoryLocalCacheStore(),
      warm: false,
    });

    await expect(opened.warmed).resolves.toBe(false);
    // HEAD + probe GET only — no third, full-body fetch.
    expect(calls.filter((c) => c.method === 'GET' && c.range === null)).toEqual(
      []
    );
  });
});

describe('openRemoteArchive — cache lookup', () => {
  async function seededStore(etag?: string) {
    const store = new InMemoryLocalCacheStore();
    await store.put(URL_, {
      blob: new Blob([ARCHIVE]),
      ...(etag !== undefined ? { validators: { etag } } : {}),
    });
    return store;
  }

  it('serves a fresh cached copy without probing, reporting cache reads', async () => {
    const { fetchImpl, calls } = fakeServer({ etag: '"v1"' });
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: await seededStore('"v1"'),
      onRead: (e) => events.push(e),
    });

    expect(opened.origin).toBe('cache');
    await expect(opened.warmed).resolves.toBe(true);
    await expect(opened.source.read(1, 2)).resolves.toEqual(
      new Uint8Array([2, 3])
    );
    expect(events).toEqual([{ origin: 'cache', offset: 1, length: 2 }]);
    // Exactly one revalidation HEAD, never a probe/range GET.
    expect(calls).toEqual([{ url: URL_, method: 'HEAD', range: null }]);
  });

  it('evicts a stale copy (ETag changed) and reopens remote', async () => {
    const { fetchImpl, calls } = fakeServer({ etag: '"v2"' });
    const store = await seededStore('"v1"');
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      warm: false,
    });

    expect(opened.origin).toBe('network');
    // The stale entry is gone even though warming was off.
    expect(calls.some((c) => c.range === 'bytes=0-0')).toBe(true);
  });

  it('treats a same-size copy without validators as fresh (weakest signal)', async () => {
    const { fetchImpl } = fakeServer();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: await seededStore(),
    });

    expect(opened.origin).toBe('cache');
  });

  it('serves the cache when the revalidation HEAD is unreachable (offline)', async () => {
    const { fetchImpl } = fakeServer({ reject: true });
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: await seededStore('"v1"'),
    });

    expect(opened.origin).toBe('cache');
    await expect(opened.source.read(0, 1)).resolves.toEqual(
      new Uint8Array([1])
    );
  });

  // Why this test matters (PR #357 review): a definitive 404 on the
  // revalidation HEAD used to be lumped with "host unreachable", so a
  // DELETED archive was served from cache forever. Deletion is an author
  // action the viewer must honor; only genuine unreachability keeps the
  // availability-over-freshness behavior.
  it('evicts the cached copy when the revalidation HEAD says the archive is gone', async () => {
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(respond(404, new Uint8Array(0), {}));
    const store = await seededStore('"v1"');

    const err = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(OpenRemoteArchiveError);
    expect((err as OpenRemoteArchiveError).rejectCause).toBe('missing');
    await expect(store.get(URL_)).resolves.toBeUndefined();
  });

  it('skipCache bypasses the lookup, and evict drops the entry', async () => {
    const { fetchImpl } = fakeServer({ etag: '"v1"' });
    const store = await seededStore('"v1"');
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      skipCache: true,
      warm: false,
    });

    expect(opened.origin).toBe('network');
    await opened.evict();
    await expect(store.get(URL_)).resolves.toBeUndefined();
  });
});

describe('openRemoteArchive — mid-session range-ignore recovery', () => {
  // Why these tests matter: a host that 206s on the probe and 200s later
  // (CDN node variance, a backend flip) used to fail the session permanently
  // — the documented "re-probe and fall back" recovery did not exist
  // (milestone review #2). The one-shot switch seam is exactly the mechanism
  // to swap the live session onto a full local copy instead.
  it('recovers a read transparently when the host stops honoring Range', async () => {
    const { fetchImpl } = fakeServer({ flipRangesAfterProbe: true });
    const opened = await openRemoteArchive(URL_, { fetchImpl, warm: false });

    // The first real read hits the flipped host, triggers the recovery
    // download, and still returns the exact requested slice.
    await expect(opened.source.read(2, 3)).resolves.toEqual(
      new Uint8Array([3, 4, 5])
    );
    // Later reads are served locally (no further network needed).
    await expect(opened.source.read(5, 2)).resolves.toEqual(
      new Uint8Array([6, 7])
    );
  });

  it('downloads the archive exactly once for concurrent failing reads', async () => {
    const { fetchImpl, calls } = fakeServer({ flipRangesAfterProbe: true });
    const opened = await openRemoteArchive(URL_, { fetchImpl, warm: false });

    const reads = await Promise.all([
      opened.source.read(0, 2),
      opened.source.read(2, 2),
      opened.source.read(4, 2),
    ]);
    expect(reads).toEqual([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5, 6]),
    ]);
    // Exactly one recovery full-body GET (range-less).
    expect(
      calls.filter((c) => c.method === 'GET' && c.range === null)
    ).toHaveLength(1);
  });

  // Why this test matters (PR #357 review): the single-flight promise used to
  // memoise a REJECTION too, so one transient failure during the recovery
  // download permanently bricked the session — every later read replayed the
  // same cached error with no way out but a full reopen.
  it('retries the recovery download after a transient failure', async () => {
    const { fetchImpl } = fakeServer({
      flipRangesAfterProbe: true,
      fullBodyFailFirst: true,
    });
    const opened = await openRemoteArchive(URL_, { fetchImpl, warm: false });

    await expect(opened.source.read(0, 3)).rejects.toThrow();
    // The next read must attempt a fresh download, not replay the failure.
    await expect(opened.source.read(0, 3)).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  // Why this test matters (PR #357 review): the recovery's cache write was
  // not awaited by evict(), so the documented dispose → await warmed → evict
  // cleanup could run BEFORE a late recovery write landed — re-poisoning the
  // cache the eviction had just cleared.
  it('evict waits for an in-flight recovery write instead of racing past it', async () => {
    const deferredFullBody: { resolve?: () => void } = {};
    const { fetchImpl } = fakeServer({
      flipRangesAfterProbe: true,
      deferredFullBody,
    });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      warm: false,
    });

    const reading = opened.source.read(0, 3);
    // Let the failed range read register the recovery download (one
    // macrotask); the download itself stays pending on the deferred body —
    // exactly the "write still in flight" window the review named. (evict's
    // contract is "after the parse settled", so racing INSIDE the register
    // gap is out of contract.)
    await new Promise((resolve) => setTimeout(resolve, 0));
    const evicting = opened.evict(); // must wait for the write, then delete
    await new Promise((resolve) => setTimeout(resolve, 10));
    deferredFullBody.resolve?.(); // the late write lands
    await expect(reading).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await evicting;

    await expect(store.get(URL_)).resolves.toBeUndefined();
  });

  // Why this test matters (PR #359 review): evict() awaits the writers that
  // exist NOW, but the session stays live after eviction (the TourViewer
  // evicts, clears, and keeps streaming) — a RangeIgnoredError on any LATER
  // read used to run the recovery download and store.put the archive right
  // back into the store the user was just told is empty. The latch permits
  // the recovery to still SERVE the read; only the persistence is disarmed.
  it('a recovery that starts after evict() serves the read but never repersists', async () => {
    const { fetchImpl } = fakeServer({ flipRangesAfterProbe: true });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      warm: false,
    });

    await opened.evict();
    // The flipped host fails the range read AFTER the eviction — recovery
    // downloads, serves the exact slice, and must not touch the store.
    await expect(opened.source.read(2, 3)).resolves.toEqual(
      new Uint8Array([3, 4, 5])
    );
    await expect(store.get(URL_)).resolves.toBeUndefined();
  });

  // Why this test matters (PR #359 review, same inversion as the warm half):
  // the recovery download is a whole-archive network transfer and must
  // report itself, or the panel proves "how little was fetched" with a lie.
  it('the recovery download reports its whole-archive network read', async () => {
    const { fetchImpl } = fakeServer({ flipRangesAfterProbe: true });
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      warm: false,
      onRead: (e) => events.push(e),
    });

    await expect(opened.source.read(2, 3)).resolves.toEqual(
      new Uint8Array([3, 4, 5])
    );
    expect(events).toContainEqual({
      origin: 'network',
      offset: 0,
      length: ARCHIVE.length,
    });
    // The range read that FAILED (200-answered slice → RangeIgnoredError)
    // must not be counted: onRead reports delivered bytes after the read
    // settles, so the stats the panel shows cannot overstate by every failed
    // slice on top of the recovery download (PR #363 review).
    expect(events).not.toContainEqual({
      origin: 'network',
      offset: 2,
      length: 3,
    });
  });

  it('persists the recovered copy so the next visit skips the broken host', async () => {
    const { fetchImpl } = fakeServer({
      flipRangesAfterProbe: true,
      etag: '"v1"',
    });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
      warm: false,
    });

    await expect(opened.source.read(0, 3)).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    const cached = await store.get(URL_);
    expect(cached?.blob.size).toBe(ARCHIVE.length);
    expect(cached?.validators).toEqual({ etag: '"v1"' });
  });
});

describe('openRemoteArchive — fallbacks and rejections', () => {
  it('a range-ignoring host degrades to an eager local copy, persisted', async () => {
    const { fetchImpl } = fakeServer({ supportsRanges: false, etag: '"v1"' });
    const store = new InMemoryLocalCacheStore();
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      cacheStore: store,
    });

    expect(opened.origin).toBe('network');
    await expect(opened.warmed).resolves.toBe(true);
    await expect(opened.source.read(4, 2)).resolves.toEqual(
      new Uint8Array([5, 6])
    );
    await expect(store.get(URL_)).resolves.toBeDefined();
  });

  // Why this test matters (PR #358 review #3): the eager-local and
  // full-download paths pull the WHOLE archive over the network, yet every
  // later read is served locally and reported 'cache' — so a stats consumer
  // showed "0 B fetched · serving from cache" right after downloading
  // everything, inverting its headline metric. The open itself must report
  // one whole-archive network read (both paths share `openLocal`, so one
  // test covers the seam for both).
  it('reports the whole-archive network read when degrading to an eager local copy', async () => {
    const { fetchImpl } = fakeServer({ supportsRanges: false });
    const events: ArchiveReadEvent[] = [];
    const opened = await openRemoteArchive(URL_, {
      fetchImpl,
      onRead: (e) => events.push(e),
    });

    expect(events).toEqual([
      { origin: 'network', offset: 0, length: ARCHIVE.length },
    ]);
    await expect(opened.source.read(0, 2)).resolves.toEqual(
      new Uint8Array([1, 2])
    );
    expect(events.at(-1)).toEqual({ origin: 'cache', offset: 0, length: 2 });
  });

  it('rejects a missing archive with cause "missing"', async () => {
    const fetchImpl: FetchImpl = () =>
      Promise.resolve(respond(404, new Uint8Array(0), {}));

    const err = await openRemoteArchive(URL_, { fetchImpl }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(OpenRemoteArchiveError);
    expect((err as OpenRemoteArchiveError).rejectCause).toBe('missing');
  });

  it('maps a fetch-level rejection (network/CORS) to cause "cors"', async () => {
    const { fetchImpl } = fakeServer({ reject: true });

    const err = await openRemoteArchive(URL_, { fetchImpl }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(OpenRemoteArchiveError);
    expect((err as OpenRemoteArchiveError).rejectCause).toBe('cors');
  });
});
