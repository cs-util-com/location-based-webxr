/**
 * A `fetch` that keeps each URL's bytes once fetched: the measuring
 * worker builds its methods again for every pair, and without the memo
 * each pair would fetch (or read from the HTTP cache) every model again.
 * Each call gets its own `Response`, so every caller can read the body.
 * A rejected fetch or an error status is not kept: the next call fetches
 * again. The memo lives as long as the worker; a crash empties it.
 *
 * @see fetch-memo.ts.md
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

interface Kept {
  readonly bytes: ArrayBuffer;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
}

/** Wraps `fetchFn` with a per-URL memo of successful bodies. */
export function memoFetch(fetchFn: Fetch): Fetch {
  const kept = new Map<string, Promise<Kept | Response>>();
  return async (url, init) => {
    let entry = kept.get(url);
    if (entry === undefined) {
      entry = (async () => {
        const res = await fetchFn(url, init);
        // An error status goes back to its caller as it came, unkept.
        return res.ok
          ? {
              bytes: await res.arrayBuffer(),
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
            }
          : res;
      })();
      kept.set(url, entry);
    }
    const drop = (): void => {
      if (kept.get(url) === entry) {
        kept.delete(url);
      }
    };
    let k: Kept | Response;
    try {
      k = await entry;
    } catch (e) {
      drop();
      throw e;
    }
    if (k instanceof Response) {
      drop();
      return k.clone();
    }
    return new Response(k.bytes.slice(0), {
      status: k.status,
      statusText: k.statusText,
      headers: k.headers,
    });
  };
}
