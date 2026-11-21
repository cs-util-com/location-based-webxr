/**
 * The feature matching benchmark page: the guided steps (photo A, photo
 * B, run, save), the camera, the options, the results table, the result
 * pictures and the copyable log. All measuring is in `bench-run.ts`; this
 * file only touches the DOM and browser APIs.
 *
 * @see feature-match-check.ts.md
 */
import { drawMatches, sideBySide } from "./bench-draw";
import {
  allFilesZip,
  assertPlainPng,
  FRAME_FILES,
  framesInfo,
  lightCheck,
  matchesInfo,
  nextPair,
  NO_PAIR,
  PAIRS,
  pairFileNames,
  pairTag,
  parseSpot,
  type LightCheck,
  type PairKey,
  type PairTag,
  type SavedFrame,
} from "./bench-export";
import { BEFORE_YOU_START, PAIR_GUIDE, SPOT_NOTE } from "./bench-guide";
import {
  describeGrey,
  fitInside,
  greyStats,
  makeFrame,
  type Frame,
} from "./bench-image";
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
} from "./bench-report";
import {
  runBenchmark,
  type BenchInput,
  type MethodResult,
  type SizeResult,
} from "./bench-run";
import { formatMs } from "./bench-stats";
import { stepStates, type FlowState } from "./bench-steps";
import { syntheticPair } from "./bench-synthetic";

/** The longest side a captured camera frame is kept at. */
const CAPTURE_MAX = 1280;
const SYNTHETIC_SEED = 1;
/** Canvas width of a result picture at most, in device pixels. */
const PICTURE_MAX_WIDTH = 640;
/** Match lines drawn per picture at most (spread evenly over all). */
const PICTURE_LINE_CAP = 200;
const PICTURE_GAP = 8;
/** Save's label after a camera run that measured nothing. */
const NOTHING_MEASURED = "nothing measured: tap to save the photos anyway";
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

/** The current video frame, shrunk to at most CAPTURE_MAX on its long side. */
function captureFrame(video: HTMLVideoElement): Frame {
  const size = fitInside(
    video.videoWidth,
    video.videoHeight,
    CAPTURE_MAX,
    CAPTURE_MAX,
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("camera: no 2D canvas");
  }
  ctx.drawImage(video, 0, 0, size.width, size.height);
  const img = ctx.getImageData(0, 0, size.width, size.height);
  return makeFrame(size.width, size.height, img.data);
}

/** A frame and its grey values as one log phrase. */
const frameText = (name: string, f: Frame): string =>
  `${name} ${String(f.width)}x${String(f.height)}, ${describeGrey(greyStats(f))}`;

/** A canvas holding the frame's pixels. */
function frameCanvas(f: Frame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("no 2D canvas");
  }
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height),
    0,
    0,
  );
  return canvas;
}

/**
 * A frame as PNG bytes: the canvas encoder writes pixels only (no EXIF,
 * text or time), and assertPlainPng refuses the file if that ever changes.
 */
async function framePng(f: Frame, label: string): Promise<Blob> {
  const canvas = frameCanvas(f);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    throw new Error(`${label}: PNG encoding failed`);
  }
  assertPlainPng(new Uint8Array(await blob.arrayBuffer()), label);
  return blob;
}

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

function chosenSizes(root: ParentNode): number[] {
  return tickedValues(root, "size")
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
}

