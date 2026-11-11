// In-memory stand-ins for the R2 bucket, the queue, the rate limiter, with only the behaviour the Worker relies on. Test-only.
import type {
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
  send(message: FillMessage): Promise<void> {
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
