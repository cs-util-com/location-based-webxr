/**
 * `url-state.ts` — the URL as a projection of where the user is.
 *
 * Why this test matters:
 * The eighth testing session reported that jumping to London and reloading came
 * back to New York, and asked for two things the read side already half had: a
 * link that can be pasted into a report, and a URL Playwright can navigate to.
 * The load-bearing property is therefore the ROUND TRIP — whatever this module
 * writes, `parseStartPosition` must read back as the same place. The two live in
 * separate modules and are easy to drift apart, so the round trip is asserted
 * both by example and over arbitrary coordinates.
 *
 * The second thing worth pinning is what is NOT written: DEC-R12-5 keeps
 * presentation state and the camera pose out, so an unrelated parameter must
 * survive untouched rather than be normalised away by a writer that thinks it
 * owns the query string.
 *
 * @see url-state.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-08-1330-osm-demo-eighth-testing-session-user-feedback.md §4 DEC-R12-5
 */

import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { parseStartPosition } from "./start-position.js";
import { FAR_PLANE_M } from "./building-view.js";
import { DEFAULT_RENDER_MULTIPLIER } from "./render-distance.js";
import {
  browserPlaceUrl,
  cameraQuery,
  MAX_DISTANCE_M,
  parseCameraTarget,
  placeQuery,
  writeCamera,
  writePlace,
} from "./url-state.js";

const TOWER_BRIDGE = { lat: 51.5055, lng: -0.0754 };

describe("placeQuery", () => {
  it("writes the site id when the user picked a named place", () => {
    // A site id is the stable, human-readable handle: it survives a re-capture
    // moving the site's coordinates, and it says WHERE in a pasted link.
    expect(
      placeQuery("", { position: TOWER_BRIDGE, siteId: "london-tower-bridge" }),
    ).toBe("?site=london-tower-bridge");
  });

  it("writes coordinates when the user simply moved", () => {
    // A map click or a GPS fix is not a named place, so there is no id to write.
    expect(placeQuery("", { position: TOWER_BRIDGE })).toBe(
      "?lat=51.50550&lng=-0.07540",
    );
  });

  it("drops the stale key of the other form, so the URL never says two things", () => {
    // `parseStartPosition` lets `?lat=&lng=` win over `?site=`, so leaving both
    // would not be ambiguous to the parser — it would be ambiguous to the human
    // reading the link, which is who this feature is for.
    expect(
      placeQuery("?site=london-tower-bridge", { position: TOWER_BRIDGE }),
    ).toBe("?lat=51.50550&lng=-0.07540");
    expect(
      placeQuery("?lat=40.7549&lng=-73.984", {
        position: TOWER_BRIDGE,
        siteId: "london-tower-bridge",
      }),
    ).toBe("?site=london-tower-bridge");
  });

  it("leaves every other parameter alone (DEC-R12-5 keeps presentation OUT)", () => {
    // The writer owns three keys and nothing else. A URL carrying a debug flag
    // must survive a walk, and a future parameter must not need this module to
    // learn about it.
    expect(placeQuery("?debug=1", { position: TOWER_BRIDGE })).toBe(
      "?debug=1&lat=51.50550&lng=-0.07540",
    );
  });

  it("rounds to five decimals, which is the precision the status line already shows", () => {
    // ~1.1 m at the equator. Matching `refresh-cycle.ts`'s `toFixed(5)` means a
    // link and the status line describe the same point rather than two points
    // that differ in the last digit for no reason a reader can see.
    expect(
      placeQuery("", { position: { lat: 51.123456789, lng: -0.987654321 } }),
    ).toBe("?lat=51.12346&lng=-0.98765");
  });

  it("never emits a signed zero, which the store normalises away and JSON does not round-trip", () => {
    expect(placeQuery("", { position: { lat: -0, lng: -0 } })).toBe(
      "?lat=0.00000&lng=0.00000",
    );
  });
});

