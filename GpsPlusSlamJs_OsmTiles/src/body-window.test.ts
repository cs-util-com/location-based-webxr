import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BodyTooLarge,
  gzipDecodedSize,
  inflateHead,
  readBodyEnds,
  SourceReadError,
} from "./body-window";

// Why these tests matter: the fill judges a gzip answer by its inflated head
// alone and the verify judges a stored tile by its two ends, so these
// windows are what stands between a bad tile and every client. Through the
// fill and verify tests they only ever see a body in one or two chunks; a
// network stream arrives in many small ones, and a tail stitched wrongly
// across them, or a head cut at the input bound misread, would judge the
// wrong bytes.

const encoder = new TextEncoder();

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A stream of `bytes` cut into chunks of the given sizes, cycled. */
function chunked(
  bytes: Uint8Array,
  sizes: number[],
): ReadableStream<Uint8Array> {
  let offset = 0;
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[i++ % sizes.length] ?? 1;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** Pseudo-random text that deflate cannot shrink much. */
function noisy(length: number): Uint8Array {
  let x = 2463534242;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = 0x21 + ((x >>> 0) % 90);
  }
  return out;
}

/** A stream that sends the first `sent` bytes of `bytes`, then fails as a torn read does. */
function failingAfter(
  bytes: Uint8Array,
  sent: number,
): ReadableStream<Uint8Array> {
  let done = false;
  return new ReadableStream({
    pull(controller) {
      if (done) {
        controller.error(new TypeError("network connection lost"));
        return;
      }
      done = true;
      controller.enqueue(bytes.slice(0, sent));
    },
  });
}

describe("readBodyEnds", () => {
  it("rejects with SourceReadError when the stored stream itself fails, raw or gzip", async () => {
    // Why this test matters: a torn read of the stored object says nothing
    // about the tile, while a gzip error is evidence against it. The verify
    // deletes on the second only, so the two must never look alike.
    const body = noisy(50_000);
    const zipped = await gzip(body);
    await expect(
      readBodyEnds(failingAfter(body, 10_000), false, 16, 16),
    ).rejects.toBeInstanceOf(SourceReadError);
    await expect(
      readBodyEnds(failingAfter(zipped, 1_000), true, 16, 16),
    ).rejects.toBeInstanceOf(SourceReadError);
  });

  // How many bytes short of the stored size the stream ends: 0 is a whole
  // read, any shortfall a source that stopped early.
  for (const [kind, short] of [
    ["raw", 1],
    ["raw", 30_000],
    ["gzip", 1],
    ["gzip", 1_000],
  ] as const) {
    it(`rejects with SourceReadError when a ${kind} stream ends ${short} bytes short of its size`, async () => {
      // Why this test matters: a stream that ends early without an error
      // looks like a cut tile (no closing bracket, a cut gzip), which the
      // verify deletes. Only the stored size tells the two apart: fewer
      // bytes than it is a failed read, no evidence about the tile.
      const body = noisy(50_000);
      const bytes = kind === "gzip" ? await gzip(body) : body;
      const cut = chunked(bytes.slice(0, bytes.length - short), [4_096]);
      await expect(
        readBodyEnds(cut, kind === "gzip", 16, 16, 2 ** 20, bytes.length),
      ).rejects.toBeInstanceOf(SourceReadError);
    });
  }

  it("reads a stream that delivers exactly its stored size as before", async () => {
    const body = noisy(50_000);
    const zipped = await gzip(body);
    for (const [bytes, isGzip] of [
      [body, false],
      [zipped, true],
    ] as const) {
      const ends = await readBodyEnds(
        chunked(bytes, [4_096]),
        isGzip,
        16,
        16,
        2 ** 20,
        bytes.length,
      );
      expect(ends.head).toEqual(body.slice(0, 16));
      expect(ends.tail).toEqual(body.slice(body.length - 16));
    }
  });

  it("keeps a gzip error that is not a read error as it was (no SourceReadError)", async () => {
    const zipped = await gzip(noisy(50_000));
    const cut = chunked(zipped.slice(0, 2_000), [500]);
    const error: unknown = await readBodyEnds(cut, true, 16, 16).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SourceReadError);
  });

  it("property: head and tail are the body's first and last bytes for any chunking", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 3000 }),
        fc.array(fc.integer({ min: 1, max: 700 }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 0, max: 600 }),
        async (bytes, sizes, headBytes, tailBytes) => {
          const ends = await readBodyEnds(
            chunked(bytes, sizes),
            false,
            headBytes,
            tailBytes,
          );
          expect(ends.head).toEqual(bytes.slice(0, headBytes));
          expect(ends.tail).toEqual(
            bytes.slice(Math.max(0, bytes.length - tailBytes)),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("stitches the tail of a gzip body from many small decoded chunks", async () => {
    const text = encoder.encode("x".repeat(5000) + "THE-END");
    const ends = await readBodyEnds(
      chunked(await gzip(text), [3, 1, 7]),
      true,
      4,
      10,
    );
    expect(new TextDecoder().decode(ends.tail)).toBe("xxxTHE-END");
    expect(new TextDecoder().decode(ends.head)).toBe("xxxx");
  });

  it("stops past the decoded bound with BodyTooLarge (a gzip bomb)", async () => {
    const bomb = await gzip(new Uint8Array(4 * 2 ** 20));
    expect(bomb.length).toBeLessThan(10_000);
    await expect(
      readBodyEnds(chunked(bomb, [1024]), true, 16, 16, 2 ** 20),
    ).rejects.toBeInstanceOf(BodyTooLarge);
  });

  it("cancels the stream it stops reading past the bound", async () => {
    let cancelled = false;
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      readBodyEnds(endless, false, 16, 16, 10_000),
    ).rejects.toBeInstanceOf(BodyTooLarge);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(20);
  });

  it("counts the bound on decoded bytes: a body exactly at it passes", async () => {
    const body = new Uint8Array(1000);
    const ends = await readBodyEnds(chunked(body, [64]), false, 1, 1, 1000);
    expect(ends.tail).toHaveLength(1);
  });
});

describe("inflateHead", () => {
  it("returns the head of a gzip far longer than its input bound", async () => {
    const text = noisy(200_000);
    const packed = await gzip(text);
    expect(packed.length).toBeGreaterThan(16_384);
    const head = await inflateHead(packed, 2048);
    expect(head).toEqual(text.slice(0, 2048));
  });

  it("rejects bytes cut at the input bound when nothing inflates from them", async () => {
    // The gzip magic, then no valid deflate data: past the 16 KB bound the
    // stream is cut, and with nothing out the cut is no excuse.
    const junk = new Uint8Array(40_000).fill(0xff);
    junk.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]);
    await expect(inflateHead(junk, 2048)).rejects.toBeDefined();
  });

  it("rejects a whole short gzip that is cut", async () => {
    const packed = await gzip(encoder.encode("{ short }"));
    await expect(
      inflateHead(packed.slice(0, packed.length - 6), 2048),
    ).rejects.toBeDefined();
  });
});

describe("gzipDecodedSize", () => {
  it("reads the trailer's ISIZE, little-endian", async () => {
    const text = noisy(70_000);
    expect(gzipDecodedSize(await gzip(text))).toBe(70_000);
  });

  it("is undefined for bytes too short to be gzip", () => {
    expect(gzipDecodedSize(new Uint8Array(19))).toBeUndefined();
  });
});
