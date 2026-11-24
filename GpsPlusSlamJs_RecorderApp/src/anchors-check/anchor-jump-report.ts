/**
 * Text of the WebXR anchors check: the one-line on-screen entries, the
 * counts line and the full log the "Copy log" button copies. Pure
 * functions over the tracker's events and statistics.
 *
 * Sidecar: `anchor-jump-report.ts.md`.
 */

import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  BAND_LOWER_M,
  FRAME_GAP_MS,
  JUMP_ROTATION_DEG,
  JUMP_TRANSLATION_M,
  MAX_EXTRAPOLATION_RATIO,
  RELOCALIZATION_RULE_M,
  SETTLE_DELAYS_MS,
  STILL_SPEED_M_PER_S,
  STILL_TURN_DEG_PER_S,
  VERDICT_TOLERANCES,
  isStill,
  poseStep,
  stepRate,
  type AnchorReading,
  type EpisodeEvent,
  type EpisodeKind,
  type FrameStats,
  type NotCounted,
  type PoseStep,
  type TimedPose,
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

function isEpisode(e: TrackerEvent): e is EpisodeEvent {
  return (
    e.kind === 'jump' || e.kind === 'tracking-loss' || e.kind === 'frame-gap'
  );
}

/** The main verdict of the latest reading; `null`: no anchor to judge. */
function latestVerdict(e: EpisodeEvent): Verdict | null {
  return e.readings.at(-1)?.comparison?.verdicts.main ?? null;
}

const SHORT: Record<Verdict, string> = {
  'frame switch': 'switch',
  'drift correction': 'drift',
  unclear: 'unclear',
};

function shortReading(r: AnchorReading): string {
  const v = r.comparison?.verdicts.main;
  return `${r.delayMs} ms ${v === undefined ? 'none' : SHORT[v]}`;
}

function episodeTitle(e: EpisodeEvent): string {
  switch (e.kind) {
    case 'jump':
      return `Jump ${e.index}`;
    case 'tracking-loss':
      return `Tracking loss ${e.index} (${(e.dtMs / 1000).toFixed(1)} s)`;
    case 'frame-gap':
      return `Frame gap ${e.index} (${Math.round(e.dtMs)} ms)`;
  }
}

/**
 * Why a closed, full episode is left out of the counts; `null`: counted.
 * No anchor to judge at the last reading (none placed, or not tracked)
 * says nothing about anchors.
 */
function exclusion(e: EpisodeEvent): NotCounted | 'no anchor' | null {
  return e.notCounted ?? (latestVerdict(e) === null ? 'no anchor' : null);
}

function episodeLabel(e: EpisodeEvent): string {
  const v = latestVerdict(e) ?? 'no anchor';
  const lastDelay = e.readings.at(-1)?.delayMs ?? 0;
  if (e.pending) return `settling, ${v} so far`;
  if (e.truncated) return `truncated, not counted (${v} at ${lastDelay} ms)`;
  const why = exclusion(e);
  if (why === 'no anchor') return 'no anchor, not counted';
  return why === null ? v : `${why}, not counted (${v})`;
}

/** The step to show: what the compensation left, or the raw step. */
function shownStep(e: EpisodeEvent): string {
  return e.compensated
    ? `unexplained ${formatStep(e.unexplainedStep)}`
    : `raw step ${formatStep(e.cameraStep)}`;
}

export function onScreenLine(e: TrackerEvent): string {
  switch (e.kind) {
    case 'jump':
    case 'tracking-loss':
    case 'frame-gap':
      return `${episodeTitle(e)}: ${episodeLabel(e)} (${e.readings.map(shortReading).join(', ')}); ${shownStep(e)}, ${e.stepClass}`;
    case 'placed':
      return 'Anchor and marker placed';
    case 'anchor-failed':
      return `Could not create the anchor: ${e.message}`;
    case 'frame-error':
      return `A frame failed: ${e.message}`;
    case 'session-start':
      return 'AR session started';
    case 'session-end':
      return 'AR session ended';
  }
}

export interface VerdictCounts {
  /** Counted episodes: reached the last delay, nothing excluded them. */
  readonly judged: number;
  readonly 'frame switch': number;
  readonly 'drift correction': number;
  readonly unclear: number;
  /** Not counted, by reason. */
  readonly moving: number;
  readonly 'long frame': number;
  readonly 'no anchor': number;
  readonly truncated: number;
  readonly settling: number;
}

const NOT_COUNTED = ['moving', 'long frame', 'no anchor', 'truncated'] as const;

