/**
 * The travelling box's field log (behind `?debug=1`): one walk logged on
 * the phone, copied (or downloaded) as compact text, and replayed offline
 * under every knob set (`replayPlaces`), so the knobs are chosen from one
 * walk per condition instead of one walk per knob value. It keeps a
 * sample 10 times a second and on every frame where the want, the place,
 * the finger or the travel changes, each with the time step the app's
 * settling counted since the sample before: under the knobs it ran with,
 * the replay then meets every settled change of the app at the same
 * sample (`replaySelfCheck`). A press, a release, a settled change and the
 * walker's Mark are events at their own time.
 *
 * A diagnostic buffer, not app state: nothing reads it but its own
 * readout, copy and replay.
 *
 * @see travelling-box-log.ts.md
 */
import { isJsonObject as isRecord } from "gps-plus-slam-app-framework/utils/json-guards";
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

/** One sample at least each this many ms (10 Hz). */
export const TRAVEL_LOG_PERIOD_MS = 100;
/** Samples kept by default: ten minutes at 10 Hz. */
const SAMPLES_MAX = 6000;
/** Events kept by default. */
const EVENTS_MAX = 2000;
/** The distance from which the sign grows (`signGrowth`'s `from`). */
const GROWTH_FROM_M = 4.5;
/** A gap between frames longer than this (ms) is a new travel. */
const NEW_TRAVEL_MS = 1000;
/** A plate-dock change sooner than this after a release (s) counts. */
const AFTER_RELEASE_S = 1;
/** The text format's version, in the head line. */
const FORMAT_VERSION = 2;

const PLACES: readonly TravelPlace[] = ["plate", "dock", "fold", "hidden"];
const WHYS: readonly TravelWhy[] = [
  "not travelling",
  "no voice",
  "outside the station",
  "sheet open",
  "out of view",
  "turned away",
  "too small",
  "slot taken",
  "readable",
];

/** One logged sample, as stored (numbers rounded). */
export interface TravelLogSample {
  readonly t: number;
  /** The app's settling time since the sample before (s, 0.1 ms). */
  readonly dt: number;
  /** The controller's first frame: the replay starts the travel hidden. */
  readonly first: boolean;
  readonly surface: string;
  /** Screen px per metre at 1 m: the phone's lens, `proj[5] x height / 2`. */
  readonly pxPerM: number;
  readonly travelling: boolean;
  /** Null whenever the surface does not travel (`wantPlace` reads it
   *  only while it does). */
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
  /** `signGrowth(distM)`: approximately the growth the app applied (the
   *  sign grows by its root's distance, a little off the plate's). */
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
  /** Samples kept (default ten minutes at 10 Hz). */
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
  /** The whole log as compact JSON lines (see the sidecar). */
  text(): string;
  /** Empties the log after it was copied or downloaded, so the next
   *  copy holds the next run alone; the readout says so. */
  clear(after: "copy" | "download"): void;
  /** The `?debug=1` readout's lines (none before the first frame). */
  readout(cost: TravellingBoxCost | null): string[];
}

