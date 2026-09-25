/**
 * `validateTour` — the load-time gate between raw JSON and the store.
 *
 * Pure, framework-free, THREE-free. Takes `unknown` (a parsed `tour.json`) and
 * either returns a well-typed `Tour` or throws `TourValidationError`. It NEVER
 * returns partial data — the loader rejects a malformed tour rather than letting
 * the store hold a half-valid graph (contract invariant 6).
 *
 * Enforces contract §1 invariants 1, 2, 4, 5 plus structural/type checks
 * (invariant "shape"). NOT checked here (owned elsewhere per the contract):
 *   - `AssetEntry.filename` presence in the zip → packaging (component 5).
 *   - `schemaVersion` → deliberately absent (contract D9).
 *
 * @see plans/Shared-Contract.md §1 — "Invariants (enforced by validateTour)"
 */

import type {
  AssetEntry,
  AssetType,
  Tour,
  TourCoord,
  Waypoint,
  WaypointContent,
} from "./types.js";

/** Thrown for any invariant / shape violation. Carries a human-readable path. */
export class TourValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TourValidationError";
  }
}

const ASSET_TYPES: ReadonlySet<string> = new Set<AssetType>([
  "sprite",
  "model",
  "audio",
]);

function fail(message: string): never {
  throw new TourValidationError(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== "string") fail(`${path} must be a string`);
  return v;
}

function requireFiniteNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(`${path} must be a finite number`);
  }
  return v;
}

function requireArray(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) fail(`${path} must be an array`);
  return v;
}

function validateCoord(raw: unknown, path: string): TourCoord {
  if (!isRecord(raw)) fail(`${path} must be an object`);
  const coord: TourCoord = {
    lat: requireFiniteNumber(raw.lat, `${path}.lat`),
    lon: requireFiniteNumber(raw.lon, `${path}.lon`),
    ...(raw.altitude === undefined
      ? {}
      : { altitude: requireFiniteNumber(raw.altitude, `${path}.altitude`) }),
  };
  return coord;
}

function validateAsset(raw: unknown, path: string): AssetEntry {
  if (!isRecord(raw)) fail(`${path} must be an object`);
  const type = requireString(raw.type, `${path}.type`);
  if (!ASSET_TYPES.has(type)) {
    fail(`${path}.type "${type}" is not a valid AssetType`);
  }
  return {
    id: requireString(raw.id, `${path}.id`),
    type: type as AssetType,
    filename: requireString(raw.filename, `${path}.filename`),
  };
}

function validateContent(
  raw: unknown,
  path: string,
  assetIds: ReadonlySet<string>,
): WaypointContent {
  if (!isRecord(raw)) fail(`${path} must be an object`);

  const refSlot = (value: unknown, slot: string): string | undefined => {
    if (value === undefined) return undefined;
    const id = requireString(value, `${path}.${slot}`);
    // Invariant 1: every referenced asset id exists in the registry.
    if (!assetIds.has(id)) {
      fail(`${path}.${slot} references unknown asset "${id}"`);
    }
    return id;
  };

  const model = refSlot(raw.model, "model");
  const sprite = refSlot(raw.sprite, "sprite");
  const audio = refSlot(raw.audio, "audio");

  // Invariant 2: at most one of { model, sprite }.
  if (model !== undefined && sprite !== undefined) {
    fail(`${path} sets both model and sprite (at most one allowed)`);
  }

  const transcript =
    raw.transcript === undefined
      ? undefined
      : requireString(raw.transcript, `${path}.transcript`);

  return {
    ...(model === undefined ? {} : { model }),
    ...(sprite === undefined ? {} : { sprite }),
    ...(audio === undefined ? {} : { audio }),
    ...(transcript === undefined ? {} : { transcript }),
  };
}

function validateWaypoint(
  raw: unknown,
  path: string,
  assetIds: ReadonlySet<string>,
): Waypoint {
  if (!isRecord(raw)) fail(`${path} must be an object`);

  const prefetchRadius = requireFiniteNumber(
    raw.prefetchRadius,
    `${path}.prefetchRadius`,
  );
  const activeRadius = requireFiniteNumber(
    raw.activeRadius,
    `${path}.activeRadius`,
  );
  // Invariant 5: PREFETCH must strictly enclose ACTIVE, both positive.
  if (!(prefetchRadius > activeRadius && activeRadius > 0)) {
    fail(
      `${path}: require prefetchRadius > activeRadius > 0 (got ${prefetchRadius}, ${activeRadius})`,
    );
  }

  return {
    id: requireString(raw.id, `${path}.id`),
    position: validateCoord(raw.position, `${path}.position`),
    prefetchRadius,
    activeRadius,
    content: validateContent(raw.content, `${path}.content`, assetIds),
  };
}

function assertUniqueIds(
  items: readonly { readonly id: string }[],
  collection: string,
): void {
  // Invariant 4: ids unique within their collection.
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) fail(`duplicate ${collection} id "${id}"`);
    seen.add(id);
  }
}

/**
 * Validate a parsed `tour.json`. Returns a well-typed `Tour` or throws
 * `TourValidationError`. Assets are validated first so waypoint content can be
 * checked against the known asset-id set (invariant 1).
 */
export function validateTour(raw: unknown): Tour {
  if (!isRecord(raw)) fail("tour must be an object");

  const assets = requireArray(raw.assets, "assets").map((a, i) =>
    validateAsset(a, `assets[${i}]`),
  );
  assertUniqueIds(assets, "asset");
  const assetIds = new Set(assets.map((a) => a.id));

  const waypoints = requireArray(raw.waypoints, "waypoints").map((w, i) =>
    validateWaypoint(w, `waypoints[${i}]`, assetIds),
  );
  assertUniqueIds(waypoints, "waypoint");

  const breadcrumb = requireArray(raw.breadcrumb, "breadcrumb").map((c, i) =>
    validateCoord(c, `breadcrumb[${i}]`),
  );

  return {
    id: requireString(raw.id, "id"),
    name: requireString(raw.name, "name"),
    description: requireString(raw.description, "description"),
    assets,
    waypoints,
    breadcrumb,
  };
}
