/**
 * The cockpit view of the feature matching page (`?ui=cockpit`): the four
 * steps (photo A, photo B, run, save) with the pair selector, the guide
 * card, the light warning and the save links, and the flat target mode
 * picked in the selector. The measuring block is `bench-engine.ts`'s.
 *
 * @see cockpit-view.ts.md
 */
import { captureFrame, framePng } from "./bench-dom";
import { $, CAPTURE_MAX, type BenchEngine } from "./bench-engine";
import {
  allFilesZip,
  FLAT_MODE,
  FRAME_FILES,
  framesInfo,
  matchesInfo,
  NO_PAIR,
  PAIRS,
  pairFileNames,
  parseSpot,
  type LightCheck,
  type PairKey,
} from "./bench-export";
import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import { describeGrey, greyStats } from "./bench-image";
import { formatBytes } from "./bench-net";
import { stepStates } from "./bench-steps";
import type { CameraControl } from "./camera-control";
import {
  canSave,
  featureMatchActions as A,
  flowState,
  logText,
  type FeatureMatchState,
  type Offered,
  type PairNote,
  type StatusSlot,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";

/** Set once "Before you start" has been shown open; it then starts closed. */
const BEFORE_START_SEEN = "feature-match-check.before-start-seen";

/** The cockpit's own elements, found once. */
interface Ui {
  readonly steps: readonly HTMLElement[];
  readonly cameraBox: HTMLElement;
  readonly video: HTMLVideoElement;
  readonly pair: HTMLSelectElement;
  readonly spot: HTMLInputElement;
  readonly beforeStart: HTMLDetailsElement;
  readonly beforeStartList: HTMLElement;
  readonly guidePurpose: HTMLElement;
  readonly guideSteps: HTMLElement;
  readonly guideAvoid: HTMLElement;
  readonly guideSpot: HTMLElement;
  readonly lightWarning: HTMLElement;
  readonly pairState: HTMLElement;
  readonly captureA: HTMLButtonElement;
  readonly captureB: HTMLButtonElement;
  readonly stateA: HTMLElement;
  readonly stateB: HTMLElement;
  readonly run: HTMLButtonElement;
  readonly runState: HTMLElement;
  readonly saveFrames: HTMLButtonElement;
  readonly saveState: HTMLElement;
  readonly saveLinks: HTMLElement;
}

const findUi = (root: ParentNode): Ui => ({
  steps: [1, 2, 3, 4].map((n) => $(root, `#step-${String(n)}`)),
  cameraBox: $(root, "#camera-box"),
  video: $(root, "#video"),
  pair: $(root, "#pair"),
  spot: $(root, "#spot"),
  beforeStart: $(root, "#before-start"),
  beforeStartList: $(root, "#before-start-list"),
  guidePurpose: $(root, "#guide-purpose"),
  guideSteps: $(root, "#guide-steps"),
  guideAvoid: $(root, "#guide-avoid"),
  guideSpot: $(root, "#guide-spot"),
  lightWarning: $(root, "#light-warning"),
  pairState: $(root, "#pair-state"),
  captureA: $(root, "#capture-a"),
  captureB: $(root, "#capture-b"),
  stateA: $(root, "#state-a"),
  stateB: $(root, "#state-b"),
  run: $(root, "#run"),
  runState: $(root, "#run-state"),
  saveFrames: $(root, "#save-frames"),
  saveState: $(root, "#save-state"),
  saveLinks: $(root, "#save-links"),
});

const listItems = (texts: readonly string[]): HTMLLIElement[] =>
  texts.map((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    return li;
  });

/**
 * "Before you start" is open on the first visit and closed on later ones.
 * Storage may be blocked (private mode): it is then open every time.
 */
function openBeforeStartOnce(box: HTMLDetailsElement): void {
  try {
    box.open = localStorage.getItem(BEFORE_START_SEEN) === null;
    localStorage.setItem(BEFORE_START_SEEN, "1");
  } catch {
    box.open = true;
  }
}

/** The warning shown above the results for a light check that failed. */
const LIGHT_WARNINGS: Readonly<Record<Exclude<LightCheck, "ok">, string>> = {
  "not-darker":
    "Photo B is not darker than photo A - the light has to change BETWEEN the two photos. Take this pair again: photo A in normal light, then dim, then photo B. If you did dim, dim further (switch off more lights): the camera brightens a dim picture by itself.",
  "too-dark-a":
    "Photo A is almost black - there is too little light to measure a dimming against. Take this pair again with the light on as normal for photo A.",
  "too-dark-b":
    "Photo B is black - nothing is left to match. Take this pair again and dim a little less: the room's shapes must stay visible on the screen.",
  changed:
    "Photo B is more than 20 % brighter or darker than photo A - the light changed during the control pair. Take this pair again without changing the light.",
};

/** The pair line under the selector. */
function pairNoteText(n: PairNote): string {
  const t = n.tag;
  switch (n.kind) {
    case "now":
      return `now: pair ${String(t.sequence)}, ${t.pair} ${t.pairLabel}, spot ${String(t.spot)}`;
    case "kept":
      return `saved pair ${String(t.sequence)}; the light check failed: take ${t.pair} again`;
    case "next":
      return `saved pair ${String(t.sequence)}; next: ${n.next.key}, spot ${String(n.next.spot)}`;
  }
}

export interface CockpitDeps {
  readonly root: ParentNode;
  readonly fm: FeatureMatchStore;
  readonly engine: BenchEngine;
  readonly camera: CameraControl;
  readonly log: (line: string) => void;
  readonly fail: (where: string, e: unknown) => void;
}

/** The cockpit's video element, for the page's camera. */
export const cockpitVideo = (root: ParentNode): HTMLVideoElement =>
  $(root, "#video");

/** Wires the cockpit found under `root`; returns its render. */
export function startCockpitView(deps: CockpitDeps): () => void {
  const { root, fm, engine, camera, log, fail } = deps;
  const { store, sides, newId, accepted, put } = fm;
  const ui = findUi(root);
  const state = (): FeatureMatchState => store.getState();
  const status = (slot: StatusSlot, text: string): void => {
    store.dispatch(A.statusSet({ slot, text }));
  };

  ui.pair.replaceChildren(
    ...[...PAIRS, NO_PAIR, FLAT_MODE].map((p) => {
      const option = document.createElement("option");
      option.value = p.key;
      option.textContent =
        p.key === NO_PAIR.key
          ? "none: manual run with the Options"
          : p.key === FLAT_MODE.key
            ? "flat: flat target capture (own steps)"
            : `${p.key} ${p.label}`;
      return option;
    }),
  );
  ui.beforeStartList.replaceChildren(...listItems(BEFORE_YOU_START));
  openBeforeStartOnce(ui.beforeStart);

  // --- render -----------------------------------------------------------

  const idleRun = ui.run.textContent;
  const statusEls: Readonly<
    Record<Exclude<StatusSlot, "synthetic" | "speed" | "copy">, HTMLElement>
  > = {
    a: ui.stateA,
    b: ui.stateB,
    run: ui.runState,
    save: ui.saveState,
  };

  /** The guidance card follows the selector. */
  const showGuide = (pair: string): void => {
    if (pair === FLAT_MODE.key) {
      return;
    }
    const g = PAIR_GUIDE[pair as PairKey];
    ui.guidePurpose.textContent = g.purpose;
    ui.guideSteps.replaceChildren(
      ...listItems(g.steps).map((li, i) => {
        if (i < g.strongSteps) {
          const strong = document.createElement("strong");
          strong.textContent = li.textContent;
          li.replaceChildren(strong);
        }
        return li;
      }),
    );
    ui.guideAvoid.textContent = `Avoid: ${g.avoid}`;
    ui.guideSpot.textContent = SPOT_NOTE;
    ui.guideSpot.hidden = !g.spotNote;
  };

  /** The offered files as links; any tap counts as downloaded. */
  const renderLinks = (offered: readonly Offered[]): void => {
    ui.saveLinks.replaceChildren(
      ...offered.map((o) => {
        const link = document.createElement("a");
        link.href = sides.urls.get(o.id) ?? "";
        link.download = o.file;
        link.textContent = o.text;
        // Any link counts as saved, the single files too: a retake of
        // photo B must then get a new running number.
        link.addEventListener("click", downloaded);
        return link;
      }),
    );
  };

  /** What was drawn last, so only what changed is drawn again. */
  let drawn: FeatureMatchState | null = null;

  /** Buttons, labels, step marks and texts from the state. */
  const render = (): void => {
    const s = state();
    const was = drawn;
    drawn = s;
    const idle = s.busy === "idle";
    ui.captureA.disabled = !idle;
    ui.captureB.disabled = !idle || s.photos.a === null;
    ui.captureA.textContent = s.camera ? "Take photo A" : "Start camera";
    ui.captureB.textContent =
      s.camera || s.photos.a === null ? "Take photo B" : "Start camera";
    ui.run.disabled = !idle || s.photos.a === null || s.photos.b === null;
    ui.saveFrames.disabled = !canSave(s);
    ui.run.textContent = s.running === "camera" ? "Running..." : idleRun;
    ui.cameraBox.hidden = !s.camera;
    const states = stepStates(flowState(s));
    for (const [i, li] of ui.steps.entries()) {
      li.dataset.state = states[i];
      if (states[i] === "current") {
        li.setAttribute("aria-current", "step");
      } else {
        li.removeAttribute("aria-current");
      }
    }
    for (const [slot, el] of Object.entries(statusEls)) {
      el.textContent = s.status[slot as StatusSlot];
    }
    ui.lightWarning.hidden = s.light === null || s.light === "ok";
    if (s.light !== null && s.light !== "ok") {
      ui.lightWarning.textContent = LIGHT_WARNINGS[s.light];
    }
    if (s.pairNote !== null) {
      ui.pairState.textContent = pairNoteText(s.pairNote);
    }
    // The selector and the spot field are drawn only when the state
    // moved them, so a field being typed in is never overwritten.
    if (was?.progress.pair !== s.progress.pair) {
      ui.pair.value = s.progress.pair;
      showGuide(s.progress.pair);
    }
    if (was?.progress.spot !== s.progress.spot) {
      ui.spot.value = String(s.progress.spot);
    }
    if (was?.offered !== s.offered) {
      renderLinks(s.offered);
    }
  };

  // --- selector -------------------------------------------------------------

  const selectorChanged = (): void => {
    store.dispatch(
      A.selectorChanged({
        pair: ui.pair.value,
        spot: parseSpot(ui.spot.value),
      }),
    );
  };
  ui.pair.addEventListener("change", selectorChanged);
  ui.spot.addEventListener("change", selectorChanged);

  // --- photos ---------------------------------------------------------------

  /**
   * A capture tap: with the camera off it only starts the camera (so the
   * photo is aimed, and not the camera's first frame); with it on it takes
   * the photo. Photo A starts a new pair; photo B starts the run.
   */
  const capture = (which: "a" | "b") => async (): Promise<void> => {
    const name = which === "a" ? "A" : "B";
    if (!camera.on()) {
      status(which, "starting camera...");
      const started = await camera.start();
      status(
        which,
        started === "on"
          ? `camera on: aim, then tap Take photo ${name}`
          : started === "failed"
            ? "camera unavailable (see log)"
            : "camera stopped: tap again",
      );
      return;
    }
    if (state().busy !== "idle") {
      return;
    }
    if (ui.video.videoWidth === 0) {
      status(which, "camera not ready yet: tap again");
      log("capture: the camera has no picture yet");
      return;
    }
    const f = captureFrame(ui.video, CAPTURE_MAX);
    const source = {
      width: ui.video.videoWidth,
      height: ui.video.videoHeight,
    };
    const grey = greyStats(f);
    log(
      `captured ${name} ${String(f.width)}x${String(f.height)} (camera ${String(source.width)}x${String(source.height)}), ${describeGrey(grey)}`,
    );
    const id = newId("photo");
    const before = state();
    put(
      sides.frames,
      [[id, { name, frame: f, source }]],
      A.photoTaken({
        which,
        photo: {
          id,
          width: f.width,
          height: f.height,
          source,
          greyMean: grey.mean,
        },
      }),
    );
    const after = state();
    const t = after.pairInProgress;
    if (t && after.pairNote !== before.pairNote) {
      log(
        `pair ${String(t.sequence)}: ${t.pair} ${t.pairLabel}, spot ${String(t.spot)}`,
      );
    }
    if (which === "b" && after.photos.b?.id === id) {
      if (after.light !== null) {
        log(`light check: ${after.light}`);
      }
      engine.startRun("camera");
    }
  };

  /** The pair's files: [download name, link text, bytes], the zip first. */
  const saveFiles = async (): Promise<[string, string, Blob][]> => {
    const s = state();
    const a = s.photos.a ? sides.frames.get(s.photos.a.id) : undefined;
    const b = s.photos.b ? sides.frames.get(s.photos.b.id) : undefined;
    const tag = s.pairInProgress;
    if (!a || !b || !tag) {
      throw new Error("no photo pair to save");
    }
    const names = pairFileNames(tag);
    const info = framesInfo(
      [a, b],
      await engine.deviceInfo(),
      CAPTURE_MAX,
      tag,
      {
        light: s.light,
        session: s.session,
      },
    );
    const results = s.resultsId ? sides.results.get(s.resultsId) : undefined;
    const matches = matchesInfo(results ?? [], { a: a.frame, b: b.frame });
    const json = (text: string) =>
      new Blob([text], { type: "application/json" });
    // [download name, name inside the zip, link text, bytes]
    const files: [string, string, string, Blob][] = [
      [
        names.A,
        FRAME_FILES.A,
        "frame A (PNG)",
        await framePng(a.frame, "frame A"),
      ],
      [
        names.B,
        FRAME_FILES.B,
        "frame B (PNG)",
        await framePng(b.frame, "frame B"),
      ],
      [names.info, FRAME_FILES.info, "sizes and device (JSON)", json(info)],
      [
        names.matches,
        FRAME_FILES.matches,
        "keypoints and matches (JSON)",
        json(matches),
      ],
    ];
    // The zip comes first: one tap saves everything, the log included.
    const now = state();
    const zip = await allFilesZip(
      files.map(([, name, , blob]) => ({ name, blob })),
      { log: logText(now), report: now.report },
    );
    files.unshift([names.all, FRAME_FILES.all, "Download all (zip)", zip]);
    return files.map(([file, , text, blob]) => [file, text, blob]);
  };

  /**
   * After the first download of the pair's files (the zip or any single
   * file), the selector moves on to the next pair (once per pair; a later
   * tap saves again but moves nothing). A pair whose light check failed
   * stays selected, to be taken again.
   */
  function downloaded(): void {
    const before = state().pairNote;
    store.dispatch(A.filesDownloaded());
    const s = state();
    const n = s.pairNote;
    if (n === before || n === null) {
      return;
    }
    if (n.kind === "kept") {
      log(
        `pair kept: take ${n.tag.pair} again (light check ${String(s.light)})`,
      );
    } else if (n.kind === "next") {
      log(`next pair: ${n.next.key}, spot ${String(n.next.spot)}`);
    }
  }

  ui.saveFrames.addEventListener("click", () => {
    if (!accepted(A.saveStarted())) {
      return;
    }
    saveFiles()
      .then((files) => {
        // The URLs and the action in one step: an action between them
        // would revoke URLs the state does not name yet.
        const urls: [string, string][] = [];
        const offered: Offered[] = files.map(([file, text, blob]) => {
          const id = newId("url");
          urls.push([id, URL.createObjectURL(blob)]);
          return { id, file, text: `${text}, ${formatBytes(blob.size)}` };
        });
        put(sides.urls, urls, A.saveFinished(offered));
        log("files ready to save");
      })
      .catch((e: unknown) => {
        fail("save", e);
        store.dispatch(A.saveFailed());
      });
  });
  ui.captureA.addEventListener("click", () => void capture("a")());
  ui.captureB.addEventListener("click", () => void capture("b")());
  ui.run.addEventListener("click", () => engine.startRun("camera"));

  // --- flat target mode ---------------------------------------------------------

  /**
   * The flat target mode is picked in the pair selector and covers the
   * page with its own capture steps and camera; Exit returns to the pair
   * picked before it.
   */
  const flat = startFlatCapture(root, {
    store: fm,
    log,
    fail,
    onExit: () => {
      store.dispatch(A.flatExited());
      applyMode();
    },
  });
  const applyMode = (): void => {
    if (state().progress.pair === FLAT_MODE.key) {
      camera.stop();
      flat.open();
    } else {
      flat.close();
    }
  };
  ui.pair.addEventListener("change", applyMode);
  applyMode();
  return render;
}
