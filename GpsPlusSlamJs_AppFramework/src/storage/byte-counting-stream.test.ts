import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { ArchiveLimitError } from './archive-limits.js';
import { byteCountingStream } from './byte-counting-stream.js';

/**
 * Why these tests matter (K0 milestone review R5): the capped reads used to
 * collect every chunk in a JS array before building a Blob, so a cap of
 * 1 GiB was also up to 1 GiB of page memory on a phone. The counting now
 * happens in a stream that hands each chunk straight on (to
 * `Response.blob()`, or to zip.js's writable), so the cap is a cap and not
 * a buffer. These tests pin the counter: totals as chunks pass, nothing
 * delivered past a refusal, and the refusal is the caller's own error on
 * BOTH ends of the stream (the reader and whoever writes into it).
 */

function chunksOf(sizes: readonly number[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= sizes.length) controller.close();
      else controller.enqueue(new Uint8Array(sizes[i++]!).fill(7));
    },
  });
}

describe('byteCountingStream', () => {
  it('passes every chunk through and reports the running total after each', async () => {
    const totals: number[] = [];
    const out = chunksOf([3, 5, 2]).pipeThrough(
      byteCountingStream((total) => {
        totals.push(total);
      })
    );
    const blob = await new Response(out).blob();
    expect(blob.size).toBe(10);
    expect(totals).toEqual([3, 8, 10]);
  });

  it('stops at the chunk whose total the callback refuses, and delivers nothing of it', async () => {
    const refusal = new ArchiveLimitError('archive-bytes', 6, 8);
    const delivered: number[] = [];
    const out = chunksOf([3, 5, 2]).pipeThrough(
      byteCountingStream((total) => {
        if (total > 6) throw refusal;
      })
    );
    const reader = out.getReader();
    const err = await (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return null;
        delivered.push(value.length);
      }
    })().catch((e: unknown) => e);
    expect(err).toBe(refusal);
    expect(delivered).toEqual([3]);
  });

  it('cancels the source once it refuses (the rest is never pulled)', async () => {
    let pulls = 0;
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const out = source.pipeThrough(
      byteCountingStream((total) => {
        if (total > 8) throw new RangeError('over');
      })
    );
    await expect(new Response(out).blob()).rejects.toThrow('over');
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it('rejects the WRITER with the same error (zip.js writes into it)', async () => {
    const refusal = new ArchiveLimitError('entry-bytes', 4, 6);
    const counter = byteCountingStream((total) => {
      if (total > 4) throw refusal;
    });
    const blob = new Response(counter.readable).blob();
    blob.catch(() => undefined);
    const writer = counter.writable.getWriter();
    await writer.write(new Uint8Array(3));
    const err = await writer.write(new Uint8Array(3)).catch((e: unknown) => e);
    expect(err).toBe(refusal);
    await expect(blob).rejects.toBe(refusal);
  });

  it('property: the reported totals are the prefix sums of the chunk sizes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 64 }), { maxLength: 20 }),
        async (sizes) => {
          const totals: number[] = [];
          const blob = await new Response(
            chunksOf(sizes).pipeThrough(
              byteCountingStream((total) => {
                totals.push(total);
              })
            )
          ).blob();
          const nonEmpty = sizes.filter((s) => s > 0);
          let sum = 0;
          expect(totals).toEqual(nonEmpty.map((s) => (sum += s)));
          expect(blob.size).toBe(sum);
        }
      )
    );
  });
});
