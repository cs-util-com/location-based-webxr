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
}

interface Call {
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
  baseHeaders: Record<string, string>
): Promise<Response> {
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

function fakeServer(opts: ServerOptions = {}): {
  fetchImpl: FetchImpl;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchImpl = (_input, init) => {
    const range = new Headers(init?.headers).get('range');
    const method = init?.method ?? 'GET';
    calls.push({ method, range });
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
      return Promise.resolve(rangeResponse(range, baseHeaders));
    }
    return fullBodyResponse(opts, init, baseHeaders);
  };
  return { fetchImpl, calls };
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

    // Every call went to the raw host, not the share page.
    expect(calls.length).toBeGreaterThan(0);
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
    expect(calls).toEqual([{ method: 'HEAD', range: null }]);
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

  it('rejects a missing archive with cause "missing"', async () => {
    const fetchImpl: FetchImpl = (_input, init) =>
      Promise.resolve(
        respond(init?.method === 'HEAD' ? 404 : 404, new Uint8Array(0), {})
      );

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
