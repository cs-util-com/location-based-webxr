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
import { browserPlaceUrl, placeQuery, writePlace } from "./url-state.js";

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
