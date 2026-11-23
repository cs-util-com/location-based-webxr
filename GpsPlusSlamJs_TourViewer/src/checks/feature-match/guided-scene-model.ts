/**
 * The guided view's scene screens as plain data: the run screen (scene
 * header, shot strip, step card, finder chips, the two buttons), the
 * measuring progress per scene and the end view with the zip choice.
 * Read from the page state only; the view copies the fields into the DOM.
 *
 * @see guided-scene-model.ts.md
 */
import {
  measureProgress,
  planResultKeys,
  type FeatureMatchState,
  type MeasureProgress,
} from "./feature-match-slice";
import type { DiagramKind } from "./guided-diagram";
import {
  measureText,
  shotContext,
  warned,
  type ShotContext,
} from "./guided-model";
import {
  LIGHT_NOTE,
  OTHER_TAB_TEXT,
  SCENE_INTRO,
  STORE_CHIP_TEXT,
  shotCard,
} from "./guided-texts";
import { planNextOpen, planPhotos, planShots } from "./run-plan";
import {
  derivedPairs,
  lightOf,
  sceneList,
  type Scene,
  type Shot,
} from "./scenes";

/** What the two buttons are about now. */
export type RunMode = "counting" | "retake" | "warn" | "capture" | "allDone";

const plural = (n: number, word: string): string =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** "Light" or, with several places, "Light, place 2". */
export function sceneName(s: FeatureMatchState, sc: Scene): string {
  return sc.kind === "light" && s.plan.spots > 1
    ? `${sc.title}, place ${String(sc.spot)}`
    : sc.title;
}

const SHORT: Readonly<Record<Scene["kind"], string>> = {
  light: "Light",
  flat: "Flat",
  deep: "Deep",
  own: "Own",
};

/** The strip tab's name: "Light", "Light 2", "Flat", "Deep", "Own 1". */
export function sceneShort(s: FeatureMatchState, sc: Scene): string {
  if (sc.kind === "light" && s.plan.spots > 1) {
    return `${SHORT.light} ${String(sc.spot)}`;
  }
  if (sc.kind === "own" && s.plan.extra > 1) {
    return `${SHORT.own} ${sc.id.slice(4)}`;
  }
  return SHORT[sc.kind];
}

/** The scene's rule: the light scene's phone stands still, the rest is hand-held. */
export const sceneRule = (sc: Scene): "still" | "hand" =>
  sc.kind === "light" ? "still" : "hand";

const scenesOf = (s: FeatureMatchState): Scene[] =>
  sceneList(s.plan.spots, s.plan.extra);

/** A shot's state in the strip. */
export type ThumbState = "taken" | "open" | "skipped";

export const thumbState = (s: FeatureMatchState, shot: string): ThumbState =>
  s.plan.shots[shot]
    ? "taken"
    : s.plan.skipped.includes(shot)
      ? "skipped"
      : "open";

/** "about 25 s" under 50 s (rounded up to 5 s), else "about 3 min"; empty for none. */
export function etaText(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "";
  const sec = ms / 1000;
  if (sec < 50) return `about ${String(Math.max(5, Math.ceil(sec / 5) * 5))} s`;
  return `about ${String(Math.ceil(sec / 60))} min`;
}

export type BadgeKind = "waiting" | "measuring" | "done" | "failed" | "none";

export interface SceneProgress {
  readonly b: BadgeKind;
  readonly text: string;
  /** Measured share of the scene's ready pairs, 0 to 1. */
  readonly frac: number;
  /** About how long the scene's unmeasured pairs take; null unknown. */
  readonly leftMs: number | null;
  /** Every shot of the scene is taken or skipped. */
  readonly complete: boolean;
  /** Pairs of the scene with both photos. */
  readonly ready: number;
  readonly failed: number;
  /** The scene's keys not taken (open or skipped). */
  readonly missing: readonly string[];
}

/** One pair's measuring time so far (the queue's estimate per pair). */
function perPairMs(p: MeasureProgress): number | null {
  const left = p.total - p.done - p.failed;
  return p.estimateMs === null || left <= 0 ? null : p.estimateMs / left;
}

