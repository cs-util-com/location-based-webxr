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
  readiness: fc.constant(null),
  placement: fc.oneof(
    fc.constant({ kind: "idle" as const }),
    fc.constant({ kind: "waiting-ready" as const }),
    fc.constant({ kind: "nothing-to-place" as const }),
    fc.record({
      kind: fc.constant("placing" as const),
      phase: fc.constantFrom(
        "reading-walk" as const,
        "loading-photos" as const,
      ),
      done: fc.nat(50),
      total: fc.nat(50),
    }),
    fc.record({
      kind: fc.constant("placed" as const),
      placedKind: fc.constant("ring" as const),
      count: fc.nat(9),
    }),
    fc.record({
      kind: fc.constant("declined" as const),
      reason: fc.constant("no recording in this tour"),
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

describe("visitorStatus (property)", () => {
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
});
