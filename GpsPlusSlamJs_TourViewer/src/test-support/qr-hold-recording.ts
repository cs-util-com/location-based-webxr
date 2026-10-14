/**
 * TEST ONLY (imported by `*.test.ts` files alone, never by the app): reads a
 * Tour Viewer VISITOR recording (`contextTag` `tour-viewing`, the
 * `tourViewing/*` log of `viewing-log.ts`) into the replay events of
 * `qr-hold-replay.ts`, with every synthetic event the phone cast set aside
 * for the regeneration check (QR-first plan 2026-10-14-0445, §7 #5).
 *
 * How each recorded action is read:
 *
 * - `qrDetected/recordQrDetection` is one LOCKED frame (the controller
 *   records a detection only on a lock): a `lock` event at the detection's
 *   time, its single-frame pose kept. The detection itself is passed on to
 *   the store too (`action`), so a replay can run the production fused pose
 *   over it.
 * - an all-synthetic `gpsData/recordGpsEventBatch` right after it is that
 *   frame's votes: the lock becomes a voted one, its pose taken from the
 *   `tourViewing/keepAlive` "armed" entry that follows (the stable pose the
 *   votes were built from), its stamp from the votes. The batch is set aside
 *   (`recordedCast`), never replayed.
 * - a batch whose first event is a device fix and the rest synthetic is a
 *   fix with its keep-alive ring: a `fix` event, the ring set aside; a plain
 *   `gpsData/recordGpsEvent` is a fix with no ring.
 * - the moved-code veto's recovery (D20: the overrides cleared, the GPS
 *   history reset, the device fixes re-fed in batches, then
 *   `tourViewing/codeIgnored` naming how many) becomes one `veto` event
 *   right AFTER the fix that triggered it - the recorder numbers an action
 *   when its dispatch returns, so the retraction, dispatched from inside
 *   that fix's store notification, is recorded before it; its actions are
 *   not replayed (the engine's sink does the same retraction).
 * - `gpsData/setAlignmentOverrides` with `null` outside a veto is an AR
 *   entry (`entry`): the sink's clear. A non-null one is the sink turning the
 *   soft trim on: set aside, the engine regenerates it.
 * - `setZeroPos` is `zero`, any other reset `reset`; every other `gpsData/*`
 *   action (the compass settings, odometry restarts) is passed on as is.
 * - the phone's own alignment, logged on `tourViewing/votesCast`, `placed`
 *   and `codeIgnored`, is kept with the event index it follows: the
 *   replay's alignment there must match it.
 *
 * A fix's ARRIVAL (the keep-alive's clock) is not recorded; it is estimated
 * as its Geolocation stamp plus `latencyMs`, clamped between the times of the
 * lock-clock events around it in the stream. During a hold every ring has
 * the full count whatever the arrival, so only a fade can depend on it.
 */

import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr/qr-pose";
import type { LatLong } from "gps-plus-slam-app-framework/core";
import type { RecordGpsEventPayload } from "gps-plus-slam-app-framework/state";

import { isSyntheticEvent, type ReplayEvent } from "./qr-hold-replay.js";

export interface RecordedAction {
  readonly type: string;
  readonly payload?: unknown;
}

/** One sighting: a run of locked frames of one code with no gap over 2 s. */
interface Sighting {
  readonly text: string;
  /** Event indices of its locked frames, in order. */
  readonly lockEvents: readonly number[];
  readonly startMs: number;
  readonly endMs: number;
  /** Whether the phone cast votes in it. */
  readonly voted: boolean;
}

export interface ParsedRecording {
  readonly events: ReplayEvent[];
  /** The synthetic events the phone cast at each event index. */
  readonly recordedCast: ReadonlyMap<number, readonly RecordGpsEventPayload[]>;
  /** The soft-trim switch the phone dispatched, and the event it followed. */
  readonly recordedOverrides: readonly {
    afterEvent: number;
    payload: unknown;
  }[];
  readonly phoneAlignments: readonly {
    readonly afterEvent: number;
    readonly type: string;
    readonly atMs: number;
    readonly matrix: readonly number[];
  }[];
  readonly sightings: readonly Sighting[];
  /** Everything the reader could not place, in plain words. */
  readonly notes: readonly string[];
  readonly zero: LatLong | null;
}

interface MutableLock {
  kind: "lock";
  text: string;
  atMs: number;
  detectionPose: Pose;
  voted?: { pose: Pose; geo: QrGeoPose; sizeM: number; stampMs: number };
}

