/**
 * The link between "better DEM heights arrived" and "the lattice changed".
 *
 * WHY THIS FILE EXISTS. These assertions were absent, and their absence was
 * demonstrated rather than suspected: with the sink's body replaced by a no-op,
 * every other test covering the DEM race stayed green. The provider's tests
 * prove it calls `onUpgrade`; the lattice's tests prove `replacePosts` works.
 * Neither proves they are connected, and the connection is the whole feature.
 *
 * The second test is the one that pays for itself later. `replacePosts` refuses
 * a batch that would leave the window on two DEMs at once, and a refusal that
 * still bumped the terrain stamp would make the page rebuild its entire mesh to
 * produce a pixel-identical result — on every walk, invisibly, as a performance
 * bug nobody could attribute.
 */

import { describe, it, expect, vi } from "vitest";

import { createTerrainUpgradeSink } from "./terrain-upgrade-sink.js";

const POSITIONS = [{ lat: 50.94, lng: 6.95 }];
const HEIGHTS = [123];

describe("createTerrainUpgradeSink", () => {
  it("hands the better heights to the lattice", () => {
    const replacePosts = vi.fn().mockReturnValue(true);
    const sink = createTerrainUpgradeSink({ replacePosts }, () => {});

    sink(POSITIONS, HEIGHTS);

    expect(replacePosts).toHaveBeenCalledWith(POSITIONS, HEIGHTS);
  });

  it("reports a change only when the lattice ACCEPTED the batch", () => {
    const accepted = vi.fn();
    createTerrainUpgradeSink({ replacePosts: () => true }, accepted)(
      POSITIONS,
      HEIGHTS,
    );
    expect(accepted).toHaveBeenCalledTimes(1);

    const refused = vi.fn();
    createTerrainUpgradeSink({ replacePosts: () => false }, refused)(
      POSITIONS,
      HEIGHTS,
    );
    expect(refused).not.toHaveBeenCalled();
  });
});
