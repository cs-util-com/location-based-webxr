/**
 * The photo test's browser side, shared by both views of the feature
 * matching page: the camera start with its generation guard, the countdown
 * with its beep, vibration and flash, the shot's photo itself (its PNG
 * and preview beside the action, and the one request that the browser
 * keeps the stored photos), the run's zip read from storage (Download
 * all) and the summary. Every outcome is an action on the
 * shared store; what stays here is a browser resource or a guard (the
 * timer, the audio context, the newest camera start, the device line,
 * whether the phone moved during a count).
 *
 * @see plan-io.ts.md
 */
import {
  downloadBlob,
  packFilesAsZip,
  ZIP_FILE_TYPE,
} from "gps-plus-slam-app-framework/storage";
import { captureFrame, framePng } from "./bench-dom";
import { CAPTURE_MAX, type BenchEngine } from "./bench-engine";
import { greyStats, previewFrame } from "./bench-image";
import { errorText, formatBytes } from "./bench-net";
import type { CameraControl } from "./camera-control";
import {
  currentShot,
  featureMatchActions as A,
  logText,
  type FeatureMatchState,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { deviceSummary } from "./guided-model";
import { OTHER_TAB_TEXT } from "./guided-texts";
import { planPhotos, planRetakes } from "./run-plan";
import { runZipFiles } from "./run-zip";
import {
  derivedPairs,
  lightOf,
  readyPairs,
  runZipName,
  summaryText,
} from "./scenes";

/** How long the white flash after a photo stays, in ms. */
const FLASH_MS = 360;

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
}

export interface PlanIo {
  /** Starts the camera; only the newest start reports back. */
  readonly startCamera: () => Promise<void>;
  /** Starts the countdown for the current shot, or shoots at once with none. */
  beginCount(): void;
  /** Ends a running countdown without a photo; `why` goes to the log. */
  readonly cancelCount: (why: string) => void;
  /** Stops the count timer when the state says no count runs. */
  syncTimer(): void;
  /**
   * Takes the current shot's photo now; true when the store took it. The
   * cockpit's hands-off shot calls it directly, without a count.
   */
  shoot(): boolean;
  /** The phone moved: named in the photo's log line if a count runs. */
  moved(): void;
  summaryOf(s: FeatureMatchState): string;
  /** Download all: the run zip read from storage (`run-zip.ts`). */
  downloadAll(): Promise<void>;
  /** Copies `text`; `out` says "copying...", then "copied" or the refusal. */
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
  /** The browser was asked once to keep the stored photos. */
  let persistAsked = false;

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

  const shoot = (): boolean => {
    const shot = currentShot(state().plan);
    if (!shot) {
      return false;
    }
    if (video.videoWidth === 0) {
      log("capture: the camera has no picture yet");
      d.note.show("No photo: the camera had no picture yet. Tap again.");
      return false;
    }
    const f = captureFrame(video, CAPTURE_MAX);
    const source = { width: video.videoWidth, height: video.videoHeight };
    const grey = greyStats(f);
    const id = newId("photo");
    const png = framePng(f, `photo ${shot.id}`);
    // A failed encode loses the photo: the shot asks to be taken again and
    // the reconcile drops the rejected PNG, so Download all goes on.
    png.catch((e: unknown) => {
      if (state().plan.shots[shot.id]?.photo.id === id) {
        fail("capture", e);
        store.dispatch(A.planShotLost(shot.id));
      }
    });
    sides.previews.set(id, previewFrame(f));
    const ok = put(
      sides.photos,
      [[id, png]],
      A.planShotTaken({
        shot: shot.id,
        photo: {
          id,
          width: f.width,
          height: f.height,
          source,
          greyMean: grey.mean,
          greySd: grey.sd,
        },
      }),
    );
    const moved = movedDuringCount;
    movedDuringCount = false;
    if (!ok) {
      log(`capture: photo of ${shot.id} refused`);
      d.note.show(
        state().otherTab
          ? OTHER_TAB_TEXT
          : `No photo of ${shot.key}: the page was busy. Tap again.`,
      );
      return false;
    }
    d.note.clear();
    askPersist();
    beep(1320, 60);
    flash();
    const take = state().plan.shots[shot.id]?.take ?? 0;
    log(
      `photo ${shot.id} take ${String(take)}: ${String(f.width)}x${String(f.height)} grey mean ${grey.mean.toFixed(1)}${moved ? " (phone moved during countdown)" : ""}`,
    );
    const light = lightOf(shot.id, planPhotos(state().plan));
    if (light) {
      log(`light check ${shot.id}: ${light}`);
    }
    return true;
  };

  /**
   * Asks once, at the first photo, that the browser keeps the stored
   * photos under storage pressure; the answer goes to the log only.
   */
  const askPersist = (): void => {
    if (persistAsked) {
      return;
    }
    persistAsked = true;
    const storage = navigator.storage as StorageManager | undefined;
    if (typeof storage?.persist !== "function") {
      log("storage persist: unavailable");
      return;
    }
    storage.persist().then(
      (granted) => {
        log(`storage persist: ${granted ? "granted" : "refused"}`);
      },
      (e: unknown) => {
        log(`storage persist: failed (${errorText(e)})`);
      },
    );
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
      shoot();
      return;
    }
    if (!accepted(A.guidedCountSet({ shot: c.shot, left: c.left - 1 }))) {
      cancelCount("refused");
      return;
    }
    beep(660, 90);
  };

  const beginCount = (): void => {
    const shot = currentShot(state().plan);
    const secs = state().plan.settings.countdown;
    buzz(30);
    if (!shot) {
      return;
    }
    if (!secs) {
      shoot();
      return;
    }
    if (!accepted(A.guidedCountSet({ shot: shot.id, left: secs }))) {
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
      extra: s.plan.extra,
      photos: planPhotos(s.plan),
      retakes: planRetakes(s.plan),
      results: s.results,
      methods: s.options.methods,
      device: deviceLine,
    });

  /** The run zip: the shots, the ready pairs' JSON, the summary and the log. */
  const packRun = async (s: FeatureMatchState): Promise<Blob> => {
    const ready = readyPairs(
      derivedPairs(s.plan.spots, s.plan.extra),
      planPhotos(s.plan),
    );
    log(`download: ${String(ready.length)} pairs as ${runZipName(s.session)}`);
    const now = state();
    const files = await runZipFiles({
      plan: s.plan,
      session: s.session,
      results: s.results,
      device: await engine.deviceInfo(),
      captureMaxLongEdge: CAPTURE_MAX,
      summary: summaryOf(now),
      log: `${logText(now)}\n`,
      photo: fm.readPhoto,
      matches: fm.readMatches,
    });
    // No clock time in the archive: the same run packs to the same bytes.
    return packFilesAsZip(files, { timeless: true });
  };

  const downloadAll = async (): Promise<void> => {
    if (!accepted(A.runZipStarted())) {
      return;
    }
    const name = runZipName(state().session);
    try {
      // Right after a load the stored log and results may not be back yet.
      await fm.restore();
      const zip = await packRun(state());
      const saved = await downloadBlob(zip, name, ZIP_FILE_TYPE);
      if (saved) {
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

  const copyText = async (text: string, out: HTMLElement): Promise<void> => {
    out.textContent = "copying...";
    try {
      await navigator.clipboard.writeText(text);
      out.textContent = "copied";
    } catch {
      out.textContent = "copy refused by the browser";
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
    downloadAll,
    copyText,
  };
}
