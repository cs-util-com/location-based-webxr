/**
 * The photo test's protocol as plain data: scenes of shots (one shared
 * first shot per scene), the run's shot list, the pairs derived from the
 * shots, the light check per shot, the next open shot and the summary the
 * tester pastes back. Pure, so the slice and every view share one reading.
 *
 * @see scenes.ts.md
 */
import {
  lightCheck,
  pairTag,
  type LightCheck,
  type PairKey,
  type PairTag,
} from "./bench-export";

/** The places the light scene can be repeated at. */
const MAX_SPOTS = 3;
/** The most own scenes a run can add. */
export const MAX_EXTRA = 8;

export type SceneKind = "light" | "flat" | "deep" | "own";

/**
 * How a shot can take itself: "still" where nothing changes from the
 * scene's previous shot (once the phone rests), "move" where the phone
 * turns first, null where the gyroscope cannot judge the change (a step,
 * a light change, the first shot of a scene): by tap.
 */
type HandsOff = "still" | "move" | null;

/** A shot's key within its scene kind. */
export type ShotKey =
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "D1"
  | "D2"
  | "D3"
  | "X1"
  | "X2";

interface ShotDef {
  readonly key: ShotKey;
  /** What to photograph, in a few words. */
  readonly text: string;
  readonly handsOff: HandsOff;
}

/** The shots of each scene kind, in the order they are taken. */
const SCENE_SHOTS: Readonly<Record<SceneKind, readonly ShotDef[]>> = {
  light: [
    { key: "L1", text: "normal light", handsOff: null },
    { key: "L2", text: "again, unchanged", handsOff: "still" },
    { key: "L3", text: "light dimmed", handsOff: null },
    {
      key: "L4",
      text: "as dark as possible, shapes still show",
      handsOff: null,
    },
  ],
  flat: [
    { key: "F1", text: "upright at 1.5 m", handsOff: null },
    { key: "F2", text: "again, unchanged", handsOff: "still" },
    { key: "F3", text: "tilted 30-45 deg", handsOff: "move" },
    { key: "F4", text: "from 3 m", handsOff: null },
    { key: "F5", text: "from 1 m", handsOff: null },
    { key: "F6", text: "1 m to the side at 1.5 m", handsOff: null },
  ],
  deep: [
    { key: "D1", text: "a deep scene", handsOff: null },
    { key: "D2", text: "again, unchanged", handsOff: "still" },
    { key: "D3", text: "1 m to the side", handsOff: null },
  ],
  own: [
    { key: "X1", text: "your own first photo", handsOff: null },
    { key: "X2", text: "your own second photo", handsOff: null },
  ],
};

const SCENE_TITLES: Readonly<Record<SceneKind, string>> = {
  light: "Light",
  flat: "Flat surface",
  deep: "Deep scene",
  own: "Your own pair",
};

export interface Scene {
  /** `light-s1`..`light-s3`, `flat-s1`, `deep-s1`, `own-1`..`own-8`. */
  readonly id: string;
  readonly kind: SceneKind;
  /** The place: 1-3 for the light scenes, 1 for the rest. */
  readonly spot: number;
  readonly title: string;
}

/** One shot of the run; its id `<scene id>/<key>` names its records. */
export interface Shot extends ShotDef {
  readonly id: string;
  readonly scene: string;
  readonly kind: SceneKind;
  readonly spot: number;
  /** Its index within its scene; 0 is the scene's first shot. */
  readonly step: number;
}

