/**
 * The travelling box's field log (behind `?debug=1`): one walk logged at
 * 10 Hz on the phone, copied as text through the page's clipboard seam,
 * and replayed offline under every knob set (`replayPlaces`), so the
 * knobs are chosen from one walk per condition instead of one walk per
 * knob value. It keeps the newest samples in a ring; a press, a release,
 * a settled place change and the walker's Mark are events at their own
 * time, since one frame long they would fall between two samples.
 *
 * A diagnostic buffer, not app state: nothing reads it but its own
 * readout, copy and replay.
 *
 * @see travelling-box-log.ts.md
 */
import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";

import type {
  TravelFrameSample,
  TravellingBoxCost,
  TravelPlaceEvent,
} from "./travelling-box.js";
import {
  letterGate,
  settlePlace,
  signGrowth,
  TRAVEL_PLATE,
  wantPlace,
  type SettleState,
  type TravelHideWhy,
  type TravellingBoxKnobs,
  type TravelPlace,
  type TravelWhy,
} from "./travelling-box-rules.js";

/** One sample each this many ms (10 Hz). */
export const TRAVEL_LOG_PERIOD_MS = 100;
/** Samples kept by default: ten minutes at 10 Hz. */
const SAMPLES_MAX = 6000;
/** Events kept by default. */
const EVENTS_MAX = 2000;
/** The distance from which the sign grows (`signGrowth`'s `from`). */
const GROWTH_FROM_M = 4.5;
/** A gap between samples longer than this (ms), or another surface, is a
 *  new travel: the replay starts it hidden, as the app does. */
const NEW_TRAVEL_MS = 1000;
/** A replayed time step is at most this (s): a missed frame is not a
 *  pause. */
const MAX_REPLAY_STEP_S = (2 * TRAVEL_LOG_PERIOD_MS) / 1000;
/** A plate-dock change this soon after a release (s) counts as one. */
const AFTER_RELEASE_S = 1;

/** One logged sample, as written (numbers rounded). */
export interface TravelLogSample {
  readonly kind: "s";
  readonly t: number;
  readonly surface: string;
  readonly travelling: boolean;
  readonly hideWhy: TravelHideWhy | null;
  readonly slotFree: boolean;
  readonly canFold: boolean;
  readonly finger: boolean;
  readonly place: TravelPlace;
  readonly want: TravelPlace;
  readonly why: TravelWhy;
  readonly valid: boolean;
  readonly onScreen: boolean;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly letterPxH: number;
  readonly letterPxW: number;
  readonly linePx: number;
  readonly angleDeg: number;
  /** The eye's distance from the plate along the ground (m). */
  readonly distM: number;
  /** Screen px per metre at 1 m: the phone's lens, `proj[5] x height / 2`. */
  readonly pxPerM: number;
  /** The sign's growth at `distM` (`signGrowth`), as the app applied it. */
  readonly growth: number;
}

export type TravelLogEvent =
  | {
      readonly kind: "place";
      readonly t: number;
      readonly surface: string;
      readonly place: TravelPlace;
      readonly why: TravelWhy;
    }
  | {
      readonly kind: "press" | "release";
      readonly t: number;
      readonly surface: string;
    }
  | { readonly kind: "mark"; readonly t: number };

export interface TravelLogOptions {
  /** The knobs the walk ran with, written in the copy's head. */
  readonly knobs: TravellingBoxKnobs;
  /** Samples kept (default ten minutes). */
  readonly capacity?: number;
  /** Events kept (default 2000). */
  readonly eventCapacity?: number;
}

export interface TravelLog {
  /** One frame of the controller (`TravellingBoxDeps.onFrame`). */
  frame(sample: TravelFrameSample): void;
  /** A settled change of place (`TravellingBoxDeps.onPlace`). */
  place(event: TravelPlaceEvent): void;
  /** The walker's "reading got hard here", at page time `at` (ms). */
  mark(at: number): void;
  samples(): readonly TravelLogSample[];
  events(): readonly TravelLogEvent[];
  size(): {
    readonly samples: number;
    readonly events: number;
    readonly marks: number;
    readonly dropped: number;
  };
  /** The whole log as JSON lines: a head, then every entry by time. */
  text(): string;
  /** The `?debug=1` readout's lines (none before the first frame). */
  readout(cost: TravellingBoxCost | null): string[];
}