/** Whether the browser offers WebGPU at all (an adapter may still fail). */
const hasWebGpu = (): boolean =>
  Boolean((navigator as Navigator & { gpu?: unknown }).gpu);

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
    "Photo B is not darker than photo A - the light has to change BETWEEN the two photos. Take this pair again: photo A in normal light, then dim, then photo B.",
  changed:
    "Photo B is more than 20 % brighter or darker than photo A - the light changed during the control pair. Take this pair again without changing the light.",
};

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
  const errors: string[] = [];
  const captures: { a: SavedFrame | null; b: SavedFrame | null } = {
    a: null,
    b: null,
  };
  /** The run on the current camera pair, its results, and the save. */
  let cameraRun: FlowState["run"] = "none";
  let cameraResults: readonly MethodResult[] = [];
  let saved = false;
  /** One action at a time: a run or a save; captures wait for both. */
  let busy: "idle" | "running" | "saving" = "idle";
  /** Blob URLs of the offered files; revoked when they are withdrawn. */
  let savedUrls: string[] = [];
  let stream: MediaStream | null = null;
  /** The camera start in flight, so a second tap does not open a second stream. */
  let starting: Promise<CameraStart> | null = null;
  /** Raised by every stop, so a start still pending learns it was stopped. */
  let cameraGeneration = 0;
  /** Pairs started in this page session; the newest one's number. */
  let sequence = 0;
  /** The pair of the current photos, fixed at photo A. */
  let pairInProgress: PairTag | null = null;
  /** The newest pair whose Download all moved the selector on. */
  let advancedFor = 0;
  /** The current pair's light check, set at photo B; null for other pairs. */
  let light: LightCheck | null = null;

  ui.pair.replaceChildren(
    ...[...PAIRS, NO_PAIR].map((p) => {
      const option = document.createElement("option");
      option.value = p.key;
      option.textContent =
        p.key === NO_PAIR.key
          ? "none: manual run with the Options"
          : `${p.key} ${p.label}`;
      return option;
    }),
  );
  ui.beforeStartList.replaceChildren(...listItems(BEFORE_YOU_START));
  openBeforeStartOnce(ui.beforeStart);

  /** The guidance card follows the selector. */
  const showGuide = (): void => {
    const g = PAIR_GUIDE[ui.pair.value as PairKey] ?? PAIR_GUIDE.x;
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
  ui.pair.addEventListener("change", showGuide);
  showGuide();

  const log = (line: string): void => {
    const t = (performance.now() / 1000).toFixed(1);
    ui.log.textContent += `[${t}s] ${line}\n`;
    ui.log.scrollTop = ui.log.scrollHeight;
  };
  const fail = (where: string, e: unknown): void => {
    const line = `${where}: ${errorText(e)}`;
    errors.push(line);
    log(`ERROR ${line}`);
  };
  window.addEventListener("error", (ev) =>
    fail("page", ev.error ?? ev.message),
  );
  window.addEventListener("unhandledrejection", (ev) =>
    fail("page", ev.reason),
  );

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

  /** Buttons, labels and step marks from the current state. */
  const refresh = (): void => {
    const idle = busy === "idle";
    const pair = captures.a !== null && captures.b !== null;
    ui.captureA.disabled = !idle;
    ui.captureB.disabled = !idle || captures.a === null;
    ui.captureA.textContent = stream ? "Take photo A" : "Start camera";
    ui.captureB.textContent =
      stream || captures.a === null ? "Take photo B" : "Start camera";
    ui.run.disabled = !idle || !pair;
    ui.runSynthetic.disabled = !idle;
    ui.saveFrames.disabled =
      !idle || !pair || (cameraRun !== "done" && cameraRun !== "failed");
    ui.cameraBox.hidden = stream === null;
    const states = stepStates({
      a: captures.a !== null,
      b: captures.b !== null,
      run: cameraRun,
      saved,
    });
    for (const [i, li] of ui.steps.entries()) {
      li.dataset.state = states[i];
      if (states[i] === "current") {
        li.setAttribute("aria-current", "step");
      } else {
        li.removeAttribute("aria-current");
      }
    }
  };

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
    refresh();
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
      refresh();
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
      refresh();
    });
    return starting;
  };

  /** Withdraws the offered files (their URLs revoked). */
  const clearSaved = (state: string): void => {
    for (const u of savedUrls) {
      URL.revokeObjectURL(u);
    }
    savedUrls = [];
    ui.saveLinks.replaceChildren();
    ui.saveState.textContent = state;
    saved = false;
  };

  /**
   * A capture tap: with the camera off it only starts the camera (so the
   * photo is aimed, and not the camera's first frame); with it on it takes
   * the photo. Photo A starts a new pair; photo B starts the run.
   */
  const capture = (which: "a" | "b") => async (): Promise<void> => {
    const state = which === "a" ? ui.stateA : ui.stateB;
    const name = which === "a" ? "A" : "B";
    if (!stream) {
      state.textContent = "starting camera...";
      const started = await startCamera();
      state.textContent =
        started === "on"
          ? `camera on: aim, then tap Take photo ${name}`
          : started === "failed"
            ? "camera unavailable (see log)"
            : "camera stopped: tap again";
      return;
    }
    if (busy !== "idle") {
      return;
    }
    if (ui.video.videoWidth === 0) {
      state.textContent = "camera not ready yet: tap again";
      log("capture: the camera has no picture yet");
      return;
    }
    const f = captureFrame(ui.video);
    captures[which] = {
      name,
      frame: f,
      source: { width: ui.video.videoWidth, height: ui.video.videoHeight },
    };
    log(
      `captured ${name} ${String(f.width)}x${String(f.height)} (camera ${String(ui.video.videoWidth)}x${String(ui.video.videoHeight)}), ${describeGrey(greyStats(f))}`,
    );
    state.textContent = `taken, ${String(f.width)}x${String(f.height)}`;
    cameraRun = "none";
    cameraResults = [];
    clearSaved("after the run");
    light = null;
    ui.lightWarning.hidden = true;
    if (which === "a") {
      sequence++;
      pairInProgress = pairTag(
        ui.pair.value,
        parseSpot(ui.spot.value),
        sequence,
      );
      const t = pairInProgress;
      ui.pairState.textContent = `now: pair ${String(t.sequence)}, ${t.pair} ${t.pairLabel}, spot ${String(t.spot)}`;
      log(
        `pair ${String(t.sequence)}: ${t.pair} ${t.pairLabel}, spot ${String(t.spot)}`,
      );
      captures.b = null;
      ui.stateB.textContent = "not taken";
      ui.runState.textContent = "waiting for photo B";
      refresh();
      return;
    }
    checkLight();
    refresh();
    startRun("camera");
  };

  /**
   * Photo B of a light pair against photo A: a dimmed pair must be darker,
   * the control pair the same. A failed check is shown above the results
   * and keeps the selector on the pair after Download all.
   */
  const checkLight = (): void => {
    const { a, b } = captures;
    if (!a || !b || !pairInProgress) {
      return;
    }
    light = lightCheck(
      pairInProgress.pair,
      greyStats(a.frame).mean,
      greyStats(b.frame).mean,
    );
    if (light === null) {
      return;
    }
    log(`light check: ${light}`);
    if (light !== "ok") {
      ui.lightWarning.textContent = LIGHT_WARNINGS[light];
      ui.lightWarning.hidden = false;
    }
  };

  const saveFiles = async (): Promise<void> => {
    const { a, b } = captures;
    const tag = pairInProgress;
    if (!a || !b || !tag) {
      return;
    }
    const names = pairFileNames(tag);
    const lightResult = light;
    const info = framesInfo(
      [a, b],
      await deviceInfo(),
      CAPTURE_MAX,
      tag,
      lightResult,
    );
    const matches = matchesInfo(cameraResults, { a: a.frame, b: b.frame });
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
    const zip = await allFilesZip(
      files.map(([, name, , blob]) => ({ name, blob })),
      { log: ui.log.textContent ?? "", report: ui.report.value },
    );
    files.unshift([names.all, FRAME_FILES.all, "Download all (zip)", zip]);
    ui.saveLinks.replaceChildren(
      ...files.map(([file, , text, blob]) => {
        const url = URL.createObjectURL(blob);
        savedUrls.push(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = file;
        link.textContent = `${text}, ${formatBytes(blob.size)}`;
        return link;
      }),
    );
    ui.saveLinks.firstElementChild?.addEventListener("click", () => {
      advancePair(tag, lightResult);
    });
  };

  /**
   * After the pair's Download all, the selector moves on to the next pair
   * (once per pair; a second tap saves again but moves nothing). A pair
   * whose light check failed stays selected, to be taken again.
   */
  const advancePair = (tag: PairTag, lightResult: LightCheck | null): void => {
    if (tag.sequence <= advancedFor) {
      return;
    }
    if (lightResult !== null && lightResult !== "ok") {
      advancedFor = tag.sequence;
      ui.pairState.textContent = `saved pair ${String(tag.sequence)}; the light check failed: take ${tag.pair} again`;
      log(`pair kept: take ${tag.pair} again (light check ${lightResult})`);
      return;
    }
    advancedFor = tag.sequence;
    const next = nextPair(tag.pair, tag.spot);
    ui.pair.value = next.key;
    ui.spot.value = String(next.spot);
    showGuide();
    ui.pairState.textContent = `saved pair ${String(tag.sequence)}; next: ${next.key}, spot ${String(next.spot)}`;
    log(`next pair: ${next.key}, spot ${String(next.spot)}`);
  };
  ui.saveFrames.addEventListener("click", () => {
    if (busy !== "idle") {
      return;
    }
    clearSaved("preparing...");
    busy = "saving";
    refresh();
    saveFiles()
      .then(() => {
        saved = true;
        ui.saveState.textContent = `ready: tap Download all (zip), or each file`;
        log("files ready to save");
      })
      .catch((e: unknown) => {
        fail("save", e);
        clearSaved("failed (see log)");
      })
      .finally(() => {
        busy = "idle";
        refresh();
      });
  });
  ui.captureA.addEventListener("click", () => void capture("a")());
  ui.captureB.addEventListener("click", () => void capture("b")());

  const pairOf = (kind: "camera" | "synthetic"): RunPair | null => {
    if (kind === "synthetic") {
      const p = syntheticPair(640, 480, SYNTHETIC_SEED);
      return {
        input: { a: p.a, b: p.b, warp: p.warp },
        text: `synthetic (seed ${String(SYNTHETIC_SEED)}, known warp) ${frameText("A", p.a)}; ${frameText("B", p.b)}`,
      };
    }
    const { a, b } = captures;
    if (!a || !b) {
      fail("input", new Error("take photo A and B first"));
      return null;
    }
    return {
      input: { a: a.frame, b: b.frame, warp: null },
      text: `camera ${frameText("A", a.frame)}; ${frameText("B", b.frame)}`,
    };
  };

  const renderTable = (rows: ReturnType<typeof tableRows>): void => {
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
    state: HTMLElement,
  ): Promise<{ text: string; results: MethodResult[] | null }> => {
    errors.length = 0;
    const pair = pairOf(kind);
    if (!pair) {
      return { text: "not run: no input", results: null };
    }
    // A protocol pair sets runs, warm-up, backend and model file itself.
    const settings = runSettings(
      {
        pair: kind === "camera" ? (pairInProgress?.pair ?? null) : null,
        backends: backendsFrom(tickedValues(root, "backend")),
        precisions: precisionsFrom(tickedValues(root, "model")),
        runs: parseRuns(valueOf(root, "#runs")),
      },
      hasWebGpu(),
    );
    const selection = {
      sift: checked(root, "#m-sift"),
      xfeat: checked(root, "#m-xfeat"),
      aliked: checked(root, "#m-aliked"),
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
    const sizes = chosenSizes(root);
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
    ui.table.replaceChildren();
    ui.pictures.replaceChildren();
    ui.report.value = "";
    if (kind === "synthetic") {
      withdrawCameraRun();
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
          state.textContent = `running: ${line}`;
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
    renderTable(tableRows(results));
    ui.report.value = formatReport({
      startedAt,
      device,
      input: pair.text,
      sizes,
      runs,
      warmup,
      results,
      errors,
    });
    const failed = results.filter(
      (r) => r.error !== null || r.sizes.some((s) => s.error !== null),
    ).length;
    const text =
      failed === 0
        ? `done: ${String(results.length)} methods`
        : `done: ${String(results.length)} methods, ${String(failed)} with errors (see log)`;
    return { text, results };
  };

  /**
   * A synthetic run replaces what Results shows, so the camera run it
   * hides is withdrawn with its offered files: Save must never describe
   * results no longer on screen.
   */
  const withdrawCameraRun = (): void => {
    if (cameraRun !== "done" && cameraRun !== "failed") {
      return;
    }
    cameraRun = "none";
    cameraResults = [];
    clearSaved("after the run");
    ui.runState.textContent = "replaced by the synthetic run: tap Run again";
    refresh();
  };

  /**
   * Runs the benchmark on the camera pair or on the synthetic one. The
   * camera pair's run is step 3; one run or save at a time.
   */
  function startRun(kind: "camera" | "synthetic"): void {
    if (busy !== "idle") {
      return;
    }
    const button = kind === "camera" ? ui.run : ui.runSynthetic;
    const state = kind === "camera" ? ui.runState : ui.syntheticState;
    const idleLabel = button.textContent;
    busy = "running";
    if (kind === "camera") {
      cameraRun = "running";
      cameraResults = [];
      clearSaved("after the run");
    }
    button.textContent = "Running...";
    state.textContent = "running";
    refresh();
    runOnce(kind, state)
      .then(({ text, results }) => {
        state.textContent = text;
        log(text);
        if (kind === "camera") {
          cameraRun = results ? "done" : "failed";
          cameraResults = results ?? [];
          ui.saveState.textContent = results
            ? "ready: tap to prepare the files"
            : NOTHING_MEASURED;
        }
      })
      .catch((e: unknown) => {
        fail("run", e);
        state.textContent = "failed (see log)";
        if (kind === "camera") {
          cameraRun = "failed";
          cameraResults = [];
          ui.saveState.textContent = NOTHING_MEASURED;
        }
      })
      .finally(() => {
        busy = "idle";
        button.textContent = idleLabel;
        refresh();
      });
  }
  ui.run.addEventListener("click", () => startRun("camera"));
  ui.runSynthetic.addEventListener("click", () => startRun("synthetic"));

  ui.copy.addEventListener("click", () => {
    const text = ui.report.value || ui.log.textContent || "";
    navigator.clipboard
      .writeText(text)
      .then(() => {
        ui.copyState.textContent = "copied";
      })
      .catch(() => {
        ui.report.focus();
        ui.report.select();
        ui.copyState.textContent =
          "copy blocked: the text is selected, copy it by hand";
      });
  });

  window.addEventListener("pagehide", stopCamera);
  refresh();
  log("ready");
}
