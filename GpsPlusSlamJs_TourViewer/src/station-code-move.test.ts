/**
 * Why these tests matter (tour editor plan 2026-10-17-1816, D17, the
 * owner's condition): a re-measured code moves whole stations, and the
 * move must be ATOMIC - the station's geo pose changes, its items' local
 * poses never do. A logic that moved items one by one would rewrite their
 * local poses and, at the first rounding, split a station's content from
 * the station. Which stations move is today's rule for notes (within
 * about 40 m and no nearer another code), applied to the station's anchor.
 */
import { describe, expect, it } from "vitest";
import { calcRelativeCoordsInMeters } from "gps-plus-slam-app-framework/core";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type {
  TourItem,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { itemGeoPose } from "gps-plus-slam-app-framework/ar/tour-station-pose";

import "./test-support/v3-tour.js";
import { moveWithCode } from "./move-with-code.js";
import { moveStationsWithCode } from "./station-code-move.js";

const M_PER_DEG = 111_320;
const code: QrGeoPose = {
  lat: 48.1374,
  lon: 11.5755,
  alt: 520,
  rotation: [0, 0, 0, 1],
};

const yaw = (deg: number): [number, number, number, number] => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

/** A pose `north` / `east` metres from the code. */
function at(north: number, east: number): QrGeoPose {
  return {
    lat: code.lat + north / M_PER_DEG,
    lon: code.lon + east / (M_PER_DEG * Math.cos((code.lat * Math.PI) / 180)),
    alt: 520,
    rotation: [0, 0, 0, 1],
  };
}

function metres(a: QrGeoPose, b: QrGeoPose): number {
  const r = calcRelativeCoordsInMeters(a, b, b.alt, a.alt);
  return Math.hypot(r[0], r[1], r[2]);
}

const pin = (id: string, position: [number, number, number]): TourItem => ({
  id,
  kind: "pin",
  label: id,
  createdAtIso: "2026-10-18T00:00:00.000Z",
  pose: { position, rotation: [0, 0, 0, 1] },
});

function station(
  id: string,
  geo: QrGeoPose,
  items: TourItem[] = [],
): TourStation {
  return {
    id,
    geo,
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items,
  };
}

/** The code measured 2 m further north and turned 30 degrees. */
const improved: QrGeoPose = { ...at(2, 0), rotation: yaw(30) };

describe("moveStationsWithCode (D17)", () => {
  it("moves a station within reach with its code, its items untouched", () => {
    const items = [pin("a", [1, 0, 2]), pin("b", [-3, 1, 0])];
    const near = station("near", at(10, 5), items);
    const out = moveStationsWithCode([near], {
      from: code,
      to: improved,
      others: [],
    });
    expect(out.moved).toEqual(["near"]);
    const [moved] = out.stations;
    // The very same items: nothing of them was rewritten.
    expect(moved!.items).toBe(items);
    expect(moved!.geo).toEqual(moveWithCode(near.geo, code, improved));
    expect({ ...moved, geo: near.geo }).toEqual(near);
    // Every item stands where the code's correction puts it.
    for (const item of items) {
      const before = itemGeoPose(item.pose, near.geo);
      const after = itemGeoPose(item.pose, moved!.geo);
      expect(metres(after, moveWithCode(before, code, improved))).toBeLessThan(
        0.002,
      );
    }
  });

  it("leaves a station beyond 40 m, one nearer another code and one already claimed", () => {
    const far = station("far", at(45, 0));
    const other = at(20, 0);
    const nearOther = station("near-other", at(15, 0));
    const claimed = station("claimed", at(3, 0));
    const out = moveStationsWithCode([far, nearOther, claimed], {
      from: code,
      to: improved,
      others: [other],
      claimed: new Set(["claimed"]),
    });
    expect(out.moved).toEqual([]);
    expect(out.stations[0]).toBe(far);
    expect(out.stations[1]).toBe(nearOther);
    expect(out.stations[2]).toBe(claimed);
  });

  it("decides by the station's anchor, not by where its items stand", () => {
    // The anchor 39 m away, an item 20 m further out: the station moves,
    // with the item; an anchor 41 m away stays, with an item at the code.
    const inReach = station("in", at(39, 0), [pin("out", [20, 0, 0])]);
    const outOfReach = station("out", at(41, 0), [pin("here", [-41, 0, 0])]);
    const out = moveStationsWithCode([inReach, outOfReach], {
      from: code,
      to: improved,
      others: [],
    });
    expect(out.moved).toEqual(["in"]);
  });

  it("gives a tie to the improved code, as for notes", () => {
    const tie = station("tie", at(10, 0));
    const out = moveStationsWithCode([tie], {
      from: code,
      to: improved,
      others: [at(20, 0)],
    });
    expect(out.moved).toEqual(["tie"]);
  });

  it("keeps the order and every station's id", () => {
    const list = [station("a", at(1, 0)), station("b", at(60, 0))];
    const out = moveStationsWithCode(list, {
      from: code,
      to: improved,
      others: [],
    });
    expect(out.stations.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
