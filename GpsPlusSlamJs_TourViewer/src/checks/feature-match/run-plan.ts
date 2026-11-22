/**
 * The photo test run as plain data, shared by every view of the feature
 * matching check: one record per plan slot (its running number, photos A
 * and B, the light check, whether it was downloaded), the pair files kept
 * on the page until Download all, the run's size and position and the
 * capture and save settings. `planReducer` holds the rules; the slice
 * wraps it, the store persists it. Pixels and Blobs are side tables keyed
 * by the ids held here.
 *
 * @see run-plan.ts.md
 */
import { lightCheck, type LightCheck } from "./bench-export";
import type { Size } from "./flat-target";
import { slotList, slotStatus, type Slot } from "./plan-slots";

/** A taken photo; its pixels are the side table's, under `id`. */
export interface PhotoMeta {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** The camera stream's size when it was taken. */
  readonly source: Size;
  /** Grey mean 0 to 255, for the light check. */
  readonly greyMean: number;
}

/** "each": every pair's zip downloads at once; "end": kept until Download all. */
type SaveMode = "each" | "end";
/** "auto": photos take themselves when the phone is still; "tap": countdown. */
type CaptureMode = "auto" | "tap";
const COUNTDOWNS = [0, 3, 5] as const;
type Countdown = (typeof COUNTDOWNS)[number];

export interface PlanSettings {
  readonly save: SaveMode;
  readonly capture: CaptureMode;
  /** Seconds between the tap and the photo; 0 shoots at once. */
  readonly countdown: Countdown;
  readonly sound: boolean;
}

/** One plan slot's pair. */
interface SlotRecord {
  /** The running number of its newest take; it names the files. */
  readonly seq: number;
  readonly a: PhotoMeta | null;
  readonly b: PhotoMeta | null;
  /** Set once both photos exist, for the light pairs; null otherwise. */
  readonly light: LightCheck | null;
  /** This take's files were downloaded: a new photo starts a new take. */
  readonly downloaded: boolean;
}

/** A pair's zip kept on the page; its Blob is the side table's, under `id`. */
interface KeptFile {
  readonly id: string;
  readonly name: string;
  readonly slot: string;
  /** The take it holds. */
  readonly seq: number;
  readonly downloaded: boolean;
}

export interface RunPlan {
  /** The places the light pairs are repeated at (1-3). */
  readonly spots: number;
  /** Extra "other" pairs (0 to the cap). */
  readonly extra: number;
  /** Index of the current slot in `slotList(spots, extra)`. */
  readonly current: number;
  /** By slot id; a slot without a record has no photo yet. */
  readonly slots: Readonly<Record<string, SlotRecord>>;
  readonly kept: readonly KeptFile[];
  readonly settings: PlanSettings;
  /** Times the run's files were downloaded. */
  readonly downloads: number;
  /** Photos taken in the run, retakes included. */
  readonly shots: number;
}

export type PlanAction =
  | { readonly type: "size"; readonly spots: number; readonly extra: number }
  | { readonly type: "move"; readonly index: number }
  | {
      readonly type: "photo";
      readonly slot: string;
      readonly which: "a" | "b";
      readonly photo: PhotoMeta;
    }
  | { readonly type: "lost"; readonly slot: string; readonly which: "a" | "b" }
  | {
      readonly type: "keep";
      readonly id: string;
      readonly name: string;
      readonly slot: string;
    }
  | { readonly type: "downloaded"; readonly ids: readonly string[] }
  | { readonly type: "run-downloaded" }
  | { readonly type: "drop-downloaded" }
  | {
      readonly type: "settings";
      readonly settings: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "reset" };

export const DEFAULT_SETTINGS: PlanSettings = {
  save: "end",
  capture: "auto",
  countdown: 3,
  sound: true,
};

export const EMPTY_PLAN: RunPlan = {
  spots: 1,
  extra: 0,
  current: 0,
  slots: {},
  kept: [],
  settings: DEFAULT_SETTINGS,
  downloads: 0,
  shots: 0,
};

/** The plan's slots in run order. */
export const planSlots = (p: RunPlan): Slot[] => slotList(p.spots, p.extra);

// --- validation ------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;
const isSize = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const LIGHTS: readonly unknown[] = [
  "ok",
  "not-darker",
  "too-dark-a",
  "too-dark-b",
  "changed",
];

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
    v.greyMean <= 255
  );
}

const photoOrNull = (v: unknown): v is PhotoMeta | null =>
  v === null || isPhoto(v);

function isRecord(v: unknown): v is SlotRecord {
  return (
    isObj(v) &&
    isCount(v.seq) &&
    photoOrNull(v.a) &&
    photoOrNull(v.b) &&
    (v.light === null || LIGHTS.includes(v.light)) &&
    typeof v.downloaded === "boolean"
  );
}

