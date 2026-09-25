/**
 * `createAuthoringStore` — the store for AUTHORING mode.
 *
 * Composes the `authoring` slice onto the framework base and — crucially —
 * whitelists every `authoring/*` action into the persistence/replay stream via
 * `persistedExtraPrefixes`, so an authoring walk records and replays
 * deterministically (contract D12), mirroring the recorder's `refPoints`.
 *
 * ONE slice prefix covers all `authoring/*` actions. It is derived from an
 * action type (`slicePrefixOf(setTourMeta.type)`), never a hand-typed literal,
 * so a slice rename can't silently drop the slice's actions from recordings.
 *
 * NOTE: `persistedExtraPrefixes` feeds the RECORDING stream, not browser-reload
 * durability — `createSlamAppStore` has no rehydration path. "Persistence" here
 * means recordable/replayable, verified via export/replay (see the plan).
 *
 * @see plans/Shared-Contract.md §2.4 (store factories, D13) + D12
 */

import {
  createSlamAppStore,
  type SlamAppRootState,
  type SlamAppStore,
} from "gps-plus-slam-app-framework/state/create-slam-app-store";
import { slicePrefixOf } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage/null-storage-backend";
import type { StorageBackend } from "gps-plus-slam-app-framework/storage/storage-backend";
import {
  authoringReducer,
  setTourMeta,
  type AuthoringSliceState,
} from "./authoring-slice.js";

/** Framework base + the authoring slice. */
export interface AuthoringRootState extends SlamAppRootState {
  authoring: AuthoringSliceState;
}

export interface AuthoringStoreOptions {
  /** Override the default `NullStorageBackend` (recording/replay pass their own). */
  storageBackend?: StorageBackend;
}

type AuthoringExtraReducers = { authoring: typeof authoringReducer };

export type AuthoringStore = SlamAppStore<AuthoringExtraReducers>;

export function createAuthoringStore(
  options: AuthoringStoreOptions = {},
): AuthoringStore {
  return createSlamAppStore<AuthoringExtraReducers>({
    storageBackend: options.storageBackend ?? new NullStorageBackend(),
    extraReducers: { authoring: authoringReducer },
    // One prefix = all `authoring/*` actions; derived from an action type.
    persistedExtraPrefixes: [slicePrefixOf(setTourMeta.type)],
  });
}
