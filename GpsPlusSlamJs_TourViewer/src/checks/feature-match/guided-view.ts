/**
 * The guided view of the feature matching page (the default; `?ui=cockpit`
 * shows the cockpit, `cockpit-view.ts`): an intro, then the scenes one
 * photo at a time (scene header, a shot strip per scene, a step card, a
 * viewfinder with a countdown before each photo), the end view with the
 * measuring per scene, the zip choice and one download, a menu, and an
 * optional measure sheet that holds the measuring block (`bench-engine.ts`).
 *
 * Every screen is drawn from `guided-scene-model.ts`; taps only dispatch
 * actions, and the screen shown, the retake choice and the zip choice are
 * the store's. Kept outside the store, as browser resources or transient
 * UI nobody else reads: the open sheet, the strip's browsed scene, the
 * ghost toggle, the motion level, the screen the camera was last set up
 * for and what the canvases and lists last drew.
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
  type FeatureMatchState,
  type GuidedScreen,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";
import { diagramSvg } from "./guided-diagram";
import { hasRate, isMoving, motionStep, shotContext } from "./guided-model";
import {
  endView,
  runView,
  stripView,
  type RunView,
} from "./guided-scene-model";
import { createPlanIo } from "./plan-io";
import { planNextOpen, planShots } from "./run-plan";
import { MAX_EXTRA } from "./scenes";

type Sheet = "menu" | "measure" | null;
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

/** Draws the frame `id` from `previews` onto `canvas` once it changes. */
function drawFrame(
  previews: ReadonlyMap<string, Parameters<typeof frameCanvas>[0]>,
  canvas: HTMLCanvasElement,
  id: string | null,
): void {
  const f = id ? previews.get(id) : undefined;
  canvas.hidden = !f;
  if (f && id && canvas.dataset.id !== id) {
    frameCanvas(f, canvas);
    canvas.dataset.id = id;
  }
}

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
    menuSheet: el("sheet-menu"),
    measureSheet: el("sheet-measure"),
    introStart: el<HTMLButtonElement>("intro-start"),
    sceneKicker: el("scene-kicker"),
    sceneName: el("scene-name"),
    ruleChip: el("rule-chip"),
    ruleText: el("rule-text"),
    segs: el("segs"),
    thumbs: el("thumbs"),
    banner: el("card-banner"),
    bannerTitle: el("banner-title"),
    bannerText: el("banner-text"),
    cardCode: el("card-code"),
    cardTitle: el("card-title"),
    cardCount: el("card-count"),
    cardDiagram: el("card-diagram"),
    cardSteps: el("card-steps"),
    cardNote: el("card-note"),
    camWait: el("cam-wait"),
    ghost: el<HTMLCanvasElement>("ghost"),
    stillChip: el("still-chip"),
    steady: el("steady"),
    ghostToggle: el<HTMLButtonElement>("ghost-toggle"),
    savedChip: el("saved-chip"),
    savedText: el("saved-text"),
    count: el("count"),
    countNum: el("count-num"),
    flash: el("flash"),
    actions: $(el("run"), ".actions"),
    secondary: el<HTMLButtonElement>("secondary"),
    primary: el<HTMLButtonElement>("primary"),
    primaryLabel: el("primary-label"),
    primarySub: el("primary-sub"),
    endKicker: el("end-kicker"),
    endTitle: el("end-title"),
    endLede: el("end-lede"),
    endEta: el("end-eta"),
    endList: el("end-list"),
    retry: el("retry"),
    retryText: el("retry-text"),
    retryFailed: el<HTMLButtonElement>("retry-failed"),
    choice: el("choice"),
    choiceNowSub: el("choice-now-sub"),
    choiceWaitSub: el("choice-wait-sub"),
    download: el<HTMLButtonElement>("download"),
    dlLabel: el("dl-label"),
    dlSub: el("dl-sub"),
    downloadState: el("download-state"),
    trustText: el("trust-text"),
    endMissing: el("end-missing"),
    missingList: el("missing-list"),
    skipSceneLabel: el("skip-scene-label"),
    copyLogState: el("copy-log-state"),
    sound: el<HTMLInputElement>("sound"),
    openFlat: el<HTMLButtonElement>("open-flat"),
  };
  const act = (name: string): HTMLButtonElement =>
    $<HTMLButtonElement>(ui.menuSheet, `[data-act="${name}"]`);

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

  let sheet: Sheet = null;
  /** The scene the strip shows; null follows the current shot. */
  let browse: string | null = null;
  /** The shot the strip last followed: a new one ends the browsing. */
  let followed = "";
  /**
   * The shot the ghost was switched on for: it shows only while that shot
   * is current, so any move (a tap or the store's own after a photo) ends it.
   */
  let ghostFor: string | null = null;
  let motion = { level: 0, seen: false, moving: false };
  /** The screen the camera was last set up for. */
  let applied: GuidedScreen | null = null;
  /** What the rebuilt lists last drew, so a render keeps their buttons. */
  const drawn = { segs: "", thumbs: "", steps: "", missing: "" };

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

  const show = (screen: GuidedScreen): void => {
    sheet = null;
    store.dispatch(A.guidedShown(screen));
    render();
  };

  /** The camera runs on the run screen only. */
  const applyScreen = (s: FeatureMatchState): void => {
    if (s.guided.screen === applied) {
      return;
    }
    applied = s.guided.screen;
    if (applied !== "run") {
      cancelCount("screen left");
      camera.stop();
      return;
    }
    if (!camera.on() && s.cameraStart !== "failed" && s.busy === "idle") {
      void startCamera();
    }
  };

  const openSheet = (next: Sheet): void => {
    if (next !== null) {
      cancelCount("sheet opened");
    }
    sheet = next;
    render();
  };

  /** Moves to shot `index` and, when it has a photo, chooses it for a retake. */
  const goTo = (index: number): void => {
    store.dispatch(A.planMoved(index));
    store.dispatch(A.retakeChosen(true));
    store.dispatch(A.guidedShown("run"));
  };

  /** The open shots of the current shot's scene. */
  const openInScene = (s: FeatureMatchState): string[] => {
    const scene = shotContext(s).shot.scene;
    return planShots(s.plan)
      .filter(
        (x) =>
          x.scene === scene &&
          !s.plan.shots[x.id] &&
          !s.plan.skipped.includes(x.id),
      )
      .map((x) => x.id);
  };

  const skipScene = (): void => {
    const shots = openInScene(state());
    if (accepted(A.planSkipped(shots))) {
      log(`run: skipped ${shots.join(", ")}`);
    }
  };

  const shootOrStart = (): void => {
    if (camera.on()) {
      io.beginCount();
    } else {
      void startCamera();
    }
  };

  const tapPrimary = (): void => {
    const s = state();
    const v = runView(s);
    if (v.primary.disabled) {
      return;
    }
    const c = shotContext(s);
    switch (v.mode) {
      case "counting":
        cancelCount("cancelled");
        return;
      case "warn":
        if (c.fixAt !== c.index) {
          goTo(c.fixAt);
          return;
        }
        shootOrStart();
        return;
      case "capture":
      case "retake":
        shootOrStart();
        return;
      case "allDone":
        show("end");
    }
  };

  const tapSecondary = (): void => {
    const s = state();
    const v = runView(s);
    if (v.secondary.disabled) {
      return;
    }
    switch (v.secondary.act) {
      case "skip-photo": {
        const shot = shotContext(s).shot.id;
        if (accepted(A.planSkipped([shot]))) {
          log(`run: skipped ${shot}`);
        }
        return;
      }
      case "skip-scene":
        skipScene();
        return;
      case "back":
      case "keep": {
        const next = planNextOpen(s.plan, -1);
        if (next !== null) {
          store.dispatch(A.planMoved(next));
        } else if (v.secondary.act === "back") {
          store.dispatch(A.retakeChosen(false));
        } else {
          show("end");
        }
        return;
      }
      case "none":
    }
  };

  // --- render -------------------------------------------------------------------

  const draw = (canvas: HTMLCanvasElement, id: string | null): void => {
    drawFrame(sides.previews, canvas, id);
  };

  const renderSteady = (s: FeatureMatchState): void => {
    ui.steady.hidden = !motion.seen || s.guided.screen !== "run";
    ui.steady.textContent = motion.moving ? "phone moving" : "steady";
    ui.steady.classList.toggle("moving", motion.moving);
  };

  const renderStrip = (s: FeatureMatchState): void => {
    const c = shotContext(s);
    if (c.shot.id !== followed) {
      followed = c.shot.id;
      browse = null;
    }
    const v = stripView(s, browse);
    const segKey = JSON.stringify(v.segs.map((g) => [g.scene, g.name]));
    if (segKey !== drawn.segs) {
      drawn.segs = segKey;
      ui.segs.replaceChildren(
        ...v.segs.map((g) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "seg";
          b.setAttribute("role", "tab");
          b.dataset.scene = g.scene;
          const name = document.createElement("span");
          name.className = "seg-name";
          name.textContent = g.name;
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.append(
            document.createElement("i"),
            document.createElement("span"),
          );
          b.append(name, badge);
          return b;
        }),
      );
    }
    v.segs.forEach((g, i) => {
      const b = ui.segs.children[i] as HTMLElement;
      b.setAttribute("aria-selected", String(g.selected));
      b.dataset.now = String(g.now);
      const badge = $(b, ".badge");
      badge.dataset.b = g.badge.b;
      badge.title = g.badge.title;
      $(badge, "span").textContent = g.badge.text;
    });
    const thumbKey = JSON.stringify(v.thumbs.map((t) => t.shot));
    if (thumbKey !== drawn.thumbs) {
      drawn.thumbs = thumbKey;
      ui.thumbs.replaceChildren(
        ...v.thumbs.map((t) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "th";
          b.dataset.index = String(t.index);
          const canvas = document.createElement("canvas");
          canvas.hidden = true;
          canvas.setAttribute("aria-hidden", "true");
          const code = document.createElement("span");
          code.className = "th-code";
          code.textContent = t.key;
          b.append(canvas, code);
          return b;
        }),
        ...(v.hint ? [document.createElement("span")] : []),
      );
    }
    v.thumbs.forEach((t, i) => {
      const b = ui.thumbs.children[i] as HTMLButtonElement;
      b.dataset.st = t.state;
      b.dataset.warn = String(t.warn);
      b.setAttribute("aria-label", t.label);
      b.disabled = s.busy !== "idle" || s.guided.count !== null;
      if (t.mark === "step") {
        b.setAttribute("aria-current", "step");
      } else {
        b.removeAttribute("aria-current");
      }
      b.dataset.retake = String(t.mark === "retake");
      draw($<HTMLCanvasElement>(b, "canvas"), t.photo);
    });
    const hint = ui.thumbs.children[v.thumbs.length] as HTMLElement | undefined;
    if (hint) {
      hint.className = "th-hint";
      hint.textContent = v.hint;
    }
  };

  const renderCard = (v: RunView): void => {
    const card = v.card;
    ui.banner.hidden = !card.banner;
    if (card.banner) {
      ui.banner.dataset.kind = card.banner.kind;
      ui.bannerTitle.textContent = card.banner.title;
      ui.bannerText.textContent = card.banner.text;
      if (card.banner.extra) {
        // Dropped on a short landscape screen: the strip badge already says it.
        const extra = document.createElement("span");
        extra.className = "banner-extra";
        extra.textContent = card.banner.extra;
        ui.bannerText.append(extra);
      }
    }
    ui.cardCode.textContent = card.code;
    ui.cardCode.dataset.mode = card.codeMode;
    ui.cardTitle.textContent = card.title;
    ui.cardCount.textContent = card.count;
    const kind = card.diagram ?? "";
    if (ui.cardDiagram.dataset.kind !== kind) {
      ui.cardDiagram.innerHTML = card.diagram ? diagramSvg(card.diagram) : "";
      ui.cardDiagram.dataset.kind = kind;
    }
    const stepKey = JSON.stringify(card.steps);
    if (stepKey !== drawn.steps) {
      drawn.steps = stepKey;
      ui.cardSteps.replaceChildren(
        ...card.steps.map((t) => {
          const li = document.createElement("li");
          li.textContent = t;
          return li;
        }),
      );
    }
    ui.cardNote.textContent = card.note;
  };

  const renderRun = (s: FeatureMatchState): void => {
    const v = runView(s);
    ui.sceneKicker.textContent = v.kicker;
    ui.sceneName.textContent = v.sceneName;
    ui.ruleChip.dataset.rule = v.rule;
    ui.ruleText.textContent = v.ruleText;
    renderStrip(s);
    renderCard(v);
    const f = v.finder;
    ui.camWait.hidden = f.camera === "";
    ui.camWait.textContent = f.camera;
    ui.stillChip.hidden = !f.still;
    ui.savedText.textContent = f.saved.text;
    ui.savedChip.classList.toggle("warn", f.saved.warn);
    const shot = shotContext(s).shot.id;
    if (ghostFor !== shot) {
      ghostFor = null;
    }
    ui.ghostToggle.hidden = !f.ghost;
    ui.ghostToggle.textContent = f.ghost?.label ?? "";
    const ghostOn = ghostFor !== null && f.ghost !== null;
    ui.ghostToggle.setAttribute("aria-pressed", String(ghostOn));
    if (ghostOn) {
      draw(ui.ghost, f.ghost.photo);
    } else {
      ui.ghost.hidden = true;
    }
    const count = s.guided.count;
    ui.count.hidden = count === null;
    if (count) {
      ui.countNum.textContent = String(count.left);
    }
    const p = v.primary;
    ui.primary.className = `primary main ${p.look}`.trim();
    ui.primary.disabled = p.disabled;
    ui.primaryLabel.textContent = p.label;
    ui.primarySub.textContent = p.sub;
    const sec = v.secondary;
    ui.secondary.hidden = sec.act === "none";
    ui.secondary.disabled = sec.disabled;
    ui.secondary.textContent = sec.label;
    ui.actions.style.gridTemplateColumns = ui.secondary.hidden
      ? "minmax(0, 1fr)"
      : "";
  };

  const renderEnd = (s: FeatureMatchState): void => {
    const v = endView(s);
    ui.endKicker.textContent = v.kicker;
    ui.endTitle.textContent = v.title;
    ui.endLede.textContent = v.lede;
    ui.endEta.textContent = v.eta.text;
    ui.endEta.classList.toggle("done", v.eta.done);
    ui.endList.replaceChildren(
      ...v.rows.map((r) => {
        const li = document.createElement("li");
        li.className = "prow";
        li.dataset.scene = r.scene;
        const head = document.createElement("div");
        head.className = "prow-head";
        const name = document.createElement("b");
        name.textContent = r.name;
        const pairs = document.createElement("span");
        pairs.className = "pairs";
        pairs.textContent = r.pairs;
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.dataset.b = r.badge.b;
        const text = document.createElement("span");
        text.textContent = r.badge.text;
        badge.append(document.createElement("i"), text);
        head.append(name, pairs, badge);
        li.append(head);
        if (r.bar !== null) {
          const bar = document.createElement("span");
          bar.className = `bar${r.badge.b === "done" ? " done" : ""}`;
          const fill = document.createElement("span");
          fill.style.width = `${String(Math.round(r.bar * 100))}%`;
          bar.append(fill);
          li.append(bar);
        } else {
          const note = document.createElement("p");
          note.className = "prow-note";
          note.textContent = r.note;
          li.append(note);
        }
        return li;
      }),
    );
    ui.retry.hidden = !v.retry.shown;
    ui.retryText.textContent = v.retry.text;
    ui.retryFailed.disabled = s.busy !== "idle";
    ui.choice.hidden = !v.choice.shown;
    for (const b of all<HTMLButtonElement>("#g-choice [data-choice]")) {
      b.setAttribute(
        "aria-checked",
        String(b.dataset.choice === s.guided.choice),
      );
    }
    ui.choiceNowSub.textContent = v.choice.now;
    ui.choiceWaitSub.textContent = v.choice.wait;
    const d = v.download;
    ui.download.className = [
      "primary big dl",
      d.waiting === null ? "" : "waiting",
      d.tone,
    ]
      .filter(Boolean)
      .join(" ");
    ui.download.style.setProperty("--p", `${String(d.waiting ?? 0)}%`);
    ui.download.disabled = d.disabled;
    ui.dlLabel.textContent = d.label;
    ui.dlSub.textContent = d.sub;
    ui.downloadState.className = `state ${v.state.tone}`.trim();
    ui.downloadState.textContent = v.state.text;
    ui.trustText.textContent = v.trust.text;
    ui.trustText.parentElement?.classList.toggle("warn", v.trust.warn);
    ui.endMissing.hidden = v.missing.length === 0;
    const missKey = JSON.stringify(v.missing);
    if (missKey !== drawn.missing) {
      drawn.missing = missKey;
      ui.missingList.replaceChildren(
        ...v.missing.map((m) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "secondary";
          b.dataset.index = String(m.index);
          b.textContent = m.label;
          return b;
        }),
      );
    }
  };

  const renderMenu = (s: FeatureMatchState): void => {
    const busy = s.busy !== "idle";
    const skip = act("skip-scene");
    skip.hidden = s.guided.screen !== "run" || openInScene(s).length === 0;
    ui.skipSceneLabel.textContent = `Skip ${runView(s).sceneName}`;
    skip.disabled = busy;
    act("own").disabled = busy || s.plan.extra >= MAX_EXTRA;
    act("finish").hidden = s.guided.screen === "end";
    act("reset").disabled = busy;
    for (const b of all<HTMLButtonElement>("#g-sheet-menu [data-countdown]")) {
      b.setAttribute(
        "aria-checked",
        String(Number(b.dataset.countdown) === s.plan.settings.countdown),
      );
    }
    ui.sound.checked = s.plan.settings.sound;
  };

  const render = (): void => {
    const s = state();
    applyScreen(s);
    io.syncTimer();
    const screen = s.guided.screen;
    ui.intro.hidden = screen !== "intro";
    ui.run.hidden = screen !== "run";
    ui.end.hidden = screen !== "end";
    ui.menuSheet.hidden = sheet !== "menu";
    ui.measureSheet.hidden = sheet !== "measure";
    const started =
      Object.keys(s.plan.shots).length > 0 || s.plan.skipped.length > 0;
    for (const b of all<HTMLButtonElement>("#g-intro [data-spots]")) {
      b.setAttribute(
        "aria-checked",
        String(Number(b.dataset.spots) === s.plan.spots),
      );
      b.disabled = started || s.busy !== "idle";
    }
    ui.introStart.textContent = started
      ? "Continue where you left off"
      : "Start";
    if (screen === "run") {
      renderRun(s);
    }
    renderSteady(s);
    if (screen === "end") {
      renderEnd(s);
    }
    if (sheet === "menu") {
      renderMenu(s);
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
  ui.introStart.addEventListener("click", () => {
    const s = state();
    if (Object.keys(s.plan.shots).length === 0) {
      log(
        `run: light scene at ${String(s.plan.spots)} place(s), ${String(planShots(s.plan).length)} shots`,
      );
    }
    show(planNextOpen(s.plan, -1) === null ? "end" : "run");
  });
  ui.primary.addEventListener("click", tapPrimary);
  ui.secondary.addEventListener("click", tapSecondary);
  ui.segs.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLElement>("[data-scene]");
    if (b) {
      browse = b.dataset.scene ?? null;
      render();
    }
  });
  ui.thumbs.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>(
      "button[data-index]",
    );
    if (b && !b.disabled) {
      goTo(Number(b.dataset.index));
    }
  });
  ui.ghostToggle.addEventListener("click", () => {
    const shot = shotContext(state()).shot.id;
    ghostFor = ghostFor === shot ? null : shot;
    render();
  });
  for (const b of all<HTMLButtonElement>("#g-choice [data-choice]")) {
    b.addEventListener("click", () => {
      store.dispatch(
        A.endChoiceSet(b.dataset.choice === "wait" ? "wait" : "now"),
      );
    });
  }
  ui.download.addEventListener("click", () => void io.downloadAll());
  ui.retryFailed.addEventListener("click", () => {
    if (accepted(A.failedRetried())) {
      log("measure: retrying the failed pairs");
    }
  });
  ui.missingList.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>(
      "button[data-index]",
    );
    if (b) {
      store.dispatch(A.planMoved(Number(b.dataset.index)));
      show("run");
    }
  });
  el("end-back").addEventListener("click", () => {
    show("run");
  });
  el("open-menu").addEventListener("click", () => {
    openSheet("menu");
  });
  el("end-menu").addEventListener("click", () => {
    openSheet("menu");
  });
  el("close-menu").addEventListener("click", () => {
    openSheet(null);
  });
  for (const b of all<HTMLButtonElement>("#g-sheet-menu [data-countdown]")) {
    b.addEventListener("click", () => {
      store.dispatch(
        A.planSettingsChanged({ countdown: Number(b.dataset.countdown) }),
      );
    });
  }
  ui.sound.addEventListener("change", () => {
    store.dispatch(A.planSettingsChanged({ sound: ui.sound.checked }));
  });
  act("cockpit").addEventListener("click", () => {
    camera.stop();
    const url = new URL(location.href);
    url.searchParams.set("ui", "cockpit");
    location.assign(url);
  });
  act("own").addEventListener("click", () => {
    const p = state().plan;
    if (!accepted(A.planSized({ spots: p.spots, extra: p.extra + 1 }))) {
      return;
    }
    // The new own scene's first shot (X1), before its X2.
    store.dispatch(A.planMoved(planShots(state().plan).length - 2));
    log(`run: own pair ${shotContext(state()).shot.id} added`);
    show("run");
  });
  act("skip-scene").addEventListener("click", () => {
    skipScene();
    openSheet(null);
  });
  act("finish").addEventListener("click", () => {
    show("end");
  });
  act("help").addEventListener("click", () => {
    show("intro");
  });
  act("copy-log").addEventListener(
    "click",
    () => void io.copyText(logText(state()), ui.copyLogState),
  );
  act("measure").addEventListener("click", () => {
    openSheet("measure");
  });
  act("reset").addEventListener("click", () => {
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
    show("intro");
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

  return render;
}