function isKept(v: unknown): v is KeptFile {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    v.id !== "" &&
    typeof v.name === "string" &&
    v.name !== "" &&
    typeof v.slot === "string" &&
    isCount(v.seq) &&
    typeof v.downloaded === "boolean"
  );
}

/** The known values of `raw` laid over `base`; null when one is unknown. */
function settingsOver(
  base: PlanSettings,
  raw: Readonly<Record<string, unknown>>,
): PlanSettings | null {
  const out = { ...base };
  for (const [k, v] of Object.entries(raw)) {
    if (k === "save" && (v === "each" || v === "end")) out.save = v;
    else if (k === "capture" && (v === "auto" || v === "tap")) out.capture = v;
    else if (k === "countdown" && COUNTDOWNS.includes(v as Countdown))
      out.countdown = v as Countdown;
    else if (k === "sound" && typeof v === "boolean") out.sound = v;
    else return null;
  }
  return out;
}

// --- the reducer -------------------------------------------------------------

const EMPTY_RECORD: SlotRecord = {
  seq: 0,
  a: null,
  b: null,
  light: null,
  downloaded: false,
};

const holdsSomething = (p: RunPlan, id: string): boolean => {
  const r = p.slots[id];
  return (
    (r !== undefined && (r.a !== null || r.b !== null)) ||
    p.kept.some((k) => k.slot === id)
  );
};

const withLight = (key: Slot["key"], r: SlotRecord): SlotRecord => ({
  ...r,
  light: r.a && r.b ? lightCheck(key, r.a.greyMean, r.b.greyMean) : null,
});

interface Step {
  readonly plan: RunPlan;
  readonly sequence: number;
}

function photo(
  p: RunPlan,
  sequence: number,
  a: PlanAction & { type: "photo" },
): Step | null {
  const slot = planSlots(p).find((s) => s.id === a.slot);
  if (!slot || (a.which !== "a" && a.which !== "b") || !isPhoto(a.photo)) {
    return null;
  }
  const old = p.slots[slot.id] ?? EMPTY_RECORD;
  if (a.which === "b" && old.a === null) {
    return null;
  }
  const newTake = old.seq === 0 || old.downloaded;
  const seq = newTake ? sequence + 1 : old.seq;
  const base: SlotRecord = { ...old, seq, downloaded: false };
  const rec =
    a.which === "a"
      ? { ...base, a: a.photo, b: newTake ? null : old.b }
      : { ...base, b: a.photo };
  return {
    plan: {
      ...p,
      slots: { ...p.slots, [slot.id]: withLight(slot.key, rec) },
      shots: p.shots + 1,
    },
    sequence: newTake ? seq : sequence,
  };
}

