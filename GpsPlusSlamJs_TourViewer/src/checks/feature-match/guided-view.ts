/**
 * The guided view of the feature matching page (the default; `?ui=cockpit`
 * shows the four steps): an intro, then one pair at a time with a step
 * card, a viewfinder and a countdown before each photo, a pairs sheet,
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
import {
  downloadBlob,
  packFilesAsZip,
  ZIP_FILE_TYPE,
  type DownloadFileType,
} from "gps-plus-slam-app-framework/storage";
import { captureFrame, frameCanvas, framePng } from "./bench-dom";
import { $, CAPTURE_MAX, type BenchEngine } from "./bench-engine";
import {
  FRAME_FILES,
  framesInfo,
  matchesInfo,
  pairFileNames,
  pairTag,
} from "./bench-export";
import { greyStats } from "./bench-image";
import { errorText, formatBytes } from "./bench-net";
import type { CameraControl } from "./camera-control";
import {
  featureMatchActions as A,
  logText,
  type FeatureMatchState,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";
import { diagramSvg } from "./guided-diagram";
import {
  deviceSummary,
  endView,
  isMoving,
  measureText,
  motionStep,
  pairRows,
  planPairOf,
  runPairs,
  runView,
  type PlanPair,
} from "./guided-model";
import { MAX_EXTRA, runZipName, summaryText } from "./plan-slots";
import { planSlots } from "./run-plan";

type Screen = "intro" | "run" | "end";
type Sheet = "pairs" | "measure" | null;
type Shot = "a" | "b";

const PNG_FILE_TYPE: DownloadFileType = {
  description: "PNG image",
  mimeType: "image/png",
  extension: ".png",
};
const JSON_FILE_TYPE: DownloadFileType = {
  description: "JSON file",
  mimeType: "application/json",
  extension: ".json",
};

/** The summary file inside the run zip. */
const SUMMARY_FILE = "feature-match-summary.txt";

