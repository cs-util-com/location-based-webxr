import { describe, expect, it } from "vitest";

import { loadSite } from "../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import type { OsmFeature } from "../model/osm-feature.js";
import { enuFrameAt } from "./enu.js";
import { buildBuildings } from "./buildings.js";
import { buildPoiMarkers } from "./poi.js";
import {
  annotatePoiHosts,
  type HostCandidate,
  type PoiHostStats,
} from "./poi-hosts.js";

/**
 * HOW `annotatePoiHosts` GROWS WITH THE WORKING SET — the guard that would have
 * caught the 2026-08-14 heat-map slowdown, written after the fact.
 *
 * **THE DEFECT THIS EXISTS TO PREVENT.** `annotatePoiHosts` tests every POI
 * marker against every building and plate. Both operands grow with the number of
 * tiles a session has loaded, and tiles are never evicted
 * (`demo-pipeline.ts` `loaded`, `affordance-index.ts` `tiles` — neither has a
 * `delete`), so the pass is QUADRATIC in session length. A revision sweep across
 * twelve commits measured the mesh build jumping **5 109 → 47 977 ms in one
 * commit** (`f83224c7`, 2026-08-06) when this function was wired in, and the
 * owner met it as a 17 s wait per click.
 *
 * **WHY NOTHING CAUGHT IT, which is what shapes this file.** Nine guards were
 * audited and every one was blind by construction: every wall-clock assertion in
 * the package pins its INPUT SIZE (`plates.test.ts` 242 features,
 * `triangulate.test.ts` a fixed disc), so a 10× slowdown driven by 300× the
 * features leaves them all green; the e2e serves an identical payload for every
 * bbox and `mergeTiles` keys on `${type}/${id}`, so its merged set is invariant
 * in tiles held — the one defect whose entire content is "the input grew" cannot
 * be seen there at all. A guard that does not VARY THE INPUT SIZE cannot catch a
 * growth defect, whatever else it asserts.
 *
 * **SO THIS FILE VARIES THE INPUT AND ASSERTS THE SHAPE.** It runs the same site
 * at 1 copy and at 9, and asserts how the work grows between them. Linear-ish is
 * 9×. An un-pruned cross product is 81×.
 *
 * **COUNTS, NOT MILLISECONDS** — `site-obstacle-index-cost.test.ts` states the
 * rule and `chunk-cost` is the cautionary tale: its 100 ms ceiling failed at
 * 104 ms under the nine-package cascade and was reverted. Counts are the same
 * number on any machine under any load. The one loose time ceiling at the bottom
 * is a smoke alarm for a constant-factor blow-up a count cannot see, and is set
 * an order of magnitude clear of the measured value so it can never flake.
 *
 * @see poi-hosts.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-15-1051-osm-demo-mesh-cost-plan.md
 */

/** The site the owner was testing on, and the densest London capture we hold. */
const SITE = "london-westminster";

/**
 * Replicates a capture `k × k` times on a fixed grid, as a stand-in for the
 * several res-7 tiles a real session accumulates.
 *
 * **IDS ARE OFFSET PER COPY, and that is load-bearing rather than tidy.**
 * `featureKey` is `${type}/${id}`, so copies sharing ids would collapse into one
 * another exactly the way the e2e fixture does — and this file would then
 * reproduce the blindness it was written to fix.
 *
 * The pitch exceeds the capture's own span so copies do not overlap; markers in
 * one copy are still tested against candidates in every other, because nothing
 * in this path prunes spatially. That is the real behaviour being measured, not
 * an artefact of the layout.
 */
function replicate(features: readonly OsmFeature[], k: number): OsmFeature[] {
  const PITCH_DEG = 0.006; // ~450 m at this latitude; captures span ~390 m.
  const out: OsmFeature[] = [];
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      const copy = row * k + col;
      const dLat = row * PITCH_DEG;
      const dLng = col * PITCH_DEG;
      const idOffset = (copy + 1) * 1_000_000_000_000;
      for (const feature of features) {
        out.push(shift(feature, dLat, dLng, idOffset));
      }
    }
  }
  return out;
}

/**
 * All three element types are shifted, and relations are the reason this is not
 * a two-line function: a relation carries `members` with OPTIONAL per-member
 * geometry and position rather than a `geometry` of its own, so the obvious
 * `feature.geometry.map(...)` throws on the first multipolygon in the capture.
 */
function shift(
  feature: OsmFeature,
  dLat: number,
  dLng: number,
  idOffset: number,
): OsmFeature {
  const id = feature.id + idOffset;
  const move = (p: { lat: number; lng: number }) => ({
    lat: p.lat + dLat,
    lng: p.lng + dLng,
  });
  if (feature.type === "node") {
    return { ...feature, id, position: move(feature.position) };
  }
  if (feature.type === "way") {
    return { ...feature, id, geometry: feature.geometry.map(move) };
  }
  return {
    ...feature,
    id,
    members: feature.members.map((member) => ({
      ...member,
      ...(member.geometry === undefined
        ? {}
        : { geometry: member.geometry.map(move) }),
      ...(member.position === undefined
        ? {}
        : { position: move(member.position) }),
    })),
  };
}

interface Sample {
  readonly copies: number;
  readonly markers: number;
  readonly candidates: number;
  readonly stats: PoiHostStats;
  readonly ms: number;
}

