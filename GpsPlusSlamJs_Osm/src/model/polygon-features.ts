/**
 * Vendored area-detection table: which closed ways bound an area.
 *
 * **Source:** `tyrasd/osm-polygon-features` (`polygon-features.json`) — the same
 * table `osmtogeojson` and much of the OSM ecosystem use. Captured 2026-07-28,
 * 27 entries. The upstream `.json` is checked in alongside this file as the
 * provenance record; this module is its typed transcription.
 *
 * **This is vendored DATA, not a dependency.** The plan's dependency rule draws
 * the line between "a checked-in table we own and version" and "a library that
 * ships code we execute"; this is firmly the former.
 *
 * **Why a `.ts` module rather than importing the `.json` directly:** JSON
 * imports in an ESM package need import attributes (`with { type: 'json' }`),
 * which in turn require `module: nodenext`/`esnext`, and downstream bundlers
 * disagree about all of it. A typed constant sidesteps the whole interop
 * question and gives us the element type for free. (We tried the JSON import
 * first; `tsc` rejected it under this package's `module: ES2022`.)
 *
 * **Semantics** — evaluated per tag by `osm-geometry.ts`, first match wins:
 *  - `all` — any value of this key makes a closed way an area.
 *  - `whitelist` — only the listed values do.
 *  - `blacklist` — every value EXCEPT the listed ones does.
 *
 * The entries most worth knowing, because they are where the C# reference's
 * `highway`-only rule went wrong:
 *  - `highway` is a *whitelist*, so a closed `highway=footway` stays a line —
 *    which is exactly the way-449879297 rule the C# oracle pins.
 *  - `barrier` is a *whitelist*, so a closed `barrier=fence` is NOT an area.
 *  - `natural` is a *blacklist*, so a closed `natural=coastline` is NOT an area
 *    while `natural=water` is.
 */

export interface PolygonFeatureRule {
  readonly key: string;
  readonly polygon: "all" | "whitelist" | "blacklist";
  readonly values?: readonly string[];
}

export const POLYGON_FEATURES: readonly PolygonFeatureRule[] = [
  { key: "building", polygon: "all" },
  {
    key: "highway",
    polygon: "whitelist",
    values: ["services", "rest_area", "escape", "elevator"],
  },
  {
    key: "natural",
    polygon: "blacklist",
    values: ["coastline", "cliff", "ridge", "arete", "tree_row"],
  },
  { key: "landuse", polygon: "all" },
  {
    key: "waterway",
    polygon: "whitelist",
    values: ["riverbank", "dock", "boatyard", "dam"],
  },
  { key: "amenity", polygon: "all" },
  { key: "leisure", polygon: "all" },
  {
    key: "barrier",
    polygon: "whitelist",
    values: ["city_wall", "ditch", "hedge", "retaining_wall", "wall", "spikes"],
  },
  {
    key: "railway",
    polygon: "whitelist",
    values: ["station", "turntable", "roundhouse", "platform"],
  },
  { key: "area", polygon: "all" },
  { key: "boundary", polygon: "all" },
  {
    key: "man_made",
    polygon: "blacklist",
    values: ["cutline", "embankment", "pipeline"],
  },
  {
    key: "power",
    polygon: "whitelist",
    values: ["plant", "substation", "generator", "transformer"],
  },
  { key: "place", polygon: "all" },
  { key: "shop", polygon: "all" },
  { key: "aeroway", polygon: "blacklist", values: ["taxiway"] },
  { key: "tourism", polygon: "all" },
  { key: "historic", polygon: "all" },
  { key: "public_transport", polygon: "all" },
  { key: "office", polygon: "all" },
  { key: "building:part", polygon: "all" },
  { key: "military", polygon: "all" },
  { key: "ruins", polygon: "all" },
  { key: "area:highway", polygon: "all" },
  { key: "craft", polygon: "all" },
  { key: "golf", polygon: "all" },
  { key: "indoor", polygon: "all" },
];
