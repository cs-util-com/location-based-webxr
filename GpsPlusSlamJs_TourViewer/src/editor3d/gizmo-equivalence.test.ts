/**
 * Why these tests matter: the gizmo's handles moved from the kind of the
 * selection (a station; an item, with dots when it is a model) to its
 * placement row. A creator who knew the old gizmo must find the same
 * ring, the same dots and the same knob on everything, at every zoom -
 * except where the row says otherwise ON PURPOSE: what always faces the
 * camera or the viewer (a pin's label, a reading sign's plate, a sound)
 * shows no knob and no stalk, since its turn never shows. The old layout
 * and the old drag rules are frozen here as they were, as the oracle.
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_PLACEMENT,
  STATION_PLACEMENT,
  type ViewPlacement,
} from "../placement/placement-rows.js";
import type { Placeable, PlaceExtent } from "../placement/placeables.js";
import { gestureTargetOf, gizmoSubjectOf } from "./gesture.js";
import {
  GIZMO,
  draggedRadiusM,
  draggedSizeM,
  gizmoLayout,
  viewHeightAtOneM,
  type GizmoLayout,
  type GroundSpot,
  type WorldPoint,
} from "./gizmo-maths.js";

// --- the frozen oracle: the layout and drag rules before the rows -------

interface OldSubject {
  readonly kind: "station" | "item";
  readonly centre: WorldPoint;
  readonly headingDeg: number;
  readonly radiusM: number | null;
  readonly sizeM: number | null;
  readonly locked?: boolean;
}

const RAD = Math.PI / 180;

function along(centre: GroundSpot, deg: number, distanceM: number): GroundSpot {
  return {
    x: centre.x + Math.sin(deg * RAD) * distanceM,
    z: centre.z - Math.cos(deg * RAD) * distanceM,
  };
}

function oldLayout(subject: OldSubject, metresPerPx: number): GizmoLayout {
  const station = subject.kind === "station";
  const model = !station && subject.sizeM !== null;
  const radius = station
    ? (subject.radiusM ?? 2)
    : Math.max(
        model
          ? GIZMO.modelRingPerSizeM * (subject.sizeM ?? 0)
          : GIZMO.itemRingMinM,
        GIZMO.itemRingPx * metresPerPx,
      );
  const moveM = station
    ? Math.max(GIZMO.stationMoveMinM, GIZMO.stationMovePx * metresPerPx)
    : radius;
  const heading = subject.headingDeg;
  const dots =
    station || model
      ? [0, 1, 2, 3].map((i) =>
          along(subject.centre, heading + 45 + i * 90, radius),
        )
      : [];
  const reach = radius + GIZMO.knobGapPx * metresPerPx;
  return {
    centre: subject.centre,
    posable: !(station && subject.locked === true),
    headingDeg: heading,
    ringM: station ? null : radius,
    moveM,
    dots,
    knob: along(subject.centre, heading, reach),
    bar: {
      fromM: radius,
      lengthM: reach - radius,
      widthM: Math.max(GIZMO.barMinM, GIZMO.barPx * metresPerPx),
    },
  };
}

function oldRadiusM(distanceM: number, fine: boolean): number {
  const r = fine
    ? Math.round(distanceM * 10) / 10
    : Math.round(distanceM * 2) / 2;
  return Math.min(300, Math.max(2, r));
}

function threeDigits(m: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, m))) - 2);
  return Number((Math.round(m / p) * p).toPrecision(3));
}

function oldSizeM(sizeM: number, startM: number, distanceM: number): number {
  const scaled = (sizeM * Math.max(distanceM, 1e-3)) / startM;
  return Math.min(500, Math.max(0.05, threeDigits(scaled)));
}

// --- the subjects ---------------------------------------------------------

const CENTRE = { x: 12, y: 520, z: -7 };
const GEO = (headingDeg: number) => ({
  lat: 48.1,
  lon: 11.5,
  alt: 521.5,
  headingDeg,
});

/** A placeable of `row` with its dots at `value`. */
function placeable(
  ref: Placeable["ref"],
  row: ViewPlacement,
  headingDeg: number,
  value: number,
  locked = false,
): Placeable {
  const extent: PlaceExtent | null =
    row.extent === undefined ? null : { ...row.extent, value };
  return {
    ref,
    selection: ref.id,
    stationId: "st",
    folderPath: [],
    geo: GEO(headingDeg),
    local: null,
    inStation: null,
    inheritedScale: 1,
    turns: row.turns,
    lifts: row.lifts,
    extent,
    locked,
    members: [],
  };
}

/** The new layout, as the editing builds it at rest. */
function newLayout(p: Placeable, metresPerPx: number): GizmoLayout {
  const target = gestureTargetOf(p, CENTRE);
  const now = { geo: target.geo, value: target.extent?.value ?? null };
  return gizmoLayout(gizmoSubjectOf(target, now, CENTRE), metresPerPx);
}

/** The metres a pixel covers at `distanceM` from a 50 degree lens on a
 *  view `viewportPx` high. */
const mppAt = (distanceM: number, viewportPx: number) =>
  (distanceM * viewHeightAtOneM(50)) / viewportPx;

