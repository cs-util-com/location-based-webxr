/**
 * The flat target capture mode of the feature matching page: per surface a
 * head-on reference with four corner taps and a rectified check, then
 * query photos per pose (3 distances x 2 tilts) at falling light, each
 * tagged with a light bin from its luma ratio against the pose's
 * full-light shot, and one zip per surface. It is a view on the page's
 * store: its state is the slice's `flat` part, its photos the store's side
 * tables. This file only touches the DOM and browser APIs; the rules are
 * in feature-match-slice.ts, flat-target.ts and flat-progress.ts.
 *
 * @see flat-capture.ts.md
 */
import { captureFrame, frameCanvas, framePng } from "./bench-dom";
import { allFilesZip, type NamedBlob } from "./bench-export";
import { greyStats, type Frame } from "./bench-image";
import { errorText, formatBytes } from "./bench-net";
import {
  currentSurface,
  featureMatchActions as A,
  flatPhase,
  logText,
  type FlatPhase,
  type FlatState,
} from "./feature-match-slice";
import {
  flatHasUnsaved,
  shotKey,
  type FeatureMatchStore,
} from "./feature-match-store";
import {
  classSummary,
  poseSummary,
  surfaceSummary,
  usableFullLight,
  type SurfaceProgress,
} from "./flat-progress";
import {
  cornersProblem,
  cropFrame,
  flatFileNames,
  flatInfo,
  guideRect,
  LIGHT_BINS,
  lightBin,
  nextCorner,
  POSES,
  rectifiedSize,
  rectify,
  SURFACE_CLASSES,
  toImagePoint,
  type ShotInfo,
  type SurfaceClass,
} from "./flat-target";

/** Long edge of every flat target photo, in pixels. */
const FLAT_CAPTURE_MAX = 1024;
/** Seconds between the tap and the photo, so the phone is still again. */
const COUNTDOWN_S = 3;
/** Long edge of the frames the live light reading samples. */
const LIVE_SAMPLE_MAX = 256;
const LIVE_EVERY_MS = 500;

/** What the flat mode needs from the page. */
export interface FlatDeps {
  /** The page's store; the flat state is its `flat` part. */
  readonly store: FeatureMatchStore;
  log(line: string): void;
  fail(where: string, e: unknown): void;
  /** Called after Exit, with the mode already closed. */
  onExit(): void;
}

export interface FlatCapture {
  open(): void;
  close(): void;
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) {
    throw new Error(`flat-capture: missing ${sel}`);
  }
  return el;
};

function findUi(root: ParentNode) {
  return {
    section: $(root, "#flat"),
    where: $(root, "#flat-where"),
    overviewOpen: $<HTMLButtonElement>(root, "#flat-overview-open"),
    exit: $<HTMLButtonElement>(root, "#flat-exit"),
    stage: $(root, "#flat-stage"),
    video: $<HTMLVideoElement>(root, "#flat-video"),
    still: $<HTMLCanvasElement>(root, "#flat-still"),
    guide: $(root, "#flat-guide"),
    countdown: $(root, "#flat-countdown"),
    overview: $(root, "#flat-overview"),
    classes: $(root, "#flat-classes"),
    surfaces: $(root, "#flat-surfaces"),
    newClass: $<HTMLSelectElement>(root, "#flat-new-class"),
    newOriginal: $<HTMLInputElement>(root, "#flat-new-original"),
    newFile: $<HTMLInputElement>(root, "#flat-new-file"),
    newSurface: $<HTMLButtonElement>(root, "#flat-new"),
    controls: $(root, "#flat-controls"),
    hint: $(root, "#flat-hint"),
    poses: $(root, "#flat-poses"),
    bins: $(root, "#flat-bins"),
    live: $(root, "#flat-live"),
    shoot: $<HTMLButtonElement>(root, "#flat-shoot"),
    redo: $<HTMLButtonElement>(root, "#flat-redo"),
    accept: $<HTMLButtonElement>(root, "#flat-accept"),
    retake: $<HTMLButtonElement>(root, "#flat-retake"),
    download: $<HTMLButtonElement>(root, "#flat-download"),
    saveLink: $<HTMLAnchorElement>(root, "#flat-save-link"),
    state: $(root, "#flat-state"),
  };
}

