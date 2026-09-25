import { describe, expect, it } from "vitest";

import { buildTourUrl } from "./build-tour-url.js";

/**
 * Why these tests matter: `?tour=` is the seam that switches the app into
 * viewing mode (contract D13) and hands component 6 the ZIP to range-read. The
 * value is itself a URL — typically a presigned one carrying `?` and `&` — so
 * the encoding is the whole point of this helper. An unencoded zip URL silently
 * truncates at its first `&`, and the QR then encodes a broken link that only
 * fails once someone scans it with a phone in a field. The round-trip assertions
 * below are what keep that failure inside the test suite.
 */

const APP = "https://tours.example.com/viewer/";

/** Read the `tour` param back out the way the viewing bootstrap does. */
const tourParam = (url: string) => new URL(url).searchParams.get("tour");

describe("buildTourUrl", () => {
  it("puts the zip URL in the tour param", () => {
    const zip = "https://cdn.example.com/tours/castle.zip";
    expect(tourParam(buildTourUrl(APP, zip))).toBe(zip);
  });

  it("round-trips a presigned URL containing ? and & unchanged", () => {
    const zip =
      "https://bucket.s3.amazonaws.com/castle.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=abc123";
    const built = buildTourUrl(APP, zip);

    expect(tourParam(built)).toBe(zip);
    // The nested query must not leak into the app URL's own param list.
    expect([...new URL(built).searchParams.keys()]).toEqual(["tour"]);
  });

  it("preserves an existing query and hash on the app base", () => {
    const built = buildTourUrl(`${APP}?debug=1#scene`, "https://cdn/x.zip");
    const url = new URL(built);

    expect(url.searchParams.get("debug")).toBe("1");
    expect(url.searchParams.get("tour")).toBe("https://cdn/x.zip");
    expect(url.hash).toBe("#scene");
  });

  it("replaces a tour param that is already present", () => {
    const built = buildTourUrl(`${APP}?tour=old.zip`, "https://cdn/new.zip");
    expect(new URL(built).searchParams.getAll("tour")).toEqual([
      "https://cdn/new.zip",
    ]);
  });
});
