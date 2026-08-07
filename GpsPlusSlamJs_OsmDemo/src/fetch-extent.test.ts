/**
 * The fetch extent.
 *
 * WHY THESE TESTS MATTER. The point of drawing the fetched area is to correct a
 * specific wrong belief — that "one res-7 tile" means the hexagon. It does not:
 * Overpass has no hexagon primitive, so `buildTileQuery` asks for the tile's
 * BOUNDING BOX and we pay for the difference on every fetch. A display that got
 * this backwards would confirm the misreading it exists to fix, so the ratio is
 * pinned rather than eyeballed.
 *
 * The numbers also have to be sane on their own terms: a res-7 hexagon is
 * ~2.8 km across, and if this module ever reported metres-as-kilometres or
 * dropped the longitude cosine, the label would still look plausible.
 */

import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";

import { describeExtent, summariseExtent, tileBounds } from "./fetch-extent.js";

/** Cologne — the demo's default area. */
const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const FETCH_RES = 7;
const TILE = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);

describe("the bounding box of a fetch tile", () => {
  it("contains the hexagon it came from", () => {
    const bounds = tileBounds(TILE);
    expect(bounds.north).toBeGreaterThan(bounds.south);
    expect(bounds.east).toBeGreaterThan(bounds.west);
    // The centre must be inside its own tile's box, or the box is not the box.
    expect(COLOGNE.lat).toBeGreaterThan(bounds.south);
    expect(COLOGNE.lat).toBeLessThan(bounds.north);
    expect(COLOGNE.lng).toBeGreaterThan(bounds.west);
    expect(COLOGNE.lng).toBeLessThan(bounds.east);
  });
});

describe("measuring one fetch", () => {
  const summary = summariseExtent(TILE);

  it("reports a res-7 tile at roughly the documented ~2.8 km across", () => {
    // Catches the whole family of unit errors at once: metres reported as km,
    // a missing longitude cosine (a ~37% error at 50.9 N), or degrees leaking
    // through. Wide bounds on purpose — this pins the ORDER, not the value.
    expect(summary.widthKm).toBeGreaterThan(2);
    expect(summary.widthKm).toBeLessThan(6);
    expect(summary.heightKm).toBeGreaterThan(2);
    expect(summary.heightKm).toBeLessThan(6);
  });

  it("fetches MORE ground than it indexes, which is the whole point", () => {
    // A hexagon does not fill its bounding box, so the ratio is necessarily
    // above 1. If this ever came out at 1 the display would be quietly telling
    // the reader the box IS the tile.
    expect(summary.boxAreaKm2).toBeGreaterThan(summary.hexAreaKm2);
    expect(summary.overFetch).toBeGreaterThan(1);
    // Still the same order of magnitude — a hexagon covers most of its box.
    expect(summary.overFetch).toBeLessThan(2);
  });

  it("takes the hexagon area from H3 rather than from its own approximation", () => {
    // The box arithmetic is equirectangular; the hex area is exact. Mixing an
    // approximate numerator with an approximate denominator would make the
    // ratio a claim about this module rather than about the geometry.
    expect(summary.hexAreaKm2).toBeGreaterThan(0);
    expect(Number.isFinite(summary.hexAreaKm2)).toBe(true);
  });
});

describe("describing the extent", () => {
  it("says BOX, so the number is not read as the hexagon", () => {
    // The misreading this display exists to prevent. A bare "2.8 km" invites
    // exactly the assumption that costs the over-fetch its visibility.
    expect(describeExtent([TILE])).toContain("box");
  });

  it("names the over-fetch ratio against the hexagon", () => {
    expect(describeExtent([TILE])).toMatch(/hexagon/);
  });

  it("sums the area when several tiles are held", () => {
    const neighbour = latLngToCell(COLOGNE.lat + 0.05, COLOGNE.lng, FETCH_RES);
    const text = describeExtent([TILE, neighbour]);
    expect(text).toContain("2 tiles");
  });

  it("says so plainly when nothing has been fetched", () => {
    // A blank label reads as "the map is broken"; this reads as "not yet".
    expect(describeExtent([])).toBe("no tiles loaded");
  });

  it("never emits NaN or Infinity into the label", () => {
    // The label sits next to the scoring numbers, so a NaN here would be blamed
    // on the scoring rather than on this module.
    const text = describeExtent([TILE]);
    expect(text).not.toMatch(/NaN|Infinity/);
  });
});
