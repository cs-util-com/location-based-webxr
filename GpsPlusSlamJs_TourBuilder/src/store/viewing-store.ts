/**
 * `createViewingStore` — the store for VIEWING mode.
 *
 * Composes the three viewing slices (`tour`, `tourProgress`, `zones`) onto the
 * framework base via `createSlamAppStore`'s `extraReducers` seam — exactly like
 * the recorder plugs in `refPoints`/`routing`/`scenario`. Defaults the storage
 * backend to `NullStorageBackend` (viewing has no recording side effects; tests
 * and replay pass their own).
 *
 * @see plans/Shared-Contract.md §2.4 (store factories, D13)
 */

import {
  createSlamAppStore,
  type SlamAppRootState,
  type SlamAppStore,
} from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import type { StorageBackend } from "gps-plus-slam-app-framework/storage/storage-backend";
import { tourReducer, type TourSliceState } from "./tour-slice.js";
import {
  tourProgressReducer,
  type TourProgressSliceState,
} from "./tour-progress-slice.js";
import { zonesReducer, type ZonesSliceState } from "./zones-slice.js";
import {
  breadcrumbProgressReducer,
  type BreadcrumbProgressSliceState,
} from "./breadcrumb-progress-slice.js";

/** Framework base + the four viewing slices. */
export interface ViewingRootState extends SlamAppRootState {
  tour: TourSliceState;
  tourProgress: TourProgressSliceState;
  zones: ZonesSliceState;
  breadcrumbProgress: BreadcrumbProgressSliceState;
}

export interface ViewingStoreOptions {
  /** Override the default `NullStorageBackend` (replay/e2e pass their own). */
  storageBackend?: StorageBackend;
}

type ViewingExtraReducers = {
  tour: typeof tourReducer;
  tourProgress: typeof tourProgressReducer;
  zones: typeof zonesReducer;
  breadcrumbProgress: typeof breadcrumbProgressReducer;
};

export type ViewingStore = SlamAppStore<ViewingExtraReducers>;

export function createViewingStore(
  options: ViewingStoreOptions = {},
): ViewingStore {
  return createSlamAppStore<ViewingExtraReducers>({
    storageBackend: options.storageBackend ?? new NullStorageBackend(),
    extraReducers: {
      tour: tourReducer,
      tourProgress: tourProgressReducer,
      zones: zonesReducer,
      breadcrumbProgress: breadcrumbProgressReducer,
    },
  });
}
