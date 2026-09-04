/**
 * Unit tests for the indicator sprite asset URLs.
 *
 * Why these tests matter: the URLs feed the framework's TextureLoader path
 * verbatim — a renamed or missing file would only surface as a silently
 * empty sprite on device. Resolving the module URLs back to files pins that
 * the self-made assets actually exist next to the module (in node the
 * `import.meta.url` base is a file:// URL, so the check is exact), and that
 * each SVG carries the intrinsic size the `<img>`-based loader needs: an
 * SVG with only a viewBox rasterises at the browser default (300 × 150) and
 * the sprite comes out blurred and stretched with no error anywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARROW_SPRITE_URL, CIRCLE_SPRITE_URL } from "./indicator-assets";

describe("indicator assets", () => {
  it("exposes two distinct SVG asset URLs", () => {
    expect(ARROW_SPRITE_URL).toMatch(/wayfinding-arrow.*\.svg$/);
    expect(CIRCLE_SPRITE_URL).toMatch(/wayfinding-diamond.*\.svg$/);
    expect(ARROW_SPRITE_URL).not.toBe(CIRCLE_SPRITE_URL);
  });

  it("points at asset files that exist on disk", () => {
    expect(existsSync(fileURLToPath(ARROW_SPRITE_URL))).toBe(true);
    expect(existsSync(fileURLToPath(CIRCLE_SPRITE_URL))).toBe(true);
  });

  it("gives each SVG an explicit square intrinsic size for the <img> loader", () => {
    for (const url of [ARROW_SPRITE_URL, CIRCLE_SPRITE_URL]) {
      const svg = readFileSync(fileURLToPath(url), "utf8");
      expect(svg).toMatch(/<svg[^>]*\swidth="256"/);
      expect(svg).toMatch(/<svg[^>]*\sheight="256"/);
    }
  });
});
