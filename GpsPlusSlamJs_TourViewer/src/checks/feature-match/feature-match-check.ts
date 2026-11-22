/**
 * The feature matching benchmark page: the guided steps (photo A, photo
 * B, run, save), the camera, the options, the results table, the result
 * pictures and the copyable log. It is a view on the page's store
 * (`feature-match-store.ts`): taps dispatch actions, `render` draws the
 * state. All measuring is in `bench-run.ts`; this file only touches the
 * DOM and browser APIs.
 *
 * @see feature-match-check.ts.md
 */
import { drawMatches, sideBySide } from "./bench-draw";
import { captureFrame, frameCanvas, framePng } from "./bench-dom";
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
  sessionToken,
  type LightCheck,
  type PairKey,
} from "./bench-export";
import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import { describeGrey, greyStats, type Frame } from "./bench-image";
import {
  backendsFrom,
  buildMethods,
  parseRuns,
  precisionsFrom,
  runSettings,
  selectionGaps,
} from "./bench-methods";
import { errorText, formatBytes, type LoadDeps } from "./bench-net";
import {
  formatReport,
  hasJspi,
  tableRows,
  UNKNOWN_DEVICE,
  type DeviceInfo,
  type TableRow,
} from "./bench-report";
import {
  runBenchmark,
  type BenchInput,
  type MethodResult,
  type SizeResult,
} from "./bench-run";
import { formatMs } from "./bench-stats";
import { stepStates } from "./bench-steps";
import { syntheticPair } from "./bench-synthetic";
import {
  formatTimingReport,
  parseTimingRuns,
  runTimingByGroup,
  timingBackends,
} from "./bench-timing";
import {
  canSave,
  featureMatchActions as A,
  flowState,
  logText,
  type BenchOptions,
  type FeatureMatchState,
  type Offered,
  type PairNote,
  type SpeedOptions,
  type StatusSlot,
} from "./feature-match-slice";
import { indexedDbKeyValueStore } from "../../key-value-db";
import {
  createFeatureMatchStore,
  PHOTO_DB,
  PHOTO_STORE,
  type KeyValueStorage,
} from "./feature-match-store";
import { startFlatCapture } from "./flat-capture";
import { ortWasmThreads } from "./method-aliked";
import type { DinoVariant } from "./method-dino";
import { guardRun, HIDDEN_DURING_RUNS } from "./run-guard";
import {
  SPEED_LONG_EDGES,
  SPEED_SIFT_CAPS,
  speedTestArms,
  speedTestSettings,
  type SpeedTestChoice,
} from "./speed-test";

/** The longest side a captured camera frame is kept at. */
const CAPTURE_MAX = 1280;
const SYNTHETIC_SEED = 1;
/** Canvas width of a result picture at most, in device pixels. */
const PICTURE_MAX_WIDTH = 640;
/** Match lines drawn per picture at most (spread evenly over all). */
const PICTURE_LINE_CAP = 200;
const PICTURE_GAP = 8;
/** Set once "Before you start" has been shown open; it then starts closed. */
const BEFORE_START_SEEN = "feature-match-check.before-start-seen";

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) {
    throw new Error(`feature-match-check: missing ${sel}`);
  }
  return el;
};

/** The page's elements, found once. */
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
  readonly runSynthetic: HTMLButtonElement;
  readonly syntheticState: HTMLElement;
  readonly runSpeed: HTMLButtonElement;
  readonly speedState: HTMLElement;
  readonly table: HTMLTableSectionElement;
  readonly pictures: HTMLElement;
  readonly report: HTMLTextAreaElement;
  readonly copy: HTMLButtonElement;
  readonly copyState: HTMLElement;
  readonly log: HTMLElement;
}

function findUi(root: ParentNode): Ui {
  return {
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
    runSynthetic: $(root, "#run-synthetic"),
    syntheticState: $(root, "#synthetic-state"),
    runSpeed: $(root, "#run-speed"),
    speedState: $(root, "#speed-state"),
    table: $(root, "#results tbody"),
    pictures: $(root, "#pictures"),
    report: $(root, "#report"),
    copy: $(root, "#copy"),
    copyState: $(root, "#copy-state"),
    log: $(root, "#log"),
  };
}