/** Every posed (kind, view) of the table with its row. */
const POSED = Object.entries(BLOCK_PLACEMENT).flatMap(([kind, views]) =>
  Object.entries(views as Readonly<Record<string, ViewPlacement>>)
    .filter(([, row]) => row.posed)
    .map(([view, row]) => ({ kind, view, row })),
);

// Swept: camera distances 5, 50 and 300 m (the editor's range) on a
// phone's and a desktop's view height; headings 0, 37 and 270 degrees;
// a model's size and a station's radius at their bounds and between.
const DISTANCES = [5, 50, 300];
const VIEWPORTS = [390, 900];
const HEADINGS = [0, 37, 270];

describe("the gizmo through the placement rows against the frozen layout", () => {
  it("is the same for every turning item and model, at every zoom", () => {
    let compared = 0;
    for (const { kind, view, row } of POSED) {
      if (!row.turns) continue;
      const sizes = kind === "model" ? [0.05, 2.4, 40, 500] : [1];
      for (const sizeM of sizes) {
        for (const headingDeg of HEADINGS) {
          const p = placeable(
            { kind: "block", id: "b" },
            row,
            headingDeg,
            sizeM,
          );
          const old: OldSubject = {
            kind: "item",
            centre: CENTRE,
            headingDeg,
            radiusM: null,
            sizeM: kind === "model" ? sizeM : null,
          };
          for (const d of DISTANCES) {
            for (const px of VIEWPORTS) {
              const mpp = mppAt(d, px);
              expect(
                newLayout(p, mpp),
                `${kind}.${view} at ${String(d)} m`,
              ).toEqual(oldLayout(old, mpp));
              compared++;
            }
          }
        }
      }
    }
    // Every turning row was compared (lectern, picture, five model views,
    // five character views).
    expect(compared).toBeGreaterThan(0);
  });

  it("is the same for what faces the camera, less its knob and stalk", () => {
    const facing = POSED.filter(({ row }) => !row.turns);
    expect(facing.map(({ kind, view }) => `${kind}.${view}`).sort()).toEqual([
      "audio.spot",
      "audio.zone",
      "longText.reading",
      "shortText.pin",
    ]);
    for (const { kind, view, row } of facing) {
      for (const headingDeg of HEADINGS) {
        const p = placeable({ kind: "block", id: "b" }, row, headingDeg, 1);
        const old: OldSubject = {
          kind: "item",
          centre: CENTRE,
          headingDeg,
          radiusM: null,
          sizeM: null,
        };
        for (const d of DISTANCES) {
          const mpp = mppAt(d, 900);
          expect(newLayout(p, mpp), `${kind}.${view}`).toEqual({
            ...oldLayout(old, mpp),
            knob: null,
            bar: null,
          });
        }
      }
    }
  });

  it("is the same for a station, locked or not, at every radius and zoom", () => {
    for (const radiusM of [2, 25, 300]) {
      for (const locked of [false, true]) {
        for (const headingDeg of HEADINGS) {
          const p = placeable(
            { kind: "station", id: "st" },
            STATION_PLACEMENT,
            headingDeg,
            radiusM,
            locked,
          );
          const old: OldSubject = {
            kind: "station",
            centre: CENTRE,
            headingDeg,
            radiusM,
            sizeM: null,
            locked,
          };
          for (const d of DISTANCES) {
            for (const px of VIEWPORTS) {
              const mpp = mppAt(d, px);
              expect(newLayout(p, mpp)).toEqual(oldLayout(old, mpp));
            }
          }
        }
      }
    }
  });

  // Why: a picture's width has a row extent, but the session cannot
  // write it yet; until it can, the picture's gizmo stays the old one -
  // no dots that would drag to nothing.
  it("withholds the dots the session cannot write yet (a picture's width)", () => {
    const p = placeable(
      { kind: "block", id: "pic" },
      BLOCK_PLACEMENT.picture.plane,
      0,
      3,
    );
    expect(p.extent).not.toBeNull();
    expect(gestureTargetOf(p, CENTRE).extent).toBeNull();
    expect(newLayout(p, mppAt(50, 900)).dots).toEqual([]);
  });
});

describe("the dots' drag rules through the rows against the frozen rules", () => {
  const radius = STATION_PLACEMENT.extent;
  const size = BLOCK_PLACEMENT.model.placed.extent;

  it("drags a station's radius exactly as before", () => {
    if (radius === undefined) throw new Error("a station has dots");
    for (let d = 0; d <= 400; d += 0.37) {
      for (const fine of [false, true]) {
        expect(draggedRadiusM(d, fine, radius)).toBe(oldRadiusM(d, fine));
      }
    }
  });

  it("drags a model's size exactly as before", () => {
    if (size === undefined) throw new Error("a model has dots");
    for (const sizeM of [0.05, 1, 2.4, 40, 500]) {
      for (const startM of [0.2, 1, 7.5]) {
        for (let d = 0; d <= 60; d += 0.53) {
          expect(draggedSizeM(sizeM, startM, d, size)).toBe(
            oldSizeM(sizeM, startM, d),
          );
        }
      }
    }
  });
});
