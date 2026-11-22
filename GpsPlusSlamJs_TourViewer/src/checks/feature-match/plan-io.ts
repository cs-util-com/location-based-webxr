/**
 * The photo test's browser side, shared by both views of the feature
 * matching page: the camera start with its generation guard, the countdown
 * with its beep, vibration and flash, the plan photo itself, a pair's own
 * zip, the run's zip (Download all), the single files and the summary.
 * Every outcome is an action on the shared store; what stays here is a
 * browser resource or a guard (the timer, the audio context, the newest
 * camera start, the device line, whether the phone moved during a count).
 *
 * @see plan-io.ts.md
 */
import {
  downloadBlob,
  packFilesAsZip,
  ZIP_FILE_TYPE,
  type DownloadFileType,
} from "gps-plus-slam-app-framework/storage";
import { captureFrame, framePng } from "./bench-dom";
import { CAPTURE_MAX, type BenchEngine } from "./bench-engine";
import {
  allFilesZip,
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
import {
  deviceSummary,
  planPairOf,
  runPairs,
  runView,
  type PlanPair,
} from "./guided-model";
import { runZipName, summaryText } from "./plan-slots";
import { planSlots } from "./run-plan";

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

/** A file of the measure sheet or the Results tab. */
type FileKind = "A" | "B" | "info" | "matches";

export interface PlanIoDeps {
  readonly fm: FeatureMatchStore;
  readonly engine: BenchEngine;
  readonly camera: CameraControl;
  readonly video: HTMLVideoElement;
  /** Shown for a moment after each photo. */
  readonly flash: HTMLElement;
  /** Says why a tap or a countdown ended without a photo. */
  readonly note: { show(text: string): void; clear(): void };
  readonly log: (line: string) => void;
  readonly fail: (where: string, e: unknown) => void;
  /** Whether the phone moves now (the view's motion reading). */
  readonly moving: () => boolean;
  /** Called once the device line for the summary is known. */
  readonly deviceKnown: () => void;
  /** Called after the store took a photo, with its slot. */
  readonly shot?: (slot: string, which: Shot) => void;
}

export interface PlanIo {
  /** Starts the camera; only the newest start reports back. */
  readonly startCamera: () => Promise<void>;
  /** Starts the countdown for `shot`, or shoots at once with none. */
  beginCount(shot: Shot): void;
  /** Ends a running countdown without a photo; `why` goes to the log. */
  readonly cancelCount: (why: string) => void;
  /** Stops the count timer when the state says no count runs. */
  syncTimer(): void;
  /** Takes `shot` of the current slot now; true when the store took it. */
  shoot(shot: Shot): boolean;
  /** The phone moved: named in the photo's log line if a count runs. */
  moved(): void;
  summaryOf(s: FeatureMatchState): string;
  /** The current take's results, when a plan run on it finished. */
  matchesOf(
    s: FeatureMatchState,
    pair: PlanPair | null,
  ): ReturnType<FeatureMatchStore["sides"]["results"]["get"]>;
  /** One pair as one zip: photos, frames JSON, matches, log and report. */
  pairZip(s: FeatureMatchState, pair: PlanPair): Promise<Blob>;
  /** Download all: the run's zip, then its downloaded marks. */
  downloadAll(): Promise<void>;
  /** One file of the current pair. */
  saveFile(kind: FileKind): Promise<void>;
  copyText(text: string, out: HTMLElement): Promise<void>;
}

/** Wires the shared photo test actions for one view. */
export function createPlanIo(d: PlanIoDeps): PlanIo {
  const { fm, engine, camera, video, log, fail } = d;
  const { store, sides, newId, accepted, put } = fm;
  const state = (): FeatureMatchState => store.getState();

  /** Raised by every camera start, so only the newest one reports back. */
  let camTry = 0;
  let countTimer: ReturnType<typeof setInterval> | null = null;
  let audio: AudioContext | null = null;
  let movedDuringCount = false;
  let deviceLine = "-";

  void engine.deviceInfo().then((info) => {
    deviceLine = deviceSummary(info);
    d.deviceKnown();
  });

  // --- sound, vibration, flash ----------------------------------------------

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
    d.flash.hidden = false;
    setTimeout(() => {
      d.flash.hidden = true;
    }, FLASH_MS);
  };

  // --- camera and countdown -------------------------------------------------

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

  const shoot = (shot: Shot): boolean => {
    const slot = runView(state()).slot;
    if (video.videoWidth === 0) {
      log("capture: the camera has no picture yet");
      d.note.show("No photo: the camera had no picture yet. Tap again.");
      return false;
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
      d.note.show(`No photo ${name}: the page was busy. Tap again.`);
      return false;
    }
    d.note.clear();
    beep(1320, 60);
    flash();
    const rec = state().plan.slots[slot];
    log(
      `photo ${name}: ${slot} #${String(rec?.seq ?? 0)} ${String(f.width)}x${String(f.height)} grey mean ${grey.mean.toFixed(1)}${moved ? " (phone moved during countdown)" : ""}`,
    );
    if (rec?.a && rec.b && rec.light) {
      log(`light check ${slot}: ${rec.light}`);
    }
    d.shot?.(slot, shot);
    return true;
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
    movedDuringCount = d.moving();
    beep(660, 90);
    stopTimer();
    countTimer = setInterval(tick, 1000);
  };

  // --- files ------------------------------------------------------------------

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

  const matchesOf = (s: FeatureMatchState, pair: PlanPair | null) => {
    const r = s.planRun;
    if (!pair || !r || r.slot !== pair.slot.id || r.seq !== pair.seq) {
      return undefined;
    }
    return r.resultsId ? sides.results.get(r.resultsId) : undefined;
  };

  const json = (text: string): Blob =>
    new Blob([text], { type: "application/json" });

  const pairZip = async (
    s: FeatureMatchState,
    pair: PlanPair,
  ): Promise<Blob> => {
    const rec = s.plan.slots[pair.slot.id];
    const tag = pairTag(pair.slot.key, pair.slot.spot, pair.seq);
    const info = framesInfo(
      [pair.a, pair.b],
      await engine.deviceInfo(),
      CAPTURE_MAX,
      tag,
      { light: rec?.light ?? null, session: s.session },
    );
    // A run that measured nothing still saves the photos: an empty list.
    const matches = matchesInfo(matchesOf(s, pair) ?? [], {
      a: pair.a.frame,
      b: pair.b.frame,
    });
    const now = state();
    return allFilesZip(
      [
        { name: FRAME_FILES.A, blob: await framePng(pair.a.frame, "frame A") },
        { name: FRAME_FILES.B, blob: await framePng(pair.b.frame, "frame B") },
        { name: FRAME_FILES.info, blob: json(info) },
        { name: FRAME_FILES.matches, blob: json(matches) },
      ],
      { log: logText(now), report: now.report },
    );
  };

  /**
   * Every complete pair: its kept zip when this take has one on the page
   * (it holds the matches), else its photos and frames JSON; then the
   * summary and the log.
   */
  const packRun = async (s: FeatureMatchState): Promise<Blob> => {
    const pairs = runPairs(s, sides.frames);
    const device = await engine.deviceInfo();
    const files: { path: string; data: Blob | string }[] = [];
    for (const p of pairs) {
      const kept = s.plan.kept.find(
        (k) => k.slot === p.slot.id && k.seq === p.tag.sequence,
      );
      const zip = kept ? sides.blobs.get(kept.id) : undefined;
      if (kept && zip) {
        files.push({ path: kept.name, data: zip });
        continue;
      }
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
      const packed = state();
      const zip = await packRun(packed);
      const saved = await downloadBlob(zip, name, ZIP_FILE_TYPE);
      if (saved) {
        store.dispatch(
          A.runZipEnded({
            phase: "saved",
            text: `Saved ${name} (${formatBytes(zip.size)}). Send this file.`,
          }),
        );
        store.dispatch(A.planRunDownloaded());
        store.dispatch(
          A.planFilesDownloaded(packed.plan.kept.map((k) => k.id)),
        );
        store.dispatch(A.planKeptDropped());
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
        // Kept and dropped at once: only the take's downloaded mark stays,
        // so no Blob goes into the side table.
        const id = newId("file");
        store.dispatch(A.planFileKept({ id, name, slot: pair.slot.id }));
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

  const copyText = async (text: string, out: HTMLElement): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      out.textContent = "copied";
    } catch {
      out.textContent = "copy refused: select the text and copy by hand";
    }
  };

  return {
    startCamera,
    beginCount,
    cancelCount,
    syncTimer: () => {
      if (state().guided.count === null) {
        stopTimer();
      }
    },
    shoot,
    moved: () => {
      if (state().guided.count !== null) {
        movedDuringCount = true;
      }
    },
    summaryOf,
    matchesOf,
    pairZip,
    downloadAll,
    saveFile,
    copyText,
  };
}