const browserDeps: LoadDeps = {
  importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
  fetch: (url, init) => fetch(url, init),
  now: () => performance.now(),
  resources: () =>
    performance.getEntriesByType("resource") as PerformanceResourceTiming[],
};

/** `localStorage` behind calls, so a blocked storage throws inside them. */
const pageStorage: KeyValueStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    localStorage.setItem(key, value);
  },
};

interface UaData {
  getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>>;
}

async function uaHints(): Promise<{
  model: string | null;
  platformVersion: string | null;
}> {
  const data = (navigator as Navigator & { userAgentData?: UaData })
    .userAgentData;
  try {
    const v =
      (await data?.getHighEntropyValues?.(["model", "platformVersion"])) ?? {};
    const str = (x: unknown) => (typeof x === "string" && x !== "" ? x : null);
    return { model: str(v.model), platformVersion: str(v.platformVersion) };
  } catch {
    return { model: null, platformVersion: null };
  }
}

interface GpuLike {
  requestAdapter(): Promise<{
    info?: { vendor?: string; architecture?: string; description?: string };
    features?: Iterable<string>;
  } | null>;
}

async function webgpuText(): Promise<string> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) {
    return "none (navigator.gpu missing)";
  }
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return "none (no adapter)";
    }
    const i = adapter.info ?? {};
    const parts = [i.vendor, i.architecture, i.description].filter((p) => p);
    const feats = Array.from(adapter.features ?? []).sort();
    return `${parts.join(" ") || "adapter (no info)"}; features: ${feats.join(", ") || "-"}`;
  } catch (e) {
    return `error: ${errorText(e)}`;
  }
}

async function collectDeviceInfo(): Promise<DeviceInfo> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const hints = await uaHints();
  return {
    userAgent: nav.userAgent,
    model: hints.model,
    platformVersion: hints.platformVersion,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    jspi: hasJspi((globalThis as { WebAssembly?: unknown }).WebAssembly),
    screen: `${String(screen.width)}x${String(screen.height)} @${String(devicePixelRatio)}`,
    webgpu: await webgpuText(),
  };
}

/** A frame and its grey values as one log phrase. */
const frameText = (name: string, f: Frame): string =>
  `${name} ${String(f.width)}x${String(f.height)}, ${describeGrey(greyStats(f))}`;

const checked = (root: ParentNode, sel: string): boolean =>
  root.querySelector<HTMLInputElement>(sel)?.checked === true;

const valueOf = (root: ParentNode, sel: string): string =>
  root.querySelector<HTMLInputElement>(sel)?.value ?? "";

