import { operatorForUrl } from "./benchmark-matrix.mjs";

function validateBbox(bbox) {
  if (
    !bbox ||
    ![bbox.south, bbox.west, bbox.north, bbox.east].every(Number.isFinite) ||
    bbox.south >= bbox.north ||
    bbox.west >= bbox.east ||
    bbox.south < -90 ||
    bbox.north > 90 ||
    bbox.west < -180 ||
    bbox.east > 180
  )
    throw new Error("Expected finite, ordered geographic bbox bounds");
}

/** Plain-Node query mirror; tests compare the full profile with buildTileQuery. */
export function buildComparisonProfiles({ bbox, keys }) {
  validateBbox(bbox);
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some(
      (key) =>
        typeof key !== "string" || !/^[A-Za-z][A-Za-z0-9_:-]*$/.test(key),
    )
  ) {
    throw new Error("Expected nonempty safe Overpass keys");
  }
  const bounds = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const map3d = `[out:json][timeout:25];(way["building"]( ${bounds} );relation["building"]( ${bounds} ););out body geom;`;
  const header = `[out:json][timeout:180][bbox:${bounds}];`;
  const relationType = '["type"~"^(multipolygon|boundary)$"]';
  const full = [
    header,
    `(${keys.map((key) => `nw["${key}"];`).join("")}${keys.map((key) => `relation["${key}"]${relationType};`).join("")});`,
    "out geom;",
  ].join("\n");
  const previewKeys = ["building", "building:part"];
  const preview = `[out:json][timeout:25];(${previewKeys.map((key) => `way["${key}"]( ${bounds} );`).join("")}${previewKeys.map((key) => `relation["${key}"]${relationType}( ${bounds} );`).join("")});out body geom;`;
  return [
    { id: "map3d", query: map3d, encoding: "raw", timeoutSeconds: 25 },
    { id: "encoded", query: map3d, encoding: "form", timeoutSeconds: 25 },
    {
      id: "geom-only",
      query: map3d.replace("out body geom;", "out geom;"),
      encoding: "raw",
      timeoutSeconds: 25,
    },
    {
      id: "timeout180",
      query: map3d.replace("timeout:25", "timeout:180"),
      encoding: "raw",
      timeoutSeconds: 180,
    },
    {
      id: "full-production180",
      query: full,
      encoding: "form",
      timeoutSeconds: 180,
    },
    { id: "preview", query: preview, encoding: "raw", timeoutSeconds: 25 },
    {
      id: "everything",
      query: [header, "nwr;", "out geom;"].join("\n"),
      encoding: "form",
      timeoutSeconds: 180,
    },
    {
      id: "everything-areal",
      query: [header, `(nw;relation${relationType};);`, "out geom;"].join("\n"),
      encoding: "form",
      timeoutSeconds: 180,
    },
  ];
}

function uniqueNonempty(values, label) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length
  ) {
    throw new Error(`Expected nonempty unique ${label}`);
  }
}

function reordered(values, round) {
  const offset = Math.floor(round / 2) % values.length;
  const rotated = [...values.slice(offset), ...values.slice(0, offset)];
  return round % 2 === 1 ? rotated.reverse() : rotated;
}

function prepareComparison({ hosts, sites, repeats = 3, profilesForSite }) {
  if (!Number.isInteger(repeats) || repeats < 1)
    throw new Error("Expected positive integer repeats");
  uniqueNonempty(hosts, "hosts");
  if (!Array.isArray(sites)) throw new Error("Expected sites array");
  uniqueNonempty(
    sites.map((site) => site?.id),
    "site IDs",
  );
  if (typeof profilesForSite !== "function")
    throw new Error("Expected profilesForSite function");
  const prepared = sites.map((site) => {
    validateBbox(site.bbox);
    const profiles = profilesForSite(site);
    if (!Array.isArray(profiles)) throw new Error("Expected profiles array");
    uniqueNonempty(
      profiles.map((profile) => profile?.id),
      "profile IDs",
    );
    for (const profile of profiles) {
      if (
        typeof profile.query !== "string" ||
        profile.query.length === 0 ||
        !["raw", "form"].includes(profile.encoding) ||
        !Number.isInteger(profile.timeoutSeconds) ||
        profile.timeoutSeconds < 1
      ) {
        throw new Error("Invalid comparison profile");
      }
    }
    return { site, profiles };
  });
  for (const url of hosts) {
    if (!["http:", "https:"].includes(new URL(url).protocol))
      throw new Error("Expected HTTP endpoint");
  }
  return prepared;
}

/** Plan only: I/O runner remains responsible for operator cooldown and budgets. */
export function planComparisonCells(options) {
  const prepared = prepareComparison(options);
  const { hosts, repeats = 3 } = options;
  const cells = [];
  for (let round = 1; round <= repeats; round++) {
    for (const { site, profiles } of reordered(prepared, round - 1)) {
      for (const profile of reordered(profiles, round - 1)) {
        for (const url of reordered(hosts, round - 1)) {
          cells.push({
            id: JSON.stringify([round, site.id, url, profile.id]),
            profile: profile.id,
            query: profile.query,
            encoding: profile.encoding,
            timeoutSeconds: profile.timeoutSeconds,
            url,
            operator: operatorForUrl(url),
            site: site.id,
            bbox: { ...site.bbox },
            round,
          });
        }
      }
    }
  }
  return cells;
}
