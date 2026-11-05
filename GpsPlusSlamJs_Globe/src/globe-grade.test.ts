import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_GLOBE_GRADE,
  GLOBE_GRADES,
  GLOBE_GRADE_PARAM,
  applyGlobeGrade,
  resolveGlobeGrade,
} from "./globe-grade.js";

/**
 * Why these tests matter: the colour grade decides how every picture of
 * the globe looks, and a name in a link picks it. The default must stay the
 * look the globe had before the presets existed, the prototype's must stay
 * its curve and exposure, and a mistyped link must degrade to the default
 * with a warning: a tester who opens a wrong link sees the plain globe and
 * a console line, not a dead page.
 */
describe("the grade table", () => {
  it("keeps the look from before the presets as the default", () => {
    expect(DEFAULT_GLOBE_GRADE).toBe("neutral");
    expect(GLOBE_GRADES.neutral).toEqual({
      toneMapping: THREE.NeutralToneMapping,
      exposure: 1,
    });
  });

  it("carries the prototype's ACES at 0.47", () => {
    expect(GLOBE_GRADES.aces).toEqual({
      toneMapping: THREE.ACESFilmicToneMapping,
      exposure: 0.47,
    });
  });

  it("has at least four presets, none two alike, every exposure positive", () => {
    const grades = Object.values(GLOBE_GRADES);
    expect(grades.length).toBeGreaterThanOrEqual(4);
    const keys = grades.map((g) => `${g.toneMapping}@${g.exposure}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const grade of grades) {
      expect(grade.exposure).toBeGreaterThan(0);
      expect(Number.isFinite(grade.exposure)).toBe(true);
    }
  });

  it("names the link's parameter", () => {
    expect(GLOBE_GRADE_PARAM).toBe("grade");
  });
});

describe("resolveGlobeGrade", () => {
  it("reads no name as the default, without a warning", () => {
    const warn = vi.fn();
    expect(resolveGlobeGrade(null, warn)).toBe(DEFAULT_GLOBE_GRADE);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps every name of the table", () => {
    const warn = vi.fn();
    for (const name of Object.keys(GLOBE_GRADES)) {
      expect(resolveGlobeGrade(name, warn)).toBe(name);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["nope", "", "ACES", "constructor", "__proto__", "toString"])(
    "reads the unknown name %j as the default, with one warning that lists the names",
    (name) => {
      const warn = vi.fn();
      expect(resolveGlobeGrade(name, warn)).toBe(DEFAULT_GLOBE_GRADE);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      for (const known of Object.keys(GLOBE_GRADES)) {
        expect(line).toContain(known);
      }
    },
  );

  it("warns on the console by default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveGlobeGrade("nope")).toBe(DEFAULT_GLOBE_GRADE);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("applyGlobeGrade", () => {
  it("sets the renderer's tone mapping and exposure from the table", () => {
    const renderer = {
      toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
      toneMappingExposure: 1,
    };
    applyGlobeGrade(renderer, "aces");
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(0.47);
  });

  it("refuses a name that is not in the table", () => {
    const renderer = {
      toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
      toneMappingExposure: 1,
    };
    expect(() => {
      applyGlobeGrade(renderer, "nope" as never);
    }).toThrow(RangeError);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });
});
