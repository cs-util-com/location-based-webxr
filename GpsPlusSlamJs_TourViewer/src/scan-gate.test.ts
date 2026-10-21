import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import {
  gateAllowsPlacement,
  gateSegment,
  isLockableLevel,
  reconsiderScanGate,
  SCAN_GATE_ESCAPE_MS,
  scanGateAtSessionStart,
  type ScanGate,
  scanCardShown,
} from "./scan-gate";

/**
 * Why these tests matter: the gate is the visitor's whole first minute. A
 * gate that could never pass (a level without geo, no detector) would leave
 * every visitor on the escape; a gate that waived itself while levels were
 * still loading would place at GPS a tour that carries a measured code.
 * Each rule is pinned by example and as a property over generated levels.
 */

const lockable: QrLevel = {
  version: 1,
  qr: {
    physicalSizeM: 0.16,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 },
  },
};
const sizeless: QrLevel = {
  version: 1,
  qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 0 } },
};
const geoless: QrLevel = { version: 1, qr: { physicalSizeM: 0.16 } };

const levelsOf = (...levels: QrLevel[]) =>
  new Map(levels.map((l, i) => [String(i), l]));

describe("isLockableLevel", () => {
  it("needs BOTH a printed size and a geo pose (property)", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasSize, hasGeo) => {
        const level: QrLevel = {
          version: 1,
          qr: {
            ...(hasSize ? { physicalSizeM: 0.2 } : {}),
            ...(hasGeo ? { geo: lockable.qr.geo } : {}),
          },
        };
        expect(isLockableLevel(level)).toBe(hasSize && hasGeo);
      }),
    );
  });
});

describe("scanGateAtSessionStart / reconsiderScanGate", () => {
  it("a creator never has a gate; a browser without a detector is waived", () => {
    expect(
      scanGateAtSessionStart({
        mode: "creator",
        hasDetector: true,
        levels: levelsOf(lockable),
      }),
    ).toEqual({ kind: "not-required", reason: "creator" });
    expect(
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: false,
        levels: levelsOf(lockable),
      }),
    ).toEqual({ kind: "not-required", reason: "no-detector" });
  });

  it("scans when a lockable level exists, or while the levels are still loading; waives when none can lock", () => {
    expect(
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: true,
        levels: levelsOf(lockable, geoless),
      }),
    ).toEqual({ kind: "scanning", escapeOffered: false });
    expect(
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: true,
        levels: null,
      }),
    ).toEqual({ kind: "scanning", escapeOffered: false });
    expect(
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: true,
        levels: levelsOf(sizeless, geoless),
      }),
    ).toEqual({ kind: "not-required", reason: "no-lockable-level" });
    expect(
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: true,
        levels: levelsOf(),
      }),
    ).toEqual({ kind: "not-required", reason: "no-lockable-level" });
  });

  it("late levels waive a scanning gate only when none can lock, and never touch a passed gate (property)", () => {
    const gates: ScanGate[] = [
      { kind: "scanning", escapeOffered: false },
      { kind: "scanning", escapeOffered: true },
      { kind: "passed", via: "code" },
      { kind: "passed", via: "skipped" },
      { kind: "idle" },
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...gates),
        fc.array(fc.constantFrom(lockable, sizeless, geoless), {
          maxLength: 4,
        }),
        (gate, levels) => {
          const after = reconsiderScanGate(gate, levelsOf(...levels));
          const waived =
            gate.kind === "scanning" && !levels.some(isLockableLevel);
          const expected: ScanGate = waived
            ? { kind: "not-required", reason: "no-lockable-level" }
            : gate;
          expect(after).toEqual(expected);
        },
      ),
    );
  });
});

describe("gateAllowsPlacement / gateSegment", () => {
  it("allows placement only once passed or not required, and names every state", () => {
    expect(gateAllowsPlacement({ kind: "idle" })).toBe(false);
    expect(gateAllowsPlacement({ kind: "scanning", escapeOffered: true })).toBe(
      false,
    );
    expect(gateAllowsPlacement({ kind: "passed", via: "code" })).toBe(true);
    expect(
      gateAllowsPlacement({ kind: "not-required", reason: "no-detector" }),
    ).toBe(true);
    expect(gateSegment({ kind: "scanning", escapeOffered: false })).toMatch(
      /point the phone/i,
    );
    expect(gateSegment({ kind: "scanning", escapeOffered: true })).toMatch(
      /GPS only/,
    );
    expect(gateSegment({ kind: "passed", via: "skipped" })).toMatch(
      /less accurate/,
    );
    expect(gateSegment({ kind: "passed", via: "code" })).toMatch(/recognised/);
    expect(
      gateSegment({ kind: "not-required", reason: "no-lockable-level" }),
    ).toMatch(/no measured code/);
    expect(gateSegment({ kind: "not-required", reason: "creator" })).toBe("");
    expect(
      gateSegment({ kind: "not-required", reason: "levels-unavailable" }),
    ).toMatch(/could not be read/);
    // The owner's S1 offers the skip after 10 s (polish round M4b,
    // Q-Scan); 45 s held a visitor at a code that would not lock.
    expect(SCAN_GATE_ESCAPE_MS).toBe(10_000);
  });
});

