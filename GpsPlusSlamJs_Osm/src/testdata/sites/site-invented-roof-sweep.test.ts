import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { inventedRoofPlans } from "../../mesh/buildings.js";
import { enuFrameAt } from "../../mesh/enu.js";
import {
  ROOFSCAPE_DEFAULTS,
  type RoofscapeParams,
} from "../../mesh/roofscape-rules.js";

/**
 * The invented-roof counts across each rule's plausible range, one rule at
 * a time from the defaults, on the two New York sites that must stay flat
 * and on Meggen, the village that must be roofed.
 *
 * WHY THIS FILE MATTERS. The pins in `site-invented-roofs.test.ts` (Park
 * Slope 0, Midtown 0, Meggen 225) are taken at ONE set of values. A verdict
 * at one value is provisional: this file says which values reverse it, so a
 * later change to a default knows what it buys and what it breaks. It also
 * re-runs the two reversals the prototype's New York report found
 * (`priorMinEvidence` 2 and `tallM` 12 on Park Slope) against the port.
 *
 * The counts are the library's own at the time of writing; a change to the
 * planner that moves one is a decision, re-pinned with its reason, never to
 * make this green.
 */

const SITES = [
  "nyc-park-slope",
  "manhattan-midtown",
  "lucerne-meggen",
] as const;
type Site = (typeof SITES)[number];

const RANGES: Readonly<Partial<Record<keyof RoofscapeParams, number[]>>> = {
  priorRadiusM: [75, 200, 500],
  priorMinEvidence: [2, 5, 20],
  flatShareMin: [0.3, 0.5, 0.9],
  tallM: [6, 9, 12],
  tallShareMin: [0.3, 0.5, 0.9],
  largeFootprintM2: [450, 2500],
  heightLimitM: [10, 14, 20],
};

const inputs = new Map(
  SITES.map((id) => {
    const site = loadSite(id);
    return [
      id,
      {
        features: parseOverpassJson(site.payload).features,
        frame: enuFrameAt(site.centre),
      },
    ] as const;
  }),
);

function roofed(id: Site, params: RoofscapeParams): number {
  const input = inputs.get(id);
  if (input === undefined) throw new Error(`no site ${id}`);
  let n = 0;
  for (const plan of inventedRoofPlans(
    input.features,
    input.frame,
    params,
  ).values()) {
    if (plan.kind === "roof") n += 1;
  }
  return n;
}

/**
 * Measured counts per site (Park Slope, Midtown, Meggen), rule and value.
 * What reverses a verdict: `priorMinEvidence` 2 roofs 150 of Park Slope
 * (the prototype report saw the same flip); `tallM` 12 roofs 11 there (the
 * prototype saw 13); `tallShareMin` 0.9 roofs 31 there; `priorRadiusM` 75
 * and `flatShareMin` 0.9 roof a few of Midtown (3 and 7). Meggen holds at
 * 225 everywhere but `largeFootprintM2` 450 (206). `heightLimitM` moves
 * nothing on these sites.
 */
const EXPECTED: Readonly<Record<string, readonly [number, number, number]>> = {
  "priorRadiusM 75": [0, 3, 225],
  "priorRadiusM 200": [0, 0, 225],
  "priorRadiusM 500": [0, 0, 225],
  "priorMinEvidence 2": [150, 0, 225],
  "priorMinEvidence 5": [0, 0, 225],
  "priorMinEvidence 20": [0, 0, 225],
  "flatShareMin 0.3": [0, 0, 225],
  "flatShareMin 0.5": [0, 0, 225],
  "flatShareMin 0.9": [0, 7, 225],
  "tallM 6": [0, 0, 225],
  "tallM 9": [0, 0, 225],
  "tallM 12": [11, 0, 225],
  "tallShareMin 0.3": [0, 0, 225],
  "tallShareMin 0.5": [0, 0, 225],
  "tallShareMin 0.9": [31, 0, 225],
  "largeFootprintM2 450": [0, 0, 206],
  "largeFootprintM2 2500": [0, 0, 225],
  "heightLimitM 10": [0, 0, 225],
  "heightLimitM 14": [0, 0, 225],
  "heightLimitM 20": [0, 0, 225],
};

describe("invented roofs across each rule's range", () => {
  it("roofs Meggen and leaves New York flat at the defaults", () => {
    expect(SITES.map((id) => roofed(id, ROOFSCAPE_DEFAULTS))).toEqual([
      0, 0, 225,
    ]);
  });

  for (const [rule, values] of Object.entries(RANGES)) {
    for (const value of values ?? []) {
      const label = `${rule} ${value}`;
      it(`${label}: Park Slope, Midtown, Meggen`, () => {
        const params = { ...ROOFSCAPE_DEFAULTS, [rule]: value };
        const counts = SITES.map((id) => roofed(id, params));
        expect(counts).toEqual(EXPECTED[label]);
      });
    }
  }
});
