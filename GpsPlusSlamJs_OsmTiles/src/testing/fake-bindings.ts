// In-memory stand-ins for the R2 bucket, the queue, the rate limiter, with only the behaviour the Worker relies on. Test-only.
import type {
  BucketListing,
  BucketListOptions,
  FillMessage,
  FillQueue,
  RateLimiter,
  TileBucket,
  TileObjectBody,
  TileObjectHead,
  TilePutOptions,
} from "../bindings";

interface Stored {
  readonly bytes: Uint8Array;
  readonly options: TilePutOptions;
  readonly uploaded: Date;
}

export class FakeBucket implements TileBucket {
  readonly objects = new Map<string, Stored>();
  readonly puts: string[] = [];
  now = () => new Date("2026-11-11T10:00:00Z");

  head(key: string): Promise<TileObjectHead | null> {
    const stored = this.objects.get(key);
    return Promise.resolve(
      stored === undefined ? null : this.meta(key, stored),
    );
  }

  get(key: string): Promise<TileObjectBody | null> {
    const stored = this.objects.get(key);
    if (stored === undefined) return Promise.resolve(null);
    const bytes = stored.bytes;
    return Promise.resolve({
      ...this.meta(key, stored),
      body: new Blob([bytes as BlobPart]).stream(),
      text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    });
  }

  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options: TilePutOptions = {},
  ): Promise<unknown> {
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value);
    this.puts.push(key);
    this.objects.set(key, { bytes, options, uploaded: this.now() });
    return Promise.resolve({});
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** Lexicographic like R2; `pageSize` lets a test force several pages. */
  pageSize = 1000;
  readonly listCalls: BucketListOptions[] = [];
  list(options: BucketListOptions): Promise<BucketListing> {
    this.listCalls.push(options);
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix))
      .sort();
    const start = options.cursor === undefined ? 0 : Number(options.cursor);
    const size = Math.min(options.limit ?? 1000, this.pageSize);
    const page = keys.slice(start, start + size);
    const objects = page.map((key) => {
      const meta = this.meta(key, this.objects.get(key) as Stored);
      // R2 returns custom metadata in a listing only when asked to.
      if (options.include?.includes("customMetadata") === true) return meta;
      const { customMetadata: _omitted, ...rest } = meta;
      return rest;
    });
    const next = start + size;
    return Promise.resolve(
      next < keys.length
        ? { objects, truncated: true, cursor: String(next) }
        : { objects, truncated: false },
    );
  }

  /** Test helper: the stored text of an object (undefined when absent). */
  textOf(key: string): string | undefined {
    const stored = this.objects.get(key);
    return stored === undefined
      ? undefined
      : new TextDecoder().decode(stored.bytes);
  }

  bytesOf(key: string): Uint8Array | undefined {
    return this.objects.get(key)?.bytes;
  }

  private meta(key: string, stored: Stored): TileObjectHead {
    return {
      key,
      size: stored.bytes.length,
      uploaded: stored.uploaded,
      httpEtag: `"etag-${key}-${stored.bytes.length}"`,
      ...(stored.options.httpMetadata === undefined
        ? {}
        : { httpMetadata: stored.options.httpMetadata }),
      ...(stored.options.customMetadata === undefined
        ? {}
        : { customMetadata: stored.options.customMetadata }),
    };
  }
}

export class FakeQueue implements FillQueue {
  readonly sent: FillMessage[] = [];
  /** Set to make `send` reject, as a queue outage would. */
  failWith: Error | undefined;
  send(message: FillMessage): Promise<void> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve();
  }
}

export class FakeLimiter implements RateLimiter {
  allow = true;
  readonly keys: string[] = [];
  limit(options: { key: string }): Promise<{ success: boolean }> {
    this.keys.push(options.key);
    return Promise.resolve({ success: this.allow });
  }
}
