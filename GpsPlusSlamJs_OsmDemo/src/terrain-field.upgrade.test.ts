/**
 * The two things the post lattice could not do before the DEM race: accept a
 * better set of heights for posts it already holds, and ever revisit a post it
 * invented.
 *
 * WHY THESE TESTS MATTER, AND WHY THEY ARE A SEPARATE FILE. Both behaviours are
 * silent when broken. `ensureAround` skips any post it already has
 * (`if (posts.has(key)) continue;`), so an upgrade that does not go through an
 * explicit replace path is not a wrong height — it is *no change at all*, while
 * every existing test stays green and the map still shows terrain. Round one's
 * plan review found exactly that: the race as first designed would have been a
 * no-op that still passed its own acceptance criteria.
 *
 * The mean-fill half is worse because it is permanent. When some positions in a
 * batch come back `undefined`, the remaining posts are filled with the MEAN of
 * the heights that did answer, written with the same `posts.set` as a measured
 * height, and then skipped forever by the write-once guard. Thousands of posts
 * can hold a plausible, confident, wrong height for the life of the page, and
 * nothing in the data or in any readout distinguishes them from measured ones.
 *
 * So the assertions below are deliberately about OBSERVABLE HEIGHTS from
 * `sampleGrid`, not about whether a method was called. "`replacePosts` was
 * invoked" is satisfied by a `replacePosts` that writes nothing.
 */

import { describe, it, expect } from "vitest";

import { enuFrameAt, type ElevationProvider } from "gps-plus-slam-osm";

import { createTerrainField } from "./terrain-field.js";

const CENTRE = { lat: 50.9413, lng: 6.958 };
/** Small enough that one call covers a handful of posts, not thousands. */
const RADIUS_M = 40;

/**
 * ABSOLUTE HEIGHTS, not relief.
 *
 * The default datum subtracts the height under the window centre, so a field
 * that is flat at 100 m and one that is flat at 200 m both sample as zero
 * everywhere — and an upgrade from one to the other would be invisible to
 * exactly the assertion that is supposed to detect it. `absoluteDatum` is AR's
 * datum and is the one that makes the replacement observable.
 */
const GRID = {
  frame: enuFrameAt(CENTRE),
  extentM: 24,
  spacingM: 8,
  absoluteDatum: { undulationMetres: 0 },
} as const;

/** A provider that answers every position with the same height. */
function flatProvider(
  height: number | undefined,
  sourceId = "flat",
): ElevationProvider {
  return {
    attribution: sourceId,
    sourceId,
    elevationAt: (positions) => Promise.resolve(positions.map(() => height)),
  };
}

/**
 * Every finite height in the sampled grid, ASSERTED NON-EMPTY.
 *
 * The guard is not defensive tidiness — it caught a real hole in these very
 * tests. An earlier draft passed grid options the sampler does not accept
 * (`halfExtentM`/`samples` rather than `frame`/`extentM`/`spacingM`), which
 * vitest happily ran because it strips types without checking them. The sampled
 * array came back empty, and `[].every(...)` is `true` — so every "the heights
 * are now 200" assertion passed while observing nothing at all. Exactly the
 * vacuity this repo has already shipped once, in a different disguise.
 */
function heightsOf(field: ReturnType<typeof createTerrainField>): number[] {
  const grid = field.sampleGrid(GRID);
  const finite = [...grid.heights].filter((h) => Number.isFinite(h));
  expect(finite.length).toBeGreaterThan(0);
  return finite;
}