/** Every rule but the photo's, which needs the running number. */
function apply(p: RunPlan, a: PlanAction): RunPlan | null {
  switch (a.type) {
    case "size": {
      const list = slotList(a.spots, a.extra);
      const ids = new Set(list.map((s) => s.id));
      const spots = list.filter((s) => s.key === "1a").length;
      const extra = list.filter((s) => s.key === "x").length;
      if (spots === p.spots && extra === p.extra) return null;
      const dropped = planSlots(p).filter((s) => !ids.has(s.id));
      if (dropped.some((s) => holdsSomething(p, s.id))) return null;
      const slots = Object.fromEntries(
        Object.entries(p.slots).filter(([id]) => ids.has(id)),
      );
      return {
        ...p,
        spots,
        extra,
        slots,
        current: Math.min(p.current, list.length - 1),
      };
    }
    case "move": {
      const n = planSlots(p).length;
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= n)
        return null;
      return a.index === p.current ? null : { ...p, current: a.index };
    }
    case "lost": {
      const r = p.slots[a.slot];
      const slot = planSlots(p).find((s) => s.id === a.slot);
      if (
        !r ||
        !slot ||
        (a.which !== "a" && a.which !== "b") ||
        r[a.which] === null
      ) {
        return null;
      }
      return {
        ...p,
        slots: {
          ...p.slots,
          [a.slot]: withLight(slot.key, { ...r, [a.which]: null }),
        },
      };
    }
    case "keep": {
      const r = p.slots[a.slot];
      if (
        !r ||
        slotStatus(r) === "missing" ||
        slotStatus(r) === "half" ||
        typeof a.id !== "string" ||
        a.id === "" ||
        typeof a.name !== "string" ||
        a.name === "" ||
        p.kept.some((k) => k.id === a.id)
      ) {
        return null;
      }
      const file: KeptFile = {
        id: a.id,
        name: a.name,
        slot: a.slot,
        seq: r.seq,
        downloaded: false,
      };
      return { ...p, kept: [...p.kept, file] };
    }
    case "downloaded": {
      const now = p.kept.filter((k) => !k.downloaded && a.ids.includes(k.id));
      if (now.length === 0) return null;
      const slots = { ...p.slots };
      for (const k of now) {
        const r = slots[k.slot];
        if (r && r.seq === k.seq) slots[k.slot] = { ...r, downloaded: true };
      }
      return {
        ...p,
        slots,
        kept: p.kept.map((k) =>
          now.includes(k) ? { ...k, downloaded: true } : k,
        ),
      };
    }
    case "run-downloaded": {
      const complete = Object.entries(p.slots).filter(
        ([, r]) => r.a !== null && r.b !== null,
      );
      if (complete.length === 0) return null;
      const slots = { ...p.slots };
      for (const [id, r] of complete) slots[id] = { ...r, downloaded: true };
      return { ...p, slots, downloads: p.downloads + 1 };
    }
    case "drop-downloaded": {
      const kept = p.kept.filter((k) => !k.downloaded);
      return kept.length === p.kept.length ? null : { ...p, kept };
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

/**
 * Applies `a` to the plan with running number `sequence`. A refused action
 * returns the very same plan and number; a photo that starts a new take
 * raises the number (it names the take's files).
 */
export function planReducer(
  p: RunPlan,
  sequence: number,
  a: PlanAction,
): { readonly plan: RunPlan; readonly sequence: number } {
  const next =
    a.type === "photo"
      ? photo(p, sequence, a)
      : (() => {
          const plan = apply(p, a);
          return plan ? { plan, sequence } : null;
        })();
  return next ?? { plan: p, sequence };
}

// --- selectors ---------------------------------------------------------------

export type KeptState = "missing" | "half" | "warn" | "saved" | "kept" | "done";

/**
 * A slot as the pair list shows it: warn (a failed light check) first,
 * then saved (this take downloaded), kept (its zip waits on the page),
 * done (both photos, nothing saved), half or missing.
 */
export function keptState(p: RunPlan, id: string): KeptState {
  const r = p.slots[id];
  const st = slotStatus(r);
  if (st === "missing" || st === "half") return st;
  if (st === "retake") return "warn";
  if (r!.downloaded) return "saved";
  return p.kept.some((k) => k.slot === id && k.seq === r!.seq && !k.downloaded)
    ? "kept"
    : "done";
}

/** The highest running number a slot holds. */
export const maxSequence = (p: RunPlan): number =>
  Object.values(p.slots).reduce((m, r) => Math.max(m, r.seq), 0);

/** Every photo id the plan names, for the side tables. */
export const planPhotoIds = (p: RunPlan): string[] =>
  Object.values(p.slots).flatMap((r) =>
    [r.a?.id, r.b?.id].filter((x): x is string => x !== undefined),
  );

// --- persistence -------------------------------------------------------------

const VERSION = 1;

/** The plan as stored text. */
export const planText = (p: RunPlan): string =>
  JSON.stringify({ v: VERSION, ...p });

/**
 * The plan read back from `planText`, or undefined for missing, damaged or
 * foreign text. A bad record, kept file or setting is dropped alone.
 */
export function parsePlan(text: string | null): RunPlan | undefined {
  let raw: unknown;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObj(raw) || raw.v !== VERSION) return undefined;
  const list = slotList(Number(raw.spots), Number(raw.extra));
  const ids = new Set(list.map((s) => s.id));
  const slots: Record<string, SlotRecord> = {};
  if (isObj(raw.slots)) {
    for (const [id, r] of Object.entries(raw.slots)) {
      if (ids.has(id) && isRecord(r)) {
        slots[id] = {
          seq: r.seq,
          a: r.a,
          b: r.b,
          light: r.light,
          downloaded: r.downloaded,
        };
      }
    }
  }
  const kept: KeptFile[] = [];
  for (const k of Array.isArray(raw.kept) ? raw.kept : []) {
    if (isKept(k) && ids.has(k.slot) && !kept.some((x) => x.id === k.id)) {
      kept.push({
        id: k.id,
        name: k.name,
        slot: k.slot,
        seq: k.seq,
        downloaded: k.downloaded,
      });
    }
  }
  const settings = isObj(raw.settings)
    ? Object.fromEntries(
        Object.entries(raw.settings).filter(
          ([k, v]) => settingsOver(DEFAULT_SETTINGS, { [k]: v }) !== null,
        ),
      )
    : {};
  const current =
    isCount(raw.current) && raw.current < list.length ? raw.current : 0;
  return {
    spots: list.filter((s) => s.key === "1a").length,
    extra: list.filter((s) => s.key === "x").length,
    current,
    slots,
    kept,
    settings: settingsOver(DEFAULT_SETTINGS, settings) ?? DEFAULT_SETTINGS,
    downloads: isCount(raw.downloads) ? raw.downloads : 0,
    shots: isCount(raw.shots) ? raw.shots : 0,
  };
}

/** After a reload the kept zips are gone (they lived in memory). */
export const planAfterReload = (p: RunPlan): RunPlan =>
  p.kept.length === 0 ? p : { ...p, kept: [] };
