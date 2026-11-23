/**
 * The cockpit view of the feature matching page (`?ui=cockpit`): the
 * viewfinder and one fixed dock (pair chip, progress, instruction, the A
 * and B tiles around the big button, readouts, status, Details and
 * Download all), and a drawer over the viewfinder with the pair list, the
 * pair guide, the results (the measuring block, single files, the flat
 * target) and the settings. After photo B the pair is measured, packed as
 * one zip (downloaded at once or kept for Download all, as set) and the
 * next pair comes up.
 *
 * Every box is drawn from `cockpit-model.ts`; taps only dispatch actions
 * or call the shared `plan-io.ts`. Kept outside the store, as browser
 * resources or transient UI nobody else reads: the drawer tab shown, the
 * welcome card, the ghost toggle (a checkbox), the motion level, the pair
 * waiting for its zip after a run (a guard, like a generation counter),
 * the pair finished last (for "Retake B of NN") and what the canvases and
 * lists last drew.
 *
 * @see cockpit-view.ts.md
 */
import {
  downloadBlob,
  ZIP_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import { createToast } from "gps-plus-slam-app-framework/utils/toast-core";
import { frameCanvas } from "./bench-dom";
import { $, type BenchEngine } from "./bench-engine";
import { pairFileNames, pairTag, type LightCheck } from "./bench-export";
import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import { errorText, formatBytes } from "./bench-net";
import type { CameraControl } from "./camera-control";
import {
  downloadCount,
  handsOffResult,
  instrView,
  meterFill,
  nextAfterPair,
  nightOn,
  NOT_MEASURED,
  pairMeasured,
  progressText,
  readoutView,
  retakeView,
  runStatusText,
  segClasses,
  shutterView,
  statusView,
  tileView,
  type LastPair,
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
  measureText,
  motionStep,
  pairAt,
  planPairOf,
} from "./guided-model";
import { guidedCard } from "./guided-texts";
import { createPlanIo } from "./plan-io";
import { doneCount, MAX_EXTRA, nextStep } from "./plan-slots";
import { keptState, planSlots, type KeptState } from "./run-plan";

/** Set once the welcome card was shown; later visits start without it. */
const BEFORE_START_SEEN = "feature-match-check.before-start-seen";
/** The meter ring's length (2 pi r, r = 46). */
const METER = 289.03;
/** How often a hands-off wait checks that motion readings still come (ms). */
const WATCHDOG_MS = 500;

type Tab = "pairs" | "guide" | "results" | "settings";
const TABS: readonly Tab[] = ["pairs", "guide", "results", "settings"];

/** The Results tab's warning for a light check that failed. */
const LIGHT_WARNINGS: Readonly<Record<Exclude<LightCheck, "ok">, string>> = {
  "not-darker":
    "Photo B is not darker than photo A - the light has to change BETWEEN the two photos. Dim further (switch off more lights) and take photo B again: the camera brightens a dim picture by itself.",
  "too-dark-a":
    "Photo A is almost black - there is too little light to measure a dimming against. Take photo A again with the light on as normal.",
  "too-dark-b":
    "Photo B is black - nothing is left to match. Dim a little less and take photo B again: the room's shapes must stay visible on the screen.",
  changed:
    "Photo B is more than 20 % brighter or darker than photo A - the light changed during the control pair. Take photo B again without changing the light.",
};

const ROW_WORDS: Readonly<Record<KeptState, string>> = {
  missing: "missing",
  half: "A only",
  warn: "retake suggested",
  saved: "saved",
  kept: "kept here",
  done: "done",
};

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
  const { store, sides, newId, accepted, put } = fm;
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
    measureRun: el<HTMLButtonElement>("measure-run"),
    measureState: el("measure-state"),
    fileA: el<HTMLButtonElement>("file-a"),
    fileB: el<HTMLButtonElement>("file-b"),
    fileInfo: el<HTMLButtonElement>("file-info"),
    fileMatches: el<HTMLButtonElement>("file-matches"),
    filesState: el("files-state"),
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
    "Take photo pairs of one scene: photo A, a change (the light, a step, a turn), then photo B. Each pair is measured and saved by itself.";
  el("welcome-list").replaceChildren(...listItems(BEFORE_YOU_START));
  el("before-list").replaceChildren(...listItems(BEFORE_YOU_START));

  // --- transient view state -------------------------------------------------

  let tab: Tab | null = null;
  let welcome = !seenBefore();
  let motion = { level: 0, seen: false, moving: false };
  /** The pair whose run is under way; packed once the run ends. */
  let pending: { slot: string; seq: number } | null = null;
  let last: LastPair | null = null;
  /** The pair list and the segments as last drawn. */
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
    shot: (slot) => {
      pairTaken(slot);
    },
  });
  const { startCamera, cancelCount } = io;

  // --- a complete pair: run, pack, move on ------------------------------------

  function pairTaken(slot: string): void {
    const s = state();
    const rec = s.plan.slots[slot];
    if (!rec?.a || !rec.b || s.guided.retake !== null) {
      return;
    }
    // A failed light check is taken again first: no run, no zip.
    if (rec.light !== null && rec.light !== "ok") {
      return;
    }
    // The run starts first: a render while `pending` is set packs it, and
    // a pack started before the run would hold the page busy and refuse it.
    engine.startRun("plan");
    pending = { slot, seq: rec.seq };
    if (state().running !== "plan") {
      // The run was refused: the zip still holds the photos.
      void packPending();
    }
  }

  /** The pending pair's zip, kept or downloaded; then the next pair. */
  async function packPending(): Promise<void> {
    const p = pending;
    pending = null;
    if (!p) {
      return;
    }
    const s = state();
    const pair = pairAt(s, sides.frames, p.slot);
    if (!pair || pair.seq !== p.seq) {
      log(`pair zip: ${p.slot} changed before it was packed`);
      return;
    }
    if (!accepted(A.planFileSaveStarted())) {
      return;
    }
    const names = pairFileNames(
      pairTag(pair.slot.key, pair.slot.spot, pair.seq),
    );
    const keep = (id: string, zip: Blob): void => {
      put(
        sides.blobs,
        [[id, zip]],
        A.planFileKept({ id, name: names.all, slot: pair.slot.id }),
      );
    };
    let text: string;
    const measured = pairMeasured(
      s,
      s.planRun?.resultsId ? sides.results.get(s.planRun.resultsId) : undefined,
      p.slot,
      p.seq,
    );
    try {
      const zip = await io.pairZip(state(), pair);
      const id = newId("file");
      if (state().plan.settings.save === "each") {
        if (await downloadBlob(zip, names.all, ZIP_FILE_TYPE)) {
          // Kept, marked downloaded, until Download all: a browser that
          // blocked the second download still has it to give.
          keep(id, zip);
          store.dispatch(A.planFilesDownloaded([id]));
          text = `Download started: ${names.all} (allow multiple downloads if Chrome asks).`;
        } else {
          keep(id, zip);
          text =
            "Not saved: the save dialog was closed. The pair is kept here for Download all.";
        }
      } else {
        keep(id, zip);
        text = `Kept ${names.all} here (${formatBytes(zip.size)}).`;
      }
      if (!measured) {
        text = `${text} ${NOT_MEASURED}`;
      }
      log(`pair zip: ${text}`);
    } catch (e) {
      fail("save", e);
      text = `Could not pack the pair: ${errorText(e)}. The photos are kept.`;
    }
    // The move comes before the save ends: a move clears the file line,
    // and this one must stay to say what became of the pair.
    const before = state();
    const at = planSlots(before.plan)[before.plan.current];
    const next = nextAfterPair(before);
    if (at?.id === p.slot && next !== null) {
      const index = before.plan.current;
      if (accepted(A.planMoved(next))) {
        last = { index, seq: p.seq };
        log(`next pair: ${planSlots(state().plan)[next]?.id ?? "-"}`);
      }
    }
    store.dispatch(A.planFileSaveEnded(text));
    note.show(text);
    // The flat target has the camera now: it starts again when that closes.
    if (
      !camera.on() &&
      state().cameraStart !== "failed" &&
      !state().flat.open
    ) {
      void startCamera();
    }
  }

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
      last = null;
      log(`pair: ${planSlots(state().plan)[index]?.id ?? "-"}`);
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
        if (v.shot) {
          io.beginCount(v.shot);
        }
        break;
      case "retake":
        if (v.shot && accepted(A.guidedRetakeToggled(v.shot))) {
          io.beginCount(v.shot);
        }
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
    const r = retakeView(state(), last);
    if (!r.action) {
      return;
    }
    if (r.action.kind === "toggle") {
      store.dispatch(A.guidedRetakeToggled(r.action.which));
      return;
    }
    const back = r.action.index;
    if (accepted(A.planMoved(back))) {
      last = null;
      store.dispatch(A.guidedRetakeToggled("b"));
      log(`retake B of ${planSlots(state().plan)[back]?.id ?? "-"}`);
    }
  };

  const tapNext = (): void => {
    const s = state();
    const step = nextStep(planSlots(s.plan), s.plan.slots, s.plan.current);
    if (step.kind !== "end") {
      cancelCount("next pair");
      move(step.index);
    }
  };

  // --- hands-off photo B ----------------------------------------------------------

  const handsOffWaits = (): boolean => {
    const p = state().handsOff.phase;
    return tab === null && (p === "armed" || p === "waiting");
  };

  /** The phone rested for the dwell: photo B, and how it went. */
  const takeHandsOff = (): void => {
    const r = handsOffResult(
      () => io.shoot("b"),
      (e) => {
        fail("capture", e);
      },
    );
    store.dispatch(A.handsOffShot(r));
    log(`hands-off photo B: ${r}`);
  };

  // --- render -------------------------------------------------------------------

  /** Draws the frame `id` onto `canvas` once; hides it while there is none. */
  const drawFrame = (canvas: HTMLCanvasElement, id: string | null): void => {
    const f = id ? sides.frames.get(id) : undefined;
    canvas.hidden = !f;
    if (f && id && canvas.dataset.id !== id) {
      frameCanvas(f.frame, canvas);
      canvas.dataset.id = id;
    }
  };

  const renderDock = (s: FeatureMatchState): void => {
    const list = planSlots(s.plan);
    const slot = list[Math.min(s.plan.current, list.length - 1)]!;
    const rec = s.plan.slots[slot.id];
    const card = guidedCard(slot.key);
    ui.chipKey.textContent = slot.key;
    ui.chipLabel.textContent = card.title;
    ui.chipSpot.textContent = slot.key.startsWith("1")
      ? `place ${String(slot.spot)}`
      : "";
    ui.progressText.textContent = progressText(s);
    const segs = segClasses(s);
    const key = segs.join(",");
    if (key !== segKey) {
      segKey = key;
      ui.segs.replaceChildren(
        ...segs.map((c) => {
          const i = document.createElement("i");
          i.className = c;
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
    ui.changeText.textContent = card.change;
    const tiles = tileView(s);
    for (const w of ["a", "b"] as const) {
      const t = tiles[w];
      ui.shot[w].dataset.state = t.state;
      ui.shot[w].disabled = t.disabled;
      ui.shotState[w].textContent = t.text;
      drawFrame(
        $<HTMLCanvasElement>(ui.shot[w], "canvas"),
        rec?.[w]?.id ?? null,
      );
    }
    const sh = shutterView(s);
    ui.shutter.dataset.mode = sh.tone;
    ui.shutter.disabled = sh.disabled;
    ui.shutterText.textContent = sh.text;
    ui.meter.style.strokeDashoffset = String(METER * (1 - meterFill(s)));
    const r = retakeView(s, last);
    ui.retake.disabled = r.disabled;
    ui.retakeLabel.textContent = r.label;
    ui.next.disabled =
      s.busy !== "idle" ||
      nextStep(list, s.plan.slots, s.plan.current).kind === "end";
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
    const n = downloadCount(s);
    ui.downloadAll.textContent =
      n > 0 ? `Download all (${String(n)})` : "Download all";
    ui.downloadAll.disabled =
      s.busy !== "idle" || doneCount(list, s.plan.slots) === 0;
    ui.app.classList.toggle("night", nightOn(s));
  };

  const renderStage = (s: FeatureMatchState): void => {
    const list = planSlots(s.plan);
    const slot = list[Math.min(s.plan.current, list.length - 1)]!;
    const rec = s.plan.slots[slot.id];
    const c = s.guided.count;
    ui.count.textContent = c ? String(c.left) : "";
    ui.cover.hidden = s.running === null;
    ui.coverText.textContent =
      runStatusText(s) || "Camera paused so the timing is fair.";
    ui.welcome.hidden = !welcome;
    const ghost =
      ui.showGhost.checked &&
      s.camera &&
      s.guided.retake === null &&
      Boolean(rec?.a) &&
      !rec?.b;
    if (ghost) {
      drawFrame(ui.ghost, rec?.a?.id ?? null);
    } else {
      ui.ghost.hidden = true;
    }
  };

  const renderPairs = (s: FeatureMatchState): void => {
    const list = planSlots(s.plan);
    const rows = list.map((sl, index) => ({
      index,
      key: sl.key,
      label: sl.key.startsWith("1")
        ? `${guidedCard(sl.key).title}, place ${String(sl.spot)}`
        : guidedCard(sl.key).title,
      state: keptState(s.plan, sl.id),
      cur: index === s.plan.current,
    }));
    const key = JSON.stringify(rows);
    if (key !== listKey) {
      listKey = key;
      ui.pairList.replaceChildren(
        ...rows.map((r) => {
          const li = document.createElement("li");
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.index = String(r.index);
          b.className = `st-${r.state}${r.cur ? " cur" : ""}`;
          if (r.cur) {
            b.setAttribute("aria-current", "step");
          }
          const k = document.createElement("b");
          k.textContent = r.key;
          const label = document.createElement("span");
          label.textContent = r.label;
          const small = document.createElement("small");
          small.textContent = ROW_WORDS[r.state];
          b.append(k, label, small);
          li.append(b);
          return li;
        }),
      );
    }
    for (const b of all<HTMLButtonElement>("#c-pair-list button")) {
      b.disabled = s.busy !== "idle";
    }
    const done = rows.filter(
      (r) => r.state !== "missing" && r.state !== "half",
    ).length;
    ui.pairsSummary.textContent = `${String(done)} of ${String(rows.length)} pairs complete.`;
    const n = downloadCount(s);
    ui.downloadDrawer.disabled = s.busy !== "idle" || n === 0;
    ui.downloadNote.textContent =
      s.runZip.text ||
      (n > 0
        ? `${String(n)} pairs not downloaded yet`
        : "nothing to download yet");
    ui.addOther.disabled = s.busy !== "idle" || s.plan.extra >= MAX_EXTRA;
    ui.startOver.disabled = s.busy !== "idle";
  };

  const renderGuide = (s: FeatureMatchState): void => {
    const slot = planSlots(s.plan)[s.plan.current];
    if (!slot || slot.key === guideKey) {
      return;
    }
    guideKey = slot.key;
    const g = PAIR_GUIDE[slot.key];
    ui.guideTitle.textContent = `${slot.key}: ${guidedCard(slot.key).title}`;
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

  const renderResults = (s: FeatureMatchState): void => {
    const slot = planSlots(s.plan)[s.plan.current];
    const light = slot ? (s.plan.slots[slot.id]?.light ?? null) : null;
    ui.lightWarn.hidden = light === null || light === "ok";
    if (light !== null && light !== "ok") {
      ui.lightWarn.textContent = LIGHT_WARNINGS[light];
    }
    const pair = planPairOf(s, sides.frames);
    const idle = s.busy === "idle";
    const off = !idle || !pair;
    ui.measureRun.disabled = off;
    ui.measureState.textContent = measureText(s, pair);
    ui.fileA.disabled = off;
    ui.fileB.disabled = off;
    ui.fileInfo.disabled = off;
    ui.fileMatches.disabled = off || !io.matchesOf(s, pair);
    ui.openFlat.disabled = !idle;
    ui.filesState.textContent = s.fileSave.text;
  };

  const renderSettings = (s: FeatureMatchState): void => {
    const set = s.plan.settings;
    const started = Object.keys(s.plan.slots).length > 0;
    for (const r of all<HTMLInputElement>('input[name="c-save"]')) {
      r.checked = r.value === set.save;
    }
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
    // A pack starts here, before the state is read: its first dispatch
    // marks the page busy, and this render must draw that.
    if (pending && state().running === null) {
      void packPending();
    }
    // Photo B waits to take itself only once the sensor has spoken: a
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
  for (const w of ["a", "b"] as const) {
    ui.shot[w].addEventListener("click", () => {
      store.dispatch(A.guidedRetakeToggled(w));
    });
  }
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
    move(planSlots(state().plan).length - 1);
    log("run: extra pair added");
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
      last = null;
      log("run: started over");
      openTab(null);
    }
  });
  ui.measureRun.addEventListener("click", () => {
    engine.startRun("plan");
  });
  ui.fileA.addEventListener("click", () => void io.saveFile("A"));
  ui.fileB.addEventListener("click", () => void io.saveFile("B"));
  ui.fileInfo.addEventListener("click", () => void io.saveFile("info"));
  ui.fileMatches.addEventListener("click", () => void io.saveFile("matches"));
  el("copy-summary").addEventListener(
    "click",
    () => void io.copyText(io.summaryOf(state()), ui.copySummaryState),
  );
  for (const r of all<HTMLInputElement>('input[name="c-save"]')) {
    r.addEventListener("change", () => {
      store.dispatch(A.planSettingsChanged({ save: r.value }));
    });
  }
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
