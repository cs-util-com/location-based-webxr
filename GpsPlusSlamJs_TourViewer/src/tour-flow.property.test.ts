import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  arStatusLine,
  placementSegment,
  qrSegment,
  type ArStatusInput,
  type PlacementState,
} from "./tour-flow.js";

/**
 * Why these properties matter (flows plan M1, review finding #7/#16): the
 * unit tests pin examples; these pin the RULES the copy must obey for every
 * state the page can be in - the no-codes rule is scoped to an OPEN tour
 * (scanning with no tour open is by design, DEC-T9), a decline reason is
 * never paraphrased away, and no non-idle placement renders as silence.
 */

const SCANNING = { state: "scanning" } as unknown as NonNullable<
  ArStatusInput["qr"]["status"]
>;

const QR_QUIET: ArStatusInput["qr"] = {
  status: SCANNING,
  unknownCode: null,
  unusableCode: null,
  votedLocks: 0,
  lockedText: null,
  reprojectionErrorPx: null,
};

const arbNonIdlePlacement = (): fc.Arbitrary<PlacementState> =>
  fc.oneof(
    fc.record({
      kind: fc.constant("placing" as const),
      phase: fc.constantFrom(
        "reading-walk" as const,
        "loading-photos" as const,
      ),
      done: fc.nat({ max: 500 }),
      total: fc.nat({ max: 500 }),
    }),
    fc.record({
      kind: fc.constant("placed" as const),
      placedKind: fc.constant("capture-spots" as const),
      count: fc.nat({ max: 500 }),
      fixes: fc.nat({ max: 500 }),
      gpsAccuracyMedianM: fc.option(
        fc.double({ min: 0, max: 100, noNaN: true }),
        { nil: null },
      ),
    }),
    fc.record({
      kind: fc.constant("declined" as const),
      reason: fc.string({ minLength: 1, maxLength: 40 }),
    }),
  );

const base = (
  tour: ArStatusInput["tour"],
  placement: PlacementState,
): ArStatusInput => ({
  mode: "visitor",
  arStatus: "running",
  cameraFrames: 1,
  tour,
  qr: QR_QUIET,
  readiness: null,
  placement,
  planesError: null,
  contentError: null,
  gate: { kind: "idle" },
  content: { kind: "none" },
});

/** Every gate state (M5 review #15: the properties used to pin `idle`). */
const gateArb: fc.Arbitrary<ArStatusInput["gate"]> = fc.oneof(
  fc.constant<ArStatusInput["gate"]>({ kind: "idle" }),
  fc
    .constantFrom(
      "creator" as const,
      "no-detector" as const,
      "no-lockable-level" as const,
      "levels-unavailable" as const,
    )
    .map((reason) => ({ kind: "not-required" as const, reason })),
  fc
    .boolean()
    .map((escapeOffered) => ({ kind: "scanning" as const, escapeOffered })),
  fc
    .constantFrom("code" as const, "skipped" as const)
    .map((via) => ({ kind: "passed" as const, via })),
);

describe("tour-flow - copy rules", () => {
  it("an open tour with zero levels never says 'Scanning', for any frame count", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), (cameraFrames) => {
        const open = {
          ...base({ kind: "open", levelCount: 0 }, { kind: "idle" }),
          cameraFrames,
        };
        expect(qrSegment(open)).not.toContain("Scanning");
        expect(arStatusLine(open)).not.toContain("Scanning");
      }),
    );
  });

  it("with no tour open the DEC-T9 scanning line stays, for any frame count", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100_000 }), (cameraFrames) => {
        const closed = {
          ...base({ kind: "none" }, { kind: "idle" }),
          cameraFrames,
        };
        expect(qrSegment(closed)).toBe("Scanning for the printed code…");
        expect(arStatusLine(closed)).toContain(
          "Scanning for the printed code…",
        );
      }),
    );
  });

  it("every non-idle placement renders text, and the composed line carries it unchanged", () => {
    fc.assert(
      fc.property(arbNonIdlePlacement(), (placement) => {
        const segment = placementSegment(placement);
        expect(segment.length).toBeGreaterThan(0);
        const line = arStatusLine(
          base({ kind: "open", levelCount: 1 }, placement),
        );
        expect(line.endsWith(` · ${segment}`)).toBe(true);
      }),
    );
  });

  it("a decline reason appears verbatim", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 40 }), (reason) => {
        expect(placementSegment({ kind: "declined", reason })).toContain(
          reason,
        );
      }),
    );
  });
});

describe("tour-flow - the gate in the composed line (M5)", () => {
  it("a scanning gate never shows the coaching hint or 'Scanning'; a waived one never says 'no printed codes' twice", () => {
    // Why this matters: "walk around" beside "stay at the code" and a
    // doubled "no code" line were both shipped once; the rules hold for
    // every gate state and frame count, not only the two examples.
    fc.assert(
      fc.property(gateArb, fc.nat({ max: 1000 }), (gate, cameraFrames) => {
        const line = arStatusLine({
          ...base({ kind: "open", levelCount: 0 }, { kind: "waiting-ready" }),
          cameraFrames,
          gate,
          readiness: {
            phase: "move-around",
            hint: "Walk around a few steps.",
            percentReady: 40,
          },
        });
        const scanning = gate.kind === "scanning";
        const coaching =
          line.includes("Walk around") || line.includes("Scanning");
        expect(scanning && coaching).toBe(false);
        const mentions = line.split("no printed codes").length - 1;
        const gateSays = line.includes("no measured code");
        expect(mentions + (gateSays ? 1 : 0)).toBeLessThanOrEqual(1);
      }),
    );
  });
});
