/**
 * The cockpit view of the feature matching page (`?ui=cockpit`): the
 * viewfinder and one fixed dock (shot chip, progress, instruction, the
 * previous and current shot tiles around the big button, readouts,
 * status, Details and Download all), and a drawer over the viewfinder
 * with the shot list, the shot guide, the results (the measuring block,
 * the flat target) and the settings. After each shot the next open shot
 * comes up by itself (the store moves on); Download all saves every ready
 * pair in one zip.
 *
 * Every box is drawn from `cockpit-model.ts`; taps only dispatch actions
 * or call the shared `plan-io.ts`. Kept outside the store, as browser
 * resources or transient UI nobody else reads: the drawer tab shown, the
 * welcome card, the ghost toggle (a checkbox), the motion level and what
 * the canvases and lists last drew.
 *
 * @see cockpit-view.ts.md
 */
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";
import { frameCanvas } from "./bench-dom";
import { $, type BenchEngine } from "./bench-engine";
import { BEFORE_YOU_START, SPOT_NOTE } from "./bench-guide";
import type { CameraControl } from "./camera-control";
import {
  downloadLabel,
  handsOffResult,
  instrView,
  meterFill,
  nightOn,
  progressText,
  readoutView,
  retakeView,
  runStatusText,
  segClasses,
  shutterView,
  statusView,
  tileView,
} from "./cockpit-model";
import {
  featureMatchActions as A,
  handsOffDue,
  type FeatureMatchState,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";
import {
  hasRate,
  isMoving,
  motionStep,
  readyCount,
  shotContext,
  shotRows,
  warned,
} from "./guided-model";
import { LIGHT_NOTE } from "./guided-texts";
import { createPlanIo } from "./plan-io";
import { planPhotos, planShots } from "./run-plan";
import { MAX_EXTRA, nextOpen } from "./scenes";

/** Set once the welcome card was shown; later visits start without it. */
const BEFORE_START_SEEN = "feature-match-check.before-start-seen";
/** The meter ring's length (2 pi r, r = 46). */
const METER = 289.03;
/** How often a hands-off wait checks that motion readings still come (ms). */
const WATCHDOG_MS = 500;

type Tab = "pairs" | "guide" | "results" | "settings";
const TABS: readonly Tab[] = ["pairs", "guide", "results", "settings"];

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
  $(root, "#c-video");

const listItems = (texts: readonly string[]): HTMLLIElement[] =>
  texts.map((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    return li;
  });

/** Whether the welcome card was seen; blocked storage shows it every time. */
function seenBefore(): boolean {
  try {
    return localStorage.getItem(BEFORE_START_SEEN) !== null;
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(BEFORE_START_SEEN, "1");
  } catch {
    // Storage blocked: the card shows again next time.
  }
}

/** Wires the cockpit found under `root`; returns its render. */
export function startCockpitView(deps: CockpitDeps): () => void {
  const { root, fm, engine, camera, log, fail } = deps;
  const { store, sides, accepted } = fm;
  const state = (): FeatureMatchState => store.getState();
  const el = <T extends HTMLElement = HTMLElement>(id: string): T =>
    $<T>(root, `#c-${id}`);
  const all = <T extends HTMLElement>(sel: string): T[] => [
    ...root.querySelectorAll<T>(sel),
  ];

  const ui = {
    app: $(root, "#cockpit"),
    video: cockpitVideo(root),
    ghost: el<HTMLCanvasElement>("ghost"),
    count: el("count"),
    flash: el("flash"),
    cover: el("cover"),
    coverText: el("cover-text"),
    welcome: el("welcome"),
    drawer: el("drawer"),
    pairsSummary: el("pairs-summary"),
    pairList: el("pair-list"),
    downloadDrawer: el<HTMLButtonElement>("download-drawer"),
    downloadNote: el("download-note"),
    addOther: el<HTMLButtonElement>("add-other"),
    startOver: el<HTMLButtonElement>("start-over"),
    guideTitle: el("guide-title"),
    guidePurpose: el("guide-purpose"),
    guideSteps: el("guide-steps"),
    guideAvoid: el("guide-avoid"),
    guideSpot: el("guide-spot"),
    lightWarn: el("light-warn"),
    copySummaryState: el("copy-summary-state"),
    sound: el<HTMLInputElement>("sound"),
    showGhost: el<HTMLInputElement>("show-ghost"),
    chipKey: el("chip-key"),
    chipLabel: el("chip-label"),
    chipSpot: el("chip-spot"),
    progressText: el("progress-text"),
    segs: el("segs"),
    instr: el("instr"),
    shot: {
      a: el<HTMLButtonElement>("shot-a"),
      b: el<HTMLButtonElement>("shot-b"),
    },
    shotState: { a: el("state-a"), b: el("state-b") },
    changeText: el("change-text"),
    retake: el<HTMLButtonElement>("retake"),
    retakeLabel: el("retake-label"),
    meter: el("meter-fg"),
    shutter: el<HTMLButtonElement>("shutter"),
    shutterText: el("shutter-text"),
    next: el<HTMLButtonElement>("next"),
    readStill: el("read-still"),
    readLight: el("read-light"),
    readMode: el("read-mode"),
    status: el("status"),
    details: el<HTMLButtonElement>("details"),
    downloadAll: el<HTMLButtonElement>("download-all"),
    openFlat: el<HTMLButtonElement>("open-flat"),
  };

  // The measuring block keeps its own elements and listeners; it moves
  // into the Results tab, and its old home stays out of sight.
  const results = $(root, "#results").closest("section");
  el("measure-more").append(
    $(root, "#options"),
    $(root, "#speed"),
    ...(results ? [results] : []),
  );
  ui.app.hidden = false;
  el("welcome-lede").textContent =
    "Take a few shots of each scene: a first shot, then one change per shot (the light, a tilt, a step). The pairs are made from the shots and saved in one zip.";
  el("welcome-list").replaceChildren(...listItems(BEFORE_YOU_START));
  el("before-list").replaceChildren(...listItems(BEFORE_YOU_START));

  // --- transient view state -------------------------------------------------

  let tab: Tab | null = null;
  let welcome = !seenBefore();
  let motion = { level: 0, seen: false, moving: false };
  /** The shot list, the segments and the guide as last drawn. */
  let listKey = "";
  let segKey = "";
  let guideKey = "";

  const note = createToast(el("stage"), {
    className: "c-shot-note",
    id: "c-shot-note",
  });
  const io = createPlanIo({
    fm,
    engine,
    camera,
    video: ui.video,
    flash: ui.flash,
    note,
    log,
    fail,
    moving: () => motion.moving,
    deviceKnown: () => {
      render();
    },
  });
  const { startCamera, cancelCount } = io;

  // --- taps -----------------------------------------------------------------------

  const closeWelcome = (): void => {
    if (welcome) {
      welcome = false;
      markSeen();
    }
  };

  const openTab = (next: Tab | null): void => {
    if (next !== null) {
      cancelCount("details opened");
      // The drawer covers the viewfinder: no photo takes itself under it.
      store.dispatch(A.handsOffPaused());
    }
    tab = next;
    render();
  };

  const move = (index: number): void => {
    if (accepted(A.planMoved(index))) {
      log(`shot: ${planShots(state().plan)[index]?.id ?? "-"}`);
    }
  };

  const tapShutter = (): void => {
    closeWelcome();
    const v = shutterView(state());
    if (v.disabled) {
      return;
    }
    switch (v.mode) {
      case "start":
        void startCamera();
        break;
      case "cancel":
        cancelCount("cancelled");
        break;
      case "capture":
      case "retake":
        io.beginCount();
        break;
      case "next":
        move(v.index);
        break;
      case "save":
        void io.downloadAll();
        break;
      case "busy":
        break;
    }
    render();
  };

  const tapRetake = (): void => {
    const r = retakeView(state());
    if (!r.action) {
      return;
    }
    if (r.action.kind === "back") {
      move(r.action.index);
      return;
    }
    // A retake is one more capture of the current shot.
    if (camera.on()) {
      io.beginCount();
    } else {
      void startCamera();
    }
  };

  const tapNext = (): void => {
    const s = state();
    const next = nextOpen(
      planShots(s.plan),
      planPhotos(s.plan),
      s.plan.current,
    );
    if (next !== null) {
      cancelCount("next shot");
      move(next);
    }
  };

  // --- hands-off shot ----------------------------------------------------------

  const handsOffWaits = (): boolean => {
    const p = state().handsOff.phase;
    return tab === null && (p === "armed" || p === "waiting");
  };

  /** The phone rested for the dwell: the shot, and how it went. */
  const takeHandsOff = (): void => {
    const r = handsOffResult(
      () => io.shoot(),
      (e) => {
        fail("capture", e);
      },
    );
    store.dispatch(A.handsOffShot(r));
    log(`hands-off shot: ${r}`);
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

  const renderDock = (s: FeatureMatchState): void => {
    const c = shotContext(s);
    ui.chipKey.textContent = c.shot.key;
    ui.chipLabel.textContent = c.card.title;
    ui.chipSpot.textContent =
      c.shot.kind === "light" ? `place ${String(c.shot.spot)}` : "";
    ui.progressText.textContent = progressText(s);
    const segs = segClasses(s);
    const key = segs.join(",");
    if (key !== segKey) {
      segKey = key;
      ui.segs.replaceChildren(
        ...segs.map((cls) => {
          const i = document.createElement("i");
          i.className = cls;
          return i;
        }),
      );
    }
    const instr = instrView(s);
    if (instr.label) {
      const b = document.createElement("b");
      b.textContent = `${instr.label}:`;
      ui.instr.replaceChildren(b, ` ${instr.text}`);
    } else if (instr.bold && instr.text.includes(instr.bold)) {
      const at = instr.text.indexOf(instr.bold);
      const b = document.createElement("b");
      b.textContent = instr.bold;
      ui.instr.replaceChildren(
        instr.text.slice(0, at),
        b,
        instr.text.slice(at + instr.bold.length),
      );
    } else {
      ui.instr.textContent = instr.text;
    }
    ui.changeText.textContent = c.card.change;
    const tiles = tileView(s);
    const photos = { a: c.prevPhoto?.id ?? null, b: c.photo?.id ?? null };
    for (const w of ["a", "b"] as const) {
      const t = tiles[w];
      ui.shot[w].dataset.state = t.state;
      ui.shot[w].disabled = t.disabled;
      ui.shotState[w].textContent = t.text;
      drawFrame($<HTMLCanvasElement>(ui.shot[w], "canvas"), photos[w]);
    }
    const sh = shutterView(s);
    ui.shutter.dataset.mode = sh.tone;
    ui.shutter.disabled = sh.disabled;
    ui.shutterText.textContent = sh.text;
    ui.meter.style.strokeDashoffset = String(METER * (1 - meterFill(s)));
    const r = retakeView(s);
    ui.retake.disabled = r.disabled;
    ui.retakeLabel.textContent = r.label;
    ui.retake.title = r.hint;
    ui.next.disabled =
      s.busy !== "idle" ||
      nextOpen(c.list, planPhotos(s.plan), c.index) === null;
    const ro = readoutView(s, motion);
    for (const [elx, r2] of [
      [ui.readStill, ro.still],
      [ui.readLight, ro.light],
      [ui.readMode, ro.mode],
    ] as const) {
      elx.textContent = r2.text;
      elx.className = `c-readout ${r2.tone}`.trim();
    }
    const st = statusView(s);
    ui.status.textContent =
      st.text ||
      (welcome ? "First time here? Read the card, then tap Start." : "");
    ui.status.className = `c-status ${st.tone}`.trim();
    ui.details.setAttribute("aria-expanded", String(tab !== null));
    ui.downloadAll.textContent = downloadLabel(s);
    ui.downloadAll.disabled = s.busy !== "idle" || readyCount(s) === 0;
    ui.app.classList.toggle("night", nightOn(s));
  };

  const renderStage = (s: FeatureMatchState): void => {
    const sc = shotContext(s);
    const c = s.guided.count;
    ui.count.textContent = c ? String(c.left) : "";
    ui.cover.hidden = s.running === null;
    ui.coverText.textContent =
      runStatusText(s) || "Camera paused so the timing is fair.";
    ui.welcome.hidden = !welcome;
    const ghost =
      ui.showGhost.checked && s.camera && Boolean(sc.prevPhoto) && !sc.photo;
    if (ghost) {
      drawFrame(ui.ghost, sc.prevPhoto?.id ?? null);
    } else {
      ui.ghost.hidden = true;
    }
  };

  const renderPairs = (s: FeatureMatchState): void => {
    const rows = shotRows(s);
    const key = JSON.stringify(rows);
    if (key !== listKey) {
      listKey = key;
      ui.pairList.replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.index = String(r.index);
          b.className = `st-${r.status}${r.current ? " cur" : ""}`;
          if (r.current) {
            b.setAttribute("aria-current", "step");
          }
          const k = document.createElement("b");
          k.textContent = r.label;
          const small = document.createElement("small");
          small.textContent = r.sub;
          b.append(k, small);
          li.append(b);
          return li;
        }),
      );
    }
    for (const b of all<HTMLButtonElement>("#c-pair-list button")) {
      b.disabled = s.busy !== "idle";
    }
    const done = rows.filter((r) => r.status !== "missing").length;
    ui.pairsSummary.textContent = `${String(done)} of ${String(rows.length)} shots taken.`;
    const n = readyCount(s);
    ui.downloadDrawer.disabled = s.busy !== "idle" || n === 0;
    ui.downloadNote.textContent =
      s.runZip.text ||
      (n > 0
        ? `${String(n)} pair${n === 1 ? "" : "s"} ready`
        : "nothing to download yet");
    ui.addOther.disabled = s.busy !== "idle" || s.plan.extra >= MAX_EXTRA;
    ui.startOver.disabled = s.busy !== "idle";
  };

  const renderGuide = (s: FeatureMatchState): void => {
    const c = shotContext(s);
    if (c.shot.id === guideKey) {
      return;
    }
    guideKey = c.shot.id;
    ui.guideTitle.textContent = `${c.shot.key}: ${c.card.title}`;
    ui.guidePurpose.textContent = c.card.purpose;
    ui.guideSteps.replaceChildren(
      ...listItems(
        [c.card.setup, c.card.change, c.card.capture].filter((t) => t !== ""),
      ),
    );
    ui.guideAvoid.textContent = `Avoid: ${c.card.avoid}`;
    ui.guideSpot.textContent = SPOT_NOTE;
    ui.guideSpot.hidden = c.shot.kind !== "light";
  };

  const renderResults = (s: FeatureMatchState): void => {
    const light = shotContext(s).light;
    ui.lightWarn.hidden = !warned(light);
    if (warned(light)) {
      ui.lightWarn.textContent = LIGHT_NOTE[light];
    }
    ui.openFlat.disabled = s.busy !== "idle";
  };

  const renderSettings = (s: FeatureMatchState): void => {
    const set = s.plan.settings;
    const started = Object.keys(s.plan.shots).length > 0;
    for (const r of all<HTMLInputElement>('input[name="c-countdown"]')) {
      r.checked = Number(r.value) === set.countdown;
    }
    for (const r of all<HTMLInputElement>('input[name="c-spots"]')) {
      r.checked = Number(r.value) === s.plan.spots;
      r.disabled = started || s.busy !== "idle";
    }
    for (const r of all<HTMLInputElement>('input[name="c-capture"]')) {
      r.checked = r.value === set.capture;
    }
    ui.sound.checked = set.sound;
  };

  function render(): void {
    // A shot waits to take itself only once the sensor has spoken: a
    // phone without one keeps the tap, and so does a browser test.
    if (tab === null && motion.seen && handsOffDue(state())) {
      store.dispatch(A.handsOffArmed(performance.now()));
    }
    const s = state();
    io.syncTimer();
    renderDock(s);
    renderStage(s);
    ui.drawer.hidden = tab === null;
    for (const b of all<HTMLButtonElement>("#c-drawer [data-tab]")) {
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    }
    for (const p of all<HTMLElement>("#c-drawer [data-panel]")) {
      p.hidden = p.dataset.panel !== tab;
    }
    if (tab === "pairs") {
      renderPairs(s);
    } else if (tab === "guide") {
      renderGuide(s);
    } else if (tab === "results") {
      renderResults(s);
    } else if (tab === "settings") {
      renderSettings(s);
    }
  }

  // --- wiring -------------------------------------------------------------------

  ui.shutter.addEventListener("click", tapShutter);
  ui.retake.addEventListener("click", tapRetake);
  ui.next.addEventListener("click", tapNext);
  // The previous shot's tile goes back to it; the current one only shows.
  ui.shot.a.addEventListener("click", () => {
    const c = shotContext(state());
    if (c.prev) {
      move(c.index - 1);
    }
  });
  el("chip").addEventListener("click", () => {
    openTab("pairs");
  });
  ui.details.addEventListener("click", () => {
    openTab(tab === null ? "pairs" : null);
  });
  el("drawer-close").addEventListener("click", () => {
    openTab(null);
  });
  for (const b of all<HTMLButtonElement>("#c-drawer [data-tab]")) {
    b.addEventListener("click", () => {
      openTab(TABS.find((t) => t === b.dataset.tab) ?? "pairs");
    });
  }
  ui.pairList.addEventListener("click", (ev) => {
    const b = (ev.target as Element).closest<HTMLButtonElement>(
      "button[data-index]",
    );
    if (!b || b.disabled) {
      return;
    }
    move(Number(b.dataset.index));
    openTab(null);
  });
  ui.downloadAll.addEventListener("click", () => void io.downloadAll());
  ui.downloadDrawer.addEventListener("click", () => void io.downloadAll());
  ui.addOther.addEventListener("click", () => {
    const p = state().plan;
    if (!accepted(A.planSized({ spots: p.spots, extra: p.extra + 1 }))) {
      return;
    }
    // The new own scene's first shot (X1), before its X2.
    move(planShots(state().plan).length - 2);
    log("run: extra scene added");
    openTab(null);
  });
  ui.startOver.addEventListener("click", () => {
    if (
      !confirm(
        "Delete every photo on this phone and start again? Download first if you want to keep them.",
      )
    ) {
      return;
    }
    if (accepted(A.planReset())) {
      log("run: started over");
      openTab(null);
    }
  });
  el("copy-summary").addEventListener(
    "click",
    () => void io.copyText(io.summaryOf(state()), ui.copySummaryState),
  );
  for (const r of all<HTMLInputElement>('input[name="c-countdown"]')) {
    r.addEventListener("change", () => {
      store.dispatch(A.planSettingsChanged({ countdown: Number(r.value) }));
    });
  }
  for (const r of all<HTMLInputElement>('input[name="c-capture"]')) {
    r.addEventListener("change", () => {
      store.dispatch(A.planSettingsChanged({ capture: r.value }));
    });
  }
  for (const r of all<HTMLInputElement>('input[name="c-spots"]')) {
    r.addEventListener("change", () => {
      store.dispatch(
        A.planSized({ spots: Number(r.value), extra: state().plan.extra }),
      );
    });
  }
  ui.sound.addEventListener("change", () => {
    store.dispatch(A.planSettingsChanged({ sound: ui.sound.checked }));
  });
  ui.showGhost.addEventListener("change", render);

  const flat = startFlatCapture(root, {
    store: fm,
    log,
    fail,
    onExit: render,
  });
  ui.openFlat.addEventListener("click", () => {
    // Not while a run or a save goes: the run needs the page, and a
    // pack would start the camera under the flat target.
    if (state().busy !== "idle") {
      return;
    }
    cancelCount("flat target opened");
    camera.stop();
    tab = null;
    render();
    flat.open();
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && tab !== null) {
      openTab(null);
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
    if (handsOffWaits()) {
      store.dispatch(
        A.handsOffSample({
          // The watchdog's clock: one clock for every sample.
          t: performance.now(),
          rate: r && { alpha: r.alpha, beta: r.beta, gamma: r.gamma },
        }),
      );
      if (state().handsOff.phase === "taking") {
        takeHandsOff();
      }
    }
  });
  // A sensor that stops reporting ends the wait (as "failed", with the tap).
  window.setInterval(() => {
    if (handsOffWaits()) {
      store.dispatch(A.handsOffSample({ t: performance.now(), rate: null }));
    }
  }, WATCHDOG_MS);

  return render;
}
