/**
 * The flat target capture mode of the feature matching page: per surface a
 * head-on reference with four corner taps and a rectified check, then
 * query photos per pose (3 distances x 2 tilts) at falling light, each
 * tagged with a light bin from its luma ratio against the pose's
 * full-light shot, and one zip per surface. This file only touches the
 * DOM and browser APIs; the rules are in flat-target.ts and
 * flat-progress.ts.
 *
 * @see flat-capture.ts.md
 */
import { captureFrame, frameCanvas, framePng } from "./bench-dom";
import { allFilesZip, type NamedBlob } from "./bench-export";
import { greyStats, type Frame } from "./bench-image";
import { errorText, formatBytes } from "./bench-net";
import {
  afterReload,
  classSummary,
  flatProgressText,
  flatReducer,
  parseFlatProgress,
  poseSummary,
  surfaceSummary,
  usableFullLight,
  type FlatAction,
  type FlatProgress,
  type SurfaceProgress,
} from "./flat-progress";
import {
  CORNERS,
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
  type Point,
  type PoseId,
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
/** The flat target progress, kept across reloads. */
const FLAT_PROGRESS = "feature-match-check.flat-progress";

/** What the flat mode needs from the page. */
export interface FlatDeps {
  /** The page load's session token, written into every surface's JSON. */
  readonly session: string;
  log(line: string): void;
  fail(where: string, e: unknown): void;
  /** The page log as it reads now, packed into each zip. */
  pageLog(): string;
  /** Called after Exit, with the mode already closed. */
  onExit(): void;
}

export interface FlatCapture {
  open(): void;
  close(): void;
}

/** One surface's photos, in memory only until downloaded. */
interface SurfacePhotos {
  reference: Frame | null;
  rectified: Frame | null;
  /** Keyed `<pose>#<q>`. */
  readonly shots: Map<string, Frame>;
  original: File | null;
  /** The camera stream's size when the reference was taken. */
  camera: { width: number; height: number } | null;
}

const shotKey = (pose: PoseId, q: number): string => `${pose}#${String(q)}`;

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

/** Which step of a surface is on screen. */
type Phase = "overview" | "ref-live" | "corners" | "check" | "poses";

function readStored(): FlatProgress {
  try {
    return afterReload(parseFlatProgress(localStorage.getItem(FLAT_PROGRESS)));
  } catch {
    return parseFlatProgress(null);
  }
}

/** Starts the mode on `root`; it stays hidden until `open()`. */
export function startFlatCapture(
  root: ParentNode,
  deps: FlatDeps,
): FlatCapture {
  const ui = findUi(root);
  let progress = readStored();
  const photos = new Map<number, SurfacePhotos>();
  /** The reference photo being marked, before it is accepted. */
  let still: Frame | null = null;
  let taps: Point[] = [];
  /** The rectified preview of four good taps. */
  let preview: Frame | null = null;
  let pose: PoseId = POSES[0]!.id;
  let countdown: { timer: number; left: number } | null = null;
  let saving = false;
  let isOpen = false;
  let stream: MediaStream | null = null;
  let generation = 0;
  let liveTimer: number | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  /** The user picked the next surface's class: no suggestion overwrites it. */
  let classPicked = false;
  /** Closed by pagehide, so a back-forward cache restore reopens it. */
  let closedByPagehide = false;
  /** A prepared zip waiting for its Save tap; stale once the surface changes. */
  let prepared: {
    readonly id: number;
    readonly shots: number;
    readonly url: string;
    readonly name: string;
    readonly text: string;
  } | null = null;

  ui.newClass.replaceChildren(
    ...SURFACE_CLASSES.map((c) => {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.label;
      return o;
    }),
  );

  const photosOf = (id: number): SurfacePhotos => {
    let p = photos.get(id);
    if (!p) {
      p = {
        reference: null,
        rectified: null,
        shots: new Map(),
        original: null,
        camera: null,
      };
      photos.set(id, p);
    }
    return p;
  };

  const current = (): SurfaceProgress | null =>
    progress.surfaces.find((s) => s.id === progress.current) ?? null;

  const dispatch = (a: FlatAction): void => {
    progress = flatReducer(progress, a);
    try {
      localStorage.setItem(FLAT_PROGRESS, flatProgressText(progress));
    } catch {
      // Storage blocked: the progress lasts as long as the page.
    }
  };

  /**
   * Frees the photos of every other surface with nothing left to download,
   * so a long session does not keep every surface's frames in memory. A
   * later zip of such a surface lists its earlier photos with a null file,
   * as after a reload.
   */
  const freeOtherPhotos = (keep: number): void => {
    for (const s of progress.surfaces) {
      if (s.id !== keep && surfaceSummary(s).unsaved === 0) {
        photos.delete(s.id);
      }
    }
  };

  /** Photos that exist only in this page: leaving it would lose them. */
  const hasUnsaved = (): boolean =>
    still !== null ||
    progress.surfaces.some((s) => surfaceSummary(s).unsaved > 0);

  const dropPrepared = (): void => {
    if (prepared) {
      URL.revokeObjectURL(prepared.url);
      prepared = null;
    }
    ui.saveLink.hidden = true;
    ui.saveLink.removeAttribute("href");
  };

  // --- screen wake lock -------------------------------------------------

  /** Keeps the screen on while the mode is open and the page visible. */
  const holdWakeLock = async (): Promise<void> => {
    if (
      !isOpen ||
      wakeLock !== null ||
      document.visibilityState !== "visible" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!isOpen || wakeLock !== null) {
        void lock.release();
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

  const phase = (): Phase => {
    const s = current();
    if (!s) {
      return "overview";
    }
    if (s.reference !== null) {
      return "poses";
    }
    if (still === null) {
      return "ref-live";
    }
    return preview ? "check" : "corners";
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
        ui.state.textContent = `camera unavailable: ${errorText(e)}`;
      }
    }
    render();
  };

  // --- drawing ----------------------------------------------------------

  /** The still with its taps, or the rectified preview, on the canvas. */
  const drawStill = (): void => {
    const f = preview ?? still;
    if (!f) {
      return;
    }
    frameCanvas(f, ui.still);
    if (preview) {
      return;
    }
    const ctx = ui.still.getContext("2d");
    if (!ctx) {
      return;
    }
    const r = Math.max(4, f.width / 120);
    ctx.lineWidth = Math.max(2, f.width / 400);
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
  const placeGuide = (s: SurfaceProgress): void => {
    const vw = ui.video.videoWidth;
    const vh = ui.video.videoHeight;
    if (!s.reference || vw === 0 || vh === 0) {
      ui.guide.hidden = true;
      return;
    }
    const p = POSES.find((x) => x.id === pose)!;
    const aspect = s.reference.rectified.width / s.reference.rectified.height;
    const g = guideRect(vw, vh, p.distance, aspect);
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

  /** The guide region's grey mean in `f`, the light reading of a pose. */
  const regionMean = (f: Frame, s: SurfaceProgress): number => {
    const p = POSES.find((x) => x.id === pose)!;
    const ref = s.reference!;
    const aspect = ref.rectified.width / ref.rectified.height;
    return greyStats(
      cropFrame(f, guideRect(f.width, f.height, p.distance, aspect)),
    ).mean;
  };

  // --- rendering --------------------------------------------------------

  const renderOverview = (): void => {
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
          dispatch({ type: "select", id: s.id });
          freeOtherPhotos(s.id);
          pose = firstOpenPose(s);
          render();
        });
        return b;
      }),
    );
    // Suggest the class furthest from its plan.
    const fewest = classSummary(progress).sort(
      (a, b) => a.started - b.started,
    )[0];
    if (fewest && !classPicked && document.activeElement !== ui.newClass) {
      ui.newClass.value = fewest.cls;
    }
    ui.newSurface.textContent = `Start surface ${String(progress.surfaces.length + 1)}`;
  };

  const renderPoses = (s: SurfaceProgress): void => {
    ui.poses.replaceChildren(
      ...POSES.map((p) => {
        const sum = poseSummary(s, p.id);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "flat-pose";
        b.dataset.pose = p.id;
        b.setAttribute("aria-pressed", String(p.id === pose));
        b.textContent = `${String(p.distance)}% ${String(p.tilt)}deg ${sum.complete ? "done" : String(sum.shots)}`;
        b.disabled = countdown !== null || saving;
        b.addEventListener("click", () => {
          pose = p.id;
          render();
        });
        return b;
      }),
    );
    const sum = poseSummary(s, pose);
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

  const hintFor = (ph: Phase, s: SurfaceProgress | null): string => {
    switch (ph) {
      case "overview":
        return "Pick a surface to continue, or start a new one below.";
      case "ref-live":
        return "Reference: face the surface straight on in good light, the surface about half the frame wide. Rest the phone, tap Take reference and let go.";
      case "corners": {
        const problem =
          taps.length === 4 && still
            ? cornersProblem(taps, still.width, still.height)
            : null;
        if (problem) {
          return `${problem}. Tap Redo corners.`;
        }
        const next = nextCorner(taps);
        return `Tap corner ${String(taps.length + 1)} of 4 on the photo: ${next ?? ""}.`;
      }
      case "check":
        return "Check the straightened surface: whole and upright? Use it, or redo the corners.";
      case "poses": {
        const p = POSES.find((x) => x.id === pose)!;
        const sum = poseSummary(s!, pose);
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

  function render(): void {
    if (!isOpen) {
      return;
    }
    const ph = phase();
    const s = current();
    const counting = countdown !== null;
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
    ui.overviewOpen.disabled = counting || saving || ph === "overview";
    ui.hint.textContent = hintFor(ph, s);
    if (ph === "overview" || !s) {
      dropPrepared();
      ui.where.textContent = "Overview";
      ui.guide.hidden = true;
      renderOverview();
      return;
    }
    const cls = SURFACE_CLASSES.find((c) => c.id === s.cls)!.label;
    ui.where.textContent =
      ph === "poses"
        ? `Surface ${String(s.id)}, ${cls}, pose ${POSES.find((p) => p.id === pose)!.label}`
        : `Surface ${String(s.id)}, ${cls}, reference`;
    const sumPose = ph === "poses" ? poseSummary(s, pose) : null;
    // The pose is in the label: a shot is taken without looking elsewhere.
    const poseNow = POSES.find((p) => p.id === pose)!;
    const poseShort = `${String(poseNow.distance)} % ${String(poseNow.tilt)} deg`;
    ui.shoot.textContent = counting
      ? `Cancel (${String(countdown!.left)})`
      : ph === "poses"
        ? sumPose!.full
          ? `Darker shot, ${poseShort} (${String(COUNTDOWN_S)} s)`
          : `Full-light shot, ${poseShort} (${String(COUNTDOWN_S)} s)`
        : ph === "ref-live"
          ? `Take reference (${String(COUNTDOWN_S)} s)`
          : `Retake reference (${String(COUNTDOWN_S)} s)`;
    ui.shoot.disabled =
      saving || (!counting && (ph === "ref-live" || ph === "poses") && !stream);
    ui.redo.disabled = counting || taps.length === 0;
    ui.accept.disabled = counting;
    if (ph === "poses") {
      renderPoses(s);
      const last = [...s.shots].reverse().find((x) => x.pose === pose);
      ui.retake.disabled = counting || saving || !last || last.saved;
      const sum = surfaceSummary(s);
      if (
        prepared &&
        (prepared.id !== s.id || prepared.shots !== s.shots.length)
      ) {
        // A shot was added or removed after the zip was made: it is stale.
        dropPrepared();
      }
      ui.download.disabled = counting || saving;
      if (!saving) {
        ui.download.textContent =
          sum.unsaved > 0
            ? `Download zip (${String(sum.unsaved)} new)`
            : "Download zip";
      }
      placeGuide(s);
    } else {
      dropPrepared();
      ui.guide.hidden = true;
      drawStill();
    }
  }

  /** The first pose not yet complete, else the first. */
  const firstOpenPose = (s: SurfaceProgress): PoseId =>
    (POSES.find((p) => !poseSummary(s, p.id).complete) ?? POSES[0]!).id;

  // --- live light reading -------------------------------------------------

  const readLive = (): void => {
    const s = current();
    if (phase() !== "poses" || !s || ui.video.videoWidth === 0) {
      ui.live.textContent = "";
      return;
    }
    try {
      const mean = regionMean(captureFrame(ui.video, LIVE_SAMPLE_MAX), s);
      const full = poseSummary(s, pose).fullMean;
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
    const s = current();
    const ph = phase();
    if (!s || ui.video.videoWidth === 0) {
      ui.state.textContent = "camera not ready yet: tap again";
      return;
    }
    if (ph === "corners" || ph === "check") {
      // A retake of the reference shows the live camera first.
      still = null;
      taps = [];
      preview = null;
      ui.state.textContent = "aim again, then tap Take reference";
      render();
      return;
    }
    const track = stream?.getVideoTracks()[0];
    if (!track || track.readyState !== "live" || track.muted) {
      // An ended or muted track still shows its last frame: a photo of it
      // would be a stale picture tagged as new.
      ui.state.textContent = "camera not live: wait a moment and tap again";
      deps.log(
        `flat: photo refused, track ${track ? `${track.readyState}${track.muted ? ", muted" : ""}` : "missing"}`,
      );
      render();
      return;
    }
    const f = captureFrame(ui.video, FLAT_CAPTURE_MAX);
    if (ph === "ref-live") {
      still = f;
      photosOf(s.id).camera = {
        width: ui.video.videoWidth,
        height: ui.video.videoHeight,
      };
      taps = [];
      preview = null;
      deps.log(
        `flat: surface ${String(s.id)} reference ${String(f.width)}x${String(f.height)}`,
      );
      ui.state.textContent = `reference taken, ${String(f.width)}x${String(f.height)}`;
      render();
      return;
    }
    const mean = regionMean(f, s);
    const before = s.shots.length;
    dispatch({ type: "add-shot", id: s.id, pose, greyMean: mean });
    const after = current()!;
    if (after.shots.length === before) {
      ui.state.textContent = `too dark for the full-light shot (grey ${mean.toFixed(0)}): switch all lamps on and take it again`;
      deps.log(`flat: full-light shot refused, grey ${mean.toFixed(1)}`);
      render();
      return;
    }
    const shot = after.shots.at(-1)!;
    photosOf(s.id).shots.set(shotKey(shot.pose, shot.q), f);
    const text = `${shot.pose} q${String(shot.q)}: ${shot.fullLight ? "full light" : `${shot.lumaRatio.toFixed(2)} of full`}, bin ${shot.bin}`;
    deps.log(`flat: surface ${String(s.id)} ${text}, grey ${mean.toFixed(1)}`);
    ui.state.textContent = `taken: ${text}`;
    readLive();
    render();
  };

  const cancelCountdown = (): void => {
    if (countdown) {
      clearInterval(countdown.timer);
      countdown = null;
      ui.countdown.hidden = true;
    }
  };

  ui.shoot.addEventListener("click", () => {
    if (countdown) {
      cancelCountdown();
      ui.state.textContent = "cancelled";
      render();
      return;
    }
    const ph = phase();
    if (ph === "corners" || ph === "check") {
      takePhoto();
      return;
    }
    countdown = {
      left: COUNTDOWN_S,
      timer: window.setInterval(() => {
        if (!countdown) {
          return;
        }
        countdown.left--;
        ui.countdown.textContent = String(countdown.left);
        if (countdown.left <= 0) {
          cancelCountdown();
          takePhoto();
          return;
        }
        render();
      }, 1000),
    };
    ui.countdown.textContent = String(COUNTDOWN_S);
    ui.countdown.hidden = false;
    render();
  });

  ui.still.addEventListener("click", (ev) => {
    if (phase() !== "corners" || !still || taps.length >= 4) {
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
    taps = [...taps, p];
    if (
      taps.length === 4 &&
      cornersProblem(taps, still.width, still.height) === null
    ) {
      try {
        preview = rectify(still, taps, rectifiedSize(taps, FLAT_CAPTURE_MAX));
        ui.state.textContent = `straightened: ${String(preview.width)}x${String(preview.height)}`;
      } catch (e) {
        deps.fail("flat corners", e);
      }
    }
    render();
  });

  ui.redo.addEventListener("click", () => {
    taps = [];
    preview = null;
    ui.state.textContent = `tap the ${CORNERS[0]} corner`;
    render();
  });

  ui.accept.addEventListener("click", () => {
    const s = current();
    if (!s || !still || !preview) {
      return;
    }
    dispatch({
      type: "set-reference",
      id: s.id,
      reference: {
        corners: taps,
        width: still.width,
        height: still.height,
        rectified: { width: preview.width, height: preview.height },
      },
    });
    const p = photosOf(s.id);
    p.reference = still;
    p.rectified = preview;
    deps.log(
      `flat: surface ${String(s.id)} corners ${taps.map((t) => `${t.x.toFixed(0)},${t.y.toFixed(0)}`).join(" ")}, rectified ${String(preview.width)}x${String(preview.height)}`,
    );
    still = null;
    taps = [];
    preview = null;
    pose = POSES[0]!.id;
    ui.state.textContent = "reference kept: now the poses";
    render();
  });

  ui.retake.addEventListener("click", () => {
    const s = current();
    if (!s) {
      return;
    }
    const last = [...s.shots].reverse().find((x) => x.pose === pose);
    dispatch({ type: "remove-last-shot", id: s.id, pose });
    if (last && current()!.shots.length < s.shots.length) {
      photosOf(s.id).shots.delete(shotKey(last.pose, last.q));
      ui.state.textContent = `removed ${last.pose} q${String(last.q)}: take it again`;
    }
    render();
  });

  /** One surface's zip: every photo in memory, the original, the JSON and the log. */
  const surfaceZip = async (
    s: SurfaceProgress,
  ): Promise<{ blob: Blob; name: string; photos: number }> => {
    const names = flatFileNames(s.id, s.cls, deps.session);
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
      const f = p.shots.get(shotKey(x.pose, x.q)) ?? null;
      const file = f ? names.query(x.pose, x.q, x.bin) : null;
      if (f && file) {
        files.push({ name: file, blob: await framePng(f, file) });
      }
      shots.push({
        file,
        pose: x.pose,
        shot: x.q,
        fullLight: x.fullLight,
        greyMean: x.greyMean,
        lumaRatio: x.lumaRatio,
        bin: x.bin,
        width: f?.width ?? null,
        height: f?.height ?? null,
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
            session: deps.session,
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
    const blob = await allFilesZip(files, { log: deps.pageLog(), report: "" });
    const photoCount = files.filter((f) => f.name.endsWith(".png")).length;
    return { blob, name: names.zip, photos: photoCount };
  };

  ui.download.addEventListener("click", () => {
    const s = current();
    if (!s || !s.reference || saving) {
      return;
    }
    saving = true;
    dropPrepared();
    ui.download.textContent = "Preparing zip...";
    ui.state.textContent = "preparing the zip...";
    render();
    surfaceZip(s)
      .then(({ blob, name, photos: n }) => {
        // A link the user taps, as the photo pairs do: a download started
        // from script after an await can be blocked, and only the tap is
        // proof enough to mark the photos downloaded.
        const url = URL.createObjectURL(blob);
        const text = `${String(n)} photos, ${formatBytes(blob.size)}`;
        prepared = { id: s.id, shots: s.shots.length, url, name, text };
        ui.saveLink.href = url;
        ui.saveLink.download = name;
        ui.saveLink.textContent = `Save ${name}`;
        ui.saveLink.hidden = false;
        ui.state.textContent = `ready: tap Save (${text})`;
        deps.log(`flat: ${name} ready, ${String(n)} photos`);
      })
      .catch((e: unknown) => {
        deps.fail("flat save", e);
        ui.state.textContent = `zip failed: ${errorText(e)}; nothing was marked downloaded`;
      })
      .finally(() => {
        saving = false;
        render();
      });
  });

  ui.saveLink.addEventListener("click", () => {
    const s = current();
    if (!prepared || !s || prepared.id !== s.id) {
      return;
    }
    dispatch({ type: "saved", id: s.id });
    ui.state.textContent = `downloaded ${prepared.name}: ${prepared.text}`;
    deps.log(`flat: ${prepared.name} saved`);
    render();
  });

  ui.newClass.addEventListener("change", () => {
    classPicked = true;
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
    dispatch({
      type: "add-surface",
      cls: ui.newClass.value as SurfaceClass,
      original: ui.newOriginal.checked || file !== null,
    });
    const s = current()!;
    freeOtherPhotos(s.id);
    photosOf(s.id).original = file;
    classPicked = false;
    ui.newFile.value = "";
    ui.newOriginal.checked = false;
    still = null;
    taps = [];
    preview = null;
    deps.log(
      `flat: surface ${String(s.id)} started, ${s.cls}${file ? ", original attached" : ""}`,
    );
    ui.state.textContent = "";
    void startCamera();
    render();
  });

  ui.overviewOpen.addEventListener("click", () => {
    cancelCountdown();
    still = null;
    taps = [];
    preview = null;
    dispatch({ type: "select", id: null });
    stopCamera();
    ui.state.textContent = "";
    render();
  });

  ui.exit.addEventListener("click", () => {
    close();
    deps.onExit();
  });

  ui.video.addEventListener("loadedmetadata", () => render());
  window.addEventListener("resize", () => render());

  function close(): void {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    cancelCountdown();
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
    if (isOpen) {
      return;
    }
    isOpen = true;
    ui.section.hidden = false;
    document.body.classList.add("flat-open");
    const s = current();
    if (s) {
      pose = firstOpenPose(s);
    }
    liveTimer = window.setInterval(readLive, LIVE_EVERY_MS);
    void holdWakeLock();
    render();
    if (s) {
      void startCamera();
    }
  }

  // Opening a surface from the overview starts the camera too.
  ui.surfaces.addEventListener("click", () => {
    if (current()) {
      void startCamera();
    }
  });
  window.addEventListener("pagehide", () => {
    if (isOpen) {
      closedByPagehide = true;
      close();
    }
  });
  // A back-forward cache restore keeps the selector on the flat mode, so
  // the mode comes back with it.
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
    if (!isOpen || document.visibilityState !== "visible") {
      return;
    }
    void holdWakeLock();
    // A camera ended in the background (another app took it) restarts.
    const track = stream?.getVideoTracks()[0];
    if (stream && (!track || track.readyState === "ended")) {
      stream = null;
      ui.video.srcObject = null;
      deps.log("flat: camera ended while hidden, restarting");
      void startCamera();
    }
  });

  return { open, close };
}