/** A scene's photos and measuring, as its strip badge and end row show it. */
export function sceneProgress(
  s: FeatureMatchState,
  sceneId: string,
  p: MeasureProgress = measureProgress(s),
): SceneProgress {
  const shots = planShots(s.plan).filter((x) => x.scene === sceneId);
  const missing = shots.filter((x) => !s.plan.shots[x.id]).map((x) => x.key);
  const closed = shots.filter((x) => thumbState(s, x.id) !== "open").length;
  const complete = closed === shots.length;
  const keys = [...planResultKeys(s.plan)].filter(
    ([, pair]) => pair.scene === sceneId,
  );
  const done = keys.filter(([k]) => s.results[k]?.status === "done").length;
  const failed = keys.filter(([k]) => s.results[k]?.status === "failed").length;
  const running = keys.some(([k]) => s.queue.running === k);
  const size = keys.length;
  const frac = size === 0 ? 0 : (done + failed) / size;
  const per = perPairMs(p);
  const leftMs = per === null ? null : per * (size - done - failed);
  const base = { frac, leftMs, complete, ready: size, failed, missing };
  if (!complete) {
    return {
      ...base,
      b: "waiting",
      text: `${String(closed)} of ${String(shots.length)}`,
    };
  }
  if (size === 0) return { ...base, b: "none", text: "nothing to measure" };
  if (done + failed === size) {
    return failed > 0
      ? { ...base, b: "failed", text: `${String(failed)} failed` }
      : { ...base, b: "done", text: "done" };
  }
  if (running) {
    const pct = Math.floor(frac * 100);
    return {
      ...base,
      b: "measuring",
      text: pct >= 1 ? `measuring ${String(pct)}%` : "measuring",
    };
  }
  if (p.stopped) return { ...base, b: "failed", text: "stopped" };
  return { ...base, b: "waiting", text: "waiting" };
}

/** The mode of the run screen's two buttons and card. */
export function runMode(
  s: FeatureMatchState,
  c: ShotContext = shotContext(s),
): RunMode {
  if (s.guided.count) return "counting";
  if (!c.photo) return "capture";
  if (warned(c.light)) return "warn";
  if (s.guided.retake || planNextOpen(s.plan, -1) !== null) return "retake";
  return "allDone";
}

/** Every shot of the scene still open: its first shot is next. */
const sceneStart = (s: FeatureMatchState, sceneId: string): boolean =>
  planShots(s.plan)
    .filter((x) => x.scene === sceneId)
    .every((x) => thumbState(s, x.id) === "open");

export interface StripSeg {
  readonly scene: string;
  readonly name: string;
  readonly selected: boolean;
  /** The current shot is in this scene. */
  readonly now: boolean;
  readonly badge: {
    readonly b: BadgeKind;
    readonly text: string;
    readonly title: string;
  };
}

export interface StripThumb {
  readonly shot: string;
  readonly index: number;
  readonly key: string;
  readonly state: ThumbState;
  /** "step": the shot to take now; "retake": the one chosen for a retake. */
  readonly mark: "step" | "retake" | null;
  readonly warn: boolean;
  /** The photo id drawn in it; null without one. */
  readonly photo: string | null;
  readonly label: string;
}

export interface StripView {
  readonly segs: readonly StripSeg[];
  readonly thumbs: readonly StripThumb[];
  /** The line beside a short scene's thumbs; empty for a long one. */
  readonly hint: string;
}

const THUMB_WORDS: Readonly<Record<ThumbState, string>> = {
  taken: "taken, tap to retake",
  open: "not taken yet",
  skipped: "skipped, tap to take it",
};

/** The strip: a tab per scene and the thumbs of the scene `browse` (else the current one). */
export function stripView(
  s: FeatureMatchState,
  browse: string | null,
): StripView {
  const c = shotContext(s);
  const mode = runMode(s, c);
  const scenes = scenesOf(s);
  const shown = scenes.some((sc) => sc.id === browse) ? browse! : c.shot.scene;
  const p = measureProgress(s);
  const segs = scenes.map((sc): StripSeg => {
    const pr = sceneProgress(s, sc.id, p);
    const eta = etaText(pr.leftMs);
    return {
      scene: sc.id,
      name: sceneShort(s, sc),
      selected: sc.id === shown,
      now: sc.id === c.shot.scene,
      badge: {
        b: pr.b,
        text: pr.text,
        title: eta ? `${pr.text}, ${eta} left` : pr.text,
      },
    };
  });
  const photos = planPhotos(s.plan);
  const list = planShots(s.plan);
  const thumbs = list
    .map((shot, index) => ({ shot, index }))
    .filter(({ shot }) => shot.scene === shown)
    .map(({ shot, index }): StripThumb => {
      const st = thumbState(s, shot.id);
      const target = index === c.index && mode !== "allDone";
      return {
        shot: shot.id,
        index,
        key: shot.key,
        state: st,
        mark: !target ? null : mode === "retake" ? "retake" : "step",
        warn: warned(lightOf(shot.id, photos)),
        photo: s.plan.shots[shot.id]?.photo.id ?? null,
        label: `${shot.key} ${shotCard(shot).title}: ${THUMB_WORDS[st]}`,
      };
    });
  const anyTaken = Object.keys(s.plan.shots).length > 0;
  return {
    segs,
    thumbs,
    hint:
      thumbs.length <= 4
        ? anyTaken
          ? "Tap a photo to retake it"
          : "Your photos appear here"
        : "",
  };
}

