import { StructuralReadError } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it, vi } from "vitest";

import { RefCountedAssetProvider } from "./asset-provider.js";

/**
 * Why these tests matter: this is the contract's `AssetProvider` (D14) — the
 * one seam the scene and store use to turn an asset id into a Blob URL. Its two
 * promises are ref-counting (an audio id shared by two waypoints must survive
 * the first `release`) and reject-on-error with the *right* retry policy (a
 * transient range hiccup retries; a structurally missing entry fails at once,
 * so a visitor standing still at a broken waypoint is not stranded on an
 * endless retry). The provider is generic over an injected blob loader, so
 * every branch is provable here without a zip or a network.
 */

/** Build a provider over a controllable fake loader + synthetic URL minter. */
function makeProvider(
  loadAssetBlob: (id: string) => Promise<Blob>,
  overrides: Partial<{
    maxRetries: number;
    delay: (ms: number) => Promise<void>;
  }> = {},
) {
  let n = 0;
  const revoked: string[] = [];
  const provider = new RefCountedAssetProvider({
    loadAssetBlob,
    createObjectUrl: () => `blob:fake/${++n}`,
    revokeObjectUrl: (url) => revoked.push(url),
    delay: () => Promise.resolve(), // no real backoff wait in tests
    ...overrides,
  });
  return { provider, revoked };
}

const blobFor = (id: string) => new Blob([id]);

describe("RefCountedAssetProvider", () => {
  it("resolves an asset id to a minted Blob URL", async () => {
    const { provider } = makeProvider((id) => Promise.resolve(blobFor(id)));

    expect(await provider.getAssetUrl("knight")).toBe("blob:fake/1");
  });

  it("revokes the URL when the last reference is released, then re-mints", async () => {
    const { provider, revoked } = makeProvider((id) =>
      Promise.resolve(blobFor(id)),
    );

    const first = await provider.getAssetUrl("knight");
    provider.release("knight");
    expect(revoked).toEqual([first]);

    // a later request for the same id starts fresh with a new URL
    expect(await provider.getAssetUrl("knight")).toBe("blob:fake/2");
  });

  it("ref-counts a shared id: one load, one URL, revoked only at the last release", async () => {
    const load = vi.fn((id: string) => Promise.resolve(blobFor(id)));
    const { provider, revoked } = makeProvider(load);

    // e.g. the same audio id attached to two waypoints
    const a = await provider.getAssetUrl("story");
    const b = await provider.getAssetUrl("story");

    expect(a).toBe(b); // same URL
    expect(load).toHaveBeenCalledTimes(1); // loaded once

    provider.release("story");
    expect(revoked).toEqual([]); // still held by the second reference

    provider.release("story");
    expect(revoked).toEqual([a]); // now freed
  });

  it("dedupes concurrent requests for the same id into a single load", async () => {
    const load = vi.fn((id: string) => Promise.resolve(blobFor(id)));
    const { provider } = makeProvider(load);

    const [a, b] = await Promise.all([
      provider.getAssetUrl("knight"),
      provider.getAssetUrl("knight"),
    ]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and then resolves", async () => {
    let attempts = 0;
    const load = vi.fn((id: string) => {
      attempts += 1;
      if (attempts < 3) return Promise.reject(new Error("network blip"));
      return Promise.resolve(blobFor(id));
    });
    const { provider } = makeProvider(load);

    expect(await provider.getAssetUrl("knight")).toBe("blob:fake/1");
    expect(load).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("fails a structural error immediately without retrying", async () => {
    const load = vi.fn(() =>
      Promise.reject(new StructuralReadError("no such entry")),
    );
    const { provider } = makeProvider(load);

    await expect(provider.getAssetUrl("ghost")).rejects.toBeInstanceOf(
      StructuralReadError,
    );
    expect(load).toHaveBeenCalledTimes(1); // never retried
  });

  it("rejects after exhausting retries, then allows a fresh later attempt", async () => {
    let fail = true;
    const load = vi.fn((id: string) =>
      fail ? Promise.reject(new Error("blip")) : Promise.resolve(blobFor(id)),
    );
    const { provider } = makeProvider(load, { maxRetries: 1 });

    await expect(provider.getAssetUrl("knight")).rejects.toThrow("blip");
    expect(load).toHaveBeenCalledTimes(2); // 1 + 1 retry

    // recovering network: a later request (zone re-entry) succeeds
    fail = false;
    expect(await provider.getAssetUrl("knight")).toBe("blob:fake/1");
  });
});