const poseOf = (f: FlatState) => POSES.find((x) => x.id === f.pose)!;

/** Starts the mode on `root`; it stays hidden until `open()`. */
export function startFlatCapture(
  root: ParentNode,
  deps: FlatDeps,
): FlatCapture {
  const ui = findUi(root);
  const { store, sides, newId, photosOf, accepted, put } = deps.store;
  const flat = (): FlatState => store.getState().flat;
  const current = (): SurfaceProgress | null => currentSurface(flat());
  const status = (text: string): void => {
    store.dispatch(A.flatStatus(text));
  };
  // The camera, the timers and the wake lock stay here: they are browser
  // resources, not state.
  let stream: MediaStream | null = null;
  let generation = 0;
  let liveTimer: number | null = null;
  let countdownTimer: number | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  /** Closed by pagehide, so a back-forward cache restore reopens it. */
  let closedByPagehide = false;

  ui.newClass.replaceChildren(
    ...SURFACE_CLASSES.map((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label;
      return o;
    }),
  );

  /** Photos that exist only in this page: leaving it would lose them. */
  const hasUnsaved = (): boolean => flatHasUnsaved(store.getState(), sides);

  // --- screen wake lock -------------------------------------------------

  /** Keeps the screen on while the mode is open and the page visible. */
  const holdWakeLock = async (): Promise<void> => {
    if (
      !flat().open ||
      wakeLock !== null ||
      document.visibilityState !== "visible" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!flat().open || wakeLock !== null) {
        lock.release().catch(() => undefined);
        return;
      }
      wakeLock = lock;
      // The browser releases it when the page is hidden.
      lock.addEventListener("release", () => {
        if (wakeLock === lock) {
          wakeLock = null;
        }
      });
    } catch (e) {
      deps.log(`flat: screen wake lock refused: ${errorText(e)}`);
    }
  };

  const releaseWakeLock = (): void => {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) {
      lock.release().catch(() => undefined);
    }
  };

  // --- camera ---------------------------------------------------------

  const stopCamera = (): void => {
    generation++;
    if (!stream) {
      return;
    }
    for (const t of stream.getTracks()) {
      t.stop();
    }
    stream = null;
    ui.video.srcObject = null;
    deps.log("flat: camera off");
    store.dispatch(A.flatCameraChanged(false));
  };

  const startCamera = async (): Promise<void> => {
    if (stream) {
      return;
    }
    const g = ++generation;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      if (g !== generation) {
        for (const t of s.getTracks()) {
          t.stop();
        }
        return;
      }
      stream = s;
      ui.video.srcObject = s;
      await ui.video.play();
      deps.log("flat: camera on");
    } catch (e) {
      if (g === generation) {
        deps.fail("flat camera", e);
        status(`camera unavailable: ${errorText(e)}`);
      }
    }
    store.dispatch(A.flatCameraChanged(stream !== null));
    render();
  };

  // --- drawing ----------------------------------------------------------

  /** The still with its taps, or the rectified preview, on the canvas. */
  const drawStill = (f: FlatState): void => {
    const preview = f.preview ? sides.flatFrames.get(f.preview.id) : undefined;
    const still = f.still ? sides.flatFrames.get(f.still.id) : undefined;
    const frame = preview ?? still;
    if (!frame) {
      return;
    }
    frameCanvas(frame, ui.still);
    if (preview) {
      return;
    }
    const ctx = ui.still.getContext("2d");
    if (!ctx) {
      return;
    }
    const taps = f.taps;
    const r = Math.max(4, frame.width / 120);
    ctx.lineWidth = Math.max(2, frame.width / 400);
    ctx.strokeStyle = "#ffd400";
    ctx.fillStyle = "#ffd400";
    ctx.font = `${String(Math.round(r * 3))}px system-ui, sans-serif`;
    ctx.beginPath();
    taps.forEach((p, i) => {
      if (i === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    if (taps.length === 4) {
      ctx.closePath();
    }
    ctx.stroke();
    taps.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillText(String(i + 1), p.x + r * 1.5, p.y - r * 1.5);
    });
  };

  /** The guide frame over the video for the selected pose. */
  const placeGuide = (f: FlatState, s: SurfaceProgress): void => {
    const vw = ui.video.videoWidth;
    const vh = ui.video.videoHeight;
    if (!s.reference || vw === 0 || vh === 0) {
      ui.guide.hidden = true;
      return;
    }
    const aspect = s.reference.rectified.width / s.reference.rectified.height;
    const g = guideRect(vw, vh, poseOf(f).distance, aspect);
    const box = ui.video.getBoundingClientRect();
    const stage = ui.stage.getBoundingClientRect();
    const scale = Math.min(box.width / vw, box.height / vh);
    const left = box.left - stage.left + (box.width - vw * scale) / 2;
    const top = box.top - stage.top + (box.height - vh * scale) / 2;
    ui.guide.style.left = `${String(left + g.x * scale)}px`;
    ui.guide.style.top = `${String(top + g.y * scale)}px`;
    ui.guide.style.width = `${String(g.width * scale)}px`;
    ui.guide.style.height = `${String(g.height * scale)}px`;
    ui.guide.hidden = false;
  };

  /** The guide region's grey mean in `frame`, the light reading of a pose. */
  const regionMean = (
    frame: Frame,
    f: FlatState,
    s: SurfaceProgress,
  ): number => {
    const ref = s.reference!;
    const aspect = ref.rectified.width / ref.rectified.height;
    return greyStats(
      cropFrame(
        frame,
        guideRect(frame.width, frame.height, poseOf(f).distance, aspect),
      ),
    ).mean;
  };

  // --- rendering --------------------------------------------------------

  const renderOverview = (f: FlatState): void => {
    const progress = f.progress;
    ui.classes.replaceChildren(
      ...classSummary(progress).map((c) => {
        const li = document.createElement("li");
        li.textContent = `${c.label}: ${String(c.complete)} of ${String(c.target)} complete, ${String(c.started)} started`;
        li.dataset.cls = c.cls;
        return li;
      }),
    );
    ui.surfaces.replaceChildren(
      ...progress.surfaces.map((s) => {
        const sum = surfaceSummary(s);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary flat-surface";
        b.dataset.surface = String(s.id);
        const label = SURFACE_CLASSES.find((c) => c.id === s.cls)!.label;
        b.textContent =
          `Surface ${String(s.id)}, ${label}${s.original ? ", original" : ""}: ` +
          `reference ${s.reference ? "done" : "missing"}, poses ${String(sum.posesComplete)}/${String(sum.poses)}, ` +
          `${String(sum.shots)} photos` +
          (sum.unsaved > 0 ? `, ${String(sum.unsaved)} not downloaded` : "") +
          (sum.complete ? " - complete" : "");
        b.addEventListener("click", () => {
          store.dispatch(A.flatSurfaceSelected(s.id));
        });
        return b;
      }),
    );
    // Suggest the class furthest from its plan.
    const fewest = classSummary(progress).sort(
      (a, b) => a.started - b.started,
    )[0];
    if (fewest && !f.classPicked && document.activeElement !== ui.newClass) {
      ui.newClass.value = fewest.cls;
    }
    ui.newSurface.textContent = `Start surface ${String(progress.surfaces.length + 1)}`;
  };

  const renderPoses = (f: FlatState, s: SurfaceProgress): void => {
    ui.poses.replaceChildren(
      ...POSES.map((p) => {
        const sum = poseSummary(s, p.id);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "flat-pose";
        b.dataset.pose = p.id;
        b.setAttribute("aria-pressed", String(p.id === f.pose));
        b.textContent = `${String(p.distance)}% ${String(p.tilt)}deg ${sum.complete ? "done" : String(sum.shots)}`;
        b.disabled = f.countdown !== null || f.saving;
        b.addEventListener("click", () => {
          store.dispatch(A.flatPoseChosen(p.id));
        });
        return b;
      }),
    );
    const sum = poseSummary(s, f.pose);
    ui.bins.replaceChildren(
      ...LIGHT_BINS.map((b) => {
        const chip = document.createElement("span");
        chip.className = "flat-bin";
        chip.dataset.bin = b.id;
        chip.dataset.filled = String(sum.bins[b.id] > 0);
        chip.textContent = `${b.id} ${b.label}: ${String(sum.bins[b.id])}`;
        return chip;
      }),
    );
  };

  const hintFor = (
    ph: FlatPhase,
    f: FlatState,
    s: SurfaceProgress | null,
  ): string => {
    switch (ph) {
      case "overview":
        return "Pick a surface to continue, or start a new one below.";
      case "ref-live":
        return "Reference: face the surface straight on in good light, the surface about half the frame wide. Rest the phone, tap Take reference and let go.";
      case "corners": {
        const problem =
          f.taps.length === 4 && f.still
            ? cornersProblem(f.taps, f.still.width, f.still.height)
            : null;
        if (problem) {
          return `${problem}. Tap Redo corners.`;
        }
        const next = nextCorner(f.taps);
        return `Tap corner ${String(f.taps.length + 1)} of 4 on the photo: ${next ?? ""}.`;
      }
      case "check":
        return "Check the straightened surface: whole and upright? Use it, or redo the corners.";
      case "poses": {
        const p = poseOf(f);
        const sum = poseSummary(s!, f.pose);
        const tilt =
          p.tilt === 0
            ? "straight on"
            : "turned about 40 deg to the side, surface kept in the frame";
        if (!sum.full) {
          return `Pose ${p.label}: rest the phone ${tilt} so the surface fills the yellow frame, all lamps on. Tap Full-light shot.`;
        }
        if (sum.complete) {
          return `Pose ${p.label} done. Pick the next pose, or add more light levels.`;
        }
        return "Do not move the phone. Change the light (one lamp, dusk with lamps off, dim indoor light), aim at an empty bin, then tap Darker shot.";
      }
    }
  };

  const show = (el: HTMLElement, on: boolean): void => {
    el.hidden = !on;
  };

  /** The prepared zip's Save link, or none. */
  const renderSaveLink = (f: FlatState): void => {
    const url = f.prepared ? sides.urls.get(f.prepared.urlId) : undefined;
    if (!f.prepared || url === undefined) {
      ui.saveLink.hidden = true;
      ui.saveLink.removeAttribute("href");
      return;
    }
    ui.saveLink.href = url;
    ui.saveLink.download = f.prepared.name;
    ui.saveLink.textContent = `Save ${f.prepared.name}`;
    ui.saveLink.hidden = false;
  };

  function render(): void {
    const f = flat();
    ui.countdown.hidden = f.countdown === null;
    if (f.countdown !== null) {
      ui.countdown.textContent = String(f.countdown);
    }
    ui.state.textContent = f.status;
    renderSaveLink(f);
    if (!f.open) {
      return;
    }
    const ph = flatPhase(f);
    const s = currentSurface(f);
    const counting = f.countdown !== null;
    show(ui.overview, ph === "overview");
    show(ui.video, ph === "ref-live" || ph === "poses");
    show(ui.still, ph === "corners" || ph === "check");
    show(ui.poses, ph === "poses");
    show(ui.bins, ph === "poses");
    show(ui.live, ph === "poses");
    show(ui.shoot, ph !== "overview");
    show(ui.redo, ph === "corners" || ph === "check");
    show(ui.accept, ph === "check");
    show(ui.retake, ph === "poses");
    show(ui.download, ph === "poses");
    ui.overviewOpen.disabled = counting || f.saving || ph === "overview";
    ui.hint.textContent = hintFor(ph, f, s);
    if (ph === "overview" || !s) {
      ui.where.textContent = "Overview";
      ui.guide.hidden = true;
      renderOverview(f);
      return;
    }
    const cls = SURFACE_CLASSES.find((c) => c.id === s.cls)!.label;
    const poseNow = poseOf(f);
    ui.where.textContent =
      ph === "poses"
        ? `Surface ${String(s.id)}, ${cls}, pose ${poseNow.label}`
        : `Surface ${String(s.id)}, ${cls}, reference`;
    const sumPose = ph === "poses" ? poseSummary(s, f.pose) : null;
    // The pose is in the label: a shot is taken without looking elsewhere.
    const poseShort = `${String(poseNow.distance)} % ${String(poseNow.tilt)} deg`;
    ui.shoot.textContent = counting
      ? `Cancel (${String(f.countdown)})`
      : ph === "poses"
        ? sumPose!.full
          ? `Darker shot, ${poseShort} (${String(COUNTDOWN_S)} s)`
          : `Full-light shot, ${poseShort} (${String(COUNTDOWN_S)} s)`
        : ph === "ref-live"
          ? `Take reference (${String(COUNTDOWN_S)} s)`
          : `Retake reference (${String(COUNTDOWN_S)} s)`;
    ui.shoot.disabled =
      f.saving ||
      (!counting && (ph === "ref-live" || ph === "poses") && !f.camera);
    ui.redo.disabled = counting || f.taps.length === 0;
    ui.accept.disabled = counting;
    if (ph === "poses") {
      renderPoses(f, s);
      const last = [...s.shots].reverse().find((x) => x.pose === f.pose);
      ui.retake.disabled = counting || f.saving || !last || last.saved;
      const sum = surfaceSummary(s);
      ui.download.disabled = counting || f.saving;
      ui.download.textContent = f.saving
        ? "Preparing zip..."
        : sum.unsaved > 0
          ? `Download zip (${String(sum.unsaved)} new)`
          : "Download zip";
      placeGuide(f, s);
    } else {
      ui.guide.hidden = true;
      drawStill(f);
    }
  }

  // --- live light reading -------------------------------------------------

  const readLive = (): void => {
    const f = flat();
    const s = currentSurface(f);
    if (flatPhase(f) !== "poses" || !s || ui.video.videoWidth === 0) {
      ui.live.textContent = "";
      return;
    }
    try {
      const mean = regionMean(captureFrame(ui.video, LIVE_SAMPLE_MAX), f, s);
      const full = poseSummary(s, f.pose).fullMean;
      for (const chip of ui.bins.children) {
        (chip as HTMLElement).dataset.live = "false";
      }
      if (full === null) {
        ui.live.textContent = `light now: grey ${mean.toFixed(0)}${usableFullLight(mean) ? "" : " - too dark for the full-light shot"}`;
        return;
      }
      const ratio = mean / full;
      const bin = lightBin(ratio);
      const chip = ui.bins.querySelector<HTMLElement>(`[data-bin="${bin}"]`);
      if (chip) {
        chip.dataset.live = "true";
      }
      ui.live.textContent = `light now: ${ratio.toFixed(2)} of full, bin ${bin}`;
    } catch (e) {
      ui.live.textContent = `light now: ${errorText(e)}`;
    }
  };

  // --- capture ------------------------------------------------------------

  const takePhoto = (): void => {
    const f = flat();
    const s = currentSurface(f);
    const ph = flatPhase(f);
    if (!s || ui.video.videoWidth === 0) {
      status("camera not ready yet: tap again");
      return;
    }
    if (ph === "corners" || ph === "check") {
      // A retake of the reference shows the live camera first.
      store.dispatch(A.flatReferenceDropped());
      return;
    }
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live" || track.muted) {
      // An ended or muted track still shows its last frame: a photo of it
      // would be a stale picture tagged as new.
      status("camera not live: wait a moment and tap again");
      deps.log(
        `flat: photo refused, track ${track ? `${track.readyState}${track.muted ? ", muted" : ""}` : "missing"}`,
      );
      return;
    }
    const frame = captureFrame(ui.video, FLAT_CAPTURE_MAX);
    if (ph === "ref-live") {
      const id = newId("flat");
      photosOf(s.id).camera = {
        width: ui.video.videoWidth,
        height: ui.video.videoHeight,
      };
      // put: the frame and the action naming it in one step, so no other
      // action can drop the frame as unnamed in between.
      put(
        sides.flatFrames,
        [[id, frame]],
        A.flatReferenceTaken({ id, width: frame.width, height: frame.height }),
      );
      deps.log(
        `flat: surface ${String(s.id)} reference ${String(frame.width)}x${String(frame.height)}`,
      );
      return;
    }
    const mean = regionMean(frame, f, s);
    const before = s.shots.length;
    store.dispatch(A.flatShotTaken(mean));
    const after = current()!;
    if (after.shots.length === before) {
      status(
        `too dark for the full-light shot (grey ${mean.toFixed(0)}): switch all lamps on and take it again`,
      );
      deps.log(`flat: full-light shot refused, grey ${mean.toFixed(1)}`);
      return;
    }
    // Not through put: the shot key is known only once the reducer has
    // placed the shot, and nothing is dispatched between the two.
    const shot = after.shots.at(-1)!;
    photosOf(s.id).shots.set(shotKey(shot.pose, shot.q), frame);
    const text = `${shot.pose} q${String(shot.q)}: ${shot.fullLight ? "full light" : `${shot.lumaRatio.toFixed(2)} of full`}, bin ${shot.bin}`;
    deps.log(`flat: surface ${String(s.id)} ${text}, grey ${mean.toFixed(1)}`);
    status(`taken: ${text}`);
    readLive();
  };

  const cancelCountdown = (): void => {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (flat().countdown !== null) {
      store.dispatch(A.flatCountdown(null));
    }
  };

  ui.shoot.addEventListener("click", () => {
    if (flat().countdown !== null) {
      cancelCountdown();
      status("cancelled");
      return;
    }
    const ph = flatPhase(flat());
    if (ph === "corners" || ph === "check") {
      takePhoto();
      return;
    }
    countdownTimer = window.setInterval(() => {
      const left = flat().countdown;
      if (left === null) {
        return;
      }
      if (left - 1 <= 0) {
        cancelCountdown();
        takePhoto();
        return;
      }
      store.dispatch(A.flatCountdown(left - 1));
    }, 1000);
    store.dispatch(A.flatCountdown(COUNTDOWN_S));
  });

  ui.still.addEventListener("click", (ev) => {
    const f = flat();
    const still = f.still ? sides.flatFrames.get(f.still.id) : undefined;
    if (flatPhase(f) !== "corners" || !still || f.taps.length >= 4) {
      return;
    }
    const p = toImagePoint(
      ev.clientX,
      ev.clientY,
      ui.still.getBoundingClientRect(),
      still.width,
      still.height,
    );
    if (!p) {
      return;
    }
    store.dispatch(A.flatTapped(p));
    const taps = flat().taps;
    if (
      taps.length === 4 &&
      cornersProblem(taps, still.width, still.height) === null
    ) {
      try {
        const preview = rectify(
          still,
          taps,
          rectifiedSize(taps, FLAT_CAPTURE_MAX),
        );
        const id = newId("flat");
        put(
          sides.flatFrames,
          [[id, preview]],
          A.flatPreviewMade({
            id,
            width: preview.width,
            height: preview.height,
          }),
        );
      } catch (e) {
        deps.fail("flat corners", e);
      }
    }
  });

  ui.redo.addEventListener("click", () => {
    store.dispatch(A.flatCornersRedone());
  });

  ui.accept.addEventListener("click", () => {
    const f = flat();
    const s = currentSurface(f);
    const still = f.still ? sides.flatFrames.get(f.still.id) : undefined;
    const preview = f.preview ? sides.flatFrames.get(f.preview.id) : undefined;
    if (!s || !still || !preview) {
      return;
    }
    // The frames move to the surface's photos before the state lets go
    // of them.
    const p = photosOf(s.id);
    p.reference = still;
    p.rectified = preview;
    deps.log(
      `flat: surface ${String(s.id)} corners ${f.taps.map((t) => `${t.x.toFixed(0)},${t.y.toFixed(0)}`).join(" ")}, rectified ${String(preview.width)}x${String(preview.height)}`,
    );
    store.dispatch(A.flatReferenceAccepted());
  });

  ui.retake.addEventListener("click", () => {
    const f = flat();
    const s = currentSurface(f);
    if (!s) {
      return;
    }
    const last = [...s.shots].reverse().find((x) => x.pose === f.pose);
    store.dispatch(A.flatShotRemoved());
    if (last && current()!.shots.length < s.shots.length) {
      status(`removed ${last.pose} q${String(last.q)}: take it again`);
    }
  });

  /** One surface's zip: every photo in memory, the original, the JSON and the log. */
  const surfaceZip = async (
    s: SurfaceProgress,
  ): Promise<{ blob: Blob; name: string; photos: number }> => {
    const session = store.getState().session;
    const names = flatFileNames(s.id, s.cls, session);
    const p = photosOf(s.id);
    const files: NamedBlob[] = [];
    if (p.reference) {
      files.push({
        name: names.reference,
        blob: await framePng(p.reference, "reference"),
      });
    }
    if (p.rectified) {
      files.push({
        name: names.rectified,
        blob: await framePng(p.rectified, "rectified"),
      });
    }
    const shots: ShotInfo[] = [];
    for (const x of s.shots) {
      const frame = p.shots.get(shotKey(x.pose, x.q)) ?? null;
      const file = frame ? names.query(x.pose, x.q, x.bin) : null;
      if (frame && file) {
        files.push({ name: file, blob: await framePng(frame, file) });
      }
      shots.push({
        file,
        pose: x.pose,
        shot: x.q,
        fullLight: x.fullLight,
        greyMean: x.greyMean,
        lumaRatio: x.lumaRatio,
        bin: x.bin,
        width: frame?.width ?? null,
        height: frame?.height ?? null,
      });
    }
    const originalName = p.original ? names.original(p.original.name) : null;
    if (p.original && originalName) {
      files.push({ name: originalName, blob: p.original });
    }
    const ref = s.reference!;
    files.push({
      name: names.info,
      blob: new Blob(
        [
          flatInfo({
            surface: s.id,
            cls: s.cls,
            session,
            original: { exists: s.original, file: originalName },
            captureMaxLongEdge: FLAT_CAPTURE_MAX,
            camera: p.camera,
            reference: {
              file: p.reference ? names.reference : null,
              width: ref.width,
              height: ref.height,
              corners: ref.corners,
              rectifiedFile: p.rectified ? names.rectified : null,
              rectified: ref.rectified,
            },
            shots,
          }),
        ],
        { type: "application/json" },
      ),
    });
    const blob = await allFilesZip(files, {
      log: logText(store.getState()),
      report: "",
    });
    const photoCount = files.filter((f) => f.name.endsWith(".png")).length;
    return { blob, name: names.zip, photos: photoCount };
  };

  ui.download.addEventListener("click", () => {
    const s = currentSurface(flat());
    if (!s || !accepted(A.flatSavingStarted())) {
      return;
    }
    surfaceZip(s)
      .then(({ blob, name, photos: n }) => {
        // A link the user taps, as the photo pairs do: a download started
        // from script after an await can be blocked, and only the tap is
        // proof enough to mark the photos downloaded.
        const urlId = newId("url");
        const text = `${String(n)} photos, ${formatBytes(blob.size)}`;
        put(
          sides.urls,
          [[urlId, URL.createObjectURL(blob)]],
          A.flatSavingEnded({
            prepared: {
              surface: s.id,
              shots: s.shots.length,
              urlId,
              name,
              text,
            },
            status: `ready: tap Save (${text})`,
          }),
        );
        deps.log(`flat: ${name} ready, ${String(n)} photos`);
      })
      .catch((e: unknown) => {
        deps.fail("flat save", e);
        store.dispatch(
          A.flatSavingEnded({
            prepared: null,
            status: `zip failed: ${errorText(e)}; nothing was marked downloaded`,
          }),
        );
      });
  });

  ui.saveLink.addEventListener("click", () => {
    const f = flat();
    const s = currentSurface(f);
    if (!f.prepared || !s || f.prepared.surface !== s.id) {
      return;
    }
    store.dispatch(A.flatSaved());
    deps.log(`flat: ${f.prepared.name} saved`);
  });

  ui.newClass.addEventListener("change", () => {
    store.dispatch(A.flatClassPicked());
  });

  ui.newOriginal.addEventListener("change", () => {
    if (!ui.newOriginal.checked) {
      ui.newFile.value = "";
    }
  });
  ui.newFile.addEventListener("change", () => {
    if ((ui.newFile.files?.length ?? 0) > 0) {
      ui.newOriginal.checked = true;
    }
  });

  ui.newSurface.addEventListener("click", () => {
    const file = ui.newFile.files?.[0] ?? null;
    store.dispatch(
      A.flatSurfaceAdded({
        cls: ui.newClass.value as SurfaceClass,
        original: ui.newOriginal.checked || file !== null,
      }),
    );
    const s = current();
    if (!s) {
      return;
    }
    photosOf(s.id).original = file;
    ui.newFile.value = "";
    ui.newOriginal.checked = false;
    deps.log(
      `flat: surface ${String(s.id)} started, ${s.cls}${file ? ", original attached" : ""}`,
    );
    void startCamera();
  });

  ui.overviewOpen.addEventListener("click", () => {
    cancelCountdown();
    store.dispatch(A.flatOverview());
    stopCamera();
  });

  ui.exit.addEventListener("click", () => {
    close();
    deps.onExit();
  });

  ui.video.addEventListener("loadedmetadata", () => render());
  window.addEventListener("resize", () => render());

  function close(): void {
    if (!flat().open) {
      return;
    }
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    store.dispatch(A.flatClosed());
    stopCamera();
    releaseWakeLock();
    if (liveTimer !== null) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    ui.section.hidden = true;
    document.body.classList.remove("flat-open");
  }

  function open(): void {
    if (flat().open) {
      return;
    }
    ui.section.hidden = false;
    document.body.classList.add("flat-open");
    store.dispatch(A.flatOpened());
    liveTimer = window.setInterval(readLive, LIVE_EVERY_MS);
    void holdWakeLock();
    if (current()) {
      void startCamera();
    }
  }

  // The flat part of the state is drawn when it changed; the page's other
  // actions (log lines above all) leave it alone, so a button is never
  // replaced under a finger.
  let drawn: FlatState | null = null;
  store.subscribe(() => {
    const f = flat();
    if (f !== drawn) {
      drawn = f;
      render();
    }
  });

  // Opening a surface from the overview starts the camera too.
  ui.surfaces.addEventListener("click", () => {
    if (current()) {
      void startCamera();
    }
  });
  window.addEventListener("pagehide", () => {
    if (flat().open) {
      closedByPagehide = true;
      close();
    }
  });
  // A back-forward cache restore brings back the page as it was hidden,
  // so the mode it closed comes back with it.
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted && closedByPagehide) {
      closedByPagehide = false;
      open();
    }
  });
  window.addEventListener("beforeunload", (ev) => {
    if (hasUnsaved()) {
      ev.preventDefault();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!flat().open || document.visibilityState !== "visible") {
      return;
    }
    void holdWakeLock();
    // A camera ended in the background (another app took it) restarts.
    const track = stream?.getVideoTracks()[0];
    if (stream && (!track || track.readyState === "ended")) {
      stream = null;
      ui.video.srcObject = null;
      store.dispatch(A.flatCameraChanged(false));
      deps.log("flat: camera ended while hidden, restarting");
      void startCamera();
    }
  });

  return { open, close };
}
