/**
 * Text of the WebXR anchors check: the one-line on-screen verdicts and the
 * full log the "Copy log" button copies. Pure functions over the tracker's
 * events and statistics.
 *
 * Sidecar: `anchor-jump-report.ts.md`.
 */

import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  BAND_LOWER_M,
  FRAME_GAP_MS,
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  RELOCALIZATION_RULE_M,
  SETTLE_FRAMES,
  VERDICT_TOLERANCES,
  poseStep,
  type AnchorComparison,
  type FrameStats,
  type JumpEvent,
  type PoseStep,
  type TrackerEvent,
  type Verdict,
} from './anchor-jump-tracker';

/** Nearest-rank percentile of a copy; `null` for no data. */
export function percentile(
  values: readonly number[],
  p: number
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function formatPose(p: Pose | null): string {
  if (p === null) return 'none';
  const pos = p.position.map((v) => v.toFixed(3)).join(', ');
  const rot = p.rotation.map((v) => v.toFixed(4)).join(', ');
  return `p=(${pos}) q=(${rot})`;
}

function formatStep(s: PoseStep): string {
  return `${s.translationM.toFixed(2)} m / ${s.rotationDeg.toFixed(1)} deg`;
}

function formatStepFine(s: PoseStep | null): string {
  return s === null
    ? 'none'
    : `${s.translationM.toFixed(3)} m / ${s.rotationDeg.toFixed(2)} deg`;
}

/** The verdict a jump is counted under: settled, else the jump frame. */
function mainVerdict(e: JumpEvent): Verdict | null {
  return (e.settled ?? e.atJump)?.verdicts.main ?? null;
}

export function onScreenLine(e: TrackerEvent): string {
  switch (e.kind) {
    case 'jump': {
      const v = mainVerdict(e);
      const label =
        v === null
          ? 'unclear (no anchor tracked)'
          : e.settled === null
            ? `${v} (settling)`
            : v;
      return `Jump ${e.index}: ${label} (camera ${formatStep(e.cameraStep)}, ${e.stepClass})`;
    }
    case 'tracking-loss':
      return `Tracking lost for ${(e.durationMs / 1000).toFixed(1)} s, camera step ${formatStep(e.cameraStep)}`;
    case 'frame-gap':
      return `Frame gap of ${Math.round(e.dtMs)} ms, camera step ${formatStep(e.cameraStep)}`;
    case 'placed':
      return 'Anchor and marker placed';
  }
}

export interface VerdictCounts {
  readonly jumps: number;
  readonly 'frame switch': number;
  readonly 'drift correction': number;
  readonly unclear: number;
}

/** Jumps by their main-tolerance verdict (no anchor counts as unclear). */
export function verdictCounts(events: readonly TrackerEvent[]): VerdictCounts {
  const counts = {
    jumps: 0,
    'frame switch': 0,
    'drift correction': 0,
    unclear: 0,
  };
  for (const e of events) {
    if (e.kind !== 'jump') continue;
    counts.jumps++;
    counts[mainVerdict(e) ?? 'unclear']++;
  }
  return counts;
}

function distribution(
  name: string,
  values: readonly number[],
  digits: number
): string {
  if (values.length === 0) return `${name}: no data`;
  const f = (p: number) => percentile(values, p)!.toFixed(digits);
  return `${name}: p50 ${f(50)}, p95 ${f(95)}, p99 ${f(99)}, max ${f(100)} (n ${values.length})`;
}

function comparisonLines(label: string, c: AnchorComparison | null): string[] {
  if (c === null) return [`  ${label}: anchor not tracked`];
  const v = c.verdicts;
  return [
    `  ${label}: ${formatPose(c.anchorAfter)}`,
    `    to D * anchorBefore ${formatStepFine(c.toPredicted)}; to anchorBefore ${formatStepFine(c.toBefore)}`,
    `    verdict tight ${v.tight}, main ${v.main}, loose ${v.loose}`,
  ];
}

function eventLines(e: TrackerEvent): string[] {
  const at = (t: number) => `[t ${Math.round(t)} ms]`;
  switch (e.kind) {
    case 'placed':
      return [`${at(e.t)} placed anchor and marker at ${formatPose(e.pose)}`];
    case 'tracking-loss':
      return [
        `${at(e.tRecovered)} tracking loss of ${Math.round(e.durationMs)} ms: camera step ${formatStepFine(e.cameraStep)}`,
        `  anchor before: ${formatPose(e.anchorBefore)}`,
        `  anchor after: ${formatPose(e.anchorAfter)}; step ${formatStepFine(e.anchorStep)}`,
      ];
    case 'frame-gap':
      return [
        `${at(e.t)} frame gap of ${Math.round(e.dtMs)} ms: camera step ${formatStepFine(e.cameraStep)}`,
        `  anchor before: ${formatPose(e.anchorBefore)}`,
        `  anchor after: ${formatPose(e.anchorAfter)}; step ${formatStepFine(e.anchorStep)}`,
      ];
    case 'jump':
      return [
        `${at(e.t)} jump ${e.index}: dt ${Math.round(e.dtMs)} ms, camera step ${formatStepFine(e.cameraStep)} (${e.stepClass})`,
        `  camera before: ${formatPose(e.cameraBefore)}`,
        `  camera after: ${formatPose(e.cameraAfter)}`,
        `  D: ${formatPose(e.d)}`,
        `  anchorBefore: ${formatPose(e.anchorBefore)}`,
        `  D * anchorBefore: ${formatPose(e.predicted)}`,
        `  marker: ${formatPose(e.marker)}`,
        ...comparisonLines('anchor in the jump frame', e.atJump),
        ...comparisonLines(
          e.settled === null
            ? 'anchor settled (still settling)'
            : `anchor settled after ${e.settledFrames} frames`,
          e.settled
        ),
      ];
  }
}

export interface LogInput {
  readonly nowIso: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly events: readonly TrackerEvent[];
  readonly stats: FrameStats;
  readonly anchorNow: Pose | null;
  readonly markerNow: Pose | null;
}

export function buildLog(input: LogInput): string {
  const { stats, events } = input;
  const counts = verdictCounts(events);
  const jumps = events.filter((e): e is JumpEvent => e.kind === 'jump');
  const band = (c: JumpEvent['stepClass']) =>
    jumps.filter((j) => j.stepClass === c).length;
  const tol = VERDICT_TOLERANCES;
  const t = (x: { positionM: number; rotationDeg: number }) =>
    `${x.positionM} m / ${x.rotationDeg} deg`;
  const anchorToMarker =
    input.anchorNow !== null && input.markerNow !== null
      ? formatStepFine(poseStep(input.anchorNow, input.markerNow))
      : 'none';
  return [
    'WebXR anchors check',
    `time: ${input.nowIso}`,
    ...Object.entries(input.environment).map(([k, v]) => `${k}: ${v}`),
    `limits: jump logged above ${JUMP_TRANSLATION_M} m or ${JUMP_ROTATION_DEG} deg between frames; frame gap above ${FRAME_GAP_MS} ms; settled pose ${SETTLE_FRAMES} frames after the jump; bands ${BAND_LOWER_M}-${RELOCALIZATION_RULE_M} m below the ${RELOCALIZATION_RULE_M} m rule`,
    `verdict tolerances: tight ${t(tol.tight)}, main ${t(tol.main)}, loose ${t(tol.loose)}`,
    `poses: raw WebXR local space; D is motion-compensated`,
    `frames: ${stats.frames}, judged pairs ${stats.dtMs.length}, lost-tracking frames ${stats.lostFrames}`,
    distribution('frame dt ms', stats.dtMs, 1),
    distribution('camera step per frame m', stats.translationM, 4),
    distribution('camera turn per frame deg', stats.rotationDeg, 3),
    `jumps: ${counts.jumps} (frame switch ${counts['frame switch']}, drift correction ${counts['drift correction']}, unclear ${counts.unclear}; main tolerance, settled pose)`,
    `jump bands: rotation only ${band('rotation only')}, under 0.3 m ${band('under 0.3 m')}, 0.3-1 m ${band('0.3-1 m')}, at least 1 m ${band('at least 1 m')}`,
    `tracking losses: ${events.filter((e) => e.kind === 'tracking-loss').length}; frame gaps: ${events.filter((e) => e.kind === 'frame-gap').length}`,
    `anchor now: ${formatPose(input.anchorNow)}`,
    `marker now: ${formatPose(input.markerNow)}`,
    `anchor to marker now: ${anchorToMarker}`,
    '--- events',
    ...events.flatMap(eventLines),
    '--- end',
  ].join('\n');
}