export interface Banner {
  /** "retake", "warn", or the scene's rule for a new scene. */
  readonly kind: "retake" | "warn" | "still" | "hand";
  readonly title: string;
  readonly text: string;
  /** The previous scene is still measured; dropped on a short screen. */
  readonly extra: string;
}

export interface CardView {
  readonly banner: Banner | null;
  readonly code: string;
  readonly codeMode: "" | "retake" | "done";
  readonly title: string;
  readonly count: string;
  readonly diagram: DiagramKind | null;
  readonly steps: readonly string[];
  readonly note: string;
}

interface ButtonView {
  readonly label: string;
  readonly sub: string;
  readonly disabled: boolean;
  readonly look: "" | "counting" | "retake" | "next";
}

/** What the secondary button does. */
export type SecondaryAct =
  "skip-photo" | "skip-scene" | "back" | "keep" | "none";

export interface RunView {
  readonly mode: RunMode;
  readonly scene: string;
  readonly kicker: string;
  readonly sceneName: string;
  readonly rule: "still" | "hand";
  readonly ruleText: string;
  readonly card: CardView;
  readonly finder: {
    /** "Do not move the phone" on the still scene. */
    readonly still: boolean;
    /** The base photo can be laid over the finder. */
    readonly ghost: { readonly label: string; readonly photo: string } | null;
    /** The camera line while it is not running; empty once it runs. */
    readonly camera: string;
    /** The saved chip: durable photos, or why they are not. */
    readonly saved: { readonly text: string; readonly warn: boolean };
  };
  readonly primary: ButtonView;
  readonly secondary: ButtonView & { readonly act: SecondaryAct };
}

function retakeBanner(s: FeatureMatchState, c: ShotContext): Banner {
  const sh = c.shot;
  const turns = sh.kind === "flat" && (sh.key === "F1" || sh.key === "F2");
  const n = c.redoes;
  const using =
    n > 0
      ? `${plural(n, "pair")} use${n > 1 ? "" : "s"} it${turns ? ", the computed turns included" : ""}; ${n > 1 ? "they are" : "it is"} measured again. `
      : "";
  return {
    kind: "retake",
    title:
      sh.step === 0 ? `Retake ${sh.key}, the base photo` : `Retake ${sh.key}`,
    text: `${using}${sh.kind === "light" ? "Put the phone back exactly where it stood. " : ""}The other photos stay.`,
    extra: "",
  };
}

function startBanner(s: FeatureMatchState, sh: Shot): Banner {
  const scenes = scenesOf(s);
  const at = scenes.findIndex((x) => x.id === sh.scene);
  const sc = scenes[at]!;
  const prev = scenes[at - 1];
  const place = sc.kind === "light" && sc.spot > 1;
  const pr = prev ? sceneProgress(s, prev.id) : null;
  return {
    kind: sceneRule(sc),
    title: `${place ? "New place" : "New scene"}: ${sceneName(s, sc)}`,
    text: place
      ? "Stand the phone somewhere else, aimed at another detailed spot. It stays there for all four photos."
      : SCENE_INTRO[sc.kind],
    extra:
      prev && pr && (pr.b === "measuring" || pr.b === "waiting") && pr.complete
        ? ` ${sceneName(s, prev)} is being measured in the background - carry on.`
        : "",
  };
}

