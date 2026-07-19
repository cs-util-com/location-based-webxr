/**
 * Unit tests for the indicator sprite asset URLs.
 *
 * Why these tests matter: the URLs feed the framework's TextureLoader path
 * verbatim — a renamed or missing PNG would only surface as a silently
 * empty sprite on device. Resolving the module URLs back to files pins that
 * the self-made assets actually exist next to the module (in node the
 * `import.meta.url` base is a file:// URL, so the check is exact).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARROW_SPRITE_URL, CIRCLE_SPRITE_URL } from "./indicator-assets";

describe("indicator assets", () => {
  it("exposes two distinct PNG asset URLs", () => {
    expect(ARROW_SPRITE_URL).toMatch(/wayfinding-arrow.*\.png$/);
    expect(CIRCLE_SPRITE_URL).toMatch(/wayfinding-ring.*\.png$/);
    expect(ARROW_SPRITE_URL).not.toBe(CIRCLE_SPRITE_URL);
  });

  it("points at asset files that exist on disk", () => {
    expect(existsSync(fileURLToPath(ARROW_SPRITE_URL))).toBe(true);
    expect(existsSync(fileURLToPath(CIRCLE_SPRITE_URL))).toBe(true);
  });
});