describe("reconsiderScanGate - the levels could not be read (M5 review #1)", () => {
  // Why this matters: a level file that fails to parse (or a host that
  // never answers) used to leave `currentLevels` null forever, and a null
  // never waives - the visitor stood at an unpassable gate for 45 s with
  // the reason written to a box outside the overlay. Unreadable levels
  // waive the gate with their own copy; a passed or waived gate stands.
  it("waives a scanning gate, and leaves every other state alone", () => {
    expect(
      reconsiderScanGate(
        { kind: "scanning", escapeOffered: true },
        "unavailable",
      ),
    ).toEqual({ kind: "not-required", reason: "levels-unavailable" });
    const passed: ScanGate = { kind: "passed", via: "code" };
    expect(reconsiderScanGate(passed, "unavailable")).toBe(passed);
    const idle: ScanGate = { kind: "idle" };
    expect(reconsiderScanGate(idle, "unavailable")).toBe(idle);
  });
});

describe("the scan gate and a code the moved-code check ignores (D20, M5c)", () => {
  // Why (§7j #4): a vetoed code must not leave the gate asking the visitor
  // to point the phone at it for 45 s; the gate passes "ignored" and says
  // the tour is placed by GPS. A tour whose every lockable code is ignored
  // needs no scan at all on its next AR entry; one with another lockable
  // code still asks for that one.
  it("passes 'ignored' when every lockable level is ignored, and still scans for one that is not", () => {
    const two = new Map([
      ["a", lockable],
      ["b", lockable],
    ]);
    const start = (ignored: ReadonlySet<string>) =>
      scanGateAtSessionStart({
        mode: "visitor",
        hasDetector: true,
        levels: two,
        ignoredLevelIds: ignored,
      });
    expect(start(new Set(["a", "b"]))).toEqual({
      kind: "passed",
      via: "ignored",
    });
    expect(start(new Set(["a"]))).toEqual({
      kind: "scanning",
      escapeOffered: false,
    });
    expect(
      reconsiderScanGate(
        { kind: "scanning", escapeOffered: true },
        two,
        new Set(["a", "b"]),
      ),
    ).toEqual({ kind: "passed", via: "ignored" });
    expect(
      reconsiderScanGate(
        { kind: "scanning", escapeOffered: false },
        two,
        new Set(["b"]),
      ),
    ).toEqual({ kind: "scanning", escapeOffered: false });
  });

  it("allows placement and says, in plain words, that the code is ignored and GPS places the tour", () => {
    const gate: ScanGate = { kind: "passed", via: "ignored" };
    expect(gateAllowsPlacement(gate)).toBe(true);
    expect(gateSegment(gate)).toBe("Code ignored - placing the tour by GPS.");
  });
});

describe("scanCardShown (polish round M4b, the owner's S1)", () => {
  // Why: the centred card asks a VISITOR for the code while the gate
  // waits, and must close by itself once the gate passes - a card left
  // over the scene would hide the tour it was waiting for.
  const scanning = { kind: "scanning", escapeOffered: false } as const;

  it("shows for a visitor's running session while the gate scans", () => {
    expect(scanCardShown("visitor", "running", scanning)).toBe(true);
    expect(
      scanCardShown("visitor", "running", {
        kind: "scanning",
        escapeOffered: true,
      }),
    ).toBe(true);
  });

  it("never shows for a creator, outside a session, or once the gate passed", () => {
    expect(scanCardShown("creator", "running", scanning)).toBe(false);
    for (const status of ["ready", "starting", "stopping", "error"] as const) {
      expect(scanCardShown("visitor", status, scanning), status).toBe(false);
    }
    for (const via of ["code", "skipped", "ignored"] as const) {
      expect(
        scanCardShown("visitor", "running", { kind: "passed", via }),
        via,
      ).toBe(false);
    }
    expect(scanCardShown("visitor", "running", { kind: "idle" })).toBe(false);
  });

  it("never shows for a tour that is not finished yet", () => {
    // Why: a tour without stations may still carry its measured code; the
    // card would ask for that code and hide the line saying the tour is
    // not finished, the one thing the visitor needs to read.
    expect(scanCardShown("visitor", "running", scanning, true)).toBe(false);
    expect(scanCardShown("visitor", "running", scanning, false)).toBe(true);
  });
});

// Why (M1b-1 review #6): the ?debug=1 line said "placing by GPS" in the
// codes-only mode, which has no GPS at all.
describe("gateSegment without location (M1b-1)", () => {
  it("never says GPS places the tour", () => {
    for (const reason of [
      "no-detector",
      "no-lockable-level",
      "levels-unavailable",
    ] as const) {
      const line = gateSegment({ kind: "not-required", reason }, true);
      expect(line).not.toMatch(/GPS/);
      expect(line).toMatch(/nothing can place the tour without location/);
    }
    expect(
      gateSegment({ kind: "scanning", escapeOffered: true }, true),
    ).not.toMatch(/GPS/);
  });
});
