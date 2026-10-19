import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  TourOrder,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-stations";
import { calcGpsCoords } from "gps-plus-slam-app-framework/core";
import { createSlamAppStore } from "gps-plus-slam-app-framework/state";
import { NullStorageBackend } from "gps-plus-slam-app-framework/storage";

import { ACCURACY_CEILING_M } from "./station-bands";
import { FIX_MAX_AGE_MS, wireStationGuide } from "./station-guide";
import type { VisitorPosition } from "./visitor-position";

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
            geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
            items: [],
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
          fixNue: [1000, 400, 1000] as [number, number, number],
          aligned: true,
          fixAtMs: 0,
          fixAccuracyM: 4,
        };
        const dom = {
          line: { textContent: "", hidden: true },
          skip: { textContent: "", hidden: true },
        };
        const guide = wireStationGuide({
          dom,
          tour: () => ({ stations, order }),
          placementAllowed: () => true,
          zero: () => zero,
          visitor: () => visitor,
          // A ready alignment no code lined up: GPS alone.
          codeLinedUp: () => false,
          alignmentReady: () => true,
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
          visitor = {
            nue: [north, 401.5, east],
            accuracyM: 4,
            fixNue: [north, 400, east],
            aligned: true,
            fixAtMs: now,
            fixAccuracyM: 4,
          };
          now += 1_000;
          guide.tick();
          if (tap) guide.skipTapped();
        }
        // From here on the visitor stands far from everything and only taps.
        visitor = {
          nue: [1000, 401.5, 1000],
          accuracyM: 4,
          fixNue: [1000, 400, 1000],
          aligned: true,
          fixAtMs: now,
          fixAccuracyM: 4,
        };
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

  // Why (M5a review M3): without a camera position the raw fix stands in
  // only while there is no alignment at all and the fix is fresh. Any
  // other moment - a tracking drop in an aligned session, a fix the GPS
  // stopped renewing - must find nothing, wherever the fix reads.
  it("a raw fix finds a station only without an alignment, only while fresh, only inside the radius", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: -2_000, max: 20_000 }),
        fc.integer({ min: -20, max: 20 }),
        fc.integer({ min: -20, max: 20 }),
        (aligned, ageMs, north, east) => {
          // Not ON the radius: the geodesy puts such a spot a hair either side.
          fc.pre(Math.abs(Math.hypot(north, east) - 5) > 0.01);
          const geo = calcGpsCoords(zero, [0, 0, 0]);
          const station: TourStation = {
            id: "s",
            title: "S",
            geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
            items: [],
            activateRadiusM: 20,
            foundRadiusM: 5,
            hint: "arrow",
            steps: [
              {
                id: "t",
                block: { kind: "text", text: "Hi" },
                advance: { mode: "tap" },
              },
            ],
          };
          const now = 100_000;
          const visitor: VisitorPosition = {
            nue: null,
            accuracyM: 4,
            fixNue: [north, 400, east],
            aligned,
            fixAtMs: now - ageMs,
            fixAccuracyM: 4,
          };
          const found: string[] = [];
          const guide = wireStationGuide({
            dom: {
              line: { textContent: "", hidden: true },
              skip: { textContent: "", hidden: true },
            },
            tour: () => ({ stations: [station], order: "fixed" }),
            placementAllowed: () => true,
            zero: () => zero,
            visitor: () => visitor,
            codeLinedUp: () => false,
            alignmentReady: () => true,
            startHud: () => ({ dispose: () => undefined }),
            now: () => now,
            onFound: (s) => found.push(s.id),
          });
          guide.tick();
          const reached =
            !aligned && ageMs <= FIX_MAX_AGE_MS && Math.hypot(north, east) < 5;
          expect(found).toEqual(reached ? ["s"] : []);
        },
      ),
      { numRuns: 300 },
    );
  });

  // Why (r881 third review L4): a lone fix (no alignment, or one not
  // ready) is judged by the worse of the median and its own accuracy. For
  // any pair - either may be unknown - and a visitor on the station's spot,
  // a find means the worse known one is within the ceiling. Both unknown
  // is judged by the radius alone: a real device fix always states an
  // accuracy (the Geolocation spec requires it), so only injected points
  // (a test page, a replay) can lack one, and refusing them would refuse
  // nothing a phone sends.
  it("a lone-fix find implies the worse of the median and the fix's own accuracy is within the ceiling", () => {
    const accuracy = fc.option(fc.integer({ min: 1, max: 500 }), {
      nil: null,
    });
    fc.assert(
      fc.property(
        accuracy,
        accuracy,
        fc.boolean(),
        (medianM, ownM, alignedNotReady) => {
          const geo = calcGpsCoords(zero, [0, 0, 0]);
          const station: TourStation = {
            id: "s",
            title: "S",
            geo: { lat: geo.lat, lon: geo.lon, alt: 400, headingDeg: 0 },
            items: [],
            activateRadiusM: 20,
            foundRadiusM: 5,
            hint: "arrow",
            steps: [
              {
                id: "t",
                block: { kind: "text", text: "Hi" },
                advance: { mode: "tap" },
              },
            ],
          };
          const now = 100_000;
          // Aligned but not ready (a cold start: the camera far away), or
          // no alignment at all: either way the fix alone is the position.
          const visitor: VisitorPosition = {
            nue: alignedNotReady ? [40, 401.5, 0] : null,
            accuracyM: medianM,
            fixNue: [1, 400, 1],
            aligned: alignedNotReady,
            fixAtMs: now,
            fixAccuracyM: ownM,
          };
          const found: string[] = [];
          const guide = wireStationGuide({
            dom: {
              line: { textContent: "", hidden: true },
              skip: { textContent: "", hidden: true },
            },
            tour: () => ({ stations: [station], order: "fixed" }),
            placementAllowed: () => true,
            zero: () => zero,
            visitor: () => visitor,
            codeLinedUp: () => false,
            alignmentReady: () => !alignedNotReady,
            startHud: () => ({ dispose: () => undefined }),
            now: () => now,
            onFound: (s) => found.push(s.id),
          });
          guide.tick();
          const known = [medianM, ownM].filter((m) => m !== null);
          const worse = known.length === 0 ? null : Math.max(...known);
          const expected = worse === null || worse <= ACCURACY_CEILING_M;
          expect(found).toEqual(expected ? ["s"] : []);
        },
      ),
      { numRuns: 300 },
    );
  });
});