describe("placeQuery round-trips through parseStartPosition", () => {
  it("reads a written site id back as that site's position", () => {
    const written = placeQuery("", {
      position: TOWER_BRIDGE,
      siteId: "london-tower-bridge",
    });
    expect(parseStartPosition(written)).toEqual(TOWER_BRIDGE);
  });

  it("reads written coordinates back to within the written precision", () => {
    // THE PROPERTY THE WHOLE FEATURE RESTS ON. A link the user pastes has to
    // land where they were; a link Playwright navigates to has to reproduce the
    // scene. The two modules are separate and their formats could drift, so this
    // states the join rather than trusting it.
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          const back = parseStartPosition(
            placeQuery("", { position: { lat, lng } }),
          );
          // Half of the last written digit, i.e. the rounding error and nothing
          // else — about 0.6 m.
          expect(Math.abs(back.lat - lat)).toBeLessThanOrEqual(0.000005);
          expect(Math.abs(back.lng - lng)).toBeLessThanOrEqual(0.000005);
        },
      ),
    );
  });

  it("keeps unrelated parameters through a round trip, from any starting query", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => /^[a-z]+$/.test(s)),
        fc.string({ minLength: 1 }).filter((s) => /^[a-z0-9]+$/.test(s)),
        (key, value) => {
          fc.pre(key !== "lat" && key !== "lng" && key !== "site");
          const written = placeQuery(`?${key}=${value}`, {
            position: TOWER_BRIDGE,
          });
          expect(new URLSearchParams(written).get(key)).toBe(value);
        },
      ),
    );
  });
});