/** Episodes of `kind` by their final main-tolerance verdict or exclusion. */
export function verdictCounts(
  events: readonly TrackerEvent[],
  kind: EpisodeKind
): VerdictCounts {
  const counts = {
    judged: 0,
    'frame switch': 0,
    'drift correction': 0,
    unclear: 0,
    moving: 0,
    'long frame': 0,
    'no anchor': 0,
    truncated: 0,
    settling: 0,
  };
  for (const e of events) {
    if (!isEpisode(e) || e.kind !== kind) continue;
    const why = e.pending
      ? 'settling'
      : e.truncated
        ? 'truncated'
        : exclusion(e);
    if (why !== null) counts[why]++;
    else {
      counts.judged++;
      counts[latestVerdict(e)!]++;
    }
  }
  return counts;
}

function countsPart(c: VerdictCounts, one: string, many: string): string {
  return `${c.judged} ${c.judged === 1 ? one : many} (frame switch ${c['frame switch']}, drift correction ${c['drift correction']}, unclear ${c.unclear})`;
}

function notCountedPart(of: (k: (typeof NOT_COUNTED)[number]) => number) {
  return NOT_COUNTED.map((k) => `${k} ${of(k)}`).join(', ');
}

/**
 * The on-screen counts: the walk stops at two or more judged. The jumps
 * and losses left out are named by reason.
 */
