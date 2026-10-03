/**
 * The viewer's moved-code check, per AR entry (Tour Viewer authoring plan
 * 2026-09-28-0953 §3.6, decision D20, milestone M5c): every scanned code is
 * PINNED at its first voted lock (its stable pose onto its saved geo,
 * `code-displacement.ts` `pinCode`) and then JUDGED on each new device fix
 * of the store's GPS history (`moved-code-rule.ts` `judgeCodeMove`), until
 * it reads `moved` (reported once) or its horizon passes.
 *
 * - DEVICE FIXES ONLY (§7j #3): the history is read through
 *   `displacementSamples`, i.e. `deviceSamples`, the one device-only filter.
 *   The code's own votes agree with its pin by construction.
 * - INCREMENTAL: each check folds only the fixes stored since its last
 *   update (O(1) per fix, `addDisplacementSample`). A history that SHRANK
 *   (a reset, e.g. the recovery's re-feed) is folded again from its start -
 *   unless an odometry frame change came first: the re-fed history then
 *   holds both frames, so every check ends instead (M5c review M4).
 * - FROM A BOUNDED HISTORY: the real-walk pairs fit every device fix of a
 *   short visit, the ones before the scan too; the check folds the fixes
 *   stamped at most `MOVED_CODE_FIT_WINDOW_S` (300 s) before the pin and
 *   every one after it (M5c review H2). An odometry frame change also cuts
 *   it: the checks end there ({@link
 *   MovedCodeChecks.frameChanged}) and a later pin folds only the fixes
 *   stored after the change.
 * - NO COMPASS (owner, 2026-10-02): a code's turn is read from its pose in
 *   GPS world space only (the rigid fit's yaw), and only for a settled save.
 *
 * Pure of the page: the caller hands in the store's history, the page clock
 * and the readings; the veto that follows a verdict is the caller's
 * (`viewer-placement.ts`).
 *
 * @see moved-code-check.ts.md
 */

import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { LatLong } from "gps-plus-slam-app-framework/core";

import {
  addDisplacementSample,
  CODE_MOVE_ESTIMATOR,
  displacementEstimate,
  displacementSamples,
  EMPTY_DISPLACEMENT_STATS,
  pinCode,
  type CodePin,
  type DisplacementStats,
} from "./code-displacement.js";
import { objectPoseNue } from "./content-placement.js";
import {
  isSettledSave,
  judgeCodeMove,
  MOVED_CODE_FIT_WINDOW_S,
  MOVED_CODE_HORIZON_S,
  MOVED_CODE_RULE_VERSION,
  type CodeMoveJudgement,
} from "./moved-code-rule.js";
import { odomNueFromWebXr } from "./visit-anchoring.js";
import type { VisitLogInput } from "./visit-log.js";

/** What the detector computed when it read `moved` - the
 *  `tourViewing/codeIgnored` log's payload (§7j #15). */
export interface MovedCodeEvidence {
  readonly ruleVersion: string;
  readonly decidedBy: NonNullable<CodeMoveJudgement["decidedBy"]>;
  /** Whether the turn check ran (the save was settled). */
  readonly turnChecked: boolean;
  /** The position bound (m). */
  readonly boundM: number;
  /** Where GPS puts the code minus where its saved pose says: [n, e] m. */
  readonly displacementM: readonly [number, number];
  readonly magnitudeM: number;
  /** The rigid fit's turn (degrees). */
  readonly yawDeg: number;
  readonly spanS: number;
  readonly spreadM: number;
  /** Device fixes folded. */
  readonly deviceFixes: number;
  /** Their median reported accuracy (m); null when none reported one. */
  readonly deviceAccuracyMedianM: number | null;
  /** The saved level's mint accuracy (m), when it carries one. */
  readonly storedAccuracyM: number | null;
  /** The saved level's alignment fix count, when it carries one. */
  readonly alignmentSampleCount: number | null;
  readonly settled: boolean;
  /** Page-clock seconds from the pin to this judgement. */
  readonly sinceScanS: number;
}