/** One measurement: the real builders, the way `buildMesh` calls them. */
function measure(k: number): Sample {
  const site = loadSite(SITE);
  const features = replicate([...parseOverpassJson(site.payload).features], k);
  const frame = enuFrameAt(site.centre);
  const options = { frame };

  const volumes = buildBuildings(features, options);
  // Buildings only. Plates need `buildAreaPlates`, which is the ONE clipped pass
  // and therefore does not grow with the working set the way this one does —
  // including it would blur the very growth this file measures. Buildings are
  // the dominant candidate source in any case (33 562 of 33 562 + plates at the
  // sweep's operating point).
  const candidates: HostCandidate[] = volumes.map((volume) => ({
    layer: "buildings",
    feature: volume.feature,
    footprint: volume.footprint,
    topM: volume.topHeightM,
  }));
  const markers = buildPoiMarkers(features, options);

  const stats: PoiHostStats = { pairsConsidered: 0, containsPointCalls: 0 };
  const started = performance.now();
  annotatePoiHosts(markers, candidates, stats);
  const ms = performance.now() - started;

  return {
    copies: k * k,
    markers: markers.length,
    candidates: candidates.length,
    stats,
    ms,
  };
}

describe("annotatePoiHosts cost growth", () => {
  const one = measure(1);
  const nine = measure(3);

  it("has a fixture that actually grows — otherwise every assertion below is vacuous", () => {
    // Why this test matters: this is the e2e's exact failure mode, asserted
    // against. `stubNetwork` answers every bbox with one payload and the merged
    // set never grows, so its mesh assertions are green at any cost. If the
    // id-offset in `replicate` ever regresses, the growth assertions here would
    // pass for the same empty reason — so the growth itself is pinned first.
    expect(nine.markers).toBeGreaterThan(one.markers * 8);
    expect(nine.candidates).toBeGreaterThan(one.candidates * 8);
  });

  it("does not ray-cast the full cross product — 9x the input must not cost 81x the work", () => {
    // Why this test matters: THIS IS THE GUARD. `containsPoint` is a full
    // point-in-ring walk with no bounding-box short-circuit of its own
    // (`spatial/point-in-ring.ts`), and it is ~77 % of this function's cost at a
    // realistic kind mix. With no broad phase, 9x the markers against 9x the
    // candidates is 81x the ray casts. With any spatial pruning it is ~9x,
    // because a marker's candidate set does not grow when the copies are
    // disjoint.
    //
    // The threshold is 12 rather than 9: copies are laid out on a grid whose
    // pitch is close to the capture span, so a bbox reject still admits a few
    // near-neighbour candidates, and marker/candidate counts do not scale
    // exactly 9x. Well below 81, far enough above 9 to never flake.
    const ratio = nine.stats.containsPointCalls / one.stats.containsPointCalls;
    expect(
      ratio,
      `containsPoint calls grew ${ratio.toFixed(1)}x for 9x the input ` +
        `(${String(one.stats.containsPointCalls)} -> ` +
        `${String(nine.stats.containsPointCalls)}). ` +
        `A full cross product is ~81x; a broad phase is ~9x.`,
    ).toBeLessThan(12);
  });

  it("reaches every pair at least as often as it ray-casts, so the counters are consistent", () => {
    // Why this test matters: `pairsConsidered` and `containsPointCalls` bracket
    // the `hostMatches` filter. If they are ever equal at nine copies the filter
    // has stopped rejecting anything, and if `containsPointCalls` exceeds
    // `pairsConsidered` the counters are wired wrong and the guard above is
    // measuring nothing.
    expect(nine.stats.containsPointCalls).toBeLessThanOrEqual(
      nine.stats.pairsConsidered,
    );
    expect(nine.stats.pairsConsidered).toBe(nine.markers * nine.candidates);
  });

  it("stays under a loose wall-clock ceiling, as a smoke alarm only", () => {
    // Why this test matters: a count cannot see a constant-factor blow-up — a
    // `containsPoint` that got 50x slower per call would leave every assertion
    // above green. This is the only defence against that, and it is deliberately
    // an order of magnitude clear of the measured value (~50-250 ms for nine
    // copies on a developer machine) because `chunk-cost` was reverted after a
    // 100 ms ceiling failed at 104 ms under the nine-package cascade. It is a
    // smoke alarm, NOT a performance budget: tighten it and it will flake.
    //
    // ADMITTED under plan M4, and the headroom is now MEASURED rather than
    // asserted. The 2026-08-21 mesh investigation timed this same call across
    // scales on a quiet machine: 5 ms at k=1, 10 ms at k=2, 34 ms at k=3 (this
    // fixture), 118 ms at k=4 — i.e. ~7 ns per pair, with the broad phase doing
    // four float compares. So the ceiling sits ~147x above the value it guards,
    // which is what makes it a smoke alarm rather than a budget.
    //
    // And the design it rejects is no longer hypothetical either, which was the
    // half of the admission bar this entry failed. The same investigation
    // established that `pairsConsidered` grows as markers x candidates exactly,
    // so a COUNT is already pinned above — leaving a constant-factor regression
    // inside `containsPoint` as the one failure no count can see. That is a real
    // gap with a measured baseline, not a speculative one.
    expect(nine.ms).toBeLessThan(5_000);
  });
});