function cardView(
  s: FeatureMatchState,
  c: ShotContext,
  mode: RunMode,
): CardView {
  if (mode === "allDone") {
    return {
      banner: null,
      code: "All",
      codeMode: "done",
      title: "Every photo is taken",
      count: "",
      diagram: null,
      steps: [
        "Tap any photo in the strip above to retake it.",
        "Or see the measuring and make the zip.",
      ],
      note: "",
    };
  }
  const sh = c.shot;
  const card = shotCard(sh);
  const inScene = c.list.filter((x) => x.scene === sh.scene);
  const first = sh.step === 0;
  let banner: Banner | null = null;
  let note = card.purpose;
  if (mode === "retake") {
    banner = retakeBanner(s, c);
  } else if (mode === "warn" && c.light) {
    banner = {
      kind: "warn",
      title: "The light check is not happy",
      text: LIGHT_NOTE[c.light],
      extra: "",
    };
  } else if (sceneStart(s, sh.scene)) {
    banner = startBanner(s, sh);
  } else if (sh.kind === "light" && c.prev) {
    // Quiet feedback: the light check of the scene's previous shot.
    const prevLight = lightOf(c.prev.id, planPhotos(s.plan));
    if (prevLight === "ok") {
      note = `${c.prev.key}: light check ok. ${note}`;
    }
  }
  if (first && mode !== "retake") {
    note = `The base photo: ${plural(c.redoes, "pair")} compare${c.redoes === 1 ? "s" : ""} against it. ${note}`;
  }
  return {
    banner,
    code: sh.key,
    codeMode: mode === "retake" || mode === "warn" ? "retake" : "",
    title: card.title,
    count: `photo ${String(sh.step + 1)} of ${String(inScene.length)}`,
    diagram: card.diagram,
    steps: [
      first ? card.setup : card.change,
      card.capture,
      `Avoid: ${card.avoid}`,
    ],
    note,
  };
}

function cameraLine(s: FeatureMatchState): string {
  if (s.camera) return "";
  if (s.cameraStart === "starting") return "Starting the camera...";
  if (s.cameraStart === "failed")
    return "Camera unavailable: tap Capture to retry";
  return "Camera off: tap Capture";
}

function savedChip(s: FeatureMatchState): RunView["finder"]["saved"] {
  if (s.otherTab) return { text: OTHER_TAB_TEXT, warn: true };
  if (s.photoStoreFailing) return { text: STORE_CHIP_TEXT, warn: true };
  const n = s.storedIds.length;
  return {
    text: n
      ? `${plural(n, "photo")} saved on this phone`
      : "Photos are saved as you go",
    warn: false,
  };
}

/** The run screen for the current shot. */
export function runView(s: FeatureMatchState): RunView {
  const c = shotContext(s);
  const mode = runMode(s, c);
  const sh = c.shot;
  const scenes = scenesOf(s);
  const sc = scenes.find((x) => x.id === sh.scene)!;
  const main = scenes.filter((x) => x.kind !== "own").length;
  const at = scenes.findIndex((x) => x.id === sc.id);
  const rule = sceneRule(sc);
  const busy = s.busy !== "idle" || s.otherTab;
  const shoots = mode === "capture" || mode === "retake" || mode === "warn";
  const secs = s.plan.settings.countdown;
  const after = secs ? `then ${String(secs)} s hands off` : "shoots at once";
  const camWait = !s.camera && s.cameraStart === "starting";
  const sub = s.camera
    ? after
    : s.cameraStart === "failed"
      ? "camera unavailable: tap to retry"
      : camWait
        ? "waiting for the camera"
        : "tap to start the camera";
  const primary = ((): ButtonView => {
    const disabled = busy || (shoots && camWait);
    switch (mode) {
      case "counting":
        return {
          label: "Cancel",
          sub: `shooting ${sh.key} in ${String(s.guided.count!.left)} s`,
          disabled: busy,
          look: "counting",
        };
      case "warn":
        if (c.fixAt !== c.index) {
          const fix = c.list[c.fixAt]!;
          return {
            label: `Back to ${fix.key}`,
            sub: `${fix.key} is too dark to dim from`,
            disabled: busy,
            look: "retake",
          };
        }
        return { label: `Retake ${sh.key}`, sub, disabled, look: "retake" };
      case "retake":
        return { label: `Retake ${sh.key}`, sub, disabled, look: "retake" };
      case "capture":
        return { label: `Capture ${sh.key}`, sub, disabled, look: "" };
      case "allDone":
        return {
          label: "See the measuring",
          sub: "and make the zip",
          disabled: false,
          look: "next",
        };
    }
  })();
  const secondary = ((): RunView["secondary"] => {
    const off = { sub: "", look: "" as const };
    switch (mode) {
      case "counting":
        return {
          ...off,
          label: "Skip photo",
          disabled: true,
          act: "skip-photo",
        };
      case "retake": {
        const next = planNextOpen(s.plan, -1);
        return {
          ...off,
          label: next === null ? "Cancel" : `Back to ${c.list[next]!.key}`,
          disabled: busy,
          act: "back",
        };
      }
      case "warn":
        return { ...off, label: "Keep it, go on", disabled: busy, act: "keep" };
      case "capture":
        return sceneStart(s, sh.scene)
          ? { ...off, label: "Skip scene", disabled: busy, act: "skip-scene" }
          : { ...off, label: "Skip photo", disabled: busy, act: "skip-photo" };
      case "allDone":
        return { ...off, label: "", disabled: true, act: "none" };
    }
  })();
  const base = c.list.find((x) => x.scene === sh.scene && x.step === 0)!;
  const basePhoto = s.plan.shots[base.id]?.photo.id;
  return {
    mode,
    scene: sc.id,
    kicker:
      sc.kind === "own"
        ? "Extra"
        : `Scene ${String(at + 1)} of ${String(main)}`,
    sceneName: sceneName(s, sc),
    rule,
    ruleText: rule === "still" ? "Phone stays still" : "Hand-held",
    card: cardView(s, c, mode),
    finder: {
      still: rule === "still" && mode !== "allDone",
      ghost:
        basePhoto && sh.step > 0 && mode !== "counting" && mode !== "allDone"
          ? { label: `Show ${base.key}`, photo: basePhoto }
          : null,
      camera: cameraLine(s),
      saved: savedChip(s),
    },
    primary,
    secondary,
  };
}

