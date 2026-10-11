import { describe, expect, it, vi } from 'vitest';

import { ArchiveLimitError } from './archive-limits.js';
import { readResponseBodyCapped } from './capped-response-body.js';

/**
 * Why these tests matter: every whole-body download of an archive (the
 * probe's 200 from a host that ignores Range, the full download, the warm
 * copy and the range-ignore recovery) used to call `res.blob()` with no
 * limit, so a host - or a crafted link - could pour any number of bytes
 * into the page. The cap must hold BEFORE the body is fetched when the
 * size is announced, and WHILE it streams when the header is missing or
 * lies.
 */

function streamOf(chunks: Uint8Array[]): {
  stream: ReadableStream<Uint8Array>;
  pulled: () => number;
  cancelled: () => boolean;
} {
  let index = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, pulled: () => index, cancelled: () => cancelled };
}

describe('readResponseBodyCapped', () => {
  it('refuses an announced size above the cap without reading the body', async () => {
    const body = streamOf([new Uint8Array(10)]);
    const res = new Response(body.stream, {
      headers: { 'content-length': '5000' },
    });
    const blob = vi.spyOn(res, 'blob');
    const err = await readResponseBodyCapped(res, 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    expect((err as ArchiveLimitError).kind).toBe('archive-bytes');
    expect((err as ArchiveLimitError).observed).toBe(5000);
    expect(body.pulled()).toBe(0);
    expect(body.cancelled()).toBe(true);
    expect(blob).not.toHaveBeenCalled();
  });

  it('stops a body without Content-Length as soon as it passes the cap', async () => {
    const chunks = Array.from({ length: 50 }, () => new Uint8Array(40));
    const body = streamOf(chunks);
    const res = new Response(body.stream);
    const err = await readResponseBodyCapped(res, 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLimitError);
    // 3 chunks = 120 bytes pass the cap of 100; nothing after is pulled
    // (a stream may pull one chunk ahead).
    expect(body.pulled()).toBeLessThanOrEqual(4);
    expect(body.cancelled()).toBe(true);
  });

  it('stops a body whose Content-Length lies low', async () => {
    const body = streamOf(Array.from({ length: 50 }, () => new Uint8Array(40)));
    const res = new Response(body.stream, {
      headers: { 'content-length': '40' },
    });
    await expect(readResponseBodyCapped(res, 100)).rejects.toBeInstanceOf(
      ArchiveLimitError
    );
    expect(body.pulled()).toBeLessThanOrEqual(4);
  });

  it('returns the whole body under the cap, typed as the response says', async () => {
    const res = new Response(
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]).stream,
      { headers: { 'content-type': 'application/zip' } }
    );
    const blob = await readResponseBodyCapped(res, 3);
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('application/zip');
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('checks the size after the fact when a response has no stream', async () => {
    // Response-shaped fakes (and some polyfills) expose only blob(): the cap
    // still holds, one step later.
    const fake = {
      headers: new Headers(),
      body: null,
      blob: () => Promise.resolve(new Blob([new Uint8Array(500)])),
    } as unknown as Response;
    await expect(readResponseBodyCapped(fake, 100)).rejects.toBeInstanceOf(
      ArchiveLimitError
    );
    const small = {
      headers: new Headers(),
      body: null,
      blob: () => Promise.resolve(new Blob([new Uint8Array(50)])),
    } as unknown as Response;
    expect((await readResponseBodyCapped(small, 100)).size).toBe(50);
  });

  it('ignores an unreadable Content-Length and still counts', async () => {
    const res = new Response(streamOf([new Uint8Array(10)]).stream, {
      headers: { 'content-length': 'abc' },
    });
    expect((await readResponseBodyCapped(res, 100)).size).toBe(10);
  });

  it('refuses a non-positive cap (a cap of 0 would refuse every archive)', async () => {
    await expect(
      readResponseBodyCapped(new Response('x'), 0)
    ).rejects.toBeInstanceOf(RangeError);
  });
});