describe("replacePosts — the upgrade the race depends on", () => {
  it("REPLACES heights the lattice already holds", async () => {
    // The write-once guard is the whole reason this method exists. Without it
    // the race publishes AWS heights, Mapterhorn's arrive, `ensureAround` finds
    // nothing missing, and the better data is silently discarded.
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);
    expect(heightsOf(field).every((h) => h === 100)).toBe(true);

    const positions = field.heldPositions();
    const replaced = field.replacePosts(
      positions,
      positions.map(() => 200),
    );

    expect(replaced).toBe(true);
    expect(heightsOf(field).every((h) => h === 200)).toBe(true);
  });

  it("refuses a PARTIAL replacement rather than leaving a step in the ground", async () => {
    // AWS SRTM and national LiDAR differ by metres, so a window half replaced
    // at a tile boundary is a visible cliff in otherwise flat ground. All of the
    // window or none of it.
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);

    const positions = field.heldPositions();
    const half = positions.slice(0, Math.floor(positions.length / 2));
    const replaced = field.replacePosts(
      half,
      half.map(() => 200),
    );

    expect(replaced).toBe(false);
    expect(heightsOf(field).every((h) => h === 100)).toBe(true);
  });

  it("ignores an upgrade batch carrying no usable heights", async () => {
    // "It answered" is not "it has data". Replacing measured heights with holes
    // would turn a working window into a flat one.
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);

    const positions = field.heldPositions();
    const replaced = field.replacePosts(
      positions,
      positions.map(() => undefined),
    );

    expect(replaced).toBe(false);
    expect(heightsOf(field).every((h) => h === 100)).toBe(true);
  });

  it("accepts a later edge once the interior is already upgraded", async () => {
    // The walking case. A second load adds a rim of new posts; upgrading only
    // that rim would be the partial replacement above — UNLESS the interior was
    // already upgraded, in which case the whole window ends up one source and
    // there is no step to make.
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);
    const interior = field.heldPositions();
    field.replacePosts(
      interior,
      interior.map(() => 200),
    );

    await field.ensureAround(
      { lat: CENTRE.lat + 0.0004, lng: CENTRE.lng },
      RADIUS_M,
    );
    const all = field.heldPositions();
    const rim = all.filter(
      (position) =>
        !interior.some(
          (held) => held.lat === position.lat && held.lng === position.lng,
        ),
    );

    expect(rim.length).toBeGreaterThan(0);
    const replaced = field.replacePosts(
      rim,
      rim.map(() => 200),
    );

    expect(replaced).toBe(true);
  });
});

describe("mean-filled posts are temporary, not permanent", () => {
  /**
   * A provider that answers only the first `answerCount` positions of each
   * batch, which is what a partly-covered window looks like: one DEM tile
   * succeeded and its neighbour did not.
   */
  function patchyProvider(
    answerCount: number,
    height: number,
  ): ElevationProvider {
    return {
      attribution: "patchy",
      sourceId: "patchy",
      elevationAt: (positions) =>
        Promise.resolve(
          positions.map((_position, index) =>
            index < answerCount ? height : undefined,
          ),
        ),
    };
  }

  it("counts the posts it invented, so a session can say how much is made up", async () => {
    // The cheapest observable step, and the reason the hazard could sit
    // unnoticed: nothing distinguished an invented post from a measured one, in
    // the data or in any readout.
    const field = createTerrainField({ provider: patchyProvider(2, 100) });
    await field.ensureAround(CENTRE, RADIUS_M);

    expect(field.meanFilledCount).toBeGreaterThan(0);
  });

  it("RE-REQUESTS an invented post on a later pass instead of skipping it forever", async () => {
    // The fix. `ensureAround`'s write-once guard used to skip mean-filled posts
    // exactly as it skips measured ones, so a plausible wrong height survived
    // every subsequent load for the life of the page.
    let answerEverything = false;
    const provider: ElevationProvider = {
      attribution: "recovering",
      sourceId: "recovering",
      elevationAt: (positions) =>
        Promise.resolve(
          positions.map((_position, index) =>
            answerEverything || index < 2 ? 100 : undefined,
          ),
        ),
    };

    const field = createTerrainField({ provider });
    await field.ensureAround(CENTRE, RADIUS_M);
    const invented = field.meanFilledCount;
    expect(invented).toBeGreaterThan(0);

    // The DEM recovers; the same window is asked for again.
    answerEverything = true;
    await field.ensureAround(CENTRE, RADIUS_M);

    expect(field.meanFilledCount).toBe(0);
  });

  it("does not re-request posts that were genuinely measured", async () => {
    // The other direction: standing still must stay free. If the re-request
    // rule leaked into measured posts, every load would re-fetch the whole
    // window and the cache would stop being a cache.
    let calls = 0;
    const provider: ElevationProvider = {
      attribution: "counting",
      sourceId: "counting",
      elevationAt: (positions) => {
        calls += 1;
        return Promise.resolve(positions.map(() => 100));
      },
    };

    const field = createTerrainField({ provider });
    await field.ensureAround(CENTRE, RADIUS_M);
    expect(calls).toBe(1);

    await field.ensureAround(CENTRE, RADIUS_M);
    expect(calls).toBe(1);
  });
});