export interface EndRow {
  readonly scene: string;
  readonly name: string;
  readonly pairs: string;
  readonly badge: { readonly b: BadgeKind; readonly text: string };
  /** The progress bar's share, or null when the row shows a note instead. */
  readonly bar: number | null;
  readonly note: string;
}

export interface EndView {
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly eta: { readonly text: string; readonly done: boolean };
  readonly rows: readonly EndRow[];
  /** "Good enough" / "Wait": shown while pairs wait to be measured. */
  readonly choice: {
    readonly shown: boolean;
    readonly now: string;
    readonly wait: string;
  };
  /** "Retry failed": shown while a failure kept for this load only exists. */
  readonly retry: { readonly shown: boolean; readonly text: string };
  readonly download: {
    readonly label: string;
    readonly sub: string;
    readonly disabled: boolean;
    /** The waiting button doubles as the progress bar (0 to 100). */
    readonly waiting: number | null;
    /** "err" paints the button red after a failed zip. */
    readonly tone: "" | "ok" | "err";
  };
  readonly state: { readonly text: string; readonly tone: "" | "ok" | "err" };
  readonly trust: { readonly text: string; readonly warn: boolean };
  /** The shots without a photo, as buttons that take them now. */
  readonly missing: readonly {
    readonly index: number;
    readonly label: string;
  }[];
}

function rowOf(s: FeatureMatchState, sc: Scene, p: MeasureProgress): EndRow {
  const pr = sceneProgress(s, sc.id, p);
  const pairs = derivedPairs(s.plan.spots, s.plan.extra).filter(
    (x) =>
      x.scene === sc.id &&
      !s.plan.skipped.includes(x.a) &&
      !s.plan.skipped.includes(x.b),
  ).length;
  const eta = etaText(pr.leftMs);
  const barShown = pr.complete && pr.ready > 0;
  const n = pr.missing.length;
  return {
    scene: sc.id,
    name: sceneName(s, sc),
    pairs: plural(pairs, "pair"),
    badge: {
      b: pr.b,
      text: pr.b === "measuring" && eta ? eta : pr.text,
    },
    bar: barShown ? pr.frac : null,
    note: barShown
      ? ""
      : !pr.complete
        ? `${pr.missing.join(", ")} ${n > 1 ? "are" : "is"} not taken yet.`
        : "No pair left to measure: photos were skipped.",
  };
}

