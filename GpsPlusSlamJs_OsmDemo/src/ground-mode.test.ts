/**
 * The ground mode — three states, one of which disables another control.
 *
 * Why these tests matter:
 * This control replaces a checkbox with a picker, and the two ways it can go
 * wrong are both silent. An unknown value from a URL parameter must not leave
 * the scene with no ground and no explanation, and `No ground` must disable the
 * height ramp — which re-colours the ground plane in place, so with the plane
 * hidden it becomes a switch that does nothing. "A control that does nothing" is
 * the shape of half of round 3's findings; shipping a new one would be poor.
 *
 * @see ground-mode.ts.md
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_GROUND_MODE,
  GROUND_MODES,
  groundDebugAvailable,
  groundModeLabel,
  parseGroundMode,
} from "./ground-mode.js";

describe("parseGroundMode", () => {
  it("accepts every mode the picker offers", () => {
    // Exhaustive over the list rather than over three literals, so a fourth mode
    // cannot arrive without being parseable.
    for (const mode of GROUND_MODES) {
      expect(parseGroundMode(mode)).toBe(mode);
    }
  });

  it("falls back to the default for anything else", () => {
    // The store holds this as a plain string (the framework may not name a demo
    // type) and it is a candidate for a URL parameter, so the input is genuinely
    // untrusted. Falling back rather than throwing: "the ground vanished because
    // of a typo in a query string" is the worst available outcome.
    expect(parseGroundMode("wireframe")).toBe(DEFAULT_GROUND_MODE);
    expect(parseGroundMode("")).toBe(DEFAULT_GROUND_MODE);
    expect(parseGroundMode(undefined)).toBe(DEFAULT_GROUND_MODE);
  });

  it("defaults to the CPU path, i.e. to what shipped before this control", () => {
    // A new control must not change the default picture, or every screenshot and
    // every pixel assertion in the suite moves for a reason unrelated to it.
    expect(DEFAULT_GROUND_MODE).toBe("cpu");
  });
});

describe("groundDebugAvailable", () => {
  it("is false only when there is no ground to colour", () => {
    expect(groundDebugAvailable("none")).toBe(false);
    expect(groundDebugAvailable("cpu")).toBe(true);
    expect(groundDebugAvailable("gpu")).toBe(true);
  });
});

describe("groundModeLabel", () => {
  it("names every mode distinctly", () => {
    const labels = GROUND_MODES.map(groundModeLabel);
    expect(new Set(labels).size).toBe(GROUND_MODES.length);
  });
});
