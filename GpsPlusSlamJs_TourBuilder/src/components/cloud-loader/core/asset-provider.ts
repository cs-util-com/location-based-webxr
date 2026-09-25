/**
 * `RefCountedAssetProvider` — the generic implementation of the contract's
 * `AssetProvider` (D14, §3).
 *
 * It knows nothing about zips or ranges: given an async `loadAssetBlob(id)`
 * backing and a URL minter, it owns only tier-1 memory (the Blob/Blob URL) and
 * the two hard guarantees of the contract — ref-counting (balanced
 * `getAssetUrl`/`release`, one revoke at count 0) and reject-on-error with a
 * retry policy that distinguishes transient from structural failures (C13,
 * C15). The viewing-mode zip specifics — id→entry→bytes with the right MIME —
 * live in the backing built by `open-remote-tour`; the same class can back the
 * authoring `FilesAssetProvider` and test `StaticAssetProvider` (D14d) with a
 * different `loadAssetBlob`.
 *
 * @see plans/2026-07-24-cloud-loader-plan.md (C12, C13, C15)
 */

import { StructuralReadError } from "gps-plus-slam-app-framework/storage";

import type { AssetId, AssetProvider } from "../../../store/types.js";

export interface RefCountedAssetProviderDeps {
  /** Backing: resolve an asset id to its bytes as a typed Blob. Throw a
   *  {@link StructuralReadError} for permanent failures (unknown id, decode);
   *  any other rejection is treated as transient and retried. */
  loadAssetBlob(id: AssetId): Promise<Blob>;
  /** Defaults to `URL.createObjectURL` (absent in Node — injected in tests). */
  createObjectUrl?: ((blob: Blob) => string) | undefined;
  /** Defaults to `URL.revokeObjectURL`. */
  revokeObjectUrl?: ((url: string) => void) | undefined;
  /** Extra attempts after the first for transient failures (default 2). */
  maxRetries?: number | undefined;
  /** Backoff delay; injected as a no-op in tests (default exponential). */
  delay?: ((ms: number) => Promise<void>) | undefined;
}

interface Ref {
  count: number;
  /** Shared across concurrent + repeat callers so an id is loaded once. */
  url: Promise<string>;
  /** The resolved URL once the load settles — lets `release` revoke synchronously. */
  settledUrl?: string;
}

/** Base backoff in ms; attempt n waits BASE·2ⁿ (2s / 4s / 8s …). */
const BACKOFF_BASE_MS = 2000;

export class RefCountedAssetProvider implements AssetProvider {
  readonly #load: (id: AssetId) => Promise<Blob>;
  readonly #createUrl: (blob: Blob) => string;
  readonly #revokeUrl: (url: string) => void;
  readonly #maxRetries: number;
  readonly #delay: (ms: number) => Promise<void>;

  readonly #refs = new Map<AssetId, Ref>();

  constructor(deps: RefCountedAssetProviderDeps) {
    this.#load = (id) => deps.loadAssetBlob(id);
    this.#createUrl = deps.createObjectUrl ?? ((b) => URL.createObjectURL(b));
    this.#revokeUrl = deps.revokeObjectUrl ?? ((u) => URL.revokeObjectURL(u));
    this.#maxRetries = deps.maxRetries ?? 2;
    this.#delay = deps.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Load an asset's bytes, retrying *transient* failures with backoff.
   * A {@link StructuralReadError} is permanent — thrown at once, never retried.
   */
  async #loadWithRetry(id: AssetId): Promise<Blob> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        return await this.#load(id);
      } catch (err) {
        if (err instanceof StructuralReadError) throw err;
        lastErr = err;
        if (attempt < this.#maxRetries) {
          await this.#delay(BACKOFF_BASE_MS * 2 ** attempt);
        }
      }
    }
    throw lastErr;
  }

  getAssetUrl(id: AssetId): Promise<string> {
    const existing = this.#refs.get(id);
    if (existing) {
      existing.count += 1;
      return existing.url;
    }
    const ref: Ref = {
      count: 1,
      url: this.#loadWithRetry(id).then((blob) => {
        ref.settledUrl = this.#createUrl(blob);
        return ref.settledUrl;
      }),
    };
    // A failed load evicts itself so a later request (e.g. re-entering the zone)
    // starts a fresh attempt instead of replaying the cached rejection (C15).
    ref.url.catch(() => {
      if (this.#refs.get(id) === ref) this.#refs.delete(id);
    });
    this.#refs.set(id, ref);
    return ref.url;
  }

  release(id: AssetId): void {
    const ref = this.#refs.get(id);
    if (!ref) return;
    ref.count -= 1;
    if (ref.count > 0) return;

    this.#refs.delete(id);
    if (ref.settledUrl !== undefined) {
      this.#revokeUrl(ref.settledUrl); // common case: load already resolved
    } else {
      // released while still loading — revoke once the URL exists
      void ref.url.then((url) => this.#revokeUrl(url)).catch(() => undefined);
    }
  }
}
