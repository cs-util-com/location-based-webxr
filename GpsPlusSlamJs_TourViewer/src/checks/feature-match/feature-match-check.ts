/**
 * The feature matching benchmark page: wires the form, the camera, the
 * run button, the results table and the copyable log. All measuring is in
 * `bench-run.ts`; this file only touches the DOM and browser APIs.
 *
 * @see feature-match-check.ts.md
 */
import {
  assertPlainPng,
  FRAME_FILES,
  framesInfo,
  type SavedFrame,
} from "./bench-export";
import {
  describeGrey,
  fitInside,
  greyStats,
  makeFrame,
  type Frame,
} from "./bench-image";
import {
  backendsFor,
  buildMethods,
  parseRuns,
  precisionsFor,
} from "./bench-methods";
import { errorText, formatBytes, type LoadDeps } from "./bench-net";
import {
  formatReport,
  hasJspi,
  tableRows,
  UNKNOWN_DEVICE,
  type DeviceInfo,
} from "./bench-report";
import { runBenchmark, type BenchInput } from "./bench-run";
import { syntheticPair } from "./bench-synthetic";

/** The longest side a captured camera frame is kept at. */
const CAPTURE_MAX = 1280;
const SYNTHETIC_SEED = 1;

const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) {
    throw new Error(`feature-match-check: missing ${sel}`);
  }
  return el;
};

/** The page's elements, found once. */
interface Ui {
  readonly run: HTMLButtonElement;
  readonly runState: HTMLElement;
  readonly log: HTMLElement;
  readonly table: HTMLTableSectionElement;
  readonly report: HTMLTextAreaElement;
  readonly copy: HTMLButtonElement;
  readonly copyState: HTMLElement;
  readonly video: HTMLVideoElement;
  readonly captureA: HTMLButtonElement;
  readonly captureB: HTMLButtonElement;
  readonly captureState: HTMLElement;
  readonly cameraBox: HTMLElement;
  readonly saveFrames: HTMLButtonElement;
  readonly saveState: HTMLElement;
  readonly saveLinks: HTMLElement;
}

function findUi(root: ParentNode): Ui {
  return {
    run: $(root, "#run"),
    runState: $(root, "#run-state"),
    log: $(root, "#log"),
    table: $(root, "#results tbody"),
    report: $(root, "#report"),
    copy: $(root, "#copy"),
    copyState: $(root, "#copy-state"),
    video: $(root, "#video"),
    captureA: $(root, "#capture-a"),
    captureB: $(root, "#capture-b"),
    captureState: $(root, "#capture-state"),
    cameraBox: $(root, "#camera-box"),
    saveFrames: $(root, "#save-frames"),
    saveState: $(root, "#save-state"),
    saveLinks: $(root, "#save-links"),
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

/**
 * A frame as PNG bytes: the canvas encoder writes pixels only (no EXIF,
 * text or time), and assertPlainPng refuses the file if that ever changes.
 */
async function framePng(f: Frame, label: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("save: no 2D canvas");
  }
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(f.rgba), f.width, f.height),
    0,
    0,
  );
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
  root.querySelector<HTMLInputElement | HTMLSelectElement>(sel)?.value ?? "";

function chosenSizes(root: ParentNode): number[] {
  return Array.from(
    root.querySelectorAll<HTMLInputElement>('input[name="size"]:checked'),
  )
    .map((i) => Number(i.value))
    .filter((v) => Number.isFinite(v) && v > 0);
}