/** A ring of at most `max` entries, oldest first. */
function ring<T>(max: number) {
  let items: T[] = [];
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
    clear(): void {
      items = [];
      start = 0;
      dropped = 0;
    },
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

/** The flags of a sample line, one bit each. */
const FLAG_BITS = [
  "first",
  "travelling",
  "slotFree",
  "canFold",
  "finger",
  "valid",
  "onScreen",
] as const;

export function createTravelLog(options: TravelLogOptions): TravelLog {
  const knobs = options.knobs;
  const samples = ring<TravelLogSample>(
    capacityOf(options.capacity, SAMPLES_MAX),
  );
  const events = ring<TravelLogEvent>(
    capacityOf(options.eventCapacity, EVENTS_MAX),
  );
  let due: number | null = null;
  let acc = 0;
  let marks = 0;
  let last: TravelLogSample | null = null;
  let cleared: string | null = null;
  /** The frame before, for the changes that force a sample. */
  let prev: TravelFrameSample | null = null;

  const toSample = (s: TravelFrameSample, dt: number): TravelLogSample => {
    const distM = round(s.distM, 2);
    return {
      t: Math.round(s.at),
      dt: round(dt, 4),
      first: s.first,
      surface: s.surface,
      pxPerM: round(s.pxPerM, 1),
      travelling: s.travelling,
      hideWhy: s.travelling ? s.hideWhy : null,
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
      letterPxH: round(s.metrics.letterPxH, 3),
      letterPxW: round(s.metrics.letterPxW, 3),
      linePx: round(s.metrics.linePx, 1),
      angleDeg: round(s.angleDeg, 1),
      distM,
      growth: signGrowth(distM, GROWTH_FROM_M),
    };
  };

  return {
    frame(s) {
      if (!Number.isFinite(s.at)) return;
      const fresh =
        s.first ||
        prev === null ||
        prev.surface !== s.surface ||
        s.at - prev.at > NEW_TRAVEL_MS;
      // A new travel starts with no finger: the one before ended its press.
      const fingerBefore = fresh || prev === null ? false : prev.finger;
      if (s.finger !== fingerBefore) {
        events.push({
          kind: s.finger ? "press" : "release",
          t: Math.round(s.at),
          surface: s.surface,
        });
      }
      acc = fresh ? 0 : acc + (Number.isFinite(s.dtS) ? s.dtS : 0);
      const changed =
        fresh ||
        prev === null ||
        prev.want !== s.want ||
        prev.place !== s.place ||
        prev.finger !== s.finger;
      prev = s;
      if (!changed && due !== null && s.at < due) return;
      due = (due ?? s.at) + TRAVEL_LOG_PERIOD_MS;
      // A pause, or a forced sample, restarts the beat.
      if (due <= s.at || changed) due = s.at + TRAVEL_LOG_PERIOD_MS;
      last = toSample(s, acc);
      acc = 0;
      cleared = null;
      samples.push(last);
    },
    place(e) {
      if (!Number.isFinite(e.at)) return;
      events.push({
        kind: "place",
        t: Math.round(e.at),
        surface: e.surface,
        place: e.place,
        why: e.why,
      });
    },
    mark(at) {
      if (!Number.isFinite(at)) return;
      marks += 1;
      events.push({ kind: "mark", t: Math.round(at) });
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
      return writeText(knobs, samples.list(), events.list(), {
        dropped: samples.dropped(),
        droppedEvents: events.dropped(),
      });
    },
    clear(after) {
      const n = samples.length();
      samples.clear();
      events.clear();
      marks = 0;
      last = null;
      cleared = `log cleared after the ${after} (${String(n)} samples)`;
    },
    readout(cost) {
      if (last === null) return cleared === null ? [] : [cleared];
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

/** The compact text: a head object, then one array per line, by time. */
function writeText(
  knobs: TravellingBoxKnobs,
  samples: readonly TravelLogSample[],
  events: readonly TravelLogEvent[],
  counts: { readonly dropped: number; readonly droppedEvents: number },
): string {
  const lines = [
    JSON.stringify({
      kind: "head",
      v: FORMAT_VERSION,
      knobs,
      periodMs: TRAVEL_LOG_PERIOD_MS,
      ...counts,
    }),
  ];
  const all = [
    ...samples.map((s) => ({ t: s.t, s, e: null })),
    ...events.map((e) => ({ t: e.t, s: null, e })),
  ].sort((a, b) => a.t - b.t);
  let context = "";
  for (const { s, e } of all) {
    if (s !== null) {
      const key = `${s.surface}|${String(s.pxPerM)}`;
      if (key !== context) {
        lines.push(JSON.stringify(["S", s.surface, s.pxPerM]));
        context = key;
      }
      lines.push(JSON.stringify(sampleRow(s)));
    } else if (e !== null) {
      lines.push(JSON.stringify(eventRow(e)));
    }
  }
  return lines.join("\n");
}

function sampleRow(s: TravelLogSample): number[] {
  let flags = 0;
  FLAG_BITS.forEach((name, bit) => {
    if (s[name]) flags |= 1 << bit;
  });
  const state =
    PLACES.indexOf(s.place) +
    4 * PLACES.indexOf(s.want) +
    16 * WHYS.indexOf(s.why);
  return [
    s.t,
    Math.round(s.dt * 1e4),
    Math.round(s.letterPxH * 1e3),
    Math.round(s.letterPxW * 1e3),
    Math.round(s.linePx * 10),
    Math.round(s.ndcX * 1e3),
    Math.round(s.ndcY * 1e3),
    Math.round(s.angleDeg * 10),
    Math.round(s.distM * 100),
    flags,
    state,
  ];
}

function eventRow(e: TravelLogEvent): (string | number)[] {
  switch (e.kind) {
    case "place":
      return [
        "p",
        e.t,
        e.surface,
        PLACES.indexOf(e.place),
        WHYS.indexOf(e.why),
      ];
    case "press":
      return ["d", e.t, e.surface];
    case "release":
      return ["u", e.t, e.surface];
    case "mark":
      return ["m", e.t];
  }
}

/** What `parseTravelLog` read back. */
export interface TravelLogRead {
  readonly knobs: TravellingBoxKnobs | null;
  readonly samples: TravelLogSample[];
  readonly events: TravelLogEvent[];
  /** Lines that did not read (a damaged paste). */
  readonly skipped: number;
}

const allFinite = (row: readonly unknown[]): row is readonly number[] =>
  row.every((v) => typeof v === "number" && Number.isFinite(v));

function readSample(
  row: readonly unknown[],
  surface: string,
  pxPerM: number,
): TravelLogSample | null {
  if (row.length !== 11 || !allFinite(row)) return null;
  const [t, dt, h, w, line, nx, ny, angle, dist, flags, state] = row as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const place = PLACES[state % 4];
  const want = PLACES[Math.floor(state / 4) % 4];
  const why = WHYS[Math.floor(state / 16)];
  if (place === undefined || want === undefined || why === undefined) {
    return null;
  }
  const flag = (name: (typeof FLAG_BITS)[number]) =>
    (flags & (1 << FLAG_BITS.indexOf(name))) !== 0;
  const travelling = flag("travelling");
  const distM = dist / 100;
  return {
    t,
    dt: dt / 1e4,
    first: flag("first"),
    surface,
    pxPerM,
    travelling,
    // While travelling, a hidden want's reason is the surface's own.
    hideWhy: travelling && want === "hidden" ? (why as TravelHideWhy) : null,
    slotFree: flag("slotFree"),
    canFold: flag("canFold"),
    finger: flag("finger"),
    place,
    want,
    why,
    valid: flag("valid"),
    onScreen: flag("onScreen"),
    ndcX: nx / 1e3,
    ndcY: ny / 1e3,
    letterPxH: h / 1e3,
    letterPxW: w / 1e3,
    linePx: line / 10,
    angleDeg: angle / 10,
    distM,
    growth: signGrowth(distM, GROWTH_FROM_M),
  };
}

function readEvent(row: readonly unknown[]): TravelLogEvent | null {
  const [kind, t, surface] = row;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  if (kind === "m" && row.length === 2) return { kind: "mark", t };
  if (typeof surface !== "string") return null;
  if ((kind === "d" || kind === "u") && row.length === 3) {
    return { kind: kind === "d" ? "press" : "release", t, surface };
  }
  if (kind === "p" && row.length === 5) {
    const place = PLACES[row[3] as number];
    const why = WHYS[row[4] as number];
    if (place === undefined || why === undefined) return null;
    return { kind: "place", t, surface, place, why };
  }
  return null;
}

/** A copied log read back; a line that does not read is skipped and
 *  counted, never thrown on. */
export function parseTravelLog(text: string): TravelLogRead {
  let knobs: TravellingBoxKnobs | null = null;
  const samples: TravelLogSample[] = [];
  const events: TravelLogEvent[] = [];
  let skipped = 0;
  let surface: string | null = null;
  let pxPerM = 0;
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
    if (isRecord(value) && value["kind"] === "head") {
      knobs = isRecord(value["knobs"])
        ? (value["knobs"] as unknown as TravellingBoxKnobs)
        : null;
      continue;
    }
    if (!Array.isArray(value)) {
      skipped += 1;
      continue;
    }
    const row: readonly unknown[] = value;
    if (row[0] === "S") {
      if (typeof row[1] === "string" && typeof row[2] === "number") {
        surface = row[1];
        pxPerM = row[2];
      } else skipped += 1;
      continue;
    }
    if (typeof row[0] === "number") {
      const read = surface === null ? null : readSample(row, surface, pxPerM);
      if (read === null) skipped += 1;
      else samples.push(read);
      continue;
    }
    const event = readEvent(row);
    if (event === null) skipped += 1;
    else events.push(event);
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
  /** Every settled change, hidden ones included. */
  readonly changes: ReplayChange[];
  readonly count: number;
  /** The changes among plate, dock and fold alone: the ones the knobs
   *  decide (appearing and hiding follow the voice, not the knobs). */
  readonly moves: number;
  /** Travelling time replayed (min). */
  readonly minutes: number;
  readonly perMinute: number;
  /** `moves` per travelling minute: what the sweep compares. */
  readonly movesPerMinute: number;
  /** Plate-dock changes sooner than 1 s after a release. */
  readonly afterRelease: number;
}

/**
 * The places a logged walk would have taken under `knobs`, by the app's
 * own rules (`wantPlace`, `settlePlace`, the words' `letterGate`): the
 * threshold and the metric read the logged letter sizes; with `grow`
 * off the logged growth is taken back out of them; the lock counts from
 * each logged release; the holds count the app's own time steps.
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
  let moves = 0;
  let travellingS = 0;
  for (const s of log.samples) {
    const fresh =
      s.first ||
      prev === null ||
      s.surface !== prev.surface ||
      s.t - prev.t > NEW_TRAVEL_MS;
    if (fresh) {
      settle = { place: "hidden", pending: null, pendingS: 0 };
      releasedAt = null;
    }
    const dtS = fresh ? 0 : s.dt;
    if (s.travelling) travellingS += dtS;
    prev = s;
    // A release before this travel's first frame is not this travel's.
    while (releaseIx < releases.length && releases[releaseIx]! <= s.t) {
      if (!fresh || releases[releaseIx] === s.t) {
        releasedAt = releases[releaseIx]!;
      }
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
      dtS,
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
    if (before === "hidden" || settle.place === "hidden") continue;
    moves += 1;
    const between =
      (before === "plate" && settle.place === "dock") ||
      (before === "dock" && settle.place === "plate");
    if (
      between &&
      releasedAt !== null &&
      (s.t - releasedAt) / 1000 < AFTER_RELEASE_S
    ) {
      afterRelease += 1;
    }
  }
  const minutes = travellingS / 60;
  return {
    changes,
    count: changes.length,
    moves,
    minutes,
    perMinute: minutes > 0 ? changes.length / minutes : 0,
    movesPerMinute: minutes > 0 ? moves / minutes : 0,
    afterRelease,
  };
}

/** How the replay under the walk's own knobs meets the app's changes. */
export interface ReplaySelfCheck {
  /** The settled changes the app logged, and the replay's. */
  readonly logged: number;
  readonly replayed: number;
  /** Pairs in order with the same surface and place, before the first
   *  that differs. */
  readonly matched: number;
  /** The largest |replayed - logged| time among the matched (ms). */
  readonly maxLagMs: number;
  /** The first pair that differs, or null when every one matched. */
  readonly firstMismatch: {
    readonly index: number;
    readonly logged: TravelLogEvent | null;
    readonly replayed: ReplayChange | null;
  } | null;
}

/**
 * The sweep's first step: the log replayed under the knobs in its own
 * head, set against the place changes the app logged. A whole log
 * (nothing dropped) should match every change at the same sample; a log
 * whose ring dropped its start can begin mid-travel, so its first pairs
 * may differ. Null without the head's knobs.
 */
export function replaySelfCheck(read: TravelLogRead): ReplaySelfCheck | null {
  if (read.knobs === null) return null;
  const logged = read.events.filter((e) => e.kind === "place");
  const replayed = replayPlaces(read, read.knobs).changes;
  let matched = 0;
  let maxLagMs = 0;
  const n = Math.max(logged.length, replayed.length);
  for (let i = 0; i < n; i++) {
    const a = logged[i];
    const b = replayed[i];
    if (
      a === undefined ||
      b === undefined ||
      a.kind !== "place" ||
      a.surface !== b.surface ||
      a.place !== b.place
    ) {
      return {
        logged: logged.length,
        replayed: replayed.length,
        matched,
        maxLagMs,
        firstMismatch: { index: i, logged: a ?? null, replayed: b ?? null },
      };
    }
    matched += 1;
    maxLagMs = Math.max(maxLagMs, Math.abs(b.t - a.t));
  }
  return {
    logged: logged.length,
    replayed: replayed.length,
    matched,
    maxLagMs,
    firstMismatch: null,
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
 * The debug readout's buttons: Copy log (through the page's clipboard
 * seam, async: busy, then how it went), Download (the fallback for a log
 * too large for the clipboard: `save` hands the text to the browser as a
 * file, async the same way) and Mark (a mark at the tap's time, its label
 * counting them). A log copied or downloaded is cleared, so the next run
 * starts empty; a dismissed save dialog keeps it.
 */
export function wireTravelLogButtons(deps: {
  readonly copy: LogButton;
  readonly download: LogButton;
  readonly mark: LogButton;
  readonly log: TravelLog;
  readonly write: ((text: string) => Promise<void>) | undefined;
  /** Saves the text as a file: true once saved or downloading, false
   *  when the visitor dismissed the dialog; rejects when it cannot. */
  readonly save: (text: string) => Promise<boolean>;
  readonly now: () => number;
  /** Sections appended in turn to the copied and downloaded text (the
   *  anchor log, the QR instrument), cleared with the log after a copy or
   *  download that succeeded. */
  readonly appendices?: readonly { text(): string; clear(): void }[];
}): void {
  const sections = deps.appendices ?? [];
  const text = (): string =>
    [deps.log.text(), ...sections.map((s) => s.text())].join("\n");
  const clearSections = (): void => {
    for (const s of sections) s.clear();
  };
  const markLabel = () => {
    deps.mark.textContent = `Mark (${String(deps.log.size().marks)})`;
  };
  deps.copy.addEventListener("click", () => {
    if (deps.copy.disabled) return;
    void copyWithFeedback(deps.copy, text(), deps.write, {
      busy: "Copying...",
      done: "Log copied",
      failed: "Copy failed",
      onDone: () => {
        deps.log.clear("copy");
        clearSections();
        markLabel();
      },
    });
  });
  const idle = deps.download.textContent;
  deps.download.addEventListener("click", () => {
    if (deps.download.disabled) return;
    deps.download.disabled = true;
    deps.download.textContent = "Saving...";
    void (async () => {
      try {
        if (await deps.save(text())) {
          deps.log.clear("download");
          clearSections();
          deps.download.textContent = "Log downloaded";
          markLabel();
        } else {
          deps.download.textContent = idle;
        }
      } catch {
        deps.download.textContent = "Download failed";
      } finally {
        deps.download.disabled = false;
      }
    })();
  });
  deps.mark.addEventListener("click", () => {
    deps.log.mark(deps.now());
    markLabel();
  });
}
