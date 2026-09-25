import { describe, expect, it } from "vitest";

import { resolveAppMode, isPreviewRequested } from "./mode.js";

describe("resolveAppMode", () => {
  it("resolves to viewing when ?tour= is present", () => {
    expect(
      resolveAppMode(new URL("https://app.example/?tour=https://x/tour.zip")),
    ).toBe("viewing");
  });

  it("resolves to viewing when ?tour= is present but empty", () => {
    expect(resolveAppMode(new URL("https://app.example/?tour="))).toBe(
      "viewing",
    );
  });

  it("resolves to authoring when ?tour= is absent", () => {
    expect(resolveAppMode(new URL("https://app.example/"))).toBe("authoring");
  });

  it("resolves to authoring when an unrelated query string is present", () => {
    expect(resolveAppMode(new URL("https://app.example/?debug=1"))).toBe(
      "authoring",
    );
  });
});

describe("isPreviewRequested", () => {
  it("is asked for by ?preview=1", () => {
    expect(
      isPreviewRequested(new URL("https://app.example/?tour=x&preview=1")),
    ).toBe(true);
  });

  it("is not asked for by default", () => {
    expect(isPreviewRequested(new URL("https://app.example/?tour=x"))).toBe(
      false,
    );
  });

  it("is not asked for by ?preview=0", () => {
    expect(
      isPreviewRequested(new URL("https://app.example/?tour=x&preview=0")),
    ).toBe(false);
  });
});
