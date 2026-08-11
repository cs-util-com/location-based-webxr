/**
 * WHICH FETCH TILES A GEO-EVENT SEARCH ACTUALLY NEEDS (W7 follow-up).
 *
 * WHY THIS EXISTS. W7's benchmark showed a search downloading tiles right after
 * a refresh at the widest radius, and the obvious objection is a good one: a
 * res-7 fetch tile is over 3 km across, so a search that only wanders ~1 km
 * around the user should never leave the one already in hand. This file settles
 * it with H3 arithmetic — no OSM data, no network, no fixture heat, just "which
 * fetch tile does this cell belong to".
 *
 * WHAT IT FOUND, and it is a defect rather than a cost. `DemoPipeline.geoEvent`
 * admitted a neighbouring event tile when **that tile's own fetch tile** was
 * already loaded, and its docstring gives the reason: "a neighbour whose data is
 * missing costs an ~20 s download… the rest are skipped". But the ensure set
 * built for an admitted neighbour reaches ~550 m past its centre in every
 * direction, into fetch tiles nobody checked — so the download it promised to
 * skip happened anyway. The gate tested the centre; the work needs the reach.
 *
 * **THE GATE NOW ASKS ABOUT THE REACH**, so the tests below are a guard rather
 * than a report. `searchAt` deliberately keeps modelling the OLD rule, because
 * the magnitude of what it let through is the reason the new one exists — and a
 * test that only exercised the current rule could not show that.
 *
 * It runs at the demo's own default position, Central Park South, because that
 * is where the 5–10 s was reported and because tile geometry is positional.
 */

import { describe, expect, it } from "vitest";
import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import {
  AFFORDANCE_RES,
  EVENT_TILE_RES,
  SCORE_CHUNK_RES,
  SCORE_DISK_MAX_RADIUS,
  fetchTilesForScoreWorkingSet,
  toFetchTile,
} from "gps-plus-slam-osm";

/** The demo's opening position — `PICKER_PLACES[0]`, Central Park South. */
const MANHATTAN = { lat: 40.7677, lng: -73.9807 };
/** Cologne Cathedral, the picker's other anchor, as a second geometry. */
const COLOGNE = { lat: 50.9413, lng: 6.9583 };

/** `CLIMB_STEPS` in `demo-pipeline.ts`; the reach is `gridDisk(steps + 1)`. */
const CLIMB_STEPS = 5;

/** A cell's bounding box, exactly as `demo-pipeline.ts` computes it. */
function bboxOf(cell: string) {
  const ring = cellToBoundary(cell);
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lat, lng] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return { south, west, north, east };
}

/** Metres between two positions — a tile-scale sanity check, not navigation. */
function metres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  return Math.hypot(
    (b.lat - a.lat) * 111_195,
    (b.lng - a.lng) * 111_195 * Math.cos((a.lat * Math.PI) / 180),
  );
}

/**
 * The fetch tiles the ensure set for one event tile touches.
 *
 * Candidates are replaced by the four CORNERS of the tile's bbox. That is not a
 * pessimistic bound but a reachable one: `eventCandidates` seeds uniformly in
 * `boundsOfCell(tile)` — the bounding box of a hexagon, not the hexagon — so a
 * candidate genuinely can be seeded at any of them.
 */
function tilesTouchedBy(eventTile: string): Set<string> {
  const box = bboxOf(eventTile);
  const touched = new Set<string>();
  for (const corner of [
    { lat: box.south, lng: box.west },
    { lat: box.south, lng: box.east },
    { lat: box.north, lng: box.west },
    { lat: box.north, lng: box.east },
  ]) {
    const start = latLngToCell(corner.lat, corner.lng, AFFORDANCE_RES);
    for (const cell of gridDisk(start, CLIMB_STEPS + 1)) {
      touched.add(toFetchTile(cell));
    }
  }
  return touched;
}

/** Steps 0 and 1 of `DemoPipeline.geoEvent`, over what a refresh has loaded. */
function searchAt(position: { lat: number; lng: number }) {
  const chunk = latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES);
  const loaded = new Set(
    fetchTilesForScoreWorkingSet(chunk, SCORE_DISK_MAX_RADIUS),
  );

  const centre = latLngToCell(position.lat, position.lng, EVENT_TILE_RES);
  const admitted = [centre];
  for (const neighbour of gridDisk(centre, 1)) {
    if (neighbour === centre) continue;
    // THE OLD GATE, kept deliberately: the neighbour's own fetch tile, nothing
    // else. Production now asks about the whole reach — see the header.
    if (loaded.has(toFetchTile(neighbour))) admitted.push(neighbour);
  }

  const touched = new Set<string>();
  for (const tile of admitted) {
    for (const fetchTile of tilesTouchedBy(tile)) touched.add(fetchTile);
  }

  return {
    centre,
    loaded,
    admitted,
    touched,
    missing: [...touched].filter((tile) => !loaded.has(tile)),
    missingForCentreOnly: [...tilesTouchedBy(centre)].filter(
      (tile) => !loaded.has(tile),
    ),
  };
}