export interface MovedCodeVerdict {
  readonly text: string;
  readonly levelId: string;
  readonly evidence: MovedCodeEvidence;
}

/** One live check, for the `?debug=1` readout and the tests. */
export interface MovedCodeCheckView {
  readonly text: string;
  readonly levelId: string;
  readonly magnitudeM: number;
  readonly yawDeg: number;
  readonly spanS: number;
  readonly spreadM: number;
  readonly samples: number;
  /** Whether the turn check runs for this code (a settled save). */
  readonly turnChecked: boolean;
  readonly verdict: CodeMoveJudgement["verdict"];
}

export interface MovedCodeChecks {
  /** Start checking `levelId` from this voted lock's stable pose (raw
   *  WebXR). A code already checked in this frame, a level without geo, no
   *  session zero, or a pose with no yaw: nothing happens. */
  pin(input: {
    readonly text: string;
    readonly levelId: string;
    readonly level: QrLevel;
    readonly qrPoseWorld: Pose;
    readonly atMs: number;
    readonly zero: LatLong | null;
  }): void;
  /** Fold the history's new device fixes and judge every live check at
   *  page time `nowMs`; the codes that read `moved` now (each once - its
   *  check ends). Checks past their horizon end silently. */
  update(
    history: Pick<VisitLogInput, "gpsPositions" | "odometryPositions"> & {
      readonly zero: LatLong | null;
    },
    nowMs: number,
  ): MovedCodeVerdict[];
  /** The odometry frame changed with `storedCount` GPS events in the
   *  history: every check ends, and later pins fold only what follows. */
  frameChanged(storedCount: number): void;
  /** End every check (a tour switch): the pins belonged to the closing
   *  tour. */
  clear(): void;
  snapshot(): MovedCodeCheckView[];
}

interface Check {
  readonly text: string;
  readonly levelId: string;
  readonly pin: CodePin;
  readonly atMs: number;
  readonly settled: boolean;
  readonly storedAccuracyM: number | null;
  readonly alignmentSampleCount: number | null;
  stats: DisplacementStats;
  /** Sorted reported accuracies of the folded fixes. */
  accuracies: number[];
  /** History entries folded so far (an index into the store's arrays). */
  folded: number;
  last: CodeMoveJudgement | null;
}

const finiteOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function sortedInsert(arr: number[], v: number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}