describe("writePlace", () => {
  it("writes when the query changes", () => {
    const replace = vi.fn();
    writePlace({ search: "", replace }, { position: TOWER_BRIDGE });
    expect(replace).toHaveBeenCalledWith("?lat=51.50550&lng=-0.07540");
  });

  it("does NOTHING when the query is already right", () => {
    // WHY THIS MATTERS. The demo dispatches a position change on every map click
    // and every GPS fix, and jitter below the written precision produces the
    // same string. Without this guard the app would rewrite history entries at
    // GPS sample rate for a URL that did not change.
    const replace = vi.fn();
    writePlace(
      { search: "?lat=51.50550&lng=-0.07540", replace },
      { position: { lat: 51.505501, lng: -0.075401 } },
    );
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("browserPlaceUrl", () => {
  /** The narrow slice of `window` this module actually touches. */
  function fakeWindow(search: string) {
    return {
      location: { search, pathname: "/osm/" },
      history: { replaceState: vi.fn() },
    };
  }

  it("REPLACES the entry rather than pushing one", () => {
    // WHY REPLACE. A walk is dozens of position changes; pushing would fill the
    // back stack with every step and make the back button undo the walk one
    // click at a time instead of leaving the demo. The URL tracks the view, it
    // does not narrate it.
    const win = fakeWindow("");
    browserPlaceUrl(win).replace("?site=london-tower-bridge");
    expect(win.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/osm/?site=london-tower-bridge",
    );
  });

  it("falls back to the bare path when there is nothing left to write", () => {
    // Passing "" to `replaceState` is a no-op that leaves the old query in
    // place, so an empty query has to be spelled as the path itself.
    const win = fakeWindow("?lat=1&lng=2");
    browserPlaceUrl(win).replace("");
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/osm/");
  });

  it("reports the current query, so `writePlace` can compare against it", () => {
    expect(browserPlaceUrl(fakeWindow("?debug=1")).search).toBe("?debug=1");
  });
});

/**
 * The camera target (DEC-R13-7).
 *
 * Why these tests matter:
 * This partially reverses DEC-R12-5, which rejected the camera pose because "a
 * pose recorded against one scene anchor is meaningless after a re-anchor". A
 * target in lat/lng is anchor-independent by construction, so that trap does not
 * apply to THIS encoding — but two new ones do, and both are silent:
 *
 * - **the write with no read.** A link nothing honours is worse than no link,
 *   and the round trip is the only thing that catches it. Same load-bearing
 *   property the place round trip above has, for the same reason.
 * - **two writers, one query string.** `writePlace` and `writeCamera` both go
 *   through `history.replaceState`, so whichever runs last decides the WHOLE
 *   query. If either rebuilt it from scratch the other's keys would vanish, and
 *   the failure would look like "sharing a link sometimes loses the site".
 */
describe("the camera target in the URL", () => {
  const LOOKING_AT = { target: TOWER_BRIDGE, distanceM: 420 };

  it("writes the target and the distance under their own keys", () => {
    expect(cameraQuery("", LOOKING_AT)).toBe(
      "?clat=51.50550&clng=-0.07540&cdist=420",
    );
  });

  /**
   * NOT `lat`/`lng`, AND THIS IS THE TRAP WORTH A TEST. `parseStartPosition`
   * gives that pair priority over `?site=`, so a camera target written under
   * those names would silently teleport the USER to wherever the camera happened
   * to be pointing.
   */
  it("does not disturb where the user is", () => {
    const query = cameraQuery("?site=london-tower-bridge", LOOKING_AT);
    expect(query).toContain("site=london-tower-bridge");
    expect(parseStartPosition(query)).toEqual(
      parseStartPosition("?site=london-tower-bridge"),
    );
  });

  it("round-trips through parseCameraTarget", () => {
    expect(parseCameraTarget(cameraQuery("", LOOKING_AT))).toEqual({
      target: { lat: 51.5055, lng: -0.0754 },
      distanceM: 420,
    });
  });

  it("round-trips arbitrary viewpoints at the written precision", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -85, max: 85, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        // Bounded by what the writer can express: beyond the far plane a
        // distance is clamped rather than round-tripped, which is the point of
        // the clamp and is asserted separately below.
        fc.double({ min: 1, max: MAX_DISTANCE_M, noNaN: true }),
        (lat, lng, distanceM) => {
          const written = cameraQuery("", {
            target: { lat, lng },
            distanceM,
          });
          const read = parseCameraTarget(written)!;
          expect(read.target.lat).toBeCloseTo(lat, 4);
          expect(read.target.lng).toBeCloseTo(lng, 4);
          // Whole metres, so half of the last written digit.
          expect(Math.abs(read.distanceM - distanceM)).toBeLessThanOrEqual(0.5);
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * BOTH WRITERS, IN BOTH ORDERS. This is the one place stage 5 can silently
   * break DEC-R12-5's shipped behaviour, so neither ordering may lose the
   * other's keys.
   */
  it("survives a place write, and leaves one intact in turn", () => {
    const afterPlace = placeQuery(cameraQuery("", LOOKING_AT), {
      position: TOWER_BRIDGE,
      siteId: "london-tower-bridge",
    });
    expect(parseCameraTarget(afterPlace)).toEqual({
      target: { lat: 51.5055, lng: -0.0754 },
      distanceM: 420,
    });
    expect(afterPlace).toContain("site=london-tower-bridge");

    const afterCamera = cameraQuery(
      placeQuery("", { position: TOWER_BRIDGE, siteId: "london-tower-bridge" }),
      LOOKING_AT,
    );
    expect(afterCamera).toContain("site=london-tower-bridge");
    expect(parseCameraTarget(afterCamera)).not.toBeUndefined();
  });

  it("leaves unrelated parameters alone", () => {
    expect(cameraQuery("?debug=1", LOOKING_AT)).toContain("debug=1");
  });

  /**
   * `Number('')` IS `0`, NOT `NaN` — the trap `start-position.ts` documents,
   * where an empty `?lat=&lng=` opened the demo in the Gulf of Guinea. A partial
   * or blank camera state is not a viewpoint.
   */
  it("refuses a partial, blank or out-of-range viewpoint", () => {
    expect(parseCameraTarget("")).toBeUndefined();
    expect(parseCameraTarget("?clat=51.5&clng=-0.07")).toBeUndefined();
    expect(parseCameraTarget("?clat=&clng=&cdist=")).toBeUndefined();
    expect(
      parseCameraTarget("?clat=51.5&clng=-0.07&cdist=abc"),
    ).toBeUndefined();
    expect(parseCameraTarget("?clat=91&clng=-0.07&cdist=420")).toBeUndefined();
    // A camera at or behind its own target has no direction to restore.
    expect(parseCameraTarget("?clat=51.5&clng=-0.07&cdist=0")).toBeUndefined();
  });

  /**
   * THE GUARD IS WHAT MAKES THE DEBOUNCE SUFFICIENT: a drag settles into a
   * position that rounds to the same five decimals long before it stops firing
   * events, so without this the app calls the history API to write the URL it
   * already had.
   */
  it("does not touch the history when nothing changed", () => {
    const replace = vi.fn();
    writeCamera({ search: cameraQuery("", LOOKING_AT), replace }, LOOKING_AT);
    expect(replace).not.toHaveBeenCalled();
  });

  /**
   * THE GUARD ONLY WORKS IF THE KEYS STAY PUT (review on #276). `placeQuery`
   * deletes its keys before setting them, because its two forms are mutually
   * exclusive; copying that here moved all three camera keys to the END of the
   * query on every write, so an unmoved camera still produced a different
   * string and the identity guard could not suppress the redundant history
   * write. `URLSearchParams.set` replaces in place, so there is nothing to
   * delete.
   */
  it("updates its keys in place, so an unmoved camera rewrites nothing", () => {
    const first = cameraQuery("?site=london-tower-bridge", LOOKING_AT);
    expect(cameraQuery(first, LOOKING_AT)).toBe(first);
    // And the site is still where it was, rather than shuffled to the end.
    expect(first.indexOf("site=")).toBeLessThan(first.indexOf("clat="));
  });

  /**
   * THE ONE FIELD A READER CANNOT SANITY-CHECK FROM ITS VALUE (review on #276).
   * lat/lng have obvious ranges; a distance does not — and `MapControls` is
   * built without `minDistance`/`maxDistance`, so nothing downstream clamps it
   * either. A truncated or hand-edited link is exactly what this feature exists
   * to survive, since its whole purpose is to be pasted into a bug report.
   */
  it("refuses a distance beyond the far plane, which would restore a view of nothing", () => {
    expect(
      parseCameraTarget(`?clat=51.5&clng=-0.07&cdist=${MAX_DISTANCE_M + 1}`),
    ).toBeUndefined();
    expect(
      parseCameraTarget(`?clat=51.5&clng=-0.07&cdist=${MAX_DISTANCE_M}`),
    ).not.toBeUndefined();
    expect(
      parseCameraTarget("?clat=51.5&clng=-0.07&cdist=1e9"),
    ).toBeUndefined();
  });

  /**
   * THE FAR PLANE IS THE BOUND, and the constant is written out rather than
   * imported so a pure URL parser does not depend on the 3D view. That makes
   * this the assertion that stops the two drifting — the repo's usual answer to
   * "two values that agree today with nothing saying they must".
   */
  it("bounds the distance at exactly the camera's far plane", () => {
    // FOLLOWS THE FAR PLANE THE PAGE BOOTS WITH, not the 1x baseline (DEC-K2).
    // A pasted link always lands in a freshly booted page, and that page draws
    // to `FAR_PLANE_M * DEFAULT_RENDER_MULTIPLIER`; bounding the URL at the
    // baseline instead would silently drop camera targets the receiving page
    // can render perfectly well — the round-trip hole this module exists to
    // avoid, in the opposite direction.
    //
    // ⚠️ THE TRADE, STATED: a user who drags the dial DOWN to 1x can restore a
    // link whose target is past their far plane and see nothing. That is a
    // deliberate act with an obvious remedy (drag it back), whereas silently
    // truncating a shared link is neither visible nor recoverable.
    expect(MAX_DISTANCE_M).toBe(FAR_PLANE_M * DEFAULT_RENDER_MULTIPLIER);
  });

  /**
   * A WRITE THE READ SIDE DROPS IS THE WORST ROUND-TRIP HOLE, because the URL
   * looks perfectly fine (review on #276). `toFixed(0)` turned any sub-metre
   * distance into `"0"`, which `parseCameraTarget` then refused.
   */
  it("never writes a distance its own reader would refuse", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0001, max: 1e7, noNaN: true }),
        (distanceM) => {
          const written = cameraQuery("", {
            target: TOWER_BRIDGE,
            distanceM,
          });
          expect(parseCameraTarget(written)).not.toBeUndefined();
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * The write side is the one place with no validation behind it — the value
   * comes from a `Vector3.distanceTo`, not from a user — so a non-finite
   * distance must not reach the URL as the string `"NaN"`.
   */
  it("clamps rather than writing NaN", () => {
    const written = cameraQuery("", {
      target: TOWER_BRIDGE,
      distanceM: Number.NaN,
    });
    expect(written).not.toContain("NaN");
    expect(parseCameraTarget(written)).not.toBeUndefined();
  });

  it("writes when the viewpoint moved", () => {
    const replace = vi.fn();
    writeCamera(
      { search: cameraQuery("", LOOKING_AT), replace },
      {
        ...LOOKING_AT,
        distanceM: 900,
      },
    );
    expect(replace).toHaveBeenCalledWith(
      "?clat=51.50550&clng=-0.07540&cdist=900",
    );
  });
});