const clampInt = (n: number, lo: number, hi: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo;

/** The light scene per place, then flat, deep and the own scenes; clamped. */
export function sceneList(spots: number, extra: number): Scene[] {
  const s = clampInt(spots, 1, MAX_SPOTS);
  const x = clampInt(extra, 0, MAX_EXTRA);
  const scene = (id: string, kind: SceneKind, spot: number): Scene => ({
    id,
    kind,
    spot,
    title: SCENE_TITLES[kind],
  });
  return [
    ...Array.from({ length: s }, (_, i) =>
      scene(`light-s${String(i + 1)}`, "light", i + 1),
    ),
    scene("flat-s1", "flat", 1),
    scene("deep-s1", "deep", 1),
    ...Array.from({ length: x }, (_, i) =>
      scene(`own-${String(i + 1)}`, "own", 1),
    ),
  ];
}

/** Every shot of the run in the order it walks them. */
export const shotList = (spots: number, extra: number): Shot[] =>
  sceneList(spots, extra).flatMap((sc) =>
    SCENE_SHOTS[sc.kind].map((d, step) => ({
      ...d,
      id: `${sc.id}/${d.key}`,
      scene: sc.id,
      kind: sc.kind,
      spot: sc.spot,
      step,
    })),
  );

/** The shot before `list[index]` in its scene; none for a first shot. */
export const previousInScene = (
  list: readonly Shot[],
  index: number,
): Shot | undefined => (list[index]?.step ? list[index - 1] : undefined);

// --- derived pairs -------------------------------------------------------------

/** "real": two captures; "turnN": F1's centre square against F2's turned N deg cw. */
type PairKind = "real" | "turn0" | "turn90" | "turn180";

interface PairDef {
  readonly a: ShotKey;
  readonly b: ShotKey;
  readonly name: string;
  readonly kind: PairKind;
  readonly legacy: PairKey | null;
  readonly axis: string;
  readonly controlFor: readonly string[];
}

const def = (
  a: ShotKey,
  b: ShotKey,
  kind: PairKind,
  legacy: PairKey | null,
  axis: string,
  controlFor: readonly string[] = [],
  name = `${a}-${b}`,
): PairDef => ({ a, b, name, kind, legacy, axis, controlFor });

/** The plan's pair table per scene kind. */
const SCENE_PAIRS: Readonly<Record<SceneKind, readonly PairDef[]>> = {
  light: [
    def("L1", "L2", "real", "1a", "light", ["light"]),
    def("L1", "L3", "real", "1b", "light"),
    def("L1", "L4", "real", "1c", "light"),
  ],
  flat: [
    def("F1", "F2", "real", "2a", "control", ["scale", "side-flat", "oblique"]),
    def("F1", "F2", "turn0", null, "rot", ["rot"], "F1-T0"),
    def("F1", "F2", "turn90", "2b", "rot", [], "F1-T90"),
    def("F1", "F2", "turn180", "2c", "rot", [], "F1-T180"),
    def("F1", "F3", "real", "2d", "oblique"),
    def("F1", "F4", "real", "3b", "scale"),
    def("F5", "F4", "real", "3c", "scale"),
    def("F1", "F6", "real", "4b", "side-flat"),
  ],
  deep: [
    def("D1", "D2", "real", "4c", "side-deep", ["side-deep"]),
    def("D1", "D3", "real", "4d", "side-deep"),
  ],
  own: [def("X1", "X2", "real", "x", "own")],
};

/** A pair derived from two shots; never stored. */
export interface DerivedPair {
  /** `<scene id>/<name>`, e.g. `flat-s1/F1-T90`. */
  readonly id: string;
  readonly scene: string;
  readonly spot: number;
  readonly name: string;
  /** Shot ids. */
  readonly a: string;
  readonly b: string;
  readonly kind: PairKind;
  readonly legacy: PairKey | null;
  readonly axis: string;
  /** The axes this pair is the control of; empty for a test pair. */
  readonly controlFor: readonly string[];
}

/** Every pair of the run, in shot-list order. */
export const derivedPairs = (spots: number, extra: number): DerivedPair[] =>
  sceneList(spots, extra).flatMap((sc) =>
    SCENE_PAIRS[sc.kind].map((d) => ({
      id: `${sc.id}/${d.name}`,
      scene: sc.id,
      spot: sc.spot,
      name: d.name,
      a: `${sc.id}/${d.a}`,
      b: `${sc.id}/${d.b}`,
      kind: d.kind,
      legacy: d.legacy,
      axis: d.axis,
      controlFor: d.controlFor,
    })),
  );

/** What the pair rules read of a shot's photo. */
interface ShotPhoto {
  readonly id: string;
  readonly greyMean: number;
}
/** The photos by shot id; a shot without one has no entry. */
export type ShotPhotos = Readonly<Record<string, ShotPhoto | undefined>>;

/** The pairs that name `shot`: what a retake of it measures again. */
export const pairsUsing = (
  pairs: readonly DerivedPair[],
  shot: string,
): DerivedPair[] => pairs.filter((p) => p.a === shot || p.b === shot);

/** The pairs whose two shots have a photo. */
export const readyPairs = (
  pairs: readonly DerivedPair[],
  photos: ShotPhotos,
): DerivedPair[] => pairs.filter((p) => photos[p.a] && photos[p.b]);

/**
 * The tag that names a pair's folder in the run zip, `n` its number in
 * the run: the legacy key, so the PC side reads the folder as before; the
 * rotation control F1-T0 has none and gets its own name.
 *
 * @throws Error for an `n` that is not an integer of at least 1.
 */
export function pairFolderTag(p: DerivedPair, n: number): PairTag {
  if (p.legacy !== null) {
    return pairTag(p.legacy, p.spot, n);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`sequence must be 1 or more, got ${String(n)}`);
  }
  return {
    pair: p.name.toLowerCase(),
    pairLabel: "rotation: control, centre squares",
    spot: p.spot,
    sequence: n,
  };
}

