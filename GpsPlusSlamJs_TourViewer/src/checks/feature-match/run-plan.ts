/**
 * The photo test run as plain data, shared by every view of the feature
 * matching check: one record per shot of the run (its photo and take),
 * the run's size and position and the capture settings. `planReducer`
 * holds the rules; the slice wraps it, the store persists it. Pixels are
 * a side table keyed by the photo ids held here.
 *
 * @see run-plan.ts.md
 */
import { isCameraReport, type CameraReport } from "./camera-report";
import type { Size } from "./flat-target";
import {
  needsRetake,
  nextOpen,
  shotList,
  type Shot,
  type ShotPhotos,
} from "./scenes";

/** A taken photo; its pixels are the side table's, under `id`. */
export interface PhotoMeta {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** The camera stream's size when it was taken. */
  readonly source: Size;
  /** Grey mean 0 to 255, for the light check. */
  readonly greyMean: number;
  /**
   * Grey standard deviation 0 to 255 (the contrast), for the PC. Absent
   * in a plan stored before it was recorded.
   */
  readonly greySd?: number;
  /**
   * What the camera reported at the photo (focus distance, zoom, size),
   * for the desk. Absent when the camera gave nothing to read.
   */
  readonly camera?: CameraReport;
}

/** "auto": photos take themselves when the phone is still; "tap": countdown. */
type CaptureMode = "auto" | "tap";
const COUNTDOWNS = [0, 3, 5] as const;
type Countdown = (typeof COUNTDOWNS)[number];

export interface PlanSettings {
  readonly capture: CaptureMode;
  /** Seconds between the tap and the photo; 0 shoots at once. */
  readonly countdown: Countdown;
  readonly sound: boolean;
}

/** One shot's photo. A shot without a record has no photo. */
interface ShotRecord {
  readonly photo: PhotoMeta;
  /** 1 for the first photo, raised by each retake; it names the file. */
  readonly take: number;
}

export interface RunPlan {
  /** The places the light scene is repeated at (1-3). */
  readonly spots: number;
  /** Own scenes (0 to the cap). */
  readonly extra: number;
  /** Index of the current shot in `shotList(spots, extra)`. */
  readonly current: number;
  /** By shot id. */
  readonly shots: Readonly<Record<string, ShotRecord>>;
  /**
   * Shot ids the tester skipped for now ("Skip photo", "Skip scene"):
   * never with a photo; the walk passes them, a move or a photo ends it.
   */
  readonly skipped: readonly string[];
  readonly settings: PlanSettings;
}

export type PlanAction =
  | { readonly type: "size"; readonly spots: number; readonly extra: number }
  | { readonly type: "move"; readonly index: number }
  | { readonly type: "photo"; readonly shot: string; readonly photo: PhotoMeta }
  | { readonly type: "lost"; readonly shot: string }
  | { readonly type: "skip"; readonly shots: readonly string[] }
  | {
      readonly type: "settings";
      readonly settings: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "reset" };

export const DEFAULT_SETTINGS: PlanSettings = {
  capture: "auto",
  countdown: 3,
  sound: true,
};

export const EMPTY_PLAN: RunPlan = {
  spots: 1,
  extra: 0,
  current: 0,
  shots: {},
  skipped: [],
  settings: DEFAULT_SETTINGS,
};

/** The plan's shots in run order. */
export const planShots = (p: RunPlan): Shot[] => shotList(p.spots, p.extra);

/** The photos by shot id, as the scene rules read them. */
export const planPhotos = (p: RunPlan): ShotPhotos =>
  Object.fromEntries(Object.entries(p.shots).map(([id, r]) => [id, r.photo]));

/** The next open shot after `from` (no photo, not skipped); null when none. */
export const planNextOpen = (p: RunPlan, from = p.current): number | null =>
  nextOpen(planShots(p), planPhotos(p), from, new Set(p.skipped));

// --- validation ------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;
const isSize = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

function isPhoto(v: unknown): v is PhotoMeta {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    v.id !== "" &&
    isSize(v.width) &&
    isSize(v.height) &&
    isObj(v.source) &&
    isSize(v.source.width) &&
    isSize(v.source.height) &&
    typeof v.greyMean === "number" &&
    Number.isFinite(v.greyMean) &&
    v.greyMean >= 0 &&
    v.greyMean <= 255 &&
    (v.greySd === undefined ||
      (typeof v.greySd === "number" &&
        Number.isFinite(v.greySd) &&
        v.greySd >= 0 &&
        v.greySd <= 255)) &&
    (v.camera === undefined || isCameraReport(v.camera))
  );
}

const isRecord = (v: unknown): v is ShotRecord =>
  isObj(v) && isPhoto(v.photo) && isCount(v.take) && v.take >= 1;

/** The known values of `raw` laid over `base`; null when one is unknown. */
function settingsOver(
  base: PlanSettings,
  raw: Readonly<Record<string, unknown>>,
): PlanSettings | null {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "capture" && (v === "auto" || v === "tap")) out.capture = v;
    else if (k === "countdown" && COUNTDOWNS.includes(v as Countdown))
      out.countdown = v as Countdown;
    else if (k === "sound" && typeof v === "boolean") out.sound = v;
    else return null;
  }
  return out;
}

// --- the reducer -------------------------------------------------------------

/**
 * A photo for a shot of the list: a new take of it. When it is the current
 * shot and its light check passes, the run moves on to the next open shot;
 * a failed check keeps it current for the retake.
 */
