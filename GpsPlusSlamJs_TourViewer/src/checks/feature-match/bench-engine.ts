/**
 * The measuring part of the feature matching page, shared by both views:
 * the options, the benchmark runs (on the camera pair, the plan's current
 * pair or the synthetic pair), the speed test, the results table, the
 * result pictures, the report, Copy log and the log. All measuring is in
 * `bench-run.ts` and `bench-timing.ts`; this file only touches the DOM and
 * browser APIs.
 *
 * @see bench-engine.ts.md
 */
import { drawMatches, sideBySide } from "./bench-draw";
import { frameCanvas } from "./bench-dom";
import { describeGrey, greyStats, type Frame } from "./bench-image";
import {
  backendsFrom,
  buildMethods,
  parseRuns,
  precisionsFrom,
  runSettings,
  selectionGaps,
} from "./bench-methods";
import { errorText, type LoadDeps } from "./bench-net";
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
import { syntheticPair } from "./bench-synthetic";
import {
  formatTimingReport,
  parseTimingRuns,
  runTimingByGroup,
  timingBackends,
} from "./bench-timing";
import {
  featureMatchActions as A,
  logText,
  type BenchOptions,
  type FeatureMatchState,
  type SpeedOptions,
} from "./feature-match-slice";
import type { FeatureMatchStore } from "./feature-match-store";
import { planPairOf } from "./guided-model";
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
export const CAPTURE_MAX = 1280;
const SYNTHETIC_SEED = 1;
/** Canvas width of a result picture at most, in device pixels. */
const PICTURE_MAX_WIDTH = 640;
/** Match lines drawn per picture at most (spread evenly over all). */
const PICTURE_LINE_CAP = 200;
const PICTURE_GAP = 8;

/** The input pairs a benchmark run can measure. */
type BenchKind = "camera" | "synthetic" | "plan";

export const $ = <T extends HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) {
    throw new Error(`feature-match-check: missing ${sel}`);
  }
  return el;
};

/** The measuring block's elements, found once. */
interface MeasureUi {
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

const findUi = (root: ParentNode): MeasureUi => ({
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
});

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

/** The pair a run measures, with its text for the report. */
interface RunPair {
  readonly input: BenchInput;
  readonly text: string;
  /** The protocol pair it belongs to, which sets the run's settings. */
  readonly pair: string | null;
}

export interface BenchEngineDeps {
  readonly root: ParentNode;
  readonly fm: FeatureMatchStore;
  readonly log: (line: string) => void;
  readonly fail: (where: string, e: unknown) => void;
  /** A log line with the page time in front. */
  readonly stamp: (line: string) => string;
  /** The view's camera: off while anything is measured. */
  readonly stopCamera: () => void;
}

export interface BenchEngine {
  /** Runs the benchmark on `kind`'s pair; one run or save at a time. */
  startRun(kind: BenchKind): void;
  /** Draws the measuring block from the state. */
  render(): void;
  /** Device facts, or dashes when the browser refuses them. */
  deviceInfo(): Promise<DeviceInfo>;
}

/** Wires the measuring block found under `root`. */
export function startBenchEngine(deps: BenchEngineDeps): BenchEngine {
  const { root, fm, log, fail, stamp, stopCamera } = deps;
  const { store, sides, newId, accepted, put } = fm;
  const ui = findUi(root);
  const state = (): FeatureMatchState => store.getState();

  const deviceInfo = (): Promise<DeviceInfo> =>
    collectDeviceInfo().catch((e: unknown) => {
      log(`device info unavailable: ${errorText(e)}`);
      return UNKNOWN_DEVICE;
    });

  const status = (slot: "copy", text: string): void => {
    store.dispatch(A.statusSet({ slot, text }));
  };

  // --- render -----------------------------------------------------------

  const idleLabels = {
    synthetic: ui.runSynthetic.textContent,
    speed: ui.runSpeed.textContent,
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

  /** What was drawn last, so only what changed is drawn again. */
  let drawn: FeatureMatchState | null = null;

  const render = (): void => {
    const s = state();
    const was = drawn;
    drawn = s;
    const idle = s.busy === "idle";
    ui.runSynthetic.disabled = !idle;
    ui.runSpeed.disabled = !idle;
    ui.runSynthetic.textContent =
      s.running === "synthetic" ? "Running..." : idleLabels.synthetic;
    ui.runSpeed.textContent =
      s.running === "speed" ? "Timing..." : idleLabels.speed;
    ui.syntheticState.textContent = s.status.synthetic;
    ui.speedState.textContent = s.status.speed;
    ui.copyState.textContent = s.status.copy;
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

  // --- runs -------------------------------------------------------------------

  const pairOf = (kind: BenchKind): RunPair | null => {
    if (kind === "synthetic") {
      const p = syntheticPair(640, 480, SYNTHETIC_SEED);
      return {
        input: { a: p.a, b: p.b, warp: p.warp },
        text: `synthetic (seed ${String(SYNTHETIC_SEED)}, known warp) ${frameText("A", p.a)}; ${frameText("B", p.b)}`,
        pair: null,
      };
    }
    const s = state();
    if (kind === "plan") {
      const p = planPairOf(s, sides.frames);
      if (!p) {
        fail("input", new Error("take photo A and B of this pair first"));
        return null;
      }
      return {
        input: { a: p.a.frame, b: p.b.frame, warp: null },
        text: `pair ${p.slot.id} ${frameText("A", p.a.frame)}; ${frameText("B", p.b.frame)}`,
        pair: p.slot.key,
      };
    }
    const a = s.photos.a ? sides.frames.get(s.photos.a.id) : undefined;
    const b = s.photos.b ? sides.frames.get(s.photos.b.id) : undefined;
    if (!a || !b) {
      fail("input", new Error("take photo A and B first"));
      return null;
    }
    return {
      input: { a: a.frame, b: b.frame, warp: null },
      text: `camera ${frameText("A", a.frame)}; ${frameText("B", b.frame)}`,
      pair: s.pairInProgress?.pair ?? null,
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
    kind: BenchKind,
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
        pair: pair.pair,
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
    if (kind !== "camera") {
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

  /** Ends the run in progress; a photo pair's results are kept beside the state. */
  const finishRun = (text: string, results: MethodResult[] | null): void => {
    const kind = state().running;
    const resultsId =
      results && (kind === "camera" || kind === "plan")
        ? newId("results")
        : null;
    put(
      sides.results,
      resultsId && results ? [[resultsId, results]] : [],
      A.runFinished({ text, resultsId }),
    );
  };

  function startRun(kind: BenchKind): void {
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
  ui.runSynthetic.addEventListener("click", () => startRun("synthetic"));

  /** One of `allowed` by its text, else `fallback`. */
  const pickNumber = <T extends number>(
    allowed: readonly T[],
    text: string,
    fallback: T,
  ): T => allowed.find((v) => String(v) === text) ?? fallback;

  /** The speed test's pair: the camera pair, else the plan's, else synthetic. */
  const speedPair = (): RunPair | null => {
    const s = state();
    if (s.photos.a !== null && s.photos.b !== null) {
      return pairOf("camera");
    }
    return pairOf(planPairOf(s, sides.frames) ? "plan" : "synthetic");
  };

  /**
   * The speed test: the ticked arms per backend on a photo pair when one
   * is taken, else on the synthetic pair; its report replaces the report
   * text, so a camera run it hides is withdrawn first.
   */
  const runSpeedOnce = async (): Promise<string> => {
    store.dispatch(A.errorsCleared());
    const pair = speedPair();
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

  optionsChanged();
  return { startRun, render, deviceInfo };
}