export function countsLine(events: readonly TrackerEvent[]): string {
  const jumps = verdictCounts(events, 'jump');
  const losses = verdictCounts(events, 'tracking-loss');
  const both = (k: (typeof NOT_COUNTED)[number]) => jumps[k] + losses[k];
  const left = NOT_COUNTED.reduce((n, k) => n + both(k), 0);
  if (jumps.judged + losses.judged + left === 0) return 'Nothing judged yet.';
  return `Judged: ${countsPart(jumps, 'jump', 'jumps')}; ${countsPart(losses, 'tracking loss', 'tracking losses')}. Not counted: ${notCountedPart(both)}.`;
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

function trackedText(tracked: boolean | null): string {
  return tracked === null ? 'unknown' : tracked ? 'yes' : 'no';
}

const at = (t: number) => `[t ${Math.round(t)} ms]`;

function timed(p: TimedPose | null): string {
  return p === null
    ? 'none (no rate: D uncompensated)'
    : `${at(p.t)} ${formatPose(p.pose)}`;
}

function readingLines(r: AnchorReading): string[] {
  const head = `  anchor at ${r.delayMs} ms (read at ${Math.round(r.atMs)} ms, tracked ${trackedText(r.tracked)}): ${formatPose(r.anchor)}`;
  const c = r.comparison;
  if (c === null) return [head, '    not judged'];
  const v = c.verdicts;
  return [
    head,
    `    to D * anchorBefore ${formatStepFine(c.toPredicted)}; to anchorBefore ${formatStepFine(c.toBefore)}`,
    `    verdict tight ${v.tight}, main ${v.main}, loose ${v.loose}`,
  ];
}

/**
 * The camera step per frame before the episode with its rate, and the
 * extrapolation ratio.
 */
function preStepLine(e: EpisodeEvent): string {
  const pre = stepRate(e.cameraPrev, e.cameraBefore);
  if (pre === null) return '  pre-step per frame none (motion unknown)';
  const ratio = e.dtMs / pre.dtMs;
  return `  pre-step per frame ${formatStepFine(pre.step)} in ${Math.round(pre.dtMs)} ms, ${pre.speedMPerS.toFixed(2)} m/s / ${pre.turnDegPerS.toFixed(1)} deg/s (${isStill(pre) ? 'still' : 'moving'})${e.compensated ? `; extrapolation ratio ${ratio.toFixed(2)}` : ''}`;
}

function episodeLines(e: EpisodeEvent): string[] {
  const why = exclusion(e);
  const state = e.pending
    ? ', still settling'
    : e.truncated
      ? ', truncated'
      : why === null
        ? ''
        : `, not counted: ${why}`;
  const step = e.compensated
    ? `unexplained ${formatStepFine(e.unexplainedStep)}`
    : 'raw step, D uncompensated';
  return [
    `${at(e.t)} ${e.kind} ${e.index}: dt ${Math.round(e.dtMs)} ms, camera step ${formatStepFine(e.cameraStep)}, ${step} (${e.stepClass})${state}`,
    preStepLine(e),
    `  camera prev: ${timed(e.cameraPrev)}`,
    `  camera before: ${timed(e.cameraBefore)}`,
    `  camera after: ${formatPose(e.cameraAfter)}`,
    `  D: ${formatPose(e.d)}`,
    `  anchorBefore (tracked ${trackedText(e.anchorBeforeTracked)}): ${formatPose(e.anchorBefore)}`,
    `  D * anchorBefore: ${formatPose(e.predicted)}`,
    `  marker: ${formatPose(e.marker)}`,
    ...e.readings.flatMap(readingLines),
  ];
}

function eventLines(e: TrackerEvent): string[] {
  switch (e.kind) {
    case 'jump':
    case 'tracking-loss':
    case 'frame-gap':
      return episodeLines(e);
    case 'placed':
      return [`${at(e.t)} placed anchor and marker at ${formatPose(e.pose)}`];
    case 'anchor-failed':
      return [`${at(e.t)} could not create the anchor: ${e.message}`];
    case 'frame-error':
      return [`${at(e.t)} a frame failed: ${e.message}`];
    case 'session-start':
      return [`${at(e.t)} session start`];
    case 'session-end':
      return [`${at(e.t)} session end`];
  }
}

function countsLogLine(name: string, c: VerdictCounts): string {
  return `${name} judged ${c.judged} (frame switch ${c['frame switch']}, drift correction ${c['drift correction']}, unclear ${c.unclear}); not counted: ${notCountedPart((k) => c[k])}; settling ${c.settling}`;
}

export interface LogInput {
  readonly nowIso: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly events: readonly TrackerEvent[];
  readonly stats: FrameStats;
  readonly anchorNow: Pose | null;
  readonly anchorNowTracked: boolean | null;
  readonly markerNow: Pose | null;
}

export function buildLog(input: LogInput): string {
  const { stats, events } = input;
  const jumps = events.filter(
    (e): e is EpisodeEvent =>
      e.kind === 'jump' && !e.pending && !e.truncated && exclusion(e) === null
  );
  const band = (c: EpisodeEvent['stepClass']) =>
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
    `limits: jump logged when the step left after the motion compensation is above ${JUMP_TRANSLATION_M} m or ${JUMP_ROTATION_DEG} deg; frame gap above ${FRAME_GAP_MS} ms; bands ${BAND_LOWER_M}-${RELOCALIZATION_RULE_M} m below the ${RELOCALIZATION_RULE_M} m rule`,
    `settling: anchor read at ${[0, ...SETTLE_DELAYS_MS].join(', ')} ms after each jump, loss and gap; the ${SETTLE_DELAYS_MS.at(-1)} ms reading is the counted verdict; an episode cut short by the next one is truncated and not counted`,
    `counted: a loss, a gap or a jump with no rate only when the camera moved at most ${STILL_SPEED_M_PER_S} m/s and ${STILL_TURN_DEG_PER_S} deg/s just before it; a jump only when its frame is at most ${MAX_EXTRAPOLATION_RATIO} times the one before; an episode with no anchor tracked at its last reading is not counted`,
    `verdict tolerances: tight ${t(tol.tight)}, main ${t(tol.main)}, loose ${t(tol.loose)}`,
    'poses: raw WebXR local space; D is motion-compensated for a jump on a frame with a rate (camera prev is the rate frame), else it is the raw step (camera prev then only shows whether the camera was still); an anchor that trackedAnchors does not hold is logged but not judged',
    `frames: ${stats.frames}, judged pairs ${stats.dtMs.length}, lost-tracking frames ${stats.lostFrames}`,
    distribution('frame dt ms', stats.dtMs, 1),
    distribution('camera step per frame m', stats.translationM, 4),
    distribution('camera turn per frame deg', stats.rotationDeg, 3),
    distribution('unexplained step per frame m', stats.unexplainedM, 4),
    distribution('unexplained turn per frame deg', stats.unexplainedDeg, 3),
    countsLogLine('jumps', verdictCounts(events, 'jump')),
    countsLogLine('tracking losses', verdictCounts(events, 'tracking-loss')),
    countsLogLine('frame gaps', verdictCounts(events, 'frame-gap')),
    `judged jump bands: rotation only ${band('rotation only')}, under 0.3 m ${band('under 0.3 m')}, 0.3-1 m ${band('0.3-1 m')}, at least 1 m ${band('at least 1 m')}`,
    `anchor now (tracked ${trackedText(input.anchorNowTracked)}): ${formatPose(input.anchorNow)}`,
    `marker now: ${formatPose(input.markerNow)}`,
    `anchor to marker now: ${anchorToMarker}`,
    '--- events',
    ...events.flatMap(eventLines),
    '--- end',
  ].join('\n');
}
