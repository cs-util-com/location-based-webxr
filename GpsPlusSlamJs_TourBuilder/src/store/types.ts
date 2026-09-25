/**
 * Shared contract types for the AR audio tour-guide (Component 3).
 *
 * These are the on-disk / on-wire `tour.json` shape plus the runtime
 * asset-provider interface. Copied VERBATIM from `plans/Shared-Contract.md` §1
 * — they must stay structurally identical to the core `LatLong` / `LatLongAlt`
 * so a `TourCoord` drops into `createGpsAnchor({ gpsPoint })` with zero field
 * mapping (contract D5: core uses `lon` + `altitude`, NOT Leaflet `lng`).
 *
 * Every subsequent component (4–10) imports its types from here. Lat/lon is
 * only how a location is PERSISTED; at runtime everything works in world-space
 * meters (contract §2.5.1).
 *
 * @see plans/Shared-Contract.md §1 (schema) + §3 (asset-provider)
 */

// ── Coordinates ──────────────────────────────────────────────────────────────
export interface TourCoord {
  readonly lat: number;
  readonly lon: number;
  readonly altitude?: number; // persisted but not yet consumed (contract D6)
}

// ── Assets ───────────────────────────────────────────────────────────────────
export type AssetId = string;
export type AssetType = "sprite" | "model" | "audio"; // image | GLTF/GLB | MP3/OGG

export interface AssetEntry {
  readonly id: AssetId;
  readonly type: AssetType;
  readonly filename: string; // path inside tour.zip (central-directory key)
}

// ── Waypoint content ─────────────────────────────────────────────────────────
export interface WaypointContent {
  readonly model?: AssetId; // ┐ invariant (validator-enforced, D4):
  readonly sprite?: AssetId; // ┘ at most one of { model, sprite } is set
  readonly audio?: AssetId; // tap-to-play story
  readonly transcript?: string; // inline floating text (component 2); NOT a file
}

export interface Waypoint {
  readonly id: string; // stable identity (cache key, visited tracking)
  readonly position: TourCoord;
  readonly prefetchRadius: number; // meters, IDLE → PREFETCHING (D2)
  readonly activeRadius: number; // meters, PREFETCHING → ACTIVE  (D2)
  readonly content: WaypointContent; // may be empty (breadcrumb-only stop)
}

// ── Tour envelope ────────────────────────────────────────────────────────────
export interface Tour {
  readonly id: string;
  readonly name: string;
  readonly description: string; // may be ""
  readonly assets: readonly AssetEntry[]; // central registry, referenced by id
  readonly waypoints: readonly Waypoint[]; // ORDERED (array order = tour order)
  readonly breadcrumb: readonly TourCoord[]; // flat polyline, recording order
}

// ── Zone state (proximity state machine output, component 4) ──────────────────
// Canonical definition lives upstream in the framework (promoted from this
// lab's proximity component, TASK.md §2.6) so it carries no dependency on
// this store.
export type { ZoneState } from "gps-plus-slam-app-framework/visualization";

// ── Asset provider (contract §3) ─────────────────────────────────────────────
/**
 * The store holds asset IDs only; bytes flow through this interface. Hiding the
 * bytes here is what lets the loading policy change without touching the store
 * or the scene. Ref-counted, reject-on-error, blob-tier only, injected — never
 * stored in Redux (contract D14).
 */
export interface AssetProvider {
  /** Resolve an asset id to a Blob URL. Ref-counted: each call must be balanced
   *  by exactly one release(). Rejects on missing/corrupt asset. */
  getAssetUrl(id: AssetId): Promise<string>;

  /** Balance one getAssetUrl(). The underlying Blob URL is revoked only when
   *  the ref-count for `id` reaches 0. */
  release(id: AssetId): void;
}
