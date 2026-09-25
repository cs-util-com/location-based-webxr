import { describe, expect, it } from "vitest";

import { TourLoadError } from "./errors.js";

/**
 * Why this matters: the onboarding gate branches on *why* a tour failed to open
 * (an unusable link is the author's problem; a corrupt zip is the file's), so
 * the discriminated `cause` is load-bearing, not decoration. It is also what
 * separates the two error tiers (C14): a `TourLoadError` is fatal to the whole
 * load, distinct from a soft per-asset `getAssetUrl` rejection.
 */

describe("TourLoadError", () => {
  it("is an Error carrying a typed cause and message", () => {
    const err = new TourLoadError("cors", "blocked by CORS");

    expect(err).toBeInstanceOf(Error);
    expect(err.loadCause).toBe("cors");
    expect(err.message).toBe("blocked by CORS");
    expect(err.name).toBe("TourLoadError");
  });
});