describe("a geo-event's reach, measured in fetch tiles", () => {
  it("confirms the premise: an event tile is much smaller than a fetch tile", () => {
    // The objection this file exists to test is arithmetically right about the
    // sizes, so measure them rather than assume them. If this ever fails, every
    // conclusion below is about different geometry.
    const eventTile = latLngToCell(
      MANHATTAN.lat,
      MANHATTAN.lng,
      EVENT_TILE_RES,
    );
    const event = bboxOf(eventTile);
    const fetch = bboxOf(toFetchTile(eventTile));

    const eventWidth = metres(
      { lat: event.south, lng: event.west },
      { lat: event.south, lng: event.east },
    );
    const fetchWidth = metres(
      { lat: fetch.south, lng: fetch.west },
      { lat: fetch.south, lng: fetch.east },
    );

    // Measured here: ~1.08 km against ~2.56 km, so a fetch tile is more than
    // twice an event tile across — which is exactly why "a search around the
    // user should never need another tile" is the reasonable expectation, and
    // why it needs an explanation when it turns out to be false.
    //
    // A RATIO, not two magnitudes: the absolute widths vary with latitude, and
    // what the argument rests on is that one comfortably contains the other.
    expect(eventWidth).toBeLessThan(1_500);
    expect(fetchWidth).toBeGreaterThan(eventWidth * 2);
  });

  it("shows WHY it needs one anyway: the user is nowhere near their tile's centre", () => {
    // The premise above assumes the search is centred in its fetch tile. It is
    // not: the user stands wherever they stand, and at the demo's own default
    // that is ~1 km from the centre of the res-7 tile they are in — so a ~1 km
    // box around them reaches the far side of the boundary while a 3.4 km tile
    // "should" have contained it easily.
    const fetchTile = toFetchTile(
      latLngToCell(MANHATTAN.lat, MANHATTAN.lng, AFFORDANCE_RES),
    );
    const [lat, lng] = cellToLatLng(fetchTile);

    expect(metres(MANHATTAN, { lat, lng })).toBeGreaterThan(500);
  });

  it("overhangs by ONE tile even searching only the user's own event tile", () => {
    // The floor of the problem, and the smallest honest statement of it: with
    // no neighbours admitted at all, the corner of the user's own event tile
    // still lands outside everything the refresh loaded.
    const { missingForCentreOnly } = searchAt(MANHATTAN);
    expect(missingForCentreOnly).toHaveLength(1);
  });

  it("measures what the OLD centre-only gate let through", () => {
    // WHY THIS TEST STILL EXISTS after the gate was fixed: it is the size of
    // the problem, and without it the new rule reads as a preference rather
    // than a repair.
    //
    // `DemoPipeline.geoEvent`'s docstring justifies the neighbour gate by
    // saying a neighbour whose data is missing "costs an ~20 s download", so
    // those are skipped. The old gate checked `toFetchTile(neighbour)` — the
    // neighbour's CENTRE. The ensure set built for that neighbour then reaches
    // ~550 m past its centre in every direction, into fetch tiles the gate
    // never looked at. At the demo's own default position that admitted six of
    // seven event tiles and needed three fetch tiles it did not have.
    //
    // Asserted as "more than the centre-only case" rather than as three, so the
    // claim survives an H3 re-index or a change to `SCORE_DISK_MAX_RADIUS`.
    // What is pinned is the ASYMMETRY, not the arithmetic of one city.
    const { admitted, missing, missingForCentreOnly } = searchAt(MANHATTAN);

    expect(admitted.length).toBeGreaterThan(1);
    expect(missing.length).toBeGreaterThan(missingForCentreOnly.length);
  });

  it("and that gating on the REACH removes every one of them", () => {
    // The rule production now uses, checked independently of production: admit
    // a neighbour only when every fetch tile its own ensure set touches is
    // already loaded. One set lookup per candidate instead of a download, and
    // it is the rule the docstring always claimed.
    //
    // `demo-pipeline.test.ts` asserts the same thing through the real pipeline
    // ("downloads ONLY for the tile the user is standing in"); this one says it
    // in geometry, which is where the number three came from.
    const { loaded, centre } = searchAt(MANHATTAN);

    const admittedByReach = [centre].concat(
      gridDisk(centre, 1)
        .filter((neighbour) => neighbour !== centre)
        .filter((neighbour) =>
          [...tilesTouchedBy(neighbour)].every((tile) => loaded.has(tile)),
        ),
    );

    const touched = new Set<string>();
    for (const tile of admittedByReach) {
      for (const fetchTile of tilesTouchedBy(tile)) touched.add(fetchTile);
    }
    const missing = [...touched].filter((tile) => !loaded.has(tile));

    // The centre tile is always searched, so its own overhang survives — that
    // is a separate decision (search a smaller area, or accept one download).
    // What this shows is that the NEIGHBOURS stop adding any.
    const { missingForCentreOnly } = searchAt(MANHATTAN);
    expect(missing).toEqual(missingForCentreOnly);
  });

  it("is geometry, not a Manhattan fluke", () => {
    // Positional claims need a second position. If only New York showed this,
    // the honest reading would be "that event tile straddles a boundary", which
    // is a much smaller finding than a rule about the gate.
    const cologne = searchAt(COLOGNE);
    expect(cologne.missing.length).toBeGreaterThan(0);
  });

  it("names the quieter half: a candidate can be seeded OUTSIDE its own tile", () => {
    // `eventCandidates` seeds uniformly in `boundsOfCell(tile)` — the bounding
    // BOX of a hexagon — so a candidate can land outside the very tile it is
    // supposed to represent. That is what makes the corners above reachable
    // rather than merely pessimistic, and it is independently worth fixing:
    // clamping candidates to the hexagon would shrink every reach by the
    // bbox-versus-hexagon margin, which `map-view.ts` records as 1.39x.
    const tile = latLngToCell(MANHATTAN.lat, MANHATTAN.lng, EVENT_TILE_RES);
    const box = bboxOf(tile);

    const corners = [
      { lat: box.south, lng: box.west },
      { lat: box.south, lng: box.east },
      { lat: box.north, lng: box.west },
      { lat: box.north, lng: box.east },
    ];
    const outside = corners.filter(
      (corner) => latLngToCell(corner.lat, corner.lng, EVENT_TILE_RES) !== tile,
    );

    // Every corner of a hexagon's bounding box lies outside the hexagon.
    expect(outside).toHaveLength(4);
  });
});