function downloadOf(
  s: FeatureMatchState,
  p: MeasureProgress,
  pend: number,
  left: string,
): EndView["download"] {
  const taken = Object.keys(s.plan.shots).length;
  const z = s.runZip;
  const ready = planResultKeys(s.plan).size > 0;
  const blocked = s.busy !== "idle" || s.otherTab || !ready;
  const sub = ready
    ? `${plural(taken, "photo")}, ${plural(p.done, "result")}`
    : "Needs two photos of one scene first";
  if (z.phase === "preparing") {
    return {
      label: "Packing the zip...",
      sub: "",
      disabled: true,
      waiting: null,
      tone: "",
    };
  }
  if (pend > 0 && !p.stopped && s.guided.choice === "wait") {
    return {
      label: "Waiting for the rest",
      sub: left ? `${left} left, then it is ready` : "then it is ready",
      disabled: true,
      waiting: Math.round((100 * (p.done + p.failed)) / Math.max(1, p.total)),
      tone: "",
    };
  }
  if (z.phase === "failed") {
    return {
      label: "Download failed - try again",
      sub,
      disabled: blocked,
      waiting: null,
      tone: "err",
    };
  }
  if (z.phase === "saved") {
    return {
      label: "Download again",
      sub,
      disabled: blocked,
      waiting: null,
      tone: "ok",
    };
  }
  return {
    label: pend > 0 ? "Make the zip now" : "Download the zip",
    sub,
    disabled: blocked,
    waiting: null,
    tone: "",
  };
}

/** The end view: the measuring per scene, the choice and the zip. */
export function endView(s: FeatureMatchState): EndView {
  const p = measureProgress(s);
  const list = planShots(s.plan);
  const taken = list.filter((x) => s.plan.shots[x.id]).length;
  const pend = p.total - p.done - p.failed;
  const per = perPairMs(p);
  const left = etaText(per === null ? null : per * pend);
  const stopped = p.stopped && pend > 0;
  const retryN = Object.values(s.results).filter(
    (e) => e.status === "failed" && !e.persisted,
  ).length;
  const stored = s.storedIds.length;
  const kept = Object.values(s.results).filter((e) => e.persisted).length;
  const z = s.runZip;
  return {
    kicker:
      taken === list.length
        ? "All photos taken"
        : `${String(taken)} of ${String(list.length)} photos taken`,
    title: stopped
      ? "Measuring stopped"
      : pend > 0
        ? "Measuring the last pairs"
        : p.total > 0
          ? "Everything is measured"
          : "Nothing measured yet",
    lede: stopped
      ? measureText(p)
      : pend > 0
        ? "The phone keeps measuring while this page is open. Make the zip now with what is finished, or wait for the rest."
        : p.total > 0
          ? "One zip holds every photo, every result and the log."
          : "A pair is measured as soon as its two photos are taken. The zip can be made once one pair is ready.",
    eta: {
      text: stopped
        ? "stopped"
        : pend > 0
          ? left
            ? `${left} left`
            : p.running !== null
              ? "loading the models"
              : ""
          : p.total > 0
            ? "all done"
            : "",
      done: pend === 0 && p.total > 0,
    },
    rows: scenesOf(s).map((sc) => rowOf(s, sc, p)),
    choice: {
      shown: pend > 0 && !stopped,
      now: `${String(p.done)} of ${String(p.total)} results go in now. The rest is measured on the PC later.`,
      wait: `${left ? `${left} more. ` : ""}The download wakes up by itself when it is done.`,
    },
    retry: {
      shown: retryN > 0,
      text: `${plural(retryN, "pair")} failed on this phone (a crash or a model that did not load).`,
    },
    download: downloadOf(s, p, pend, left),
    state: {
      text: z.text,
      tone: z.phase === "failed" ? "err" : z.phase === "saved" ? "ok" : "",
    },
    trust: s.photoStoreFailing
      ? {
          text: "Some photos could not be stored on this phone, so a reload would lose them: download now.",
          warn: true,
        }
      : {
          text: `Saved on this phone: ${plural(stored, "photo")}, the log and ${plural(kept, "result")}. A reload continues right here; the zip can be made any time.`,
          warn: false,
        },
    missing: list
      .map((x, index) => ({ x, index }))
      .filter(({ x }) => !s.plan.shots[x.id])
      .map(({ x, index }) => ({
        index,
        label: `${x.key}${x.kind === "light" && s.plan.spots > 1 ? ` (place ${String(x.spot)})` : ""}${s.plan.skipped.includes(x.id) ? ", skipped" : ""}`,
      })),
  };
}
