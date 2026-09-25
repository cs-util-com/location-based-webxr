/**
 * Template loader — the one place an asset turns into a parsed, GPU-resident
 * template, shared by every presenter (plan A9).
 *
 * It owns the three things that must be decided once per **asset**, not once
 * per waypoint:
 *
 * - **the LRU** (`core/model-cache`), whose entry also owns the asset's blob
 *   reference — so eviction is what finally calls `release()`;
 * - **the parse queue** (`core/parse-queue`), capping main-thread parses;
 * - **in-flight de-duplication.** Two waypoints a few metres apart can share one
 *   model id (the contract allows it) and cross the prefetch line in the same
 *   update. Without this map both would fetch and parse the same GLB — twice the
 *   jank the PREFETCH zone exists to avoid, and twice the VRAM until the cache
 *   noticed the duplicate.
 *
 * Every `acquire()` that resolves must be balanced by exactly one `release()`,
 * mirroring the asset-provider's own contract (D14).
 */

import type { AssetId, AssetProvider } from "../../../store/types.js";
import type { ModelCache } from "../core/model-cache.js";
import type { ParseQueue } from "../core/parse-queue.js";
import type { SceneAdapter, TemplateHandle } from "./scene-adapter.js";

export interface TemplateLoaderDeps {
  readonly adapter: SceneAdapter;
  readonly assetProvider: AssetProvider;
  readonly queue: ParseQueue;
  readonly cache: ModelCache<TemplateHandle>;
}

export interface TemplateLoader {
  /** Resolve a parsed template, taking one reference for the caller. */
  acquire(assetId: AssetId, kind: "model" | "sprite"): Promise<TemplateHandle>;
  /** Balance one resolved `acquire()`. */
  release(assetId: AssetId): void;
  /**
   * Abandon everything still in flight (tour change, teardown). A load that
   * lands after this frees itself instead of entering the cache — otherwise its
   * blob reference would be owned by a cache entry nobody will ever evict.
   */
  invalidate(): void;
}

/** A load that resolved after its loader was invalidated. Never surfaced to the user. */
class StaleLoadError extends Error {
  constructor(assetId: AssetId) {
    super(`load of ${assetId} completed after teardown`);
    this.name = "StaleLoadError";
  }
}

export function createTemplateLoader(deps: TemplateLoaderDeps): TemplateLoader {
  const { adapter, assetProvider, queue, cache } = deps;
  const inFlight = new Map<AssetId, Promise<TemplateHandle>>();
  let epoch = 0;

  /** The full fetch → parse → cache chain for one asset. */
  async function load(
    assetId: AssetId,
    kind: "model" | "sprite",
  ): Promise<TemplateHandle> {
    const startedAt = epoch;
    let url: string | null = null;
    try {
      url = await assetProvider.getAssetUrl(assetId);
      const template = await queue.run(() => adapter.buildTemplate(kind, url!));
      if (startedAt !== epoch) {
        // The tour changed or the scene was disposed while this was parsing.
        // Free it here and now: putting it in the cache would hand its blob
        // reference to an entry no eviction will ever reach.
        adapter.disposeTemplate(template);
        assetProvider.release(assetId);
        throw new StaleLoadError(assetId);
      }
      // The cache entry takes over ownership of the blob reference: it is
      // released by the eviction callback, not here (plan A9). `put` hands the
      // initiating caller its one reference.
      cache.put(assetId, template);
      return template;
    } catch (error) {
      // A REJECTED getAssetUrl never incremented the ref-count, so only a
      // resolved-then-failed chain may release (contract D14b / plan A7). The
      // stale path already released above — releasing twice would throw in any
      // correctly ref-counted provider.
      if (url !== null && !(error instanceof StaleLoadError)) {
        assetProvider.release(assetId);
      }
      throw error;
    }
  }

  async function acquire(
    assetId: AssetId,
    kind: "model" | "sprite",
  ): Promise<TemplateHandle> {
    const cached = cache.acquire(assetId);
    if (cached !== undefined) return cached;

    const pending = inFlight.get(assetId);
    if (pending !== undefined) {
      await pending;
      // Join the winner's entry. It can be gone already if the initiator
      // released it into a full cache in the meantime — then load fresh rather
      // than handing back a disposed template.
      const joined = cache.acquire(assetId);
      if (joined !== undefined) return joined;
      return acquire(assetId, kind);
    }

    const promise = load(assetId, kind);
    inFlight.set(assetId, promise);
    try {
      return await promise;
    } finally {
      inFlight.delete(assetId);
    }
  }

  return {
    acquire,
    release(assetId: AssetId): void {
      cache.release(assetId);
    },
    invalidate(): void {
      epoch += 1;
      inFlight.clear();
    },
  };
}
