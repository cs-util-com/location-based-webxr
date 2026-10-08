/**
 * Why this test matters: the owner (2026-10-07, on r793, flying into the
 * Alps): the flat cloud layer over the Earth "is still too visible at
 * 1,000 km and at 100 km; it should weaken much earlier and be gone at the
 * latest when the volumetric clouds are fully in" (round-2 plan
 * 2026-10-07-2350 DEC-FR2-5, revised by its cold review, finding 4). And
 * the recorded C2 invariant (`globe-cloud-volume.ts`): no altitude draws the
 * clouds twice or not at all, so the layer hands over to the volume through
 * the volume's own fade.
 */

import { describe, expect, it } from "vitest";

import { cloudVolumeShare } from "./globe-cloud-volume.js";
import { GLOBE_CLOUD_FLAT, flatCloudShare } from "./globe-cloud-flat-fade.js";

const KM = 1_000;
const LAB = { ceilingKm: 40, fadeKm: 25 };

describe("flatCloudShare", () => {
  it("is full high up, and gone exactly when the volume is full", () => {
    expect(flatCloudShare(65_000 * KM, LAB)).toBe(1);
    expect(flatCloudShare(GLOBE_CLOUD_FLAT.topM, LAB)).toBe(1);
    expect(flatCloudShare(15 * KM, LAB)).toBe(0);
    expect(flatCloudShare(2 * KM, LAB)).toBe(0);
  });

  // The owner's 1,000 km and 100 km: clearly weaker than at the top.
  it("is clearly weaker at 1,000 km and weak by 100 km", () => {
    expect(flatCloudShare(1_000 * KM, LAB)).toBeLessThan(0.75);
    expect(flatCloudShare(100 * KM, LAB)).toBeCloseTo(
      GLOBE_CLOUD_FLAT.weakShare,
      9,
    );
  });

  it("never rises on the way down", () => {
    let last = Infinity;
    for (let h = 70_000 * KM; h > 1 * KM; h /= 1.01) {
      const share = flatCloudShare(h, LAB);
      expect(share).toBeLessThanOrEqual(last + 1e-12);
      last = share;
    }
  });

  // C2: the volume takes over exactly what the layer gives up below its
  // ceiling, so the clouds never vanish between the two.
  it("hands over to the volume through the volume's own fade", () => {
    for (let h = 40 * KM; h >= 15 * KM; h -= 0.5 * KM) {
      const volume = cloudVolumeShare(h / KM, LAB);
      expect(flatCloudShare(h, LAB) / GLOBE_CLOUD_FLAT.weakShare).toBeCloseTo(
        1 - volume,
        9,
      );
    }
  });

  it("follows the fade it is given (the module's default volume, 40/10)", () => {
    expect(flatCloudShare(30 * KM, { ceilingKm: 40, fadeKm: 10 })).toBe(0);
    expect(flatCloudShare(30 * KM, LAB)).toBeGreaterThan(0);
  });

  it("takes the top and the weak share as options", () => {
    const options = { ...LAB, topM: 10_000 * KM, weakShare: 0.5 };
    expect(flatCloudShare(5_000 * KM, options)).toBeLessThan(1);
    expect(flatCloudShare(100 * KM, options)).toBeCloseTo(0.5, 9);
  });

  it("rejects an altitude that is not finite and a weak share outside [0, 1]", () => {
    expect(() => flatCloudShare(Number.NaN, LAB)).toThrow(RangeError);
    expect(() => flatCloudShare(10 * KM, { ...LAB, weakShare: 2 })).toThrow(
      RangeError,
    );
  });
});
