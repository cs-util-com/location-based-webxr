/**
 * Ground height per H3 cell — the adapter the navigation library asks for.
 *
 * Why these tests matter:
 * `obstacleLevelsAt` takes ground height as an injected `(cell) => number`, and
 * that injection is not a style choice — it is what keeps `nav/` free of ENU.
 * The library holds lat/lng and H3 cells only; the demo's `heightAt` speaks ENU
 * metres in a frame the demo owns. **This adapter is the single place the two
 * meet**, so if a recentre ever invalidates a coordinate, it invalidates it
 * here and nowhere else.
 *
 * The two failures it has to rule out are both silent:
 *
 * - **Wrong frame.** Feeding `heightAt` a lat/lng, or an ENU point from a stale
 *   frame, returns a plausible number from the wrong place — a wall top
 *   computed against the ground half a kilometre away.
 * - **NaN leaking through.** A miss outside the sampled window must arrive as a
 *   non-finite number, because `obstacleLevelsAt` turns that into "no levels
 *   here" — a visibly unreachable cell. A silent 0 instead puts the agent at
 *   sea level under a hillside.
 *
 * @see cell-ground.ts.md
 */

import { describe, expect, it } from "vitest";
import { cellToLatLng, latLngToCell } from "h3-js";
import { enuFrameAt } from "gps-plus-slam-osm";

import { groundHeightAtCell } from "./cell-ground.js";

const ORIGIN = { lat: 50.9413, lng: 6.9583 };
const RES = 13;

/** A field that reports its own ENU x, so a test can see which point arrived. */
const echoX = { heightAt: (p: { x: number; y: number }) => p.x };

describe("groundHeightAtCell", () => {
  it("samples the field at the cell's centre, converted through the frame", () => {
    const frame = enuFrameAt(ORIGIN);
    const cell = latLngToCell(ORIGIN.lat, ORIGIN.lng + 0.001, RES);
    const [lat, lng] = cellToLatLng(cell);

    const groundAt = groundHeightAtCell(frame, echoX);

    // The value must be the ENU x of the cell CENTRE — not of the frame origin,
    // and not the raw longitude.
    expect(groundAt(cell)).toBeCloseTo(frame.toEnu({ lat, lng }).x, 6);
    expect(groundAt(cell)).toBeGreaterThan(50);
  });

  it("returns the same answer for the same cell", () => {
    // Determinism, for the reason every list in `nav/` is sorted: a route that
    // varied between calls would be unreproducible.
    const frame = enuFrameAt(ORIGIN);
    const groundAt = groundHeightAtCell(frame, echoX);
    const cell = latLngToCell(ORIGIN.lat, ORIGIN.lng, RES);

    expect(groundAt(cell)).toBe(groundAt(cell));
  });

  it("passes a non-finite sample straight through", () => {
    // NOT COERCED TO ZERO. `obstacleLevelsAt` turns a non-finite ground into
    // "no levels in this cell", which is visibly unreachable; a silent 0 would
    // put the agent at sea level under a hillside and read as a DEM bug.
    const frame = enuFrameAt(ORIGIN);
    const groundAt = groundHeightAtCell(frame, { heightAt: () => NaN });

    expect(groundAt(latLngToCell(ORIGIN.lat, ORIGIN.lng, RES))).toBeNaN();
  });

  it("reports flat zero when there is no field at all", () => {
    // A DEM outage is not an error here: the demo already renders flat in that
    // case, and refusing every cell would make the agent unable to move at all
    // rather than able to move on flat ground.
    const frame = enuFrameAt(ORIGIN);
    const groundAt = groundHeightAtCell(frame, undefined);

    expect(groundAt(latLngToCell(ORIGIN.lat, ORIGIN.lng, RES))).toBe(0);
  });

  it("gives neighbouring cells different heights on a slope", () => {
    // The vacuous-green guard. Everything above passes on a constant field, and
    // a constant field is exactly what a broken conversion produces.
    const frame = enuFrameAt(ORIGIN);
    const groundAt = groundHeightAtCell(frame, echoX);
    const west = latLngToCell(ORIGIN.lat, ORIGIN.lng - 0.001, RES);
    const east = latLngToCell(ORIGIN.lat, ORIGIN.lng + 0.001, RES);

    expect(groundAt(west)).not.toBeCloseTo(groundAt(east), 3);
  });
});