/** A ring of at most `max` entries, oldest first. */
function ring<T>(max: number) {
  const items: T[] = [];
  let start = 0;
  let dropped = 0;
  return {
    push(item: T): void {
      if (items.length < max) {
        items.push(item);
        return;
      }
      items[start] = item;
      start = (start + 1) % max;
      dropped += 1;
    },
    list: (): T[] => [...items.slice(start), ...items.slice(0, start)],
    length: () => items.length,
    dropped: () => dropped,
  };
}

const round = (v: number, digits: number): number => {
  if (!Number.isFinite(v)) return 0;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** A positive whole capacity, else `fallback`. */
const capacityOf = (n: number | undefined, fallback: number): number =>
  n !== undefined && Number.isInteger(n) && n > 0 ? n : fallback;

export function createTravelLog(options: TravelLogOptions): TravelLog {
  const knobs = options.knobs;
  const samples = ring<TravelLogSample>(
    capacityOf(options.capacity, SAMPLES_MAX),
  );
  const events = ring<TravelLogEvent>(
    capacityOf(options.eventCapacity, EVENTS_MAX),
  );
  let due: number | null = null;
  let finger = false;
  let marks = 0;
  let last: TravelLogSample | null = null;

  const toSample = (s: TravelFrameSample): TravelLogSample => ({
    kind: "s",
    t: round(s.at, 0),
    surface: s.surface,
    travelling: s.travelling,
    hideWhy: s.hideWhy,
    slotFree: s.slotFree,
    canFold: s.canFold,
    finger: s.finger,
    place: s.place,
    want: s.want,
    why: s.wantWhy,
    valid: s.metrics.valid,
    onScreen: s.metrics.onScreen,
    ndcX: round(s.metrics.ndcX, 3),
    ndcY: round(s.metrics.ndcY, 3),
    letterPxH: round(s.metrics.letterPxH, 2),
    letterPxW: round(s.metrics.letterPxW, 2),
    linePx: round(s.metrics.linePx, 2),
    angleDeg: round(s.angleDeg, 1),
    distM: round(s.distM, 2),
    pxPerM: round(s.pxPerM, 1),
    growth: round(signGrowth(s.distM, GROWTH_FROM_M), 3),
  });

  return {
    frame(s) {
      if (!Number.isFinite(s.at)) return;
      if (s.finger !== finger) {
        finger = s.finger;
        events.push({
          kind: finger ? "press" : "release",
          t: round(s.at, 0),
          surface: s.surface,
        });
      }
      if (due !== null && s.at < due) return;
      due = (due ?? s.at) + TRAVEL_LOG_PERIOD_MS;
      // A pause (the travel ended, the page hid) restarts the beat.
      if (due <= s.at) due = s.at + TRAVEL_LOG_PERIOD_MS;
      last = toSample(s);
      samples.push(last);
    },
    place(e) {
      if (!Number.isFinite(e.at)) return;
      events.push({
        kind: "place",
        t: round(e.at, 0),
        surface: e.surface,
        place: e.place,
        why: e.why,
      });
    },
    mark(at) {
      if (!Number.isFinite(at)) return;
      marks += 1;
      events.push({ kind: "mark", t: round(at, 0) });
    },
    samples: () => samples.list(),
    events: () => events.list(),
    size: () => ({
      samples: samples.length(),
      events: events.length(),
      marks,
      dropped: samples.dropped(),
    }),
    text() {
      const head = {
        kind: "head",
        v: 1,
        knobs,
        periodMs: TRAVEL_LOG_PERIOD_MS,
        dropped: samples.dropped(),
        droppedEvents: events.dropped(),
      };
      const all: (TravelLogSample | TravelLogEvent)[] = [
        ...samples.list(),
        ...events.list(),
      ].sort((a, b) => a.t - b.t);
      return [head, ...all].map((e) => JSON.stringify(e)).join("\n");
    },
    readout(cost) {
      if (last === null) return [];
      const s = last;
      const plateau = (TRAVEL_PLATE.emM / GROWTH_FROM_M) * s.pxPerM;
      const lines = [
        `travel ${s.surface}: ${s.place} (${s.why}), em ${s.letterPxH.toFixed(1)} h ${s.letterPxW.toFixed(1)} w px, ${s.distM.toFixed(1)} m, ${s.angleDeg.toFixed(0)} deg, ${s.pxPerM.toFixed(0)} px/m, plateau ${plateau.toFixed(1)} px`,
      ];
      const size = `log ${String(samples.length())} samples, ${String(events.length())} events, ${String(marks)} ${marks === 1 ? "mark" : "marks"}${samples.dropped() > 0 ? `, ${String(samples.dropped())} dropped` : ""}`;
      lines.push(
        cost === null
          ? size
          : `${size}; frames ${String(cost.over50)}/${String(cost.frames)} over 50 ms, work ${cost.workAvgMs.toFixed(2)} ms avg ${cost.workMaxMs.toFixed(1)} max, paints ${String(cost.paints)} at ${cost.paintAvgMs.toFixed(1)} ms`,
      );
      return lines;
    },
  };
}

/** What `parseTravelLog` read back. */
export interface TravelLogRead {
  readonly knobs: TravellingBoxKnobs | null;
  readonly samples: TravelLogSample[];
  readonly events: TravelLogEvent[];
  /** Lines that did not read (a damaged paste). */
  readonly skipped: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A copied log read back; a line that does not read is skipped and
 *  counted, never thrown on. */
export function parseTravelLog(text: string): TravelLogRead {
  let knobs: TravellingBoxKnobs | null = null;
  const samples: TravelLogSample[] = [];
  const events: TravelLogEvent[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isRecord(value)) {
      skipped += 1;
      continue;
    }
    if (value["kind"] === "head") {
      knobs = isRecord(value["knobs"])
        ? (value["knobs"] as unknown as TravellingBoxKnobs)
        : null;
      continue;
    }
    if (typeof value["t"] !== "number" || !Number.isFinite(value["t"])) {
      skipped += 1;
      continue;
    }
    const kind = value["kind"];
    if (kind === "s" && typeof value["letterPxH"] === "number") {
      samples.push(value as unknown as TravelLogSample);
    } else if (
      kind === "place" ||
      kind === "press" ||
      kind === "release" ||
      kind === "mark"
    ) {
      events.push(value as unknown as TravelLogEvent);
    } else {
      skipped += 1;
    }
  }
  return { knobs, samples, events, skipped };
}

/** A settled change in a replay. */
interface ReplayChange {
  readonly t: number;
  readonly surface: string;
  readonly place: TravelPlace;
  readonly why: TravelWhy;
}

export interface ReplayResult {
  readonly changes: ReplayChange[];
  readonly count: number;
  /** Travelling time replayed (min). */
  readonly minutes: number;
  readonly perMinute: number;
  /** Plate-dock changes within 1 s after a release. */
  readonly afterRelease: number;
}

/**
 * The places a logged walk would have taken under `knobs`, by the app's
 * own rules (`wantPlace`, `settlePlace`, the words' `letterGate`): the
 * threshold and the metric read the logged letter sizes; with `grow`
 * off the logged growth is taken back out of them; the lock counts from
 * each logged release. At 10 Hz a hold resolves to the next sample (0.1
 * s), so a replayed change can land up to one sample later than on the
 * phone.
 */
export function replayPlaces(
  log: {
    readonly samples: readonly TravelLogSample[];
    readonly events: readonly TravelLogEvent[];
  },
  knobs: TravellingBoxKnobs,
): ReplayResult {
  const releases = log.events
    .filter((e) => e.kind === "release")
    .map((e) => e.t)
    .sort((a, b) => a - b);
  const changes: ReplayChange[] = [];
  let settle: SettleState = { place: "hidden", pending: null, pendingS: 0 };
  let prev: TravelLogSample | null = null;
  let releaseIx = 0;
  let releasedAt: number | null = null;
  let afterRelease = 0;
  let travellingMs = 0;
  for (const s of log.samples) {
    const fresh =
      prev === null ||
      s.surface !== prev.surface ||
      s.t - prev.t > NEW_TRAVEL_MS;
    if (fresh) settle = { place: "hidden", pending: null, pendingS: 0 };
    const gapMs = prev === null || fresh ? 0 : s.t - prev.t;
    if (s.travelling) travellingMs += gapMs;
    prev = s;
    while (releaseIx < releases.length && releases[releaseIx]! <= s.t) {
      releasedAt = releases[releaseIx]!;
      releaseIx += 1;
    }
    const shrink = knobs.grow || !(s.growth > 0) ? 1 : 1 / s.growth;
    const h = s.letterPxH * shrink;
    const w = s.letterPxW * shrink;
    const metrics = {
      valid: s.valid,
      onScreen: s.onScreen,
      ndcX: s.ndcX,
      ndcY: s.ndcY,
      letterPxH: h,
      letterPxW: w,
      letterPx: Math.min(h, w),
      linePx: s.linePx * shrink,
    };
    const wanted = wantPlace(
      {
        travelling: s.travelling,
        hideWhy: s.hideWhy,
        gates: [letterGate(metrics, knobs)],
        metrics,
        angleDeg: s.angleDeg,
        onPlate: settle.place === "plate",
        slotFree: s.slotFree,
        canFold: s.canFold,
      },
      knobs,
    );
    const before = settle.place;
    settle = settlePlace(
      settle,
      wanted.place,
      Math.min(MAX_REPLAY_STEP_S, gapMs / 1000),
      {
        fingerDown: s.finger,
        sinceReleaseS:
          releasedAt === null ? Infinity : (s.t - releasedAt) / 1000,
      },
      knobs,
    );
    if (settle.place === before) continue;
    changes.push({
      t: s.t,
      surface: s.surface,
      place: settle.place,
      why: wanted.why,
    });
    const between =
      (before === "plate" && settle.place === "dock") ||
      (before === "dock" && settle.place === "plate");
    if (
      between &&
      releasedAt !== null &&
      (s.t - releasedAt) / 1000 <= AFTER_RELEASE_S
    ) {
      afterRelease += 1;
    }
  }
  const minutes = travellingMs / 60_000;
  return {
    changes,
    count: changes.length,
    minutes,
    perMinute: minutes > 0 ? changes.length / minutes : 0,
    afterRelease,
  };
}

/** A button as the log's controls drive it (a DOM button, or a plain
 *  object in a test). */
interface LogButton {
  disabled: boolean;
  textContent: string | null;
  addEventListener(type: "click", listener: () => void): void;
}

/**
 * The debug readout's two buttons: Copy log (through the page's clipboard
 * seam, async: busy, then how it went) and Mark (a mark at the tap's
 * time, its label counting them).
 */
export function wireTravelLogButtons(deps: {
  readonly copy: LogButton;
  readonly mark: LogButton;
  readonly log: TravelLog;
  readonly write: ((text: string) => Promise<void>) | undefined;
  readonly now: () => number;
}): void {
  deps.copy.addEventListener("click", () => {
    if (deps.copy.disabled) return;
    void copyWithFeedback(deps.copy, deps.log.text(), deps.write, {
      busy: "Copying...",
      done: "Log copied",
      failed: "Copy failed",
    });
  });
  deps.mark.addEventListener("click", () => {
    deps.log.mark(deps.now());
    deps.mark.textContent = `Mark (${String(deps.log.size().marks)})`;
  });
}
