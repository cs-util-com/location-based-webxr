/**
 * `racingProvider` over arbitrary answers, failures and arrival orders.
 *
 * WHY A PROPERTY SPEC AND NOT MORE EXAMPLES. This composition's contract is
 * three universally quantified statements — the published heights are one
 * source's answer and never a blend of both, the output length always matches
 * the input, and no combination of empty answers or failures makes it throw for
 * missing data — over inputs that are trivially generatable. The example tests
 * next door pin hand-picked pairs at hand-picked arrival orders, which is
 * exactly the shape that leaves "both empty", "one empty and the other failed"
 * and "the loser lands first" unexercised.
 *
 * The blend property is the one worth the file on its own. `consensusProvider`
 * exists next door and medians its inputs; a future refactor that reaches for it
 * here would average a LiDAR height with a coarse global one and throw the
 * resolution advantage away — smoothly, plausibly, and with every example test
 * still green because the average of two similar heights looks like a height.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ElevationProvider } from "./elevation-provider.js";
import { racingProvider } from "./racing-provider.js";

const POSITIONS = [
  { lat: 50.94, lng: 6.95 },
  { lat: 50.95, lng: 6.96 },
  { lat: 50.96, lng: 6.97 },
];

/** A height, a hole, or a source that has no data at all for that post. */
const height = fc.option(fc.integer({ min: -400, max: 8000 }), {
  nil: undefined,
});

/** An answer, or a failure — both of which a real DEM source produces. */
const answer = fc.oneof(
  fc.array(height, { minLength: 3, maxLength: 3 }),
  fc.constant("fail"),
);

/** Microtask delay, so the two arms settle in either order. */
const ticks = fc.integer({ min: 0, max: 3 });

function provider(
  sourceId: string,
  result: readonly (number | undefined)[] | "fail",
  delay: number,
): ElevationProvider {
  return {
    attribution: sourceId,
    sourceId,
    async elevationAt() {
      for (let i = 0; i < delay; i++) await Promise.resolve();
      if (result === "fail") throw new Error(`${sourceId} is down`);
      return result;
    },
  };
}

describe("racingProvider, over arbitrary answers and arrival orders", () => {
  it("publishes ONE source's heights verbatim, never a blend of both", async () => {
    // The property the composition exists for. A median or an average here
    // would destroy exactly the resolution advantage the race was built to
    // preserve, and would look entirely plausible on screen.
    await fc.assert(
      fc.asyncProperty(
        answer,
        answer,
        ticks,
        ticks,
        async (preferredResult, fastResult, preferredDelay, fastDelay) => {
          const racer = racingProvider(
            provider("preferred", preferredResult, preferredDelay),
            provider("fast", fastResult, fastDelay),
          );

          const published = await racer.elevationAt(POSITIONS);

          const candidates = [preferredResult, fastResult].filter(
            (r): r is (number | undefined)[] => r !== "fail",
          );
          const allEmpty = POSITIONS.map(() => undefined);
          const acceptable = [...candidates, allEmpty];
          expect(
            acceptable.some(
              (candidate) =>
                JSON.stringify(candidate) === JSON.stringify(published),
            ),
          ).toBe(true);
        },
      ),
    );
  });

  it("always returns one height slot per position", async () => {
    // The seam's contract, and the thing every caller indexes by. A short array
    // from a misbehaving source must not shorten the output.
    await fc.assert(
      fc.asyncProperty(
        answer,
        answer,
        ticks,
        ticks,
        async (preferredResult, fastResult, preferredDelay, fastDelay) => {
          const racer = racingProvider(
            provider("preferred", preferredResult, preferredDelay),
            provider("fast", fastResult, fastDelay),
          );
          const published = await racer.elevationAt(POSITIONS);
          expect(published).toHaveLength(POSITIONS.length);
        },
      ),
    );
  });

  it("never throws for missing data, however both sources fail", async () => {
    // A DEM outage degrades the ground; it must not break the mesh build. Only
    // an abort is allowed out of here, and none of these inputs aborts.
    await fc.assert(
      fc.asyncProperty(
        answer,
        answer,
        ticks,
        ticks,
        async (preferredResult, fastResult, preferredDelay, fastDelay) => {
          const racer = racingProvider(
            provider("preferred", preferredResult, preferredDelay),
            provider("fast", fastResult, fastDelay),
          );
          await expect(racer.elevationAt(POSITIONS)).resolves.toBeDefined();
        },
      ),
    );
  });

  it("only ever upgrades TO the preferred source, and only from usable data", async () => {
    // THE GUARD ON THE GUARD, added after the milestone review predicted this
    // exact hole and found it. `delivered` is empty on every run where the
    // preferred arm won, failed, or answered with holes, and nothing below
    // required it to be non-empty on ANY run — so deleting the whole upgrade
    // feature from the provider left this property green. It is the only new
    // loop in the milestone that lacked the guard the plan mandates.
    let everDelivered = 0;
    // The direction matters more than the count: an upgrade that fires with the
    // fast source's heights, or with a batch of holes, silently makes the field
    // worse while every "did it upgrade?" assertion stays green.
    await fc.assert(
      fc.asyncProperty(
        answer,
        answer,
        ticks,
        ticks,
        async (preferredResult, fastResult, preferredDelay, fastDelay) => {
          const delivered: (readonly (number | undefined)[])[] = [];
          const racer = racingProvider(
            provider("preferred", preferredResult, preferredDelay),
            provider("fast", fastResult, fastDelay),
            { onUpgrade: (_positions, heights) => delivered.push(heights) },
          );

          await racer.elevationAt(POSITIONS);
          await racer.awaitUpgrades();

          everDelivered += delivered.length;
          for (const heights of delivered) {
            expect(preferredResult).not.toBe("fail");
            expect(JSON.stringify(heights)).toBe(
              JSON.stringify(preferredResult),
            );
            expect(heights.some((h) => h !== undefined)).toBe(true);
          }
        },
      ),
    );

    expect(
      everDelivered,
      "no run upgraded, so this property asserted nothing about upgrades — " +
        "check the generator still produces slow-fast-source cases",
    ).toBeGreaterThan(0);
  });
});
