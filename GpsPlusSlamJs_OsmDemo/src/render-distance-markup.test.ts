/**
 * The dial's markup value must be the constant the code boots from.
 *
 * WHY THIS TEST MATTERS. The dial ships with a `value` in `index.html` and the
 * boot path applies `renderDistanceFor(that value)`. Those are a pair with
 * nothing holding them together, and the failure is quiet in the worst way: a
 * markup value the boot path does not apply leaves the SLIDER THUMB and the
 * DRAWN DISTANCE disagreeing, while the readout — which is painted from the
 * camera, not from the slider — correctly reports the un-applied distance. So
 * the screen is self-consistent and the control is a lie.
 *
 * That is exactly the state the dial was in before DEC-K2: `value="1"` with a
 * boot path that only PAINTED, never applied. It went unnoticed because at 1x
 * the applied and un-applied numbers are identical (DEC-Y24 made the control
 * inert on purpose). The moment the default stops being 1x, the gap becomes
 * visible — which is why this guard arrives with the change that opens it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_RENDER_MULTIPLIER,
  MAX_RENDER_MULTIPLIER,
  renderDistanceFor,
} from "./render-distance.js";
import { FAR_PLANE_M } from "./building-view.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markup = readFileSync(resolve(packageRoot, "index.html"), "utf8");

/** The dial element itself, so a mention in a comment cannot satisfy the match. */
const dial = /<input[^>]*id="render-distance"[^>]*>/.exec(markup)?.[0] ?? "";

describe("the render-distance dial's markup and its constant", () => {
  it("carries DEFAULT_RENDER_MULTIPLIER as its value", () => {
    expect(dial).not.toBe("");
    const value = /value="([^"]*)"/.exec(dial)?.[1];
    expect(value).toBe(String(DEFAULT_RENDER_MULTIPLIER));
  });

  it("offers a range the default actually sits inside", () => {
    // A default outside [min, max] is silently clamped by the browser, so the
    // thumb and the constant would part company on the very first paint.
    const min = Number(/min="([^"]*)"/.exec(dial)?.[1]);
    const max = Number(/max="([^"]*)"/.exec(dial)?.[1]);

    expect(min).toBeLessThanOrEqual(DEFAULT_RENDER_MULTIPLIER);
    expect(max).toBeGreaterThanOrEqual(DEFAULT_RENDER_MULTIPLIER);
    expect(max).toBe(MAX_RENDER_MULTIPLIER);
  });

  it("lands on a whole step, so the thumb sits where the value says", () => {
    // `step` is 1 from `min`; a fractional default would render the thumb at a
    // position the value does not describe.
    const min = Number(/min="([^"]*)"/.exec(dial)?.[1]);
    const step = Number(/step="([^"]*)"/.exec(dial)?.[1]);

    expect(Number.isInteger((DEFAULT_RENDER_MULTIPLIER - min) / step)).toBe(
      true,
    );
  });

  it("names a default that is a real change from the inert 1x", () => {
    // GUARDS THE DECISION, NOT THE NUMBER. DEC-K2 exists because 1x was judged
    // too near; if someone quietly returns the default to 1 the dial becomes
    // inert again and the field request is silently reverted.
    expect(DEFAULT_RENDER_MULTIPLIER).toBeGreaterThan(1);
    expect(renderDistanceFor(DEFAULT_RENDER_MULTIPLIER).farPlaneM).toBe(
      FAR_PLANE_M * DEFAULT_RENDER_MULTIPLIER,
    );
  });
});