interface MutableFix {
  kind: "fix";
  arrivalMs: number;
  payload: RecordGpsEventPayload;
}

const SIGHTING_GAP_MS = 2000;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** The actions of each veto's recovery, by the index of its `codeIgnored`:
 *  walking back over the re-fed batches, the reset and the cleared
 *  overrides (keep-alive log entries in between are skipped). */
function vetoBlocks(actions: readonly RecordedAction[]): {
  consumed: Set<number>;
  vetoAt: Map<number, string>;
  notes: string[];
} {
  const consumed = new Set<number>();
  const vetoAt = new Map<number, string>();
  const notes: string[] = [];
  actions.forEach((a, i) => {
    if (a.type !== "tourViewing/codeIgnored" || !isObj(a.payload)) return;
    const text = String(a.payload.text);
    const recovery = a.payload.recovery as { batches?: number } | undefined;
    let batches = recovery?.batches ?? 0;
    let j = i - 1;
    const block: number[] = [];
    while (j >= 0 && batches > 0) {
      const t = actions[j]!.type;
      if (t === "gpsData/recordGpsEventBatch") {
        block.push(j);
        batches -= 1;
      } else if (!t.startsWith("tourViewing/")) break;
      j -= 1;
    }
    while (j >= 0 && actions[j]!.type.startsWith("tourViewing/")) j -= 1;
    if (actions[j]?.type === "gpsData/resetGpsSessionData") {
      block.push(j);
      j -= 1;
    }
    if (
      actions[j]?.type === "gpsData/setAlignmentOverrides" &&
      actions[j]!.payload === null
    ) {
      block.push(j);
    } else {
      notes.push(
        `veto at action ${String(i)}: no cleared overrides before its reset`,
      );
    }
    if (batches > 0) {
      notes.push(
        `veto at action ${String(i)}: ${String(batches)} re-fed batches not found`,
      );
    }
    for (const k of block) consumed.add(k);
    vetoAt.set(Math.min(...block), text);
  });
  return { consumed, vetoAt, notes };
}

