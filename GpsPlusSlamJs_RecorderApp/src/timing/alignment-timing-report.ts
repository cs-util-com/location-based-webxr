/**
 * Turning a timing run into the two things the owner takes away: a JSON blob
 * they copy by hand, and a small table they read on the phone.
 *
 * Pure. Nothing here touches the DOM, the clock or the network - the page
 * supplies the environment and the recording description, so this module can
 * be tested on fixed numbers.
 *
 * The design rule behind every field: a figure is worthless without the
 * parameters it rests on. The report therefore carries the whole arm table
 * (with the overrides each arm ran under), the ladder, the repeat and warm-up
 * counts, every raw repeat, and the device it was measured on. A reader weeks
 * later must be able to falsify the numbers without asking anyone.
 */

import type {
  AlignmentTimingResult,
  AlignmentTimingSegment,
} from './alignment-timing-loop';
import type { TimingArm } from './alignment-timing-arms';
import type { AlignmentOverrides } from 'gps-plus-slam-app-framework/state';

/** The device and build the run happened on. */
export interface TimingEnvironment {
  readonly userAgent: string;
  /** `navigator.hardwareConcurrency`, or null where the browser hides it. */
  readonly hardwareConcurrency: number | null;
  readonly appVersion: string;
  readonly libraryVersion: string;
  readonly frameworkVersion: string;
  readonly buildCommit: string;
}

export interface TimingRecordingInfo {
  readonly fileName: string;
  readonly fixCount: number;
  /** Wall-clock span of the replayed fixes, or null when unknown. */
  readonly durationSeconds: number | null;
}

export interface TimingReportArm {
  readonly armId: string;
  readonly label: string;
  readonly overrides: AlignmentOverrides | null;
  readonly segments: readonly AlignmentTimingSegment[];
  readonly totalMedianMs: number;
  readonly totalMinMs: number;
  readonly totalMsPerRepeat: readonly number[];
  readonly warmupTotalMs: readonly number[];
}

export interface AlignmentTimingReport {
  readonly schema: 'alignment-timing/1';
  readonly generatedAt: string;
  readonly recording: TimingRecordingInfo;
  readonly parameters: AlignmentTimingResult['parameters'];
  readonly environment: TimingEnvironment;
  readonly arms: readonly TimingReportArm[];
}

export interface BuildTimingReportInput {
  readonly result: AlignmentTimingResult;
  readonly arms: readonly TimingArm[];
  readonly environment: TimingEnvironment;
  readonly recording: TimingRecordingInfo;
  /** ISO timestamp; injected so the report is reproducible in tests. */
  readonly generatedAt: string;
}

/**
 * Join a loop result to the arm table that produced it.
 *
 * @throws Error when the loop measured an arm the table does not define. That
 *   means the page and the measurement disagree about what was measured, and
 *   the failure mode is a silently mislabelled column.
 */
export function buildTimingReport(
  input: BuildTimingReportInput
): AlignmentTimingReport {
  const byId = new Map(input.arms.map((a) => [a.id, a]));
  const arms = input.result.arms.map((measured): TimingReportArm => {
    const arm = byId.get(measured.armId);
    if (!arm) {
      throw new Error(
        `timing result names arm "${measured.armId}", which is not in the arm table`
      );
    }
    return {
      armId: measured.armId,
      label: arm.label,
      overrides: arm.overrides,
      segments: measured.segments,
      totalMedianMs: measured.totalMedianMs,
      totalMinMs: measured.totalMinMs,
      totalMsPerRepeat: measured.totalMsPerRepeat,
      warmupTotalMs: measured.warmupTotalMs,
    };
  });
  return {
    schema: 'alignment-timing/1',
    generatedAt: input.generatedAt,
    recording: input.recording,
    parameters: input.result.parameters,
    environment: input.environment,
    arms,
  };
}

/** Milliseconds at microsecond resolution - the scale a single solve lives on. */
function formatMs(value: number): string {
  return value.toFixed(3);
}

export interface TimingTable {
  /** The parameters, in one sentence, so no figure is read without them. */
  readonly caption: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  /** Per arm: label, total median, total minimum, ratio against shipped. */
  readonly totals: readonly (readonly string[])[];
}

/**
 * Render the report as strings. The first arm is the reference of the ratio
 * column - the arm table puts the shipped configuration there, and the report
 * preserves the loop's order.
 */
export function buildTimingTable(report: AlignmentTimingReport): TimingTable {
  const { ladder, repeats, warmups, fixCount } = report.parameters;
  const caption =
    `${fixCount} fixes, history ladder ${ladder.join(' / ')}, ` +
    `median and minimum of ${repeats} timed passes after ${warmups} warm-up ` +
    `pass, arms interleaved within each pass.`;

  const rows: string[][] = [];
  for (const arm of report.arms) {
    for (const segment of arm.segments) {
      rows.push([
        arm.label,
        `${segment.fromHistory}→${segment.toHistory}`,
        String(segment.midHistory),
        formatMs(segment.medianMsPerFix),
        formatMs(segment.minMsPerFix),
        String(repeats),
      ]);
    }
  }

  const reference = report.arms[0]?.totalMedianMs;
  const totals = report.arms.map((arm) => [
    arm.label,
    formatMs(arm.totalMedianMs),
    formatMs(arm.totalMinMs),
    reference !== undefined && reference > 0
      ? `${(arm.totalMedianMs / reference).toFixed(2)}x`
      : 'n/a',
  ]);

  return {
    caption,
    header: [
      'arm',
      'history',
      'mid M',
      'ms/fix (median)',
      'ms/fix (min)',
      'repeats',
    ],
    rows,
    totals,
  };
}
