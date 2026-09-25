/**
 * The authoring orchestrator for component 10 (TASK.md §2.3) — the thin
 * layer that turns a live `PositionSource` into store dispatches: drop a
 * waypoint at the latest fix, sample breadcrumb points continuously (plan
 * AU3), and register a picked File before the action that references it can
 * be dispatched.
 *
 * @see plans/2026-08-07-authoring-plan.md
 */

import {
  addWaypoint,
  attachAsset as attachAssetAction,
  addBreadcrumbPoint,
  type AuthoringSliceState,
} from "../../../store/authoring-slice.js";
import type { AuthoringStateShape } from "../../../store/selectors.js";
import { buildValidatedExport } from "../core/export-tour.js";
import { buildAssetEntry, type AssetSlot } from "../core/asset-attachment.js";
import { createBreadcrumbGate, type FixInfo } from "../core/breadcrumb-gate.js";
import { nextId } from "../core/id.js";
import type { PositionSource } from "./gps-position-source.js";
import type { FilesAssetProviderHandle } from "./files-asset-provider.js";
import type { AssetId, Tour, TourCoord } from "../../../store/types.js";

type AuthoringAction =
  | ReturnType<typeof addWaypoint>
  | ReturnType<typeof attachAssetAction>
  | ReturnType<typeof addBreadcrumbPoint>;

export interface AuthoringSessionDeps {
  readonly positionSource: PositionSource;
  readonly dispatch: (action: AuthoringAction) => void;
  readonly getState: () => AuthoringStateShape;
  readonly filesAssetProvider: FilesAssetProviderHandle;
}

export interface AuthoringSession {
  /** Drop a waypoint at `position`, or at the latest known GPS fix when
   *  omitted (the walk-there-and-press flow). Returns the new waypoint's
   *  id, or null if no position is available (no override given and no fix
   *  has arrived yet). */
  dropWaypoint(position?: TourCoord): string | null;
  attachAsset(waypointId: string, slot: AssetSlot, file: File): void;
  exportTour(): { tour: Tour; assetFiles: ReadonlyMap<AssetId, File> };
  destroy(): void;
}

export function createAuthoringSession(
  deps: AuthoringSessionDeps,
): AuthoringSession {
  let destroyed = false;
  let current: TourCoord | null = null;
  let currentFix: FixInfo | undefined;
  const gate = createBreadcrumbGate();
  const assetFiles = new Map<AssetId, File>();

  const state = (): AuthoringSliceState => deps.getState().authoring;

  const unsubscribe = deps.positionSource.subscribe((pos, fix) => {
    if (destroyed) return;
    current = pos;
    currentFix = fix;
    if (gate.consider(pos, fix)) {
      deps.dispatch(addBreadcrumbPoint(pos));
    }
  });

  return {
    dropWaypoint(position?: TourCoord): string | null {
      const pos = position ?? current;
      if (pos === null) return null;
      const id = nextId(
        "wp",
        state().waypoints.map((w) => w.id),
      );
      deps.dispatch(addWaypoint({ id, position: pos }));
      // Only a waypoint dropped at the live fix says where the author stands
      // (a map click or drag can be anywhere), so only it re-anchors the trail.
      if (position === undefined) gate.reanchor(pos, currentFix);
      return id;
    },

    attachAsset(waypointId, slot, file): void {
      const id = nextId(
        "asset",
        state().assets.map((a) => a.id),
      );
      const asset = buildAssetEntry(id, slot, file);
      assetFiles.set(id, file);
      deps.filesAssetProvider.registerFile(id, file);
      deps.dispatch(attachAssetAction({ waypointId, slot, asset }));
    },

    exportTour() {
      return {
        tour: buildValidatedExport(deps.getState()),
        assetFiles,
      };
    },

    destroy(): void {
      destroyed = true;
      unsubscribe();
    },
  };
}