export function parseViewerRecording(
  actions: readonly RecordedAction[],
  options: { readonly latencyMs?: number } = {},
): ParsedRecording {
  const latencyMs = options.latencyMs ?? 0;
  const { consumed, vetoAt, notes } = vetoBlocks(actions);
  const events: ReplayEvent[] = [];
  const recordedCast = new Map<number, RecordGpsEventPayload[]>();
  const recordedOverrides: { afterEvent: number; payload: unknown }[] = [];
  const phoneAlignments: {
    afterEvent: number;
    type: string;
    atMs: number;
    matrix: number[];
  }[] = [];
  /** Lock-clock anchors (event index, time) for the arrival estimate. */
  const anchors: { at: number; ms: number }[] = [];
  let pendingLock: { index: number; lock: MutableLock } | null = null;
  let zero: LatLong | null = null;
  /** A veto read but not yet placed: the recorder numbers an action when
   *  its dispatch RETURNS, so the retraction the moved-code check dispatches
   *  from inside a fix's store notification is recorded BEFORE that fix
   *  (the post-order pitfall of lessons-learned, 2026-06-28). It belongs
   *  right after the next fix; its log entries go with it. */
  let pendingVeto: {
    text: string;
    snaps: { type: string; atMs: number; matrix: number[] }[];
    anchorsMs: number[];
  } | null = null;
  /** A device fix, its ring set aside, then a deferred veto after it. */
  const pushFix = (
    fix: MutableFix,
    ring: RecordGpsEventPayload[] | null,
  ): void => {
    events.push(fix);
    if (ring !== null) recordedCast.set(events.length - 1, ring);
    if (pendingVeto === null) return;
    events.push({ kind: "veto", text: pendingVeto.text });
    const at = events.length - 1;
    for (const snap of pendingVeto.snaps)
      phoneAlignments.push({ afterEvent: at, ...snap });
    for (const ms of pendingVeto.anchorsMs) anchors.push({ at, ms });
    pendingVeto = null;
  };

  actions.forEach((a, i) => {
    const p = a.payload;
    const vetoText = vetoAt.get(i);
    if (vetoText !== undefined) {
      pendingVeto = { text: vetoText, snaps: [], anchorsMs: [] };
      return;
    }
    if (consumed.has(i)) return;
    switch (a.type) {
      case "qrDetected/recordQrDetection": {
        if (!isObj(p)) break;
        const lock: MutableLock = {
          kind: "lock",
          text: String(p.text),
          atMs: Number(p.timestamp),
          detectionPose: p.qrPoseWorld as Pose,
        };
        // The store sees the detection (for the fused pose), then the lock.
        events.push({ kind: "action", action: a });
        events.push(lock);
        pendingLock = { index: events.length - 1, lock };
        anchors.push({ at: events.length - 1, ms: lock.atMs });
        return;
      }
      case "gpsData/recordGpsEventBatch": {
        const batch =
          (isObj(p) ? (p.events as RecordGpsEventPayload[]) : []) ?? [];
        const synthetic = batch.filter(isSyntheticEvent);
        if (batch.length > 0 && synthetic.length === batch.length) {
          if (pendingLock === null) {
            notes.push(
              `action ${String(i)}: a lock batch with no locked frame before it`,
            );
            break;
          }
          const first = batch[0]!.rawGpsPoint.timestamp;
          pendingLock.lock.voted = {
            // Filled from the "armed" entry that follows.
            pose: pendingLock.lock.detectionPose,
            geo: {
              lat: Number.NaN,
              lon: Number.NaN,
              alt: 0,
              headingDeg: Number.NaN,
            },
            sizeM: Number.NaN,
            stampMs: first,
          };
          recordedCast.set(pendingLock.index, batch);
          return;
        }
        const device = batch.filter((e) => !isSyntheticEvent(e));
        if (device.length === 1 && !isSyntheticEvent(batch[0]!)) {
          const fix: MutableFix = {
            kind: "fix",
            arrivalMs: Number.NaN,
            payload: batch[0]!,
          };
          pushFix(fix, synthetic);
          pendingLock = null;
          return;
        }
        notes.push(
          `action ${String(i)}: a batch of ${String(device.length)} device fixes and ${String(synthetic.length)} votes, not a fix with its ring: replayed as is`,
        );
        events.push({ kind: "action", action: a });
        pendingLock = null;
        return;
      }
      case "gpsData/recordGpsEvent": {
        if (!isObj(p)) break;
        const payload = p as unknown as RecordGpsEventPayload;
        if (isSyntheticEvent(payload)) {
          notes.push(
            `action ${String(i)}: a lone synthetic recordGpsEvent: replayed as is`,
          );
          events.push({ kind: "action", action: a });
        } else {
          const fix: MutableFix = {
            kind: "fix",
            arrivalMs: Number.NaN,
            payload,
          };
          pushFix(fix, null);
        }
        pendingLock = null;
        return;
      }
      case "gpsData/setAlignmentOverrides":
        if (p === null || p === undefined) {
          events.push({ kind: "entry" });
        } else {
          recordedOverrides.push({ afterEvent: events.length - 1, payload: p });
        }
        return;
      case "gpsData/setZeroPos":
        zero = p as LatLong;
        events.push({ kind: "zero", zero: p as LatLong });
        return;
      case "gpsData/resetGpsSessionData":
        events.push({ kind: "reset" });
        pendingLock = null;
        return;
      case "tourViewing/keepAlive": {
        if (!isObj(p)) break;
        if (typeof p.atMs === "number") {
          if (pendingVeto !== null) pendingVeto.anchorsMs.push(p.atMs);
          else anchors.push({ at: events.length - 1, ms: p.atMs });
        }
        if (p.event !== "armed" || !isObj(p.kept)) break;
        const kept = p.kept as {
          qrPoseWorld: Pose;
          qrGeo: QrGeoPose;
          sizeM: number;
        };
        const lock = pendingLock?.lock;
        if (lock?.voted === undefined || lock.text !== p.text) {
          notes.push(
            `action ${String(i)}: an "armed" entry with no voted lock of its code before it`,
          );
          break;
        }
        lock.voted = {
          pose: kept.qrPoseWorld,
          geo: kept.qrGeo,
          sizeM: kept.sizeM,
          stampMs: lock.voted.stampMs,
        };
        if (p.keepAliveMs !== lock.atMs) {
          notes.push(
            `action ${String(i)}: the hold restarted at ${String(p.keepAliveMs)}, the detection was at ${String(lock.atMs)}`,
          );
        }
        return;
      }
      case "tourViewing/votesCast":
      case "tourViewing/placed":
      case "tourViewing/codeIgnored": {
        if (!isObj(p)) break;
        if (pendingVeto !== null) {
          if (typeof p.atMs === "number") pendingVeto.anchorsMs.push(p.atMs);
          if (Array.isArray(p.alignmentMatrix)) {
            pendingVeto.snaps.push({
              type: a.type,
              atMs: Number(p.atMs),
              matrix: p.alignmentMatrix as number[],
            });
          }
          return;
        }
        if (typeof p.atMs === "number")
          anchors.push({ at: events.length - 1, ms: p.atMs });
        if (Array.isArray(p.alignmentMatrix)) {
          phoneAlignments.push({
            afterEvent: events.length - 1,
            type: a.type,
            atMs: Number(p.atMs),
            matrix: p.alignmentMatrix as number[],
          });
        }
        return;
      }
      default:
        if (a.type.startsWith("gpsData/")) {
          events.push({ kind: "action", action: a });
          pendingLock = null;
        }
        return;
    }
  });

  if (pendingVeto !== null) {
    events.push({ kind: "veto", text: (pendingVeto as { text: string }).text });
    notes.push("a veto with no fix after it: placed at the end");
  }

  // The sink's clear at the AR entry happens before the session's zero,
  // where the store keeps nothing and a recording may hold nothing either
  // (the 2026-10-10 one does not): an entry is implied at the start when
  // none comes before the first lock.
  const firstLock = events.findIndex((e) => e.kind === "lock");
  const firstEntry = events.findIndex((e) => e.kind === "entry");
  if (firstLock >= 0 && (firstEntry < 0 || firstEntry > firstLock)) {
    events.unshift({ kind: "entry" });
    const shift = <T>(m: Map<number, T>): Map<number, T> =>
      new Map([...m].map(([k, v]) => [k + 1, v]));
    const moved = shift(recordedCast);
    recordedCast.clear();
    for (const [k, v] of moved) recordedCast.set(k, v);
    for (const o of recordedOverrides) o.afterEvent += 1;
    for (const a of phoneAlignments) a.afterEvent += 1;
    for (const a of anchors) a.at += 1;
    notes.push("no AR entry before the first lock: one implied at the start");
  }

  // Voted locks whose "armed" entry never came keep a NaN geo: say so.
  events.forEach((e, k) => {
    if (
      e.kind === "lock" &&
      e.voted !== undefined &&
      Number.isNaN(e.voted.sizeM)
    ) {
      notes.push(`event ${String(k)}: a voted lock with no "armed" pose`);
    }
  });

  // Arrival estimate: stamp + latency, clamped by the lock-clock anchors
  // around the fix, and never before the previous fix's arrival.
  anchors.sort((x, y) => x.at - y.at);
  let lastArrival = Number.NEGATIVE_INFINITY;
  let k = 0;
  let lower = Number.NEGATIVE_INFINITY;
  events.forEach((e, idx) => {
    while (k < anchors.length && anchors[k]!.at < idx) {
      lower = Math.max(lower, anchors[k]!.ms);
      k += 1;
    }
    if (e.kind !== "fix") return;
    const upper =
      k < anchors.length ? anchors[k]!.ms : Number.POSITIVE_INFINITY;
    const guess = e.payload.rawGpsPoint.timestamp + latencyMs;
    const clamped = Math.max(lower, lastArrival, Math.min(guess, upper));
    (e as MutableFix).arrivalMs = clamped;
    lastArrival = clamped;
  });

  // Sightings.
  const sightings: Sighting[] = [];
  let open: {
    text: string;
    locks: number[];
    startMs: number;
    endMs: number;
    voted: boolean;
  } | null = null;
  events.forEach((e, idx) => {
    if (e.kind !== "lock") return;
    if (
      open === null ||
      open.text !== e.text ||
      e.atMs - open.endMs > SIGHTING_GAP_MS
    ) {
      if (open !== null) {
        sightings.push({
          text: open.text,
          lockEvents: open.locks,
          startMs: open.startMs,
          endMs: open.endMs,
          voted: open.voted,
        });
      }
      open = {
        text: e.text,
        locks: [],
        startMs: e.atMs,
        endMs: e.atMs,
        voted: false,
      };
    }
    open.locks.push(idx);
    open.endMs = e.atMs;
    if (e.voted !== undefined) open.voted = true;
  });
  if (open !== null) {
    const o = open as {
      text: string;
      locks: number[];
      startMs: number;
      endMs: number;
      voted: boolean;
    };
    sightings.push({
      text: o.text,
      lockEvents: o.locks,
      startMs: o.startMs,
      endMs: o.endMs,
      voted: o.voted,
    });
  }

  return {
    events,
    recordedCast,
    recordedOverrides,
    phoneAlignments,
    sightings,
    notes,
    zero,
  };
}
