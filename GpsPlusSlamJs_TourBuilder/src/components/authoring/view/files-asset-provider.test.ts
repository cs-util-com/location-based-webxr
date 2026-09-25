import { StructuralReadError } from "gps-plus-slam-app-framework/storage";
import { describe, expect, it } from "vitest";

import { createFilesAssetProvider } from "./files-asset-provider.js";

/**
 * Why this matters: this is the authoring-mode `AssetProvider` backing
 * (contract D14d) — a thin wrapper over the already-built, already-tested
 * `RefCountedAssetProvider` (component 6) that owns nothing but the picked
 * `File`s themselves. No new ref-counting/retry logic here.
 */

function fakeObjectUrl() {
  let n = 0;
  return {
    createObjectUrl: () => `blob:fake/${++n}`,
    revokeObjectUrl: () => undefined,
  };
}

describe("createFilesAssetProvider", () => {
  it("resolves a registered file to a Blob URL", async () => {
    const handle = createFilesAssetProvider(fakeObjectUrl());
    const file = new File(["knight"], "knight.glb");
    handle.registerFile("knight", file);

    const url = await handle.provider.getAssetUrl("knight");

    expect(url).toBe("blob:fake/1");
  });

  it("rejects with StructuralReadError for an unregistered id", async () => {
    const handle = createFilesAssetProvider(fakeObjectUrl());

    await expect(handle.provider.getAssetUrl("missing")).rejects.toBeInstanceOf(
      StructuralReadError,
    );
  });

  it("release balances getAssetUrl without throwing", async () => {
    const handle = createFilesAssetProvider(fakeObjectUrl());
    handle.registerFile("knight", new File(["knight"], "knight.glb"));

    await handle.provider.getAssetUrl("knight");
    expect(() => handle.provider.release("knight")).not.toThrow();
  });
});
