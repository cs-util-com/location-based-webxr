/**
 * Why these tests matter: a picture seen from a viewpoint is drawn where
 * its viewpoint says, not at its own pose, so the 3D view's handle for it
 * must be the viewpoint: dragging the picture's pose would move nothing
 * the creator can see. The viewpoint stands in its station's frame (its
 * folders do not carry it), so its handle does too. A picture in any
 * other view, or in a viewpoint view still without one (drawn as a plain
 * plane at its pose), keeps its own handle. The station's own readers
 * (its circle, its grounding, a new pin's free spot) still read the
 * picture's pose: only the selection's handle changes.
 */
import { describe, expect, it } from "vitest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";
import type {
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type { TourStationChild } from "gps-plus-slam-app-framework/ar/tour-story";

import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { viewpointRotation } from "../editor/picture-viewpoint.js";
import { placeableOf, posedEntryOf } from "./placeables.js";

// A geo pose is minted through the core library, which wants its store.
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const VIEWPOINT = {
  position: [9, 1.6, 0] as [number, number, number],
  rotation: viewpointRotation(180, -5),
  hfovDeg: 56,
  distanceM: 6,
};

function picture(view: string, withViewpoint = true): TourBlock {
  return {
    id: "p",
    kind: "picture",
    view,
    createdAtIso: "2026-11-13T08:00:00Z",
    image: "img",
    widthM: 1.2,
    pose: { position: [3, 0, 0], rotation: [0, 0, 0, 1] },
    ...(withViewpoint ? { viewpoint: VIEWPOINT } : {}),
  } as unknown as TourBlock;
}

/** A station holding `block` inside a folder 100 m north of its anchor. */
function stationWith(block: TourBlock): TourStation {
  return {
    id: "a",
    title: "Station a",
    geo: { lat: 48.1, lon: 11.5, alt: 520, rotation: [0, 0, 0, 1] },
    activateRadiusM: 30,
    foundRadiusM: 8,
    hint: "arrow",
    children: [
      {
        id: "f",
        kind: "folder",
        pose: { position: [100, 0, 0], rotation: [0, 0, 0, 1] },
        children: [block],
      } as unknown as TourStationChild,
    ],
  };
}

/** The heading of a turn: its x axis, clockwise from north. */
function headingOf(q: readonly number[]): number {
  const [x = 0, y = 0, z = 0, w = 1] = q;
  const north = 1 - 2 * (y * y + z * z);
  const east = 2 * (x * z - w * y);
  return ((((Math.atan2(east, north) * 180) / Math.PI) % 360) + 360) % 360;
}

describe("a picture seen from its viewpoint, as the selection's placeable", () => {
  for (const view of ["thenNow", "sharpen", "viewer", "finder", "window"]) {
    it(`is its viewpoint in ${view}: in the station's frame, turning and lifting, no dots`, () => {
      const station = stationWith(picture(view));
      const p = placeableOf({ stations: [station] }, "p");
      expect(p?.ref).toEqual({ kind: "viewpoint", id: "p" });
      expect(p?.selection).toBe("p");
      expect(p?.stationId).toBe("a");
      expect(p?.folderPath).toEqual([]);
      expect(p?.inheritedScale).toBe(1);
      expect(p?.turns).toBe(true);
      expect(p?.lifts).toBe(true);
      expect(p?.extent).toBeNull();
      expect(p?.locked).toBe(false);
      expect(p?.members).toEqual(["p"]);
      expect(p?.inStation?.position).toEqual([9, 1.6, 0]);
      expect(p?.local).toEqual(p?.inStation);
      expect(headingOf(p?.inStation?.rotation ?? [])).toBeCloseTo(180, 6);
      expect(p?.geo).toEqual(itemGeoPose(p!.inStation!, station.geo));
    });
  }

  it("is the picture itself in any other view, and in a viewpoint view without one", () => {
    for (const block of [picture("framed"), picture("thenNow", false)]) {
      const p = placeableOf({ stations: [stationWith(block)] }, "p");
      expect(p?.ref).toEqual({ kind: "block", id: "p" });
      expect(p?.inStation?.position).toEqual([103, 0, 0]);
    }
  });

  it("leaves the station's own readers on the picture's pose", () => {
    const station = stationWith(picture("thenNow"));
    const entry = posedEntryOf(station, "p");
    expect(entry?.place.ref).toEqual({ kind: "block", id: "p" });
    expect(entry?.place.inStation?.position).toEqual([103, 0, 0]);
  });
});