/** The key a pair's result is stored under: stale after either retake. */
export const resultKey = (p: DerivedPair, idA: string, idB: string): string =>
  `${p.id}@${idA}+${idB}`;

// --- the light check -----------------------------------------------------------

/** The old light checks, plus L4 brighter than L3. */
export type ShotLight = LightCheck | "not-darker-than-dimmed";

/**
 * A light shot's check against its scene's L1 (L2 by the control rule,
 * L3 and L4 by the dimmed rule), and L4 against L3; null for every other
 * shot or while a photo it needs is missing.
 */
export function lightOf(shot: string, photos: ShotPhotos): ShotLight | null {
  const m = /^(light-s\d+)\/(L[234])$/.exec(shot);
  const own = photos[shot];
  const first = m ? photos[`${m[1]}/L1`] : undefined;
  if (!m || !own || !first) return null;
  const key = m[2] === "L2" ? "1a" : m[2] === "L3" ? "1b" : "1c";
  const check = lightCheck(key, first.greyMean, own.greyMean);
  const dimmed = photos[`${m[1]}/L3`];
  if (
    m[2] === "L4" &&
    check === "ok" &&
    dimmed &&
    own.greyMean > dimmed.greyMean
  ) {
    return "not-darker-than-dimmed";
  }
  return check;
}

/** A shot's light check failed: it wants a retake. */
export const needsRetake = (shot: string, photos: ShotPhotos): boolean => {
  const l = lightOf(shot, photos);
  return l !== null && l !== "ok";
};

/**
 * The first shot without a photo after `from`, else the first one before
 * it; null when every shot has one.
 */
export function nextOpen(
  list: readonly Shot[],
  photos: ShotPhotos,
  from: number,
): number | null {
  const after = list.findIndex((s, i) => i > from && !photos[s.id]);
  if (after >= 0) return after;
  const first = list.findIndex((s) => !photos[s.id]);
  return first >= 0 && first !== from ? first : null;
}

// --- the summary ---------------------------------------------------------------

/** The run's zip, named by the session token only. */
export const runZipName = (session: string): string =>
  `feature-match-run-${session}.zip`;

export interface SummaryInput {
  readonly session: string;
  readonly spots: number;
  readonly extra: number;
  readonly photos: ShotPhotos;
  /** Photos taken in the run, retakes included. */
  readonly shotsTaken: number;
  readonly device: string;
}

/** The plain text in the zip: what is taken, missing, ready and checked. */
export function summaryText(i: SummaryInput): string {
  const list = shotList(i.spots, i.extra);
  const pairs = derivedPairs(i.spots, i.extra);
  const taken = list.filter((s) => i.photos[s.id]);
  const missing = list.filter((s) => !i.photos[s.id]);
  const light = list.flatMap((s) => {
    const l = lightOf(s.id, i.photos);
    return l ? [`${s.id} ${l}`] : [];
  });
  const places = clampInt(i.spots, 1, MAX_SPOTS);
  return [
    "Feature matcher photo test - summary",
    `Session: ${i.session}`,
    `Shots taken: ${String(taken.length)} of ${String(list.length)} (light at ${String(places)} place${places === 1 ? "" : "s"})`,
    `Missing: ${missing.length ? missing.map((s) => s.id).join(", ") : "none"}`,
    `Pairs ready: ${String(readyPairs(pairs, i.photos).length)} of ${String(pairs.length)}`,
    `Light checks: ${light.length ? light.join(", ") : "-"}`,
    `Retakes: ${String(Math.max(0, i.shotsTaken - taken.length))}`,
    "Measured: none on the phone, measure on the PC",
    `File: ${runZipName(i.session)}`,
    `Phone: ${i.device}`,
    "No location, no time and no names are included.",
  ].join("\n");
}
