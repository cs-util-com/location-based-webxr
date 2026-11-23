/**
 * The photo test's run zip, read from storage: every shot's photo once,
 * a frames JSON per ready pair naming its two shot files (and for the
 * rotation pairs the centre squares and the turn), a matches JSON per
 * pair the phone measured, the summary and the log. The photos come
 * through a reader, so the zip is the same after a reload.
 *
 * @see run-zip.ts.md
 */
import { FRAME_FILES, PAIRS } from "./bench-export";
import type { DeviceInfo } from "./bench-report";
import type { ResultEntry } from "./feature-match-slice";
import { centreCrop, turnOf } from "./rotation-square";
import { planPhotos, planShots, type RunPlan } from "./run-plan";
import {
  derivedPairs,
  lightOf,
  readyResultKeys,
  type DerivedPair,
} from "./scenes";

/** The format tag of a pair's frames JSON in the run zip. */
export const RUN_FRAMES_FORMAT = "feature-match-frames/2";
/** The summary file inside the run zip. */
export const SUMMARY_FILE = "feature-match-summary.txt";
/** The log file inside the run zip. */
export const LOG_FILE = FRAME_FILES.log;

/** A shot's photo in the zip: `shots/<scene id>/<shot key>-t<take>.png`. */
export const shotFile = (shot: string, take: number): string =>
  `shots/${shot}-t${String(take)}.png`;

/** A pair's folder in the zip: `pairs/<scene id>/<pair name>`. */
const pairDir = (p: DerivedPair): string => `pairs/${p.id}`;

export interface ZipEntry {
  readonly path: string;
  readonly data: Blob | string;
}

export interface RunZipInput {
  readonly plan: RunPlan;
  readonly session: string;
  readonly results: Readonly<Record<string, ResultEntry>>;
  readonly device: DeviceInfo;
  /** The long edge photos were captured at, at most. */
  readonly captureMaxLongEdge: number;
  readonly summary: string;
  readonly log: string;
  /** A photo's PNG by its id; rejects when it cannot be read. */
  readonly photo: (id: string) => Promise<Blob>;
  /** A measured pair's matches JSON by result key; undefined when none. */
  readonly matches: (key: string) => Promise<string | undefined>;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * A ready pair's frames JSON: the protocol key and label, the derived
 * pair, its axis and control role, the light check, and per frame its
 * shot, take, file, sizes and grey mean (and the centre square for a
 * rotation pair, whose turn is given once). No time and no place.
 */
function framesJson(p: DerivedPair, i: RunZipInput): string {
  const turn = turnOf(p.kind);
  const frame = (name: "A" | "B", shot: string) => {
    const r = i.plan.shots[shot]!;
    const ph = r.photo;
    return {
      name,
      shot,
      take: r.take,
      file: shotFile(shot, r.take),
      width: ph.width,
      height: ph.height,
      sourceWidth: ph.source.width,
      sourceHeight: ph.source.height,
      greyMean: round2(ph.greyMean),
      ...(ph.greySd === undefined ? {} : { greySd: round2(ph.greySd) }),
      ...(turn === null ? {} : { crop: centreCrop(ph.width, ph.height) }),
    };
  };
  return `${JSON.stringify(
    {
      format: RUN_FRAMES_FORMAT,
      pair: p.legacy,
      pairLabel: PAIRS.find((x) => x.key === p.legacy)?.label ?? p.legacy,
      derivedPair: p.id,
      kind: p.kind,
      spot: p.spot,
      axis: p.axis,
      control: p.controlFor.length > 0,
      controlFor: p.controlFor,
      session: i.session,
      lightCheck: lightOf(p.b, planPhotos(i.plan)),
      captureMaxLongEdge: i.captureMaxLongEdge,
      frames: [frame("A", p.a), frame("B", p.b)],
      ...(turn === null ? {} : { turn: { degrees: turn, direction: "cw" } }),
      device: i.device,
    },
    null,
    2,
  )}\n`;
}

/**
 * The run zip's files in order: the shots in run order, then per ready
 * pair its frames JSON and, when the phone measured it, its matches JSON,
 * then the summary and the log.
 *
 * @throws whatever `photo` rejects with, so a photo that cannot be read
 *   fails the zip instead of leaving a hole in it.
 */
export async function runZipFiles(i: RunZipInput): Promise<ZipEntry[]> {
  const files: ZipEntry[] = [];
  for (const shot of planShots(i.plan)) {
    const r = i.plan.shots[shot.id];
    if (r) {
      files.push({
        path: shotFile(shot.id, r.take),
        data: await i.photo(r.photo.id),
      });
    }
  }
  const ready = readyResultKeys(
    derivedPairs(i.plan.spots, i.plan.extra),
    planPhotos(i.plan),
  );
  for (const [key, p] of ready) {
    files.push({
      path: `${pairDir(p)}/${FRAME_FILES.info}`,
      data: framesJson(p, i),
    });
    const matches =
      i.results[key]?.status === "done" ? await i.matches(key) : undefined;
    if (matches !== undefined) {
      files.push({
        path: `${pairDir(p)}/${FRAME_FILES.matches}`,
        data: matches,
      });
    }
  }
  files.push(
    { path: SUMMARY_FILE, data: i.summary },
    { path: LOG_FILE, data: i.log },
  );
  return files;
}