function photo(p: RunPlan, a: PlanAction & { type: "photo" }): RunPlan | null {
  const list = planShots(p);
  const index = list.findIndex((s) => s.id === a.shot);
  if (index < 0 || !isPhoto(a.photo)) return null;
  const take = (p.shots[a.shot]?.take ?? 0) + 1;
  const shots = { ...p.shots, [a.shot]: { photo: a.photo, take } };
  const skipped = p.skipped.filter((id) => id !== a.shot);
  const next = { ...p, shots, skipped };
  if (index !== p.current || needsRetake(a.shot, planPhotos(next))) return next;
  return { ...next, current: planNextOpen(next, index) ?? index };
}

/** Skips the open shots named; the run moves on when the current one is. */
function skip(p: RunPlan, a: PlanAction & { type: "skip" }): RunPlan | null {
  const ids = new Set(planShots(p).map((s) => s.id));
  const add = [...new Set(a.shots)].filter(
    (id) => ids.has(id) && !p.shots[id] && !p.skipped.includes(id),
  );
  if (add.length === 0) return null;
  const next = { ...p, skipped: [...p.skipped, ...add] };
  const cur = planShots(p)[p.current]?.id ?? "";
  if (!add.includes(cur)) return next;
  return { ...next, current: planNextOpen(next) ?? p.current };
}

function apply(p: RunPlan, a: PlanAction): RunPlan | null {
  switch (a.type) {
    case "photo":
      return photo(p, a);
    case "skip":
      return skip(p, a);
    case "size": {
      const list = shotList(a.spots, a.extra);
      const ids = new Set(list.map((s) => s.id));
      const spots = new Set(
        list.filter((s) => s.kind === "light").map((s) => s.scene),
      ).size;
      const extra = new Set(
        list.filter((s) => s.kind === "own").map((s) => s.scene),
      ).size;
      if (spots === p.spots && extra === p.extra) return null;
      if (Object.keys(p.shots).some((id) => !ids.has(id))) return null;
      return {
        ...p,
        spots,
        extra,
        current: Math.min(p.current, list.length - 1),
        skipped: p.skipped.filter((id) => ids.has(id)),
      };
    }
    case "move": {
      const n = planShots(p).length;
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= n)
        return null;
      const id = planShots(p)[a.index]!.id;
      const skipped = p.skipped.filter((x) => x !== id);
      if (a.index === p.current && skipped.length === p.skipped.length)
        return null;
      return { ...p, current: a.index, skipped };
    }
    case "lost": {
      if (!p.shots[a.shot]) return null;
      const shots = { ...p.shots };
      delete shots[a.shot];
      return { ...p, shots };
    }
    case "settings": {
      if (!isObj(a.settings)) return null;
      const s = settingsOver(p.settings, a.settings);
      if (!s || JSON.stringify(s) === JSON.stringify(p.settings)) return null;
      return { ...p, settings: s };
    }
    case "reset":
      return { ...EMPTY_PLAN, settings: p.settings };
    default:
      return null;
  }
}

/** Applies `a`; a refused action returns the very same plan. */
export const planReducer = (p: RunPlan, a: PlanAction): RunPlan =>
  apply(p, a) ?? p;

// --- selectors ---------------------------------------------------------------

/** Every photo id the plan names, for the side tables. */
export const planPhotoIds = (p: RunPlan): string[] =>
  Object.values(p.shots).map((r) => r.photo.id);

/**
 * Photos taken again over a shot that had one: the takes past the first.
 * A photo the browser lost is not a retake: its record is gone, so the
 * next photo of that shot is take 1 again.
 */
export const planRetakes = (p: RunPlan): number =>
  Object.values(p.shots).reduce((n, r) => n + r.take - 1, 0);

// --- persistence -------------------------------------------------------------

const VERSION = 2;

/** The plan as stored text. */
export const planText = (p: RunPlan): string =>
  JSON.stringify({ v: VERSION, ...p });

/** The stored text is a plan of the pair-slot version, which is not read. */
export function isOldPlan(text: string | null): boolean {
  try {
    const raw: unknown = text === null ? null : JSON.parse(text);
    return isObj(raw) && raw.v === 1;
  } catch {
    return false;
  }
}

/**
 * The plan read back from `planText`, or undefined for missing, damaged or
 * foreign text and for any version but this one (no migration). A bad
 * record or setting is dropped alone.
 */
export function parsePlan(text: string | null): RunPlan | undefined {
  let raw: unknown;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObj(raw) || raw.v !== VERSION) return undefined;
  const list = shotList(Number(raw.spots), Number(raw.extra));
  const ids = new Set(list.map((s) => s.id));
  const shots: Record<string, ShotRecord> = {};
  if (isObj(raw.shots)) {
    for (const [id, r] of Object.entries(raw.shots)) {
      if (ids.has(id) && isRecord(r))
        shots[id] = { photo: r.photo, take: r.take };
    }
  }
  const settings = isObj(raw.settings)
    ? Object.fromEntries(
        Object.entries(raw.settings).filter(
          ([k, v]) => settingsOver(DEFAULT_SETTINGS, { [k]: v }) !== null,
        ),
      )
    : {};
  return {
    spots: new Set(list.filter((s) => s.kind === "light").map((s) => s.scene))
      .size,
    extra: new Set(list.filter((s) => s.kind === "own").map((s) => s.scene))
      .size,
    current:
      isCount(raw.current) && raw.current < list.length ? raw.current : 0,
    shots,
    skipped: Array.isArray(raw.skipped)
      ? [
          ...new Set(
            raw.skipped.filter(
              (id): id is string =>
                typeof id === "string" && ids.has(id) && !shots[id],
            ),
          ),
        ]
      : [],
    settings: settingsOver(DEFAULT_SETTINGS, settings) ?? DEFAULT_SETTINGS,
  };
}
