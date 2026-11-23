/**
 * The guided view of the feature matching page (the default; `?ui=cockpit`
 * shows the cockpit, `cockpit-view.ts`): an intro, then one shot at a time with a step
 * card, a viewfinder and a countdown before each photo, a shots sheet,
 * the end screen with Download all and the summary, and an optional
 * measure sheet that holds the measuring block (`bench-engine.ts`).
 *
 * Every screen is drawn from `guided-model.ts`; taps only dispatch
 * actions. Kept outside the store, as browser resources or transient UI
 * nobody else reads: the screen and sheet shown, the countdown timer, the
 * audio context, the motion level, the ghost toggle, the camera start's
 * generation guard and what the canvases last drew.
 *
 * @see guided-view.ts.md
 */
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";
import { frameCanvas } from "./bench-dom";
import { $, type BenchEngine } from "./bench-engine";
import type { CameraControl } from "./camera-control";
import {
  featureMatchActions as A,
  logText,
  measureProgress,
  type FeatureMatchState,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";
import { diagramSvg } from "./guided-diagram";
import {
  endView,
  introCountdownText,
  hasRate,
  isMoving,
  motionStep,
  runView,
  shotContext,
  shotRows,
} from "./guided-model";
import { OTHER_TAB_TEXT, STORE_CHIP_TEXT } from "./guided-texts";
import { createPlanIo } from "./plan-io";
import { planShots } from "./run-plan";
import { MAX_EXTRA } from "./scenes";

type Screen = "intro" | "run" | "end";
type Sheet = "pairs" | "measure" | null;
export interface GuidedDeps {
  readonly root: ParentNode;
  readonly fm: FeatureMatchStore;
  readonly engine: BenchEngine;
  readonly camera: CameraControl;
  readonly log: (line: string) => void;
  readonly fail: (where: string, e: unknown) => void;
}

/** The guided view's video element, for the page's camera. */
export const guidedVideo = (root: ParentNode): HTMLVideoElement =>
  $(root, "#g-video");

const byId = <T extends HTMLElement>(root: ParentNode, id: string): T =>
  $<T>(root, `#g-${id}`);

/** Wires the guided view found under `root`; returns its render. */
export function startGuidedView(deps: GuidedDeps): () => void {
  const { root, fm, engine, camera, log, fail } = deps;
  const { store, sides, accepted } = fm;
  const state = (): FeatureMatchState => store.getState();
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    byId<T>(root, id);
  const all = <T extends HTMLElement>(sel: string): T[] => [
    ...root.querySelectorAll<T>(sel),
  ];

  const video = guidedVideo(root);
  const ui = {
    intro: el("intro"),
    run: el("run"),
    end: el("end"),
    pairsSheet: el("sheet-pairs"),
    measureSheet: el("sheet-measure"),
    introStart: el<HTMLButtonElement>("intro-start"),
    introStill: el("intro-still"),
    headPos: el("head-pos"),
    headBar: el("head-bar"),
    headDone: el("head-done"),
    cardKey: el("card-key"),
    cardTitle: el("card-title"),
    cardPlace: el("card-place"),
    cardShot: el("card-shot"),
    cardDiagram: el("card-diagram"),
    cardPurpose: el("card-purpose"),
    cardAvoid: el("card-avoid"),
    seq: {
      a: el("seq-a"),
      change: el("seq-change"),
      b: el("seq-b"),
    },
    seqText: {
      a: el("seq-a-text"),
      change: el("seq-change-text"),
      b: el("seq-b-text"),
    },
    ghost: el<HTMLCanvasElement>("ghost"),
    review: el("review"),
    reviewA: el<HTMLCanvasElement>("review-a"),
    reviewB: el<HTMLCanvasElement>("review-b"),
    reviewNote: el("review-note"),
    steady: el("steady"),
    camChip: el("cam-chip"),
    storeChip: el("store-chip"),
    storeState: el("store-state"),
    ghostToggle: el<HTMLButtonElement>("ghost-toggle"),
    count: el("count"),
    countNum: el("count-num"),
    flash: el("flash"),
    slotA: el<HTMLButtonElement>("slot-a"),
    slotB: el<HTMLButtonElement>("slot-b"),
    primary: el<HTMLButtonElement>("primary"),
    primaryLabel: el("primary-label"),
    primarySub: el("primary-sub"),
    endKicker: el("end-kicker"),
    endTitle: el("end-title"),
    endLede: el("end-lede"),
    downloadAll: el<HTMLButtonElement>("download-all"),
    downloadState: el("download-state"),
    summary: el<HTMLTextAreaElement>("summary"),
    copySummaryState: el("copy-summary-state"),
    copyLogState: el("copy-log-state"),
    pairsCount: el("pairs-count"),
    pairGrid: el("pair-grid"),
    sound: el<HTMLInputElement>("sound"),
    addOther: el<HTMLButtonElement>("add-other"),
    startOver: el<HTMLButtonElement>("start-over"),
    openFlat: el<HTMLButtonElement>("open-flat"),
  };

  // The measuring block keeps its own elements and listeners; it moves
  // into the measure sheet, and its old home stays out of sight.
  el("measure-synthetic").append(
    $(root, "#run-synthetic"),
    $(root, "#synthetic-state"),
  );
  const results = $(root, "#results").closest("section");
  el("measure-more").append(
    $(root, "#options"),
    $(root, "#speed"),
    ...(results ? [results] : []),
  );
  $(root, "#options-note").hidden = true;
  $(root, "#guided").hidden = false;

  // --- transient view state -------------------------------------------------

  /** Whether any shot has a photo: the run has started. */
  const started = (s: FeatureMatchState): boolean =>
    Object.keys(s.plan.shots).length > 0;

  let screen: Screen = started(state()) ? "run" : "intro";
  let sheet: Sheet = null;
  /**
   * The shot the ghost was switched on for: it shows only while that shot
   * is current, so any move (a tap or the store's own after a photo) ends it.
   */
  let ghostFor: string | null = null;
  let motion = { level: 0, seen: false, moving: false };
  /** The pair grid's rows as last drawn, so a render keeps the buttons. */
  let gridKey = "";

  const io = createPlanIo({
    fm,
    engine,
    camera,
    video,
    flash: ui.flash,
    // Says in the finder why a tap or a countdown ended without a photo.
    note: createToast(el("finder"), {
      className: "chip warn shot-note",
      id: "g-shot-note",
    }),
    log,
    fail,
    moving: () => motion.moving,
    deviceKnown: () => {
      render();
    },
  });
  const { startCamera, cancelCount } = io;

  // --- screens ------------------------------------------------------------------

  const show = (next: Screen): void => {
    if (next !== "run") {
      cancelCount("screen left");
    }
    screen = next;
    if (next === "run") {
      if (
        !camera.on() &&
        state().cameraStart !== "failed" &&
        state().busy === "idle"
      ) {
        void startCamera();
      }
    } else {
      camera.stop();
    }
    render();
  };

  const openSheet = (next: Sheet): void => {
    if (next === "pairs") {
      cancelCount("pairs opened");
    }
    sheet = next;
    render();
  };

  const tapPrimary = (): void => {
    const p = runView(state()).primary;
    if (p.disabled) {
      return;
    }
    switch (p.mode) {
      case "cancel":
        cancelCount("cancelled");
        return;
      case "capture":
        if (!camera.on()) {
          void startCamera();
          return;
        }
        io.beginCount();
        return;
      case "next":
      case "missing":
        if (accepted(A.planMoved(p.index))) {
          log(`next shot: ${runView(state()).shot}`);
        }
        return;
      case "finish":
        show("end");
    }
  };

  // --- render -------------------------------------------------------------------

  /** Draws the frame `id` onto `canvas` once; hides it while there is none. */
  const drawFrame = (canvas: HTMLCanvasElement, id: string | null): void => {
    const f = id ? sides.previews.get(id) : undefined;
    canvas.hidden = !f;
    if (f && id && canvas.dataset.id !== id) {
      frameCanvas(f, canvas);
      canvas.dataset.id = id;
    }
  };

  const renderSteady = (reviewing: boolean): void => {
    ui.steady.hidden = !motion.seen || screen !== "run" || reviewing;
    ui.steady.textContent = motion.moving ? "phone moving" : "steady";
    ui.steady.classList.toggle("moving", motion.moving);
  };

  const renderRun = (s: FeatureMatchState): boolean => {
    const v = runView(s);
    ui.headPos.textContent = v.pos;
    ui.headBar.style.width = `${String((100 * v.done) / v.total)}%`;
    ui.headDone.textContent = `${String(v.done)}/${String(v.total)}`;
    ui.cardKey.textContent = v.key;
    ui.cardTitle.textContent = v.title;
    ui.cardPlace.textContent = v.place;
    ui.cardPurpose.textContent = v.purpose;
    ui.cardAvoid.textContent = `Avoid: ${v.avoid}`;
    ui.cardShot.dataset.shot = v.chip.shot;
    ui.cardShot.textContent = v.chip.text;
    if (ui.cardDiagram.dataset.kind !== v.diagram) {
      ui.cardDiagram.innerHTML = diagramSvg(v.diagram);
      ui.cardDiagram.dataset.kind = v.diagram;
    }
    for (const part of ["a", "change", "b"] as const) {
      ui.seqText[part].textContent = v.steps[part];
      ui.seq[part].classList.toggle("now", v.seq[part] === "now");
      ui.seq[part].classList.toggle("past", v.seq[part] === "past");
    }
    ui.review.hidden = !v.reviewing;
    if (v.reviewing) {
      ui.reviewNote.className = `review-note ${v.note.warn ? "warn" : "ok"}`;
      ui.reviewNote.textContent = v.note.text;
      drawFrame(ui.reviewA, v.photos.a);
      drawFrame(ui.reviewB, v.photos.b);
    }
    ui.camChip.hidden = v.reviewing || s.camera;
    ui.camChip.textContent =
      s.cameraStart === "starting"
        ? "starting camera..."
        : s.cameraStart === "failed"
          ? "camera unavailable: tap Capture to retry"
          : "camera off: tap Capture";
    ui.storeChip.hidden = !s.photoStoreFailing && !s.otherTab;
    ui.storeChip.textContent = s.otherTab ? OTHER_TAB_TEXT : STORE_CHIP_TEXT;
    ui.ghostToggle.hidden = !v.ghost;
    if (ghostFor !== v.shot) {
      ghostFor = null;
    }
    const ghostOn = ghostFor !== null;
    ui.ghostToggle.setAttribute("aria-pressed", String(ghostOn));
    if (ghostOn && v.ghost) {
      drawFrame(ui.ghost, v.photos.a);
    } else {
      ui.ghost.hidden = true;
    }
    const count = s.guided.count;
    ui.count.hidden = count === null;
    if (count) {
      ui.countNum.textContent = String(count.left);
    }
    for (const [w, btn] of [
      ["a", ui.slotA],
      ["b", ui.slotB],
    ] as const) {
      const t = v.slots[w];
      btn.dataset.filled = String(t.filled);
      btn.disabled = t.disabled;
      $(btn, ".slot-sub").textContent = t.sub;
      drawFrame($<HTMLCanvasElement>(btn, "canvas"), v.photos[w]);
    }
    const p = v.primary;
    ui.primary.classList.toggle("counting", p.mode === "cancel");
    ui.primary.classList.toggle(
      "next",
      p.mode !== "cancel" && p.mode !== "capture",
    );
    ui.primary.disabled = p.disabled;
    ui.primaryLabel.textContent = p.label;
    ui.primarySub.textContent = p.sub;
    return v.reviewing;
  };

  const renderPairs = (s: FeatureMatchState): void => {
    const rows = shotRows(s);
    const done = rows.filter(
      (r) => r.status === "done" || r.status === "retake",
    ).length;
    ui.pairsCount.textContent = `${String(done)} of ${String(rows.length)} done`;
    const key = JSON.stringify([rows, screen]);
    if (key !== gridKey) {
      gridKey = key;
      ui.pairGrid.replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.index = String(r.index);
          if (r.current && screen === "run") {
            b.setAttribute("aria-current", "step");
          }
          const dot = document.createElement("i");
          dot.className = `dot ${r.status}`;
          const label = document.createElement("b");
          label.textContent = r.label;
          const sub = document.createElement("small");
          sub.textContent = r.sub;
          b.append(dot, label, sub);
          li.append(b);
          return li;
        }),
      );
    }
    for (const b of all<HTMLButtonElement>("#g-pair-grid button")) {
      b.disabled = s.busy !== "idle";
    }
    ui.addOther.disabled = s.busy !== "idle" || s.plan.extra >= MAX_EXTRA;
    ui.startOver.disabled = s.busy !== "idle";
  };

  const renderEnd = (s: FeatureMatchState): void => {
    const v = endView(s, measureProgress(s));
    ui.endKicker.textContent = v.kicker;
    ui.endTitle.textContent = v.title;
    ui.endLede.textContent = v.lede;
    ui.downloadAll.textContent = v.download.label;
    ui.downloadAll.disabled = !v.canDownload;
    ui.downloadState.className = `state ${v.download.tone}`.trim();
    ui.downloadState.textContent = v.download.text;
    ui.summary.value = io.summaryOf(s);
    ui.storeState.hidden = !s.photoStoreFailing;
  };

  const render = (): void => {
    const s = state();
    io.syncTimer();
    ui.intro.hidden = screen !== "intro";
    ui.run.hidden = screen !== "run";
    ui.end.hidden = screen !== "end";
    ui.pairsSheet.hidden = sheet !== "pairs";
    ui.measureSheet.hidden = sheet !== "measure";
    for (const b of all<HTMLButtonElement>("#g-intro [data-spots]")) {
      b.setAttribute(
        "aria-checked",
        String(Number(b.dataset.spots) === s.plan.spots),
      );
      b.disabled = started(s) || s.busy !== "idle";
    }
    ui.introStill.textContent = introCountdownText(s.plan.settings);
    ui.introStart.textContent = started(s)
      ? "Continue where you left off"
      : "Start";
    for (const b of all<HTMLButtonElement>("#g-sheet-pairs [data-countdown]")) {
      b.setAttribute(
        "aria-checked",
        String(Number(b.dataset.countdown) === s.plan.settings.countdown),
      );
    }
    ui.sound.checked = s.plan.settings.sound;
    const reviewing = screen === "run" ? renderRun(s) : false;
    renderSteady(reviewing);
    if (sheet === "pairs") {
      renderPairs(s);
    }
    if (screen === "end") {
      renderEnd(s);
    }
  };

  // --- wiring -------------------------------------------------------------------

  for (const b of all<HTMLButtonElement>("#g-intro [data-spots]")) {
    b.addEventListener("click", () => {
      store.dispatch(
        A.planSized({
          spots: Number(b.dataset.spots),
          extra: state().plan.extra,
        }),
      );
    });
  }
  for (const b of all<HTMLButtonElement>("#g-sheet-pairs [data-countdown]")) {
    b.addEventListener("click", () => {
      store.dispatch(
        A.planSettingsChanged({ countdown: Number(b.dataset.countdown) }),
      );
    });
  }
  ui.sound.addEventListener("change", () => {
    store.dispatch(A.planSettingsChanged({ sound: ui.sound.checked }));
  });
  ui.introStart.addEventListener("click", () => {
    const s = state();
    if (!started(s)) {
      log(
        `run: light tests at ${String(s.plan.spots)} place(s), ${String(planShots(s.plan).length)} shots`,
      );
    }
    show("run");
  });
  el("open-help").addEventListener("click", () => {
    show("intro");
  });
  el("open-pairs").addEventListener("click", () => {
    openSheet("pairs");
  });
  el("close-pairs").addEventListener("click", () => {
    openSheet(null);
  });
  ui.primary.addEventListener("click", tapPrimary);
  for (const [w, btn] of [
    ["a", ui.slotA],
    ["b", ui.slotB],
  ] as const) {
    btn.addEventListener("click", () => {
      if (w === "a") {
        // Back to the scene's previous shot.
        const c = shotContext(state());
        if (c.prev) {
          store.dispatch(A.planMoved(c.index - 1));
        }
        return;
      }
      // This shot again: a retake is one more capture of the current shot.
      if (camera.on()) {
        io.beginCount();
      } else {
        void startCamera();
      }
    });
  }
  ui.ghostToggle.addEventListener("click", () => {
    const shot = runView(state()).shot;
    ghostFor = ghostFor === shot ? null : shot;
    render();
  });
  ui.pairGrid.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>(
      "button[data-index]",
    );
    if (!b || b.disabled) {
      return;
    }
    store.dispatch(A.planMoved(Number(b.dataset.index)));
    sheet = null;
    show("run");
  });
  ui.addOther.addEventListener("click", () => {
    const p = state().plan;
    if (!accepted(A.planSized({ spots: p.spots, extra: p.extra + 1 }))) {
      return;
    }
    // The new own scene's first shot (X1), before its X2.
    store.dispatch(A.planMoved(planShots(state().plan).length - 2));
    log(`run: extra scene ${runView(state()).shot} added`);
    sheet = null;
    show("run");
  });
  el("go-end").addEventListener("click", () => {
    sheet = null;
    show("end");
  });
  ui.startOver.addEventListener("click", () => {
    if (
      !confirm(
        "Delete every photo on this phone and start again? Download first if you want to keep them.",
      )
    ) {
      return;
    }
    if (!accepted(A.planReset())) {
      return;
    }
    log("run: started over");
    sheet = null;
    show("intro");
  });
  ui.downloadAll.addEventListener("click", () => void io.downloadAll());
  el("copy-summary").addEventListener(
    "click",
    () => void io.copyText(io.summaryOf(state()), ui.copySummaryState),
  );
  el("copy-log").addEventListener(
    "click",
    () => void io.copyText(logText(state()), ui.copyLogState),
  );
  el("end-back").addEventListener("click", () => {
    show("run");
  });
  el("open-measure").addEventListener("click", () => {
    openSheet("measure");
  });
  el("close-measure").addEventListener("click", () => {
    openSheet(null);
  });
  const flat = startFlatCapture(root, {
    store: fm,
    log,
    fail,
    onExit: render,
  });
  ui.openFlat.addEventListener("click", () => {
    camera.stop();
    sheet = null;
    render();
    flat.open();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && sheet !== null) {
      openSheet(null);
    }
  });
  window.addEventListener("devicemotion", (ev) => {
    const r = ev.rotationRate;
    if (!hasRate(r)) {
      return;
    }
    const level = motionStep(motion.level, r);
    const moving = isMoving(level);
    const changed = moving !== motion.moving || !motion.seen;
    motion = { level, seen: true, moving };
    if (moving) {
      io.moved();
    }
    if (changed) {
      render();
    }
  });

  if (screen === "run") {
    show("run");
  }
  return render;
}
