/**
 * The authoring-mode `AssetProvider` backing (contract D14d). A thin wrapper
 * over component 6's `RefCountedAssetProvider` — owns only the picked
 * `File`s themselves; all ref-counting/retry logic is reused, not
 * reimplemented (plan AU7).
 *
 * @see plans/2026-08-07-authoring-plan.md
 */

import { StructuralReadError } from "gps-plus-slam-app-framework/storage";

import {
  RefCountedAssetProvider,
  type RefCountedAssetProviderDeps,
} from "../../cloud-loader/core/asset-provider.js";
import type { AssetId, AssetProvider } from "../../../store/types.js";

export interface FilesAssetProviderHandle {
  readonly provider: AssetProvider;
  /** Register a picked File under an asset id, before dispatching the
   *  action that references it. */
  registerFile(id: AssetId, file: File): void;
}

export function createFilesAssetProvider(
  overrides: Pick<
    RefCountedAssetProviderDeps,
    "createObjectUrl" | "revokeObjectUrl"
  > = {},
): FilesAssetProviderHandle {
  const files = new Map<AssetId, File>();
  const provider = new RefCountedAssetProvider({
    ...overrides,
    loadAssetBlob: (id) => {
      const file = files.get(id);
      if (!file) {
        return Promise.reject(
          new StructuralReadError(`unknown asset id: ${id}`),
        );
      }
      return Promise.resolve(file);
    },
  });

  return {
    provider,
    registerFile(id, file) {
      files.set(id, file);
    },
  };
}