/** How long the white flash after a photo stays, in ms. */
const FLASH_MS = 360;

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
  const { store, sides, newId, accepted, put } = fm;
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
    measureRun: el<HTMLButtonElement>("measure-run"),
    measureRunLabel: el("measure-run-label"),
    measureState: el("measure-state"),
    fileA: el<HTMLButtonElement>("file-a"),
    fileB: el<HTMLButtonElement>("file-b"),
    fileInfo: el<HTMLButtonElement>("file-info"),
    fileMatches: el<HTMLButtonElement>("file-matches"),
    filesState: el("files-state"),
    openFlat: el<HTMLButtonElement>("open-flat"),
  };

  // The measuring block keeps its own elements and listeners; it moves
  // into the measure sheet, and the four-step layout stays out of sight.
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

  let screen: Screen = state().plan.shots === 0 ? "intro" : "run";
  let sheet: Sheet = null;
  let ghostOn = false;
  /** Raised by every camera start, so only the newest one reports back. */
  let camTry = 0;
  let motion = { level: 0, seen: false, moving: false };
  /** The phone moved while the countdown ran; named in the photo's log line. */
  let movedDuringCount = false;
  let countTimer: ReturnType<typeof setInterval> | null = null;
  let audio: AudioContext | null = null;
  let deviceLine = "-";
  /** The pair grid's rows as last drawn, so a render keeps the buttons. */
  let gridKey = "";

  void engine.deviceInfo().then((d) => {
    deviceLine = deviceSummary(d);
    render();
  });

  // --- sound, vibration, flash ------------------------------------------------

  const beep = (freq: number, ms: number): void => {
    if (!state().plan.settings.sound) {
      return;
    }
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + ms / 1000);
    } catch {
      // No audio: the countdown digits still show.
    }
  };
  /** Only at the tap, never at the shot: a vibration then shakes the photo. */
  const buzz = (ms: number): void => {
    try {
      navigator.vibrate(ms);
    } catch {
      // No vibration.
    }
  };
  const flash = (): void => {
    ui.flash.hidden = false;
    setTimeout(() => {
      ui.flash.hidden = true;
    }, FLASH_MS);
  };

  // --- camera and screens -----------------------------------------------------

  const startCamera = async (): Promise<void> => {
    const mine = ++camTry;
    store.dispatch(A.cameraStartSet("starting"));
    const r = await camera.start();
    if (mine === camTry) {
      store.dispatch(A.cameraStartSet(r === "failed" ? "failed" : "idle"));
    }
  };

  const stopTimer = (): void => {
    if (countTimer !== null) {
      clearInterval(countTimer);
      countTimer = null;
    }
  };

  const cancelCount = (why: string): void => {
    if (state().guided.count === null) {
      return;
    }
    store.dispatch(A.guidedCountSet(null));
    stopTimer();
    log(`countdown: ${why}`);
  };

  const show = (next: Screen): void => {
    if (next !== "run") {
      cancelCount("screen left");
    }
    screen = next;
    if (next === "run") {
      if (
        !camera.on() &&
        state().cameraStart === "idle" &&
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

  // --- photos -------------------------------------------------------------------

  const shoot = (shot: Shot): void => {
    const before = state();
    const slot = runView(before).slot;
    if (video.videoWidth === 0) {
      log("capture: the camera has no picture yet");
      return;
    }
    const f = captureFrame(video, CAPTURE_MAX);
    const source = { width: video.videoWidth, height: video.videoHeight };
    const grey = greyStats(f);
    const id = newId("photo");
    const name = shot === "a" ? "A" : "B";
    const ok = put(
      sides.frames,
      [[id, { name, frame: f, source }]],
      A.planPhotoTaken({
        slot,
        which: shot,
        photo: {
          id,
          width: f.width,
          height: f.height,
          source,
          greyMean: grey.mean,
        },
      }),
    );
    const moved = movedDuringCount;
    movedDuringCount = false;
    if (!ok) {
      log(`capture: photo ${name} of ${slot} refused`);
      return;
    }
    beep(1320, 60);
    flash();
    const rec = state().plan.slots[slot];
    log(
      `photo ${name}: ${slot} #${String(rec?.seq ?? 0)} ${String(f.width)}x${String(f.height)} grey mean ${grey.mean.toFixed(1)}${moved ? " (phone moved during countdown)" : ""}`,
    );
    if (rec?.a && rec.b && rec.light) {
      log(`light check ${slot}: ${rec.light}`);
    }
    if (shot === "a") {
      ghostOn = false;
    }
  };

  const tick = (): void => {
    const c = state().guided.count;
    if (!c) {
      stopTimer();
      return;
    }
    if (c.left <= 1) {
      stopTimer();
      store.dispatch(A.guidedCountSet(null));
      shoot(c.shot);
      return;
    }
    if (!accepted(A.guidedCountSet({ shot: c.shot, left: c.left - 1 }))) {
      cancelCount("refused");
      return;
    }
    beep(660, 90);
  };

  const beginCount = (shot: Shot): void => {
    const secs = state().plan.settings.countdown;
    buzz(30);
    if (!secs) {
      shoot(shot);
      return;
    }
    if (!accepted(A.guidedCountSet({ shot, left: secs }))) {
      return;
    }
    movedDuringCount = motion.moving;
    beep(660, 90);
    stopTimer();
    countTimer = setInterval(tick, 1000);
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
        if (p.shot) {
          beginCount(p.shot);
        }
        return;
      case "next":
      case "missing":
        if (accepted(A.planMoved(p.index))) {
          ghostOn = false;
          log(`next pair: ${runView(state()).slot}`);
        }
        return;
      case "finish":
        show("end");
    }
  };

  // --- Download all -------------------------------------------------------------

  const summaryOf = (s: FeatureMatchState): string =>
    summaryText({
      session: s.session,
      spots: s.plan.spots,
      list: planSlots(s.plan),
      pairs: s.plan.slots,
      shots: s.plan.shots,
      downloads: s.plan.downloads,
      device: deviceLine,
    });

  const packRun = async (s: FeatureMatchState): Promise<Blob> => {
    const pairs = runPairs(s, sides.frames);
    const device = await engine.deviceInfo();
    const files: { path: string; data: Blob | string }[] = [];
    for (const p of pairs) {
      files.push(
        { path: p.names.A, data: await framePng(p.a.frame, "frame A") },
        { path: p.names.B, data: await framePng(p.b.frame, "frame B") },
        {
          path: p.names.info,
          data: framesInfo(
            [p.a, p.b],
            device,
            CAPTURE_MAX,
            p.tag,
            { light: p.light, session: s.session },
            { A: p.names.A, B: p.names.B },
          ),
        },
      );
    }
    log(`download: ${String(pairs.length)} pairs as ${runZipName(s.session)}`);
    const now = state();
    files.push(
      { path: SUMMARY_FILE, data: summaryOf(now) },
      { path: FRAME_FILES.log, data: `${logText(now)}\n` },
    );
    return packFilesAsZip(files);
  };

  const downloadAll = async (): Promise<void> => {
    if (!accepted(A.runZipStarted())) {
      return;
    }
    const name = runZipName(state().session);
    try {
      const zip = await packRun(state());
      const saved = await downloadBlob(zip, name, ZIP_FILE_TYPE);
      if (saved) {
        store.dispatch(A.planRunDownloaded());
        store.dispatch(
          A.runZipEnded({
            phase: "saved",
            text: `Saved ${name} (${formatBytes(zip.size)}). Send this file.`,
          }),
        );
        log(`download: saved ${name}`);
      } else {
        store.dispatch(
          A.runZipEnded({
            phase: "idle",
            text: "Not saved: the save dialog was closed. Nothing was lost.",
          }),
        );
        log("download: the save dialog was closed");
      }
    } catch (e) {
      fail("download", e);
      store.dispatch(
        A.runZipEnded({
          phase: "failed",
          text: `Could not prepare the zip: ${errorText(e)}. Nothing was lost; try again.`,
        }),
      );
    }
  };

  // --- single files (measure sheet) ------------------------------------------

  /** The current pair's matches, when a plan run on this take finished. */
  const matchesOf = (s: FeatureMatchState, pair: PlanPair | null) => {
    const r = s.planRun;
    if (!pair || !r || r.slot !== pair.slot.id || r.seq !== pair.seq) {
      return undefined;
    }
    return r.resultsId ? sides.results.get(r.resultsId) : undefined;
  };

  type FileKind = "A" | "B" | "info" | "matches";
  const saveFile = async (kind: FileKind): Promise<void> => {
    const s = state();
    const pair = planPairOf(s, sides.frames);
    if (!pair || !accepted(A.planFileSaveStarted())) {
      return;
    }
    let note: string;
    try {
      const rec = s.plan.slots[pair.slot.id];
      const tag = pairTag(pair.slot.key, pair.slot.spot, pair.seq);
      const names = pairFileNames(tag);
      const json = (text: string): Blob =>
        new Blob([text], { type: "application/json" });
      let blob: Blob;
      let type = JSON_FILE_TYPE;
      if (kind === "A" || kind === "B") {
        const f = kind === "A" ? pair.a : pair.b;
        blob = await framePng(f.frame, `frame ${kind}`);
        type = PNG_FILE_TYPE;
      } else if (kind === "info") {
        blob = json(
          framesInfo(
            [pair.a, pair.b],
            await engine.deviceInfo(),
            CAPTURE_MAX,
            tag,
            { light: rec?.light ?? null, session: s.session },
            { A: names.A, B: names.B },
          ),
        );
      } else {
        const res = matchesOf(s, pair);
        if (!res) {
          throw new Error("no finished run on this pair");
        }
        blob = json(matchesInfo(res, { a: pair.a.frame, b: pair.b.frame }));
      }
      const name = names[kind];
      if (await downloadBlob(blob, name, type)) {
        const id = newId("file");
        put(
          sides.blobs,
          [[id, blob]],
          A.planFileKept({ id, name, slot: pair.slot.id }),
        );
        store.dispatch(A.planFilesDownloaded([id]));
        store.dispatch(A.planKeptDropped());
        note = `saved ${name} (${formatBytes(blob.size)})`;
        log(`file saved: ${name}`);
      } else {
        note = "not saved: the save dialog was closed";
      }
    } catch (e) {
      fail("save", e);
      note = `could not save: ${errorText(e)}`;
    }
    store.dispatch(A.planFileSaveEnded(note));
  };

  // --- copy -------------------------------------------------------------------

  const copyText = async (text: string, out: HTMLElement): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      out.textContent = "copied";
    } catch {
      out.textContent = "copy refused: select the text and copy by hand";
    }
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

  const renderSteady = (reviewing: boolean): void => {
    ui.steady.hidden = !motion.seen || screen !== "run" || reviewing;
    ui.steady.textContent = motion.moving ? "phone moving" : "steady";
    ui.steady.classList.toggle("moving", motion.moving);
  };

  const renderRun = (s: FeatureMatchState): boolean => {
    const v = runView(s);
    const rec = s.plan.slots[v.slot];
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
      drawFrame(ui.reviewA, rec?.a?.id ?? null);
      drawFrame(ui.reviewB, rec?.b?.id ?? null);
    }
    ui.camChip.hidden = v.reviewing || s.camera;
    ui.camChip.textContent =
      s.cameraStart === "starting"
        ? "starting camera..."
        : s.cameraStart === "failed"
          ? "camera unavailable: tap Capture to retry"
          : "camera off: tap Capture";
    ui.storeChip.hidden = !s.photoStoreFailing;
    ui.ghostToggle.hidden = !v.ghost;
    ui.ghostToggle.setAttribute("aria-pressed", String(ghostOn));
    if (ghostOn && v.ghost) {
      drawFrame(ui.ghost, rec?.a?.id ?? null);
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
      btn.dataset.retaking = String(t.retaking);
      btn.disabled = t.disabled;
      $(btn, ".slot-sub").textContent = t.sub;
      drawFrame($<HTMLCanvasElement>(btn, "canvas"), rec?.[w]?.id ?? null);
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
    const rows = pairRows(s);
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
    const v = endView(s);
    ui.endKicker.textContent = v.kicker;
    ui.endTitle.textContent = v.title;
    ui.endLede.textContent = v.lede;
    ui.downloadAll.textContent = v.download.label;
    ui.downloadAll.disabled = !v.canDownload;
    ui.downloadState.className = `state ${v.download.tone}`.trim();
    ui.downloadState.textContent = v.download.text;
    ui.summary.value = summaryOf(s);
    ui.storeState.hidden = !s.photoStoreFailing;
  };

  const renderMeasure = (s: FeatureMatchState): void => {
    const pair = planPairOf(s, sides.frames);
    const idle = s.busy === "idle";
    ui.measureRun.disabled = !idle || !pair;
    ui.measureRunLabel.textContent = `Run on pair ${runView(s).slot}`;
    ui.measureState.textContent = measureText(s, pair);
    const off = !idle || !pair;
    ui.fileA.disabled = off;
    ui.fileB.disabled = off;
    ui.fileInfo.disabled = off;
    ui.fileMatches.disabled = off || !matchesOf(s, pair);
    ui.filesState.textContent = s.fileSave.text;
  };

  const render = (): void => {
    const s = state();
    if (s.guided.count === null) {
      stopTimer();
    }
    ui.intro.hidden = screen !== "intro";
    ui.run.hidden = screen !== "run";
    ui.end.hidden = screen !== "end";
    ui.pairsSheet.hidden = sheet !== "pairs";
    ui.measureSheet.hidden = sheet !== "measure";
    const started = Object.keys(s.plan.slots).length > 0;
    for (const b of all<HTMLButtonElement>("#g-intro [data-spots]")) {
      b.setAttribute(
        "aria-checked",
        String(Number(b.dataset.spots) === s.plan.spots),
      );
      b.disabled = started || s.busy !== "idle";
    }
    ui.introStart.textContent =
      s.plan.shots > 0 ? "Continue where you left off" : "Start";
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
    if (sheet === "measure") {
      renderMeasure(s);
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
    if (s.plan.shots === 0) {
      log(
        `run: light tests at ${String(s.plan.spots)} place(s), ${String(planSlots(s.plan).length)} pairs`,
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
      store.dispatch(A.guidedRetakeToggled(w));
    });
  }
  ui.ghostToggle.addEventListener("click", () => {
    ghostOn = !ghostOn;
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
    ghostOn = false;
    sheet = null;
    show("run");
  });
  ui.addOther.addEventListener("click", () => {
    const p = state().plan;
    if (!accepted(A.planSized({ spots: p.spots, extra: p.extra + 1 }))) {
      return;
    }
    store.dispatch(A.planMoved(planSlots(state().plan).length - 1));
    log(`run: extra pair ${runView(state()).slot} added`);
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
    ghostOn = false;
    sheet = null;
    show("intro");
  });
  ui.downloadAll.addEventListener("click", () => void downloadAll());
  el("copy-summary").addEventListener(
    "click",
    () => void copyText(summaryOf(state()), ui.copySummaryState),
  );
  el("copy-log").addEventListener(
    "click",
    () => void copyText(logText(state()), ui.copyLogState),
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
  ui.measureRun.addEventListener("click", () => {
    engine.startRun("plan");
  });
  ui.fileA.addEventListener("click", () => void saveFile("A"));
  ui.fileB.addEventListener("click", () => void saveFile("B"));
  ui.fileInfo.addEventListener("click", () => void saveFile("info"));
  ui.fileMatches.addEventListener("click", () => void saveFile("matches"));

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
    if (!r || (r.alpha === null && r.beta === null && r.gamma === null)) {
      return;
    }
    const level = motionStep(motion.level, r);
    const moving = isMoving(level);
    const changed = moving !== motion.moving || !motion.seen;
    motion = { level, seen: true, moving };
    if (moving && state().guided.count !== null) {
      movedDuringCount = true;
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
