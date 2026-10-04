import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { wireStationGuide } from "./station-guide";

/**
 * Why this property matters (K4 review R9): "no order can deadlock" was
 * proven for the run alone, while the guide could still stall a tour - a
 * found station could not be skipped, and a story whose choices all loop
 * back never ends. Here the stories NEVER end by themselves, the visitor
 * wanders (finding some stations by GPS, never reaching others), and then
 * only taps the one skip button, waiting a little between taps: every
 * order preset, with any `next` links (cycles included), completes within
 * two taps per station.
 */

// The core's geodesy needs an activated store (the framework's factory).
createSlamAppStore({ storageBackend: new NullStorageBackend() });

const zero = { lat: 47.5, lon: 8.7 };

const tourArb = fc
  .integer({ min: 1, max: 5 })
  .chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.array(
        fc.tuple(
          fc.integer({ min: -150, max: 150 }),
          fc.integer({ min: -150, max: 150 }),
          fc.option(fc.integer({ min: 0, max: n - 1 }), { nil: undefined }),
        ),
        { minLength: n, maxLength: n },
      ),
      fc.constantFrom<TourOrder>("fixed", "any", "branch"),
      fc.array(
        fc.tuple(
          fc.integer({ min: -150, max: 150 }),
          fc.integer({ min: -150, max: 150 }),
          fc.boolean(),
        ),
        { maxLength: 20 },
      ),
    ),
  );

describe("wireStationGuide (properties)", () => {
  it("never deadlocks: stories that never end and stations nobody reaches still complete within two skip taps per station", () => {
    fc.assert(
      fc.property(tourArb, ([n, specs, order, wander]) => {
        const stations: TourStation[] = specs.map(([north, east, next], i) => {
          const geo = calcGpsCoords(zero, [north, 0, east]);
          return {
            id: `s${String(i)}`,
            title: `S${String(i)}`,
            anchor: {
              geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
            },
            activateRadiusM: 20,
            foundRadiusM: 5,
            hint: "arrow",
            ...(next === undefined ? {} : { next: `s${String(next)}` }),
            // One choice whose only option loops back to itself: it never
            // ends on its own.
            steps: [
              {
                id: "ask",
                block: {
                  kind: "choice",
                  prompt: "Again?",
                  options: [{ id: "yes", label: "Yes", goto: "ask" }],
                },
                advance: { mode: "tap" },
              },
            ],
          };
        });
        let now = 0;
        let visitor = {
          nue: [1000, 401.5, 1000] as [number, number, number],
          accuracyM: 4,
        };
        const dom = {
          line: { textContent: "", hidden: true },
          skip: { textContent: "", hidden: true },
        };
        const guide = wireStationGuide({
          dom,
          tour: () => ({ stations, order, levels: null }),
          placementAllowed: () => true,
          zero: () => zero,
          visitor: () => visitor,
          isIgnoredCode: () => false,
          startHud: () => ({ dispose: () => undefined }),
          now: () => now,
          // A found station's story starts, and never ends by itself.
          onFound: () => undefined,
          // Ending it from the guide ends it, as the story panel does.
          onEndStory: (id) => {
            guide.storyEnded(id);
          },
        });
        for (const [north, east, tap] of wander) {
          visitor = { nue: [north, 401.5, east], accuracyM: 4 };
          now += 1_000;
          guide.tick();
          if (tap) guide.skipTapped();
        }
        // From here on the visitor stands far from everything and only taps.
        visitor = { nue: [1000, 401.5, 1000], accuracyM: 4 };
        for (let taps = 0; taps < 2 * n + 2; taps += 1) {
          now += 10_000;
          guide.tick();
          if (dom.line.textContent.startsWith("Tour complete")) break;
          guide.skipTapped();
        }
        guide.tick();
        expect(dom.line.textContent).toMatch(/^Tour complete/);
      }),
      { numRuns: 300 },
    );
  });
});