describe("an upgrade that arrives after the user moved (PR #328 review)", () => {
  /**
   * WHY THIS BLOCK EXISTS. The all-or-nothing rule refuses a batch that would
   * leave the window standing on two DEMs — correctly. But `ensureAround` only
   * ever asks the provider for the posts it is MISSING, so a batch is exactly
   * one request's positions and NO batch ever spans an already-filled interior
   * plus a newer rim.
   *
   * Walk one step while an upgrade is in flight and the window is covered by
   * TWO batches. Each is refused on its own, and before this fix both were
   * discarded with nothing to retry them — so the better heights were lost
   * PERMANENTLY the moment the user moved. Given the preferred source was
   * measured at 3–21 s against ~1 s for the fast one, that is the ordinary
   * case, not an edge one: the headline feature would rarely have worked for
   * anyone actually walking around.
   *
   * The doc claimed "the next upgrade covering both takes it". There was no
   * mechanism behind that sentence. These tests are what makes it true.
   */

  const NEXT = { lat: CENTRE.lat + 0.0004, lng: CENTRE.lng };

  it("APPLIES once the interior and the rim have both arrived", async () => {
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);
    const interior = field.heldPositions();

    // The user walks before the interior's upgrade lands.
    await field.ensureAround(NEXT, RADIUS_M);
    const all = field.heldPositions();
    const rim = all.filter(
      (position) =>
        !interior.some(
          (held) => held.lat === position.lat && held.lng === position.lng,
        ),
    );
    expect(rim.length).toBeGreaterThan(0);

    // Neither half covers the current window on its own...
    expect(
      field.replacePosts(
        interior,
        interior.map(() => 200),
      ),
    ).toBe(false);

    // ...and the second half completes it.
    expect(
      field.replacePosts(
        rim,
        rim.map(() => 200),
      ),
    ).toBe(true);

    // THE OBSERVABLE, not the return value: the ground the user is standing on
    // is now the better source, everywhere.
    const grid = field.sampleGrid({ ...GRID, frame: enuFrameAt(NEXT) });
    const heights = [...grid.heights].filter((h) => Number.isFinite(h));
    expect(heights.length).toBeGreaterThan(0);
    expect(heights.every((h) => h === 200)).toBe(true);
  });

  it("refuses a batch for posts the lattice does not hold", async () => {
    // WHAT THIS ACTUALLY COVERS, corrected after mutation. It was written as
    // "does not report a change when every pending post has been evicted", to
    // cover the `written === 0` guard — and deleting that guard left this test
    // GREEN, because a batch of unheld posts is refused earlier, by the window
    // check.
    //
    // The guard is still right and still there, but it is DEFENSIVE rather
    // than reachable: eviction now prunes `pendingUpgrade` alongside `posts`,
    // so an entry cannot survive to be written and then be missing. Saying so
    // is better than a test whose name claims a coverage it does not have —
    // which is the failure this round has already found three times.
    const field = createTerrainField({ provider: flatProvider(100) });
    await field.ensureAround(CENTRE, RADIUS_M);

    // Positions the lattice has never held: far enough away to be outside the
    // window entirely, so the write loop skips all of them.
    const elsewhere = [
      { lat: CENTRE.lat + 5, lng: CENTRE.lng + 5 },
      { lat: CENTRE.lat + 5.001, lng: CENTRE.lng + 5 },
    ];

    expect(
      field.replacePosts(
        elsewhere,
        elsewhere.map(() => 200),
      ),
    ).toBe(false);
  });
});
