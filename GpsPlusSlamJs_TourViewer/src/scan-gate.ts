/**
 * The visitor's scan gate (guided-setup plan DEC-N3/N4, §2.2): nothing is
 * placed until the hung code LOCKS in AR. Pure: the states, the rule that
 * decides whether a session needs the gate at all, and the copy. The
 * session that drives it (the lock event, the escape clock, the button)
 * lives in `viewer-placement.ts`.
 *
 * What counts as a lock: the tracking controller's `onLocked` with a
 * LOCKABLE level - one that carries both a printed size (else it never
 * solves) and a geo pose (else it never votes). Not the vote: votes need
 * the GPS zero and a budget, and a code that is visibly locked but not yet
 * voting would leave the gate stuck (plan review #1).
 *
 * A code the moved-code check IGNORES (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.6, D20, M5c) passes the gate as `ignored`: placed by
 * GPS, and said so, instead of asking for a code the viewer will not use
 * (§7j #4). A tour whose every lockable code is ignored passes at once.
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import type { ViewerMode } from "./mode.js";

/** After this long in `scanning` the visitor may continue with GPS only
 *  (DEC-N3). Its own clock, not the frame cadence: the no-frames case is
 *  exactly the case it exists for (plan review #11). */
export const SCAN_GATE_ESCAPE_MS = 45_000;

export type ScanGate =
  /** No session, or the gate was torn down with one. */
  | { kind: "idle" }
  /** This session never needed a lock: a creator, a browser without a
   *  detector, or a tour whose codes cannot lock. */
  | {
      kind: "not-required";
      reason:
        "creator" | "no-detector" | "no-lockable-level" | "levels-unavailable";
    }
  /** Waiting for the lock; `escapeOffered` once the clock elapsed. */
  | { kind: "scanning"; escapeOffered: boolean }
  /** The code locked, the visitor took the escape, or the code turned out
   *  to be one the moved-code check ignores. */
  | { kind: "passed"; via: "code" | "skipped" | "ignored" };

/** A level the viewer can lock against: it solves (size) and votes (geo). */
export function isLockableLevel(level: QrLevel): boolean {
  return level.qr.physicalSizeM !== undefined && level.qr.geo !== undefined;
}

/**
 * The gate at session start. Levels still loading (`null`) mean the gate
 * cannot yet be waived - it starts scanning and is reconsidered when they
 * arrive (`reconsiderScanGate`).
 */
export function scanGateAtSessionStart(input: {
  mode: ViewerMode;
  hasDetector: boolean;
  levels: ReadonlyMap<string, QrLevel> | null;
  /** Level ids the moved-code check ignores for this tour. */
  ignoredLevelIds?: ReadonlySet<string>;
}): ScanGate {
  if (input.mode === "creator")
    return { kind: "not-required", reason: "creator" };
  if (!input.hasDetector)
    return { kind: "not-required", reason: "no-detector" };
  if (
    input.levels !== null &&
    ![...input.levels.values()].some(isLockableLevel)
  ) {
    return { kind: "not-required", reason: "no-lockable-level" };
  }
  if (
    input.levels !== null &&
    allLockableIgnored(input.levels, input.ignoredLevelIds)
  ) {
    return { kind: "passed", via: "ignored" };
  }
  return { kind: "scanning", escapeOffered: false };
}

/** Whether the levels carry a lockable code and every one is ignored. */
function allLockableIgnored(
  levels: ReadonlyMap<string, QrLevel>,
  ignored: ReadonlySet<string> | undefined,
): boolean {
  if (ignored === undefined || ignored.size === 0) return false;
  const lockable = [...levels].filter(([, level]) => isLockableLevel(level));
  return lockable.length > 0 && lockable.every(([id]) => ignored.has(id));
}

/**
 * The gate once the tour's levels are known: a scanning gate is waived
 * when none of them can lock, and when the levels could not be read at all
 * (M5 review #1: a corrupt or unreachable level file used to hold the
 * visitor at an unpassable gate for the full 45 s, with the failure written
 * to a box outside the overlay). Every other state stands.
 */
export function reconsiderScanGate(
  gate: ScanGate,
  levels: ReadonlyMap<string, QrLevel> | "unavailable",
  ignoredLevelIds?: ReadonlySet<string>,
): ScanGate {
  if (gate.kind !== "scanning") return gate;
  if (levels === "unavailable")
    return { kind: "not-required", reason: "levels-unavailable" };
  if (![...levels.values()].some(isLockableLevel))
    return { kind: "not-required", reason: "no-lockable-level" };
  return allLockableIgnored(levels, ignoredLevelIds)
    ? { kind: "passed", via: "ignored" }
    : gate;
}

/** Whether placement may run under this gate. */
export function gateAllowsPlacement(gate: ScanGate): boolean {
  return gate.kind === "passed" || gate.kind === "not-required";
}

/** The gate's segment of the status line. */
export function gateSegment(gate: ScanGate): string {
  switch (gate.kind) {
    case "idle":
      return "";
    case "not-required":
      switch (gate.reason) {
        case "creator":
          return "";
        case "no-detector":
          return "No code scanner in this browser - placing by GPS.";
        case "no-lockable-level":
          return "This tour has no measured code - placing by GPS.";
        case "levels-unavailable":
          return "The tour's printed-code file could not be read - placing by GPS.";
      }
      break;
    case "scanning":
      return gate.escapeOffered
        ? "Point the phone at the tour's code (on the poster) - or continue with GPS only below (less accurate)."
        : "Point the phone at the tour's code (on the poster).";
    case "passed":
      switch (gate.via) {
        case "code":
          return "Code recognised - placing the tour.";
        case "skipped":
          return "Placing by GPS (less accurate).";
        case "ignored":
          return "Code ignored - placing the tour by GPS.";
      }
  }
  return "";
}