/** The values of the ticked boxes named `name`. */
const tickedValues = (root: ParentNode, name: string): string[] =>
  Array.from(
    root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`),
    (i) => i.value,
  );

/** The benchmark's options as the controls hold them now. */
const readOptions = (root: ParentNode): BenchOptions => ({
  methods: {
    sift: checked(root, "#m-sift"),
    xfeat: checked(root, "#m-xfeat"),
    aliked: checked(root, "#m-aliked"),
    siftLightGlue: checked(root, "#m-siftlg"),
  },
  backends: tickedValues(root, "backend"),
  models: tickedValues(root, "model"),
  sizes: tickedValues(root, "size"),
  runs: valueOf(root, "#runs"),
});

/** The speed test's options as the controls hold them now. */
const readSpeedOptions = (root: ParentNode): SpeedOptions => ({
  xfeat: checked(root, "#t-xfeat"),
  siftLightGlue: checked(root, "#t-siftlg"),
  dinoInt8: checked(root, "#t-dino-int8"),
  dinoQ4f16: checked(root, "#t-dino-q4f16"),
  backends: tickedValues(root, "t-backend"),
  edge: valueOf(root, "#t-edge"),
  cap: valueOf(root, "#t-cap"),
  runs: valueOf(root, "#t-runs"),
});

const chosenSizes = (o: BenchOptions): number[] =>
  o.sizes.map(Number).filter((v) => Number.isFinite(v) && v > 0);

let webGpuProbe: Promise<boolean> | null = null;

/**
 * Whether WebGPU can run here: navigator.gpu alone is not enough, as a
 * browser may offer it with no adapter. Asked once per page; null or a
 * throw is no WebGPU.
 */
const hasWebGpu = (): Promise<boolean> =>
  (webGpuProbe ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (!gpu) {
      return false;
    }
    try {
      return (await gpu.requestAdapter()) !== null;
    } catch {
      return false;
    }
  })());

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

/** What a camera start came to: running, refused, or stopped meanwhile. */
type CameraStart = "on" | "failed" | "stopped";

/** The pair a run measures, with its text for the report. */
interface RunPair {
  readonly input: BenchInput;
  readonly text: string;
}

/** Starts the page on `root` (the document in the HTML entry). */
export function startFeatureMatchCheck(root: ParentNode = document): void {
  const ui = findUi(root);
  const fm = createFeatureMatchStore({
    storage: pageStorage,
    // This page load's token for the frames JSON (no time, no place).
    session: sessionToken(crypto.getRandomValues(new Uint8Array(4))),
    revokeUrl: (url) => URL.revokeObjectURL(url),
    photoDb: indexedDbKeyValueStore(
      typeof indexedDB === "undefined" ? undefined : indexedDB,
      PHOTO_DB,
      PHOTO_STORE,
    ),
    // Called only after a database call settled, long after `fail` exists.
    photoDbFailed: (e) => {
      fail("photo storage", e);
    },
  });
  const { store, sides, newId, accepted, put } = fm;
  const state = (): FeatureMatchState => store.getState();
  // The camera, its start in flight and the pictures stay here: they are
  // browser resources, not state.
  let stream: MediaStream | null = null;
  /** The camera start in flight, so a second tap does not open a second stream. */
  let starting: Promise<CameraStart> | null = null;
  /** Raised by every stop, so a start still pending learns it was stopped. */
  let cameraGeneration = 0;

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

  /** A log line with the page time in front. */
  const stamp = (line: string): string =>
    `[${(performance.now() / 1000).toFixed(1)}s] ${line}`;
  const log = (line: string): void => {
    store.dispatch(A.logged(stamp(line)));
  };
  const fail = (where: string, e: unknown): void => {
    const line = `${where}: ${errorText(e)}`;
    store.dispatch(A.failed({ line, stamped: stamp(`ERROR ${line}`) }));
  };
  const status = (slot: StatusSlot, text: string): void => {
    store.dispatch(A.statusSet({ slot, text }));
  };
  window.addEventListener("error", (ev) =>
    fail("page", ev.error ?? ev.message),
  );
  window.addEventListener("unhandledrejection", (ev) =>
    fail("page", ev.reason),
  );
  void fm.restorePhotos();

  try {
    performance.setResourceTimingBufferSize(1000);
  } catch {
    // Older browsers keep their default buffer; sizes may then read "-".
  }

  /** Device facts, or dashes when the browser refuses them. */
  const deviceInfo = (): Promise<DeviceInfo> =>
    collectDeviceInfo().catch((e: unknown) => {
      log(`device info unavailable: ${errorText(e)}`);
      return UNKNOWN_DEVICE;
    });

  // --- render -----------------------------------------------------------

  const idleLabels = {
    run: ui.run.textContent,
    synthetic: ui.runSynthetic.textContent,
    speed: ui.runSpeed.textContent,
  };
  const statusEls: Readonly<Record<StatusSlot, HTMLElement>> = {
    a: ui.stateA,
    b: ui.stateB,
    run: ui.runState,
    synthetic: ui.syntheticState,
    speed: ui.speedState,
    save: ui.saveState,
    copy: ui.copyState,
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

  const renderTable = (rows: readonly TableRow[]): void => {
    ui.table.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement("tr");
        for (const v of [
          r.method,
          r.backend,
          r.size,
          r.extract,
          r.match,
          r.keypoints,
          r.descriptorBytes,
          r.matches,
          r.correct,
          r.error,
        ]) {
          const td = document.createElement("td");
          td.textContent = v;
          tr.append(td);
        }
        if (r.error !== "") {
          tr.className = "row-error";
        }
        return tr;
      }),
    );
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
    ui.runSynthetic.disabled = !idle;
    ui.runSpeed.disabled = !idle;
    ui.saveFrames.disabled = !canSave(s);
    ui.run.textContent = s.running === "camera" ? "Running..." : idleLabels.run;
    ui.runSynthetic.textContent =
      s.running === "synthetic" ? "Running..." : idleLabels.synthetic;
    ui.runSpeed.textContent =
      s.running === "speed" ? "Timing..." : idleLabels.speed;
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
    if (was?.table !== s.table) {
      renderTable(s.table);
    }
    if (was?.report !== s.report) {
      ui.report.value = s.report;
    }
    if (was?.log !== s.log) {
      const from = was?.log.length ?? 0;
      ui.log.textContent += s.log
        .slice(from)
        .map((l) => `${l}\n`)
        .join("");
      ui.log.scrollTop = ui.log.scrollHeight;
    }
  };

  // --- selector and options ----------------------------------------------

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

  /** The options follow the controls; a run reads them from the state. */
  const optionsChanged = (): void => {
    store.dispatch(A.optionsChanged(readOptions(root)));
    store.dispatch(A.speedOptionsChanged(readSpeedOptions(root)));
  };
  for (const sel of ["#options", "#speed"]) {
    const box = root.querySelector(sel);
    box?.addEventListener("change", optionsChanged);
    box?.addEventListener("input", optionsChanged);
  }

  // --- camera -------------------------------------------------------------

  /**
   * Stops the camera: it must not run beside the timed runs (it costs the
   * same CPU and GPU being measured). A start still pending sees the
   * raised generation and stops its own stream.
   */
  const stopCamera = (): void => {
    cameraGeneration++;
    if (!stream) {
      return;
    }
    for (const t of stream.getTracks()) {
      t.stop();
    }
    stream = null;
    ui.video.srcObject = null;
    log("camera off");
    store.dispatch(A.cameraChanged(false));
  };

  /** Opens the camera stream and plays it; never rejects. */
  const openCamera = async (): Promise<CameraStart> => {
    const generation = cameraGeneration;
    const stoppedMeanwhile = () => generation !== cameraGeneration;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
        },
        audio: false,
      });
      if (stoppedMeanwhile()) {
        for (const t of s.getTracks()) {
          t.stop();
        }
        return "stopped";
      }
      stream = s;
      ui.video.srcObject = s;
      store.dispatch(A.cameraChanged(true));
      await ui.video.play();
      if (stoppedMeanwhile()) {
        return "stopped";
      }
      log("camera on");
      return "on";
    } catch (e) {
      if (stoppedMeanwhile()) {
        return "stopped";
      }
      fail("camera", e);
      stopCamera();
      return "failed";
    }
  };

  /** Starts the camera once; "on" when it is running. */
  const startCamera = (): Promise<CameraStart> => {
    if (stream) {
      return Promise.resolve("on");
    }
    // Forgotten once settled. The callback runs in a later microtask, after
    // the assignment, so a start that fails before awaiting anything (no
    // camera API at all) is forgotten too and the next tap tries again.
    starting ??= openCamera().finally(() => {
      starting = null;
    });
    return starting;
  };

  // --- photos ---------------------------------------------------------------

  /**
   * A capture tap: with the camera off it only starts the camera (so the
   * photo is aimed, and not the camera's first frame); with it on it takes
   * the photo. Photo A starts a new pair; photo B starts the run.
   */
  const capture = (which: "a" | "b") => async (): Promise<void> => {
    const name = which === "a" ? "A" : "B";
    if (!stream) {
      status(which, "starting camera...");
      const started = await startCamera();
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
      startRun("camera");
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
    const info = framesInfo([a, b], await deviceInfo(), CAPTURE_MAX, tag, {
      light: s.light,
      session: s.session,
    });
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

  // --- runs -------------------------------------------------------------------

  const pairOf = (kind: "camera" | "synthetic"): RunPair | null => {
    if (kind === "synthetic") {
      const p = syntheticPair(640, 480, SYNTHETIC_SEED);
      return {
        input: { a: p.a, b: p.b, warp: p.warp },
        text: `synthetic (seed ${String(SYNTHETIC_SEED)}, known warp) ${frameText("A", p.a)}; ${frameText("B", p.b)}`,
      };
    }
    const { photos } = state();
    const a = photos.a ? sides.frames.get(photos.a.id) : undefined;
    const b = photos.b ? sides.frames.get(photos.b.id) : undefined;
    if (!a || !b) {
      fail("input", new Error("take photo A and B first"));
      return null;
    }
    return {
      input: { a: a.frame, b: b.frame, warp: null },
      text: `camera ${frameText("A", a.frame)}; ${frameText("B", b.frame)}`,
    };
  };

  /** A result card below the earlier ones: its caption, and later a picture. */
  const addCard = (caption: string, error: boolean): HTMLElement => {
    const fig = document.createElement("figure");
    fig.className = error ? "picture picture-error" : "picture";
    const cap = document.createElement("figcaption");
    cap.textContent = caption;
    fig.append(cap);
    ui.pictures.append(fig);
    return fig;
  };

  /** Draws one finished size: both frames, keypoints and match lines. */
  const addPicture = (
    pair: RunPair,
    images: { a: HTMLCanvasElement; b: HTMLCanvasElement },
    label: string,
    s: SizeResult,
  ): void => {
    const head = `${label} @${String(s.longEdge)} (${String(s.width)}x${String(s.height)})`;
    if (s.error !== null || s.sample === null) {
      addCard(`${head}: ERROR ${s.error ?? "no result"}`, true);
      return;
    }
    const sample = s.sample;
    const matches = sample.pairs.length / 2;
    const fig = addCard(head, false);
    const box = Math.max(160, ui.pictures.clientWidth);
    const layout = sideBySide(
      pair.input.a,
      pair.input.b,
      Math.min(PICTURE_MAX_WIDTH, Math.round(box * devicePixelRatio)),
      PICTURE_GAP,
    );
    const canvas = document.createElement("canvas");
    canvas.width = layout.width;
    canvas.height = layout.height;
    canvas.style.width = `${String(Math.min(box, layout.width))}px`;
    canvas.setAttribute(
      "aria-label",
      `${head}: frames A and B side by side with ${String(matches)} matches`,
    );
    const ctx = canvas.getContext("2d");
    const shown = ctx
      ? drawMatches(ctx, {
          layout,
          imageA: images.a,
          imageB: images.b,
          frameA: pair.input.a,
          frameB: pair.input.b,
          size: s,
          sample,
          lineCap: PICTURE_LINE_CAP,
        })
      : 0;
    fig.firstElementChild!.textContent =
      `${head}, last round: keypoints A ${String(sample.a.x.length)}, B ${String(sample.b.x.length)}` +
      ` | matches ${String(matches)}` +
      (shown < matches ? ` (${String(shown)} drawn)` : "") +
      (s.correct === null ? "" : ` | correct ${String(s.correct)}`) +
      ` | extract ${formatMs(s.extract.median)} ms, match ${formatMs(s.match.median)} ms`;
    fig.append(canvas);
  };

  const runOnce = async (
    kind: "camera" | "synthetic",
  ): Promise<{ text: string; results: MethodResult[] | null }> => {
    store.dispatch(A.errorsCleared());
    const pair = pairOf(kind);
    if (!pair) {
      return { text: "not run: no input", results: null };
    }
    const o = state().options;
    // A protocol pair sets runs, warm-up, backend and model file itself.
    const settings = runSettings(
      {
        pair: kind === "camera" ? (state().pairInProgress?.pair ?? null) : null,
        backends: backendsFrom(o.backends),
        precisions: precisionsFrom(o.models),
        runs: parseRuns(o.runs),
      },
      await hasWebGpu(),
    );
    const selection = {
      ...o.methods,
      backends: settings.backends,
      precisions: settings.precisions,
    };
    const gaps = selectionGaps(selection);
    if (gaps.length > 0) {
      fail("options", new Error(gaps.join("; ")));
      return {
        text: "not run: a ticked method has nothing to run on (see log)",
        results: null,
      };
    }
    const methods = buildMethods(selection, browserDeps);
    const sizes = chosenSizes(o);
    if (methods.length === 0 || sizes.length === 0) {
      fail(
        "options",
        new Error("tick at least one method, backend, model file and size"),
      );
      return { text: "not run: nothing ticked", results: null };
    }
    const { runs, warmup } = settings;
    stopCamera();
    const startedAt = new Date().toISOString();
    const device = await deviceInfo();
    store.dispatch(A.tableSet([]));
    ui.pictures.replaceChildren();
    store.dispatch(A.reportSet(""));
    if (kind === "synthetic") {
      store.dispatch(A.cameraRunWithdrawn());
    }
    const images = {
      a: frameCanvas(pair.input.a),
      b: frameCanvas(pair.input.b),
    };
    log(
      `run: ${String(methods.length)} methods, sizes ${sizes.join("/")}, ${String(runs)} runs`,
    );
    log(settings.line);
    const results = await runBenchmark(
      methods,
      pair.input,
      { sizes, runs, warmup },
      {
        now: () => performance.now(),
        yieldToUi: () => new Promise((r) => setTimeout(r, 0)),
        log: (line) => {
          log(line);
          store.dispatch(A.runProgressed(line));
        },
        onSize: (m, s) => {
          try {
            addPicture(pair, images, m.label, s);
          } catch (e) {
            fail("picture", e);
          }
        },
      },
    );
    for (const r of results) {
      if (r.error !== null) {
        addCard(`${r.label}: ERROR ${r.error}`, true);
      }
    }
    store.dispatch(A.tableSet(tableRows(results)));
    store.dispatch(
      A.reportSet(
        formatReport({
          startedAt,
          device,
          input: pair.text,
          sizes,
          runs,
          warmup,
          results,
          errors: state().errors,
        }),
      ),
    );
    const failed = results.filter(
      (r) => r.error !== null || r.sizes.some((s) => s.error !== null),
    ).length;
    const text =
      failed === 0
        ? `done: ${String(results.length)} methods`
        : `done: ${String(results.length)} methods, ${String(failed)} with errors (see log)`;
    return { text, results };
  };

  /** Ends the run in progress, its camera results kept beside the state. */
  const finishRun = (text: string, results: MethodResult[] | null): void => {
    const resultsId =
      results && state().running === "camera" ? newId("results") : null;
    put(
      sides.results,
      resultsId && results ? [[resultsId, results]] : [],
      A.runFinished({ text, resultsId }),
    );
  };

  /**
   * Runs the benchmark on the camera pair or on the synthetic one. The
   * camera pair's run is step 3; one run or save at a time.
   */
  function startRun(kind: "camera" | "synthetic"): void {
    // A control set by script fires no event: read them all once more.
    optionsChanged();
    if (!accepted(A.runStarted(kind))) {
      return;
    }
    runOnce(kind)
      .then(({ text, results }) => {
        log(text);
        finishRun(text, results);
      })
      .catch((e: unknown) => {
        fail("run", e);
        finishRun("failed (see log)", null);
      });
  }
  ui.run.addEventListener("click", () => startRun("camera"));
  ui.runSynthetic.addEventListener("click", () => startRun("synthetic"));

  /** One of `allowed` by its text, else `fallback`. */
  const pickNumber = <T extends number>(
    allowed: readonly T[],
    text: string,
    fallback: T,
  ): T => allowed.find((v) => String(v) === text) ?? fallback;

  /**
   * The speed test: the ticked arms per backend on the camera pair when
   * both photos are taken, else on the synthetic pair; its report replaces
   * the report text, so a camera run it hides is withdrawn first.
   */
  const runSpeedOnce = async (): Promise<string> => {
    store.dispatch(A.errorsCleared());
    const { photos } = state();
    const pair = pairOf(
      photos.a !== null && photos.b !== null ? "camera" : "synthetic",
    );
    if (!pair) {
      return "not run: no input";
    }
    const o = state().speedOptions;
    const { backends, note } = timingBackends(
      backendsFrom(o.backends),
      await hasWebGpu(),
    );
    const dino: DinoVariant[] = [];
    if (o.dinoInt8) {
      dino.push("int8");
    }
    if (o.dinoQ4f16) {
      dino.push("q4f16");
    }
    const choice: SpeedTestChoice = {
      xfeat: o.xfeat,
      siftLightGlue: o.siftLightGlue,
      dino,
      backends,
      longEdge: pickNumber(SPEED_LONG_EDGES, o.edge, 640),
      siftCap: pickNumber(SPEED_SIFT_CAPS, o.cap, 512),
    };
    const arms = speedTestArms(choice, pair.input, browserDeps);
    if (arms.length === 0) {
      fail("speed test", new Error("tick at least one arm and backend"));
      return "not run: nothing ticked";
    }
    const runs = parseTimingRuns(o.runs);
    stopCamera();
    store.dispatch(A.cameraRunWithdrawn());
    const startedAt = new Date().toISOString();
    const device = await deviceInfo();
    store.dispatch(A.reportSet(""));
    const settingsLine = speedTestSettings(
      choice,
      pair.input,
      note,
      ortWasmThreads(
        globalThis.crossOriginIsolated === true,
        navigator.hardwareConcurrency,
      ),
    );
    log(
      `speed test: ${String(arms.length)} arms, ${String(runs)} runs; ${settingsLine}`,
    );
    // A hidden page or a dark screen is throttled: keep the screen on, and
    // say in the report when the page was hidden anyway.
    const guard = guardRun({
      doc: document,
      wakeLock: "wakeLock" in navigator ? navigator.wakeLock : undefined,
      log: (line) => log(`speed test: ${line}`),
    });
    let results;
    try {
      results = await runTimingByGroup(
        arms,
        { runs },
        {
          now: () => performance.now(),
          yieldToUi: () => new Promise((r) => setTimeout(r, 0)),
          log: (line) => {
            log(line);
            store.dispatch(A.runProgressed(line));
          },
        },
      );
    } finally {
      guard.end();
    }
    if (guard.wasHidden()) {
      store.dispatch(
        A.failed({
          line: HIDDEN_DURING_RUNS,
          stamped: stamp(`ERROR speed test: ${HIDDEN_DURING_RUNS}`),
        }),
      );
    }
    store.dispatch(
      A.reportSet(
        formatTimingReport({
          startedAt,
          device,
          input: pair.text,
          settings: settingsLine,
          runs,
          results,
          errors: state().errors,
        }),
      ),
    );
    const failed = results.filter((r) => r.error !== null).length;
    return failed === 0
      ? `done: ${String(results.length)} arms: tap Copy log`
      : `done: ${String(results.length)} arms, ${String(failed)} with errors (see the report)`;
  };

  ui.runSpeed.addEventListener("click", () => {
    optionsChanged();
    if (!accepted(A.runStarted("speed"))) {
      return;
    }
    runSpeedOnce()
      .then((text) => {
        log(text);
        finishRun(text, null);
      })
      .catch((e: unknown) => {
        fail("speed test", e);
        finishRun(`failed: ${errorText(e)}`, null);
      });
  });

  ui.copy.addEventListener("click", () => {
    const s = state();
    const text = s.report || logText(s);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        status("copy", "copied");
      })
      .catch(() => {
        ui.report.focus();
        ui.report.select();
        status("copy", "copy blocked: the text is selected, copy it by hand");
      });
  });

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
      stopCamera();
      flat.open();
    } else {
      flat.close();
    }
  };
  ui.pair.addEventListener("change", applyMode);

  window.addEventListener("pagehide", stopCamera);
  store.subscribe(render);
  optionsChanged();
  render();
  log("ready");
  applyMode();
}