export function createMovedCodeChecks(): MovedCodeChecks {
  const checks = new Map<string, Check>();
  /** The first history index of the current odometry frame. */
  let frameStart = 0;
  /** The history's length at the last update: a shorter one was reset. */
  let seenLength = 0;

  function fold(
    check: Check,
    history: Parameters<MovedCodeChecks["update"]>[0],
  ): void {
    const { gpsPositions, odometryPositions } = history;
    if (gpsPositions.length < check.folded) {
      // The history was reset (and maybe re-fed): fold it again.
      check.stats = EMPTY_DISPLACEMENT_STATS;
      check.accuracies = [];
      check.folded = 0;
    }
    const samples = displacementSamples({
      gpsPositions: gpsPositions.slice(check.folded),
      odometryPositions: odometryPositions.slice(check.folded),
      zero: history.zero,
    });
    // The fit window (M5c review H2): fixes stamped long before the pin
    // never fold.
    const fromMs = check.atMs - MOVED_CODE_FIT_WINDOW_S * 1000;
    for (const sample of samples) {
      if (sample.tMs < fromMs) continue;
      check.stats = addDisplacementSample(
        check.stats,
        check.pin,
        CODE_MOVE_ESTIMATOR,
        sample,
      );
      if (sample.accuracyM !== undefined) {
        sortedInsert(check.accuracies, sample.accuracyM);
      }
    }
    check.folded = gpsPositions.length;
  }

  function judge(check: Check) {
    const estimate = displacementEstimate(check.stats, CODE_MOVE_ESTIMATOR);
    const accuracyMedianM =
      check.accuracies.length === 0
        ? null
        : check.accuracies[check.accuracies.length >> 1]!;
    const judgement = judgeCodeMove({ estimate, settled: check.settled });
    check.last = judgement;
    return { estimate, accuracyMedianM, judgement };
  }

  return {
    pin({ text, levelId, level, qrPoseWorld, atMs, zero }) {
      if (checks.has(levelId) || zero === null || !Number.isFinite(atMs)) {
        return;
      }
      const geo = level.qr.geo;
      if (geo === undefined) return;
      let pin: CodePin | null;
      try {
        const stored = objectPoseNue(geo, zero);
        pin = pinCode(odomNueFromWebXr(qrPoseWorld), {
          position: stored.positionNue,
          rotation: stored.rotationNue,
        });
      } catch {
        pin = null;
      }
      if (pin === null) return;
      checks.set(levelId, {
        text,
        levelId,
        pin,
        atMs,
        settled: isSettledSave(level),
        storedAccuracyM: finiteOrNull(level.qr.mintQuality?.gpsAccuracyM),
        alignmentSampleCount: finiteOrNull(
          level.qr.mintQuality?.alignmentSampleCount,
        ),
        stats: EMPTY_DISPLACEMENT_STATS,
        accuracies: [],
        folded: frameStart,
        last: null,
      });
    },
    update(history, nowMs) {
      const length = history.gpsPositions.length;
      if (length < seenLength && frameStart > 0) {
        // A reset after a frame change (the veto's recovery re-feeds every
        // device fix, both frames'): re-folding from index 0 would mix the
        // frames, so every check ends and later pins fold only what is
        // stored from here on (M5c review M4).
        checks.clear();
        frameStart = length;
      }
      seenLength = length;
      const verdicts: MovedCodeVerdict[] = [];
      for (const check of [...checks.values()]) {
        const sinceScanS = (nowMs - check.atMs) / 1000;
        if (!(sinceScanS <= MOVED_CODE_HORIZON_S)) {
          checks.delete(check.levelId);
          continue;
        }
        fold(check, history);
        const { estimate, accuracyMedianM, judgement } = judge(check);
        if (judgement.verdict !== "moved" || judgement.decidedBy === null) {
          continue;
        }
        checks.delete(check.levelId);
        verdicts.push({
          text: check.text,
          levelId: check.levelId,
          evidence: {
            ruleVersion: MOVED_CODE_RULE_VERSION,
            decidedBy: judgement.decidedBy,
            turnChecked: judgement.turnChecked,
            boundM: judgement.boundM,
            displacementM: estimate?.displacementM ?? [0, 0],
            magnitudeM: estimate?.magnitudeM ?? 0,
            yawDeg: estimate?.yawDeg ?? 0,
            spanS: estimate?.spanS ?? 0,
            spreadM: estimate?.spreadM ?? 0,
            deviceFixes: estimate?.samples ?? 0,
            deviceAccuracyMedianM: accuracyMedianM,
            storedAccuracyM: check.storedAccuracyM,
            alignmentSampleCount: check.alignmentSampleCount,
            settled: check.settled,
            sinceScanS,
          },
        });
      }
      return verdicts;
    },
    frameChanged(storedCount) {
      checks.clear();
      frameStart = Math.max(0, storedCount);
    },
    clear() {
      checks.clear();
    },
    snapshot() {
      return [...checks.values()].map((check) => {
        const estimate = displacementEstimate(check.stats, CODE_MOVE_ESTIMATOR);
        return {
          text: check.text,
          levelId: check.levelId,
          magnitudeM: estimate?.magnitudeM ?? 0,
          yawDeg: estimate?.yawDeg ?? 0,
          spanS: estimate?.spanS ?? 0,
          spreadM: estimate?.spreadM ?? 0,
          samples: estimate?.samples ?? 0,
          turnChecked: check.settled,
          verdict: check.last?.verdict ?? "undecided",
        };
      });
    },
  };
}