/** Starts the page on `root` (the document in the HTML entry). */
export function startFeatureMatchCheck(root: ParentNode = document): void {
  const ui = findUi(root);
  const errors: string[] = [];
  const captures: { a: SavedFrame | null; b: SavedFrame | null } = {
    a: null,
    b: null,
  };
  /** Blob URLs of the offered files; revoked when the captures change. */
  let savedUrls: string[] = [];
  let stream: MediaStream | null = null;
  /** The camera start in flight, so a second tap does not open a second stream. */
  let starting: Promise<boolean> | null = null;

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

  /**
   * Stops the camera: it must not run beside the timed runs (it costs the
   * same CPU and GPU being measured). The next capture starts it again.
   */
  const stopCamera = (): void => {
    if (!stream) {
      return;
    }
    for (const t of stream.getTracks()) {
      t.stop();
    }
    stream = null;
    ui.video.srcObject = null;
    log("camera off");
  };

  /** Starts the camera once; true when it is running. */
  const startCamera = (): Promise<boolean> => {
    if (stream) {
      return Promise.resolve(true);
    }
    starting ??= (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
          },
          audio: false,
        });
        stream = s;
        ui.video.srcObject = s;
        await ui.video.play();
        log("camera on");
        return true;
      } catch (e) {
        fail("camera", e);
        stopCamera();
        return false;
      } finally {
        starting = null;
      }
    })();
    return starting;
  };

  const captureText = (): string =>
    `A: ${captures.a ? "ready" : "-"}, B: ${captures.b ? "ready" : "-"}`;

  const capture = (which: "a" | "b") => async (): Promise<void> => {
    if (!stream) {
      ui.captureState.textContent = "starting camera...";
    }
    if (!(await startCamera())) {
      ui.captureState.textContent = "camera unavailable (see log)";
      return;
    }
    if (ui.video.videoWidth === 0) {
      ui.captureState.textContent = "camera not ready yet: tap again";
      log("capture: the camera has no picture yet");
      return;
    }
    const name = which === "a" ? "A" : "B";
    const f = captureFrame(ui.video);
    captures[which] = {
      name,
      frame: f,
      source: { width: ui.video.videoWidth, height: ui.video.videoHeight },
    };
    log(
      `captured ${name} ${String(f.width)}x${String(f.height)} (camera ${String(ui.video.videoWidth)}x${String(ui.video.videoHeight)}), ${describeGrey(greyStats(f))}`,
    );
    ui.captureState.textContent = captureText();
    clearSaved(captures.a && captures.b ? "" : "capture A and B first");
  };
  const clearSaved = (state: string): void => {
    for (const u of savedUrls) {
      URL.revokeObjectURL(u);
    }
    savedUrls = [];
    ui.saveLinks.replaceChildren();
    ui.saveState.textContent = state;
    ui.saveFrames.disabled = !(captures.a && captures.b);
  };
  const saveFrames = async (): Promise<void> => {
    const { a, b } = captures;
    if (!a || !b) {
      return;
    }
    const info = framesInfo([a, b], await deviceInfo(), CAPTURE_MAX);
    const files: [string, string, Blob][] = [
      [FRAME_FILES.A, "frame A (PNG)", await framePng(a.frame, "frame A")],
      [FRAME_FILES.B, "frame B (PNG)", await framePng(b.frame, "frame B")],
      [
        FRAME_FILES.info,
        "sizes (JSON)",
        new Blob([info], { type: "application/json" }),
      ],
    ];
    ui.saveLinks.replaceChildren(
      ...files.map(([file, text, blob]) => {
        const url = URL.createObjectURL(blob);
        savedUrls.push(url);
        const link = document.createElement("a");
        link.href = url;
        link.download = file;
        link.textContent = `${text}, ${formatBytes(blob.size)}`;
        return link;
      }),
    );
  };
  ui.saveFrames.addEventListener("click", () => {
    clearSaved("preparing...");
    ui.saveFrames.disabled = true;
    saveFrames()
      .then(() => {
        ui.saveState.textContent = "3 files ready: tap each to save";
        log("frames ready to save");
      })
      .catch((e: unknown) => {
        fail("save", e);
        clearSaved("failed (see log)");
      })
      .finally(() => {
        ui.saveFrames.disabled = !(captures.a && captures.b);
      });
  });
  ui.captureA.addEventListener("click", () => void capture("a")());
  ui.captureB.addEventListener("click", () => void capture("b")());

  for (const radio of root.querySelectorAll<HTMLInputElement>(
    'input[name="input"]',
  )) {
    radio.addEventListener("change", () => {
      const camera = valueOf(root, 'input[name="input"]:checked') === "camera";
      ui.cameraBox.hidden = !camera;
      if (camera) {
        void startCamera();
      } else {
        stopCamera();
      }
    });
  }

  const benchInput = (): { input: BenchInput; text: string } | null => {
    if (valueOf(root, 'input[name="input"]:checked') !== "camera") {
      const p = syntheticPair(640, 480, SYNTHETIC_SEED);
      return {
        input: { a: p.a, b: p.b, warp: p.warp },
        text: `synthetic (seed ${String(SYNTHETIC_SEED)}, known warp) ${frameText("A", p.a)}; ${frameText("B", p.b)}`,
      };
    }
    const { a, b } = captures;
    if (!a || !b) {
      fail("input", new Error("capture A and B first"));
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

  const runOnce = async (): Promise<string> => {
    errors.length = 0;
    const chosen = benchInput();
    if (!chosen) {
      return "not run: no input";
    }
    const methods = buildMethods(
      {
        sift: checked(root, "#m-sift"),
        xfeat: checked(root, "#m-xfeat"),
        aliked: checked(root, "#m-aliked"),
        backends: backendsFor(valueOf(root, "#backend")),
        precisions: precisionsFor(valueOf(root, "#precision")),
      },
      browserDeps,
    );
    const sizes = chosenSizes(root);
    if (methods.length === 0 || sizes.length === 0) {
      fail("settings", new Error("choose at least one method and one size"));
      return "not run: nothing chosen";
    }
    const runs = parseRuns(valueOf(root, "#runs"));
    stopCamera();
    const startedAt = new Date().toISOString();
    const device = await deviceInfo();
    log(
      `run: ${String(methods.length)} methods, sizes ${sizes.join("/")}, ${String(runs)} runs`,
    );
    const results = await runBenchmark(
      methods,
      chosen.input,
      { sizes, runs },
      {
        now: () => performance.now(),
        yieldToUi: () => new Promise((r) => setTimeout(r, 0)),
        log,
      },
    );
    renderTable(tableRows(results));
    ui.report.value = formatReport({
      startedAt,
      device,
      input: chosen.text,
      sizes,
      runs,
      results,
      errors,
    });
    const failed = results.filter(
      (r) => r.error !== null || r.sizes.some((s) => s.error !== null),
    ).length;
    return failed === 0
      ? `done: ${String(results.length)} methods`
      : `done: ${String(results.length)} methods, ${String(failed)} with errors (see log)`;
  };

  ui.run.addEventListener("click", () => {
    ui.run.disabled = true;
    ui.run.textContent = "Running...";
    ui.runState.textContent = "running";
    runOnce()
      .then((state) => {
        ui.runState.textContent = state;
        log(state);
      })
      .catch((e: unknown) => {
        fail("run", e);
        ui.runState.textContent = "failed (see log)";
      })
      .finally(() => {
        ui.run.disabled = false;
        ui.run.textContent = "Run benchmark";
      });
  });

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
  log("ready");
}
