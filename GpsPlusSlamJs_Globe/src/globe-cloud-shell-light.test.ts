/**
 * The spherical cloud volume's ambient light.
 *
 * Why this file matters: the shell spans the terminator, so it cannot take
 * the slab's one zenith sky (the ground sky's, for one sun); it lights each
 * sample by its own sun through a small table of the framework's CPU sky,
 * by the sun's cosine. A table that was flat, negative, or bright at night
 * would light the night side's clouds or leave the day's grey: held here,
 * where it is cheap, rather than by a browser smoke. Moved from the lab's
 * node test with the module; the assertions are the same.
 */
import { describe, expect, it } from "vitest";

import {
  ZENITH_MU,
  ZENITH_TABLE,
  zenithTable,
} from "./globe-cloud-shell-light.js";

describe("zenithTable", () => {
  const table = zenithTable(60, 3);
  const lum = (rgb: readonly number[]) =>
    0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);

  it("holds 13 finite, non-negative entries from below the horizon to overhead", () => {
    expect(table).toHaveLength(ZENITH_MU.entries);
    expect(table).toHaveLength(13);
    for (const v of table) {
      for (const c of v) {
        expect(Number.isFinite(c) && c >= 0, `entry ${c}`).toBe(true);
      }
    }
  });

  it("is blue by day, dark at night and brightens as the sun climbs", () => {
    const day = table.at(-1) ?? [0, 0, 0];
    expect(day[2]).toBeGreaterThan(day[0]);
    // Dark with the sun 17 degrees down.
    expect(lum(table[0] ?? [])).toBeLessThan(0.02 * lum(day));
    for (let i = 4; i < table.length; i++) {
      expect(lum(table[i] ?? []), `rises at ${i}`).toBeGreaterThanOrEqual(
        lum(table[i - 1] ?? []),
      );
    }
  });

  // The shell reads the baked table (the computation is 470 ms of main
  // thread); it must be what the computation gives, to 5 digits.
  it("is what the shell reads, baked", () => {
    expect(ZENITH_TABLE).toHaveLength(table.length);
    table.forEach((rgb, i) =>
      rgb.forEach((c, k) => {
        const baked = ZENITH_TABLE[i]?.[k] ?? Number.NaN;
        expect(
          Math.abs(c - baked) <= 1e-4 * Math.max(c, 1e-6) + 1e-12,
          `entry ${i}.${k}: ${c} against ${baked}`,
        ).toBe(true);
      }),
    );
  });

  it("is frozen, so no reader can change the shell's light", () => {
    expect(Object.isFrozen(ZENITH_TABLE)).toBe(true);
    expect(ZENITH_TABLE.every((rgb) => Object.isFrozen(rgb))).toBe(true);
  });

  it("refuses a visibility or a height it cannot light", () => {
    expect(() => zenithTable(0, 2)).toThrow(RangeError);
    expect(() => zenithTable(60, Number.NaN)).toThrow(RangeError);
    expect(() => zenithTable(60, -1)).toThrow(RangeError);
    expect(() => zenithTable(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });
});
