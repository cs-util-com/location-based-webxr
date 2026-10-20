/**
 * Why this property matters (UI round 1, U1): the visitor's line is built
 * from five independent inputs (code, gate, placement, content, errors)
 * whose combinations the example table cannot list. For EVERY combination
 * a running session must say something, and must never leak the debug
 * readout's counters or the old mode prefix to a visitor.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ArStatusInput } from "./tour-flow";
import { visitorStatus } from "./visitor-status";

const text = fc.option(fc.constant("https://example.test/t"), { nil: null });

const arbInput: fc.Arbitrary<ArStatusInput> = fc.record({
  mode: fc.constant("visitor"),
  arStatus: fc.constant("running" as const),
  cameraFrames: fc.nat(),
  tour: fc.constant({ kind: "open" as const, levelCount: 1 }),
  qr: fc.record({
    status: fc.constantFrom("scanning", "tracking", null),
    unknownCode: text,
    unusableCode: text,
    ignoredCode: text,
    votedLocks: fc.integer({ min: 0, max: 10 }),
    lockedText: text,
    reprojectionErrorPx: fc.option(fc.double({ min: 0, max: 9, noNaN: true }), {
      nil: null,
    }),
  }),
  readiness: fc.oneof(
    fc.constant(null),
    fc
      .constantFrom(
        "initializing" as const,
        "move-around" as const,
        "almost-ready" as const,
        "ready" as const,
        "ar-lost" as const,
      )
      .map((phase) => ({ phase, percentReady: 0.5, hint: "Move slowly." })),
  ),
  codesOnly: fc.boolean(),
  stationsAwaitHeading: fc.boolean(),
  awayFromStations: fc.boolean(),
  placement: fc.oneof(
    fc.constant({ kind: "idle" as const }),
    fc.constant({ kind: "waiting-ready" as const }),
    fc.record({
      kind: fc.constant("placed" as const),
      placedKind: fc.constant("capture-spots" as const),
      count: fc.nat(9),
      fixes: fc.nat(9),
      gpsAccuracyMedianM: fc.constant(null),
    }),
    fc.record({
      kind: fc.constant("declined" as const),
      reason: fc.constant("no readable capture photos"),
    }),
  ),
  planesError: fc.option(fc.constant("HTTP 404"), { nil: null }),
  contentError: fc.option(fc.constant("bad"), { nil: null }),
  gate: fc.oneof(
    fc.record({
      kind: fc.constant("scanning" as const),
      escapeOffered: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant("passed" as const),
      via: fc.constantFrom(
        "code" as const,
        "skipped" as const,
        "ignored" as const,
      ),
    }),
    fc.record({
      kind: fc.constant("not-required" as const),
      reason: fc.constantFrom(
        "no-detector" as const,
        "no-lockable-level" as const,
        "levels-unavailable" as const,
      ),
    }),
  ),
  content: fc.oneof(
    fc.constant({ kind: "none" as const }),
    fc.record({
      kind: fc.constant("placed" as const),
      count: fc.nat(9),
      skipped: fc.nat(3),
    }),
  ),
});

const WALK = "Walk a few steps so the guide knows the direction.";
const TO_STATION = "Walk to a station to see its content.";

describe("visitorStatus (property)", () => {
  // Why this property matters (D34; PR review S6, N8): the request for a
  // few steps joins every sentence a running session can show, so for
  // every combination it must appear once at most, only while the guide
  // waits and tracking runs with location, and never beside "Look around."
  // (the one sentence it replaces).
  it("asks for a few steps once at most, only while the guide waits with tracking running and location, never beside Look around", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { text } = visitorStatus(input);
        const phase = input.readiness?.phase;
        const allowed =
          input.stationsAwaitHeading === true &&
          input.codesOnly !== true &&
          phase !== undefined &&
          phase !== "initializing" &&
          phase !== "ar-lost";
        const count = text.split(WALK).length - 1;
        expect(count).toBeLessThanOrEqual(allowed ? 1 : 0);
        expect(count > 0 && text.includes("Look around.")).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });

  it("a running session always says something, and never the debug readout", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { text, state } = visitorStatus(input);
        expect(text.length).toBeGreaterThan(0);
        expect(state).not.toBe("before-ar");
        expect(text).not.toMatch(
          /Visitor mode|camera frames|vote batch|Pose error|fixes|±|Relocaliz/,
        );
      }),
      { numRuns: 500 },
    );
  });

  // Why this property matters: with every piece of content
  // waiting at a station the visitor is not at, "Look around." points at
  // nothing. A placed tour then asks the visitor to walk to a station,
  // never beside "Look around." and never beside the request for a few
  // steps (which, when asked, comes first and walking answers both).
  it("away from every station a placed tour asks for a station, never Look around", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { text } = visitorStatus(input);
        const asked = text.split(TO_STATION).length - 1;
        expect(asked).toBeLessThanOrEqual(input.awayFromStations ? 1 : 0);
        expect(asked > 0 && text.includes("Look around.")).toBe(false);
        expect(asked > 0 && text.includes(WALK)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});
