/**
 * The worker spike page (`feature-match-check.html?spike=worker`): does
 * the camera preview stay smooth while the photo test's measuring worker
 * measures photo pairs, and can XFeat start in a module worker? One Start
 * button; a progress bar, the time left and a plain status line while it
 * runs; a result card and a Copy log button at the end. The rules and the
 * words are `worker-spike-model.ts`, the run status is the store's
 * (`worker-spike-slice.ts`); this module measures and draws.
 *
 * @see worker-spike.ts.md
 */
import { copyWithFeedback } from "gps-plus-slam-app-framework/utils/copy-with-feedback";

import { sleep } from "../../sleep.js";
import { captureFrame, framePng } from "./bench-dom";
import { CAPTURE_MAX } from "./bench-engine";
import { errorText } from "./bench-net";
import type { MethodResult } from "./bench-run";
import { createCameraControl } from "./camera-control";
import {
  createMeasureClient,
  WorkerCrashed,
  type MeasureWorker,
} from "./measure-client";
import type { MeasureJob } from "./measure-protocol";
import { guardRun } from "./run-guard";
import {
  cameraVerdict,
  GAP_CAP_MS,
  GAP_FACTOR,
  gapStats,
  methodTimes,
  planMinutes,
  plainError,
  spikePlanFrom,
  spikeProgress,
  spikeSummary,
  verdictSweep,
  xfeatOutcome,
  xfeatTimedOut,
  XFEAT_LIMIT_MS,
  type GapStats,
  type SpikePlan,
  type SpikeStep,
  type XFeatOutcome,
} from "./worker-spike-model";
import {
  createWorkerSpikeStore,
  workerSpikeActions as A,
  type WorkerSpikeState,
} from "./worker-spike-slice";

/** The methods the measuring worker runs here: the plan's phone subset. */
const METHODS: MeasureJob["methods"] = {
  sift: true,
  aliked: true,
  siftLightGlue: false,
};
/** The live verdict reads the last minute of gaps at 30 fps, not the run. */
const LIVE_GAPS = 1800;

const VIEW = `
<section id="spike" class="screen run spike" data-phase="starting">
  <header class="run-head spike-head" hidden>
    <div class="progress">
      <span id="spike-step" class="head-pos"></span>
      <span class="bar"><span id="spike-bar"></span></span>
    </div>
    <span id="spike-left" class="spike-left"></span>
  </header>
  <div class="card spike-card">
    <div id="spike-intro">
      <p class="kicker">Feature matching</p>
      <h1>Background measuring test</h1>
      <p id="spike-intro-text" class="lede"></p>
    </div>
    <p id="spike-status" class="spike-status" aria-live="polite"></p>
    <p id="spike-keep" class="hint" hidden>
      Keep this page open and the screen on until the result shows.
    </p>
    <div id="spike-error" class="spike-error" role="alert" hidden>
      <p id="spike-error-msg" class="spike-error-msg"></p>
      <p id="spike-error-todo"></p>
    </div>
    <div id="spike-result" hidden>
      <p class="kicker">Result</p>
      <div id="spike-notice" class="spike-error" role="alert" hidden>
        <p id="spike-notice-msg" class="spike-error-msg"></p>
        <p id="spike-notice-todo"></p>
      </div>
      <dl class="spike-answers">
        <div id="spike-camera-row">
          <dt>Camera smooth while the worker measured?</dt>
          <dd id="spike-camera"></dd>
        </div>
        <div id="spike-xfeat-row">
          <dt>XFeat in a background worker</dt>
          <dd id="spike-xfeat"></dd>
        </div>
        <div>
          <dt>Time per method</dt>
          <dd><ul id="spike-methods" class="spike-methods"></ul></dd>
        </div>
      </dl>
      <p class="hint">Tap Copy log and paste it in the chat.</p>
    </div>
    <details id="spike-log-box" class="spike-log" hidden>
      <summary>Show the full log</summary>
      <pre id="spike-log"></pre>
    </details>
  </div>
  <div class="finder">
    <video id="spike-video" playsinline muted></video>
    <div class="finder-chips">
      <span id="spike-cam-chip" class="chip dim"></span>
    </div>
  </div>
  <div class="spike-actions">
    <button id="spike-start" type="button" class="primary big">Start</button>
    <button id="spike-copy" type="button" class="primary big" hidden>
      Copy log
    </button>
    <button id="spike-retry" type="button" class="secondary big" hidden>
      Try again
    </button>
  </div>
</section>`;

/** An error's stack for the log (never for the screen). */
const stackOf = (e: unknown): string =>
  e instanceof Error && e.stack ? e.stack : errorText(e);

const msText = (v: number): string =>
  Number.isFinite(v) ? `${v.toFixed(1)} ms` : "-";

const gapLine = (g: GapStats): string =>
  `${String(g.count)} frame gaps, p95 ${msText(g.p95)}, p99 ${msText(g.p99)}, max ${msText(g.max)}`;

/** The gaps between the frames the video shows, in ms, per window. */
interface GapRecorder {
  /** The last `LIVE_GAPS` gaps since the last `take`, kept. */
  peek(): number[];
  /** The gaps since the last `take`; starts a new window. */
  take(): number[];
  stop(): void;
}

function recordGaps(video: HTMLVideoElement): GapRecorder {
  let gaps: number[] = [];
  let last: number | null = null;
  let on = typeof video.requestVideoFrameCallback === "function";
  const tick = (now: number): void => {
    if (!on) {
      return;
    }
    if (last !== null) {
      gaps.push(now - last);
    }
    last = now;
    video.requestVideoFrameCallback(tick);
  };
  if (on) {
    video.requestVideoFrameCallback(tick);
  }
  return {
    peek: () => gaps.slice(-LIVE_GAPS),
    take: () => {
      const out = gaps;
      gaps = [];
      return out;
    },
    stop: () => {
      on = false;
    },
  };
}

/** The probe gave no answer within its limit. */
class ProbeTimeout extends Error {}

/** The page's parts the run uses. */
interface RunDeps {
  readonly store: ReturnType<typeof createWorkerSpikeStore>;
  readonly video: HTMLVideoElement;
  readonly plan: SpikePlan;
  readonly log: (line: string) => void;
}

/** Starts the spike: replaces the page's body with its own view. */
export function startWorkerSpike(doc: Document = document): void {
  const plan = spikePlanFrom(location.search);
  const store = createWorkerSpikeStore(plan);
  doc.title = "Feature matching: background measuring test";
  // The view's look is the guided view's (`guided-view.css`).
  doc.documentElement.dataset.ui = "guided";
  const holder = doc.createElement("div");
  holder.innerHTML = VIEW;
  doc.body.replaceChildren(...holder.childNodes);
  const $ = <T extends HTMLElement>(id: string): T => {
    const el = doc.getElementById(id);
    if (!el) {
      throw new Error(`worker spike: no #${id}`);
    }
    return el as T;
  };
  const root = $("spike");
  const video = $<HTMLVideoElement>("spike-video");
  const start = $<HTMLButtonElement>("spike-start");
  const copy = $<HTMLButtonElement>("spike-copy");
  const retry = $<HTMLButtonElement>("spike-retry");
  $("spike-intro-text").textContent =
    `This test checks whether the camera preview stays smooth while the phone measures photo pairs in the background, and whether XFeat can run there. It takes about ${String(planMinutes(plan))} minutes, plus a first download of about 65 MB of models. Point the camera at something with lots of detail (a bookshelf, a plant, a poster) and hold the phone still or move it slowly.`;

  const t0 = performance.now();
  const log = (line: string): void => {
    store.dispatch(
      A.logged(`[${((performance.now() - t0) / 1000).toFixed(1)}s] ${line}`),
    );
  };
  window.addEventListener("error", (ev) => {
    log(`ERROR page: ${stackOf(ev.error ?? ev.message)}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    log(`ERROR page: ${stackOf(ev.reason)}`);
  });

  const camera = createCameraControl(video, {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    log,
    fail: (where, e) => {
      log(`ERROR ${where}: ${stackOf(e)}`);
      store.dispatch(A.cameraFailed(plainError("camera", e)));
    },
    changed: () => undefined,
  });
  window.addEventListener("pagehide", camera.stop);

  const render = (): void => {
    draw(doc, root, store.getState(), performance.now());
  };
  store.subscribe(render);
  // The time left counts down between store changes too.
  setInterval(() => {
    if (store.getState().phase === "running") {
      render();
    }
  }, 1000);
  render();

  start.addEventListener("click", () => {
    store.dispatch(A.runStarted(performance.now()));
    if (store.getState().phase !== "running") {
      return;
    }
    runSpike({ store, video, plan, log }).then(
      (crashed) => {
        camera.stop();
        if (crashed) {
          log("the measuring worker stopped during the run");
        }
      },
      (e: unknown) => {
        camera.stop();
        log(`ERROR run: ${stackOf(e)}`);
        store.dispatch(A.runFailed(plainError("page", e)));
      },
    );
  });
  copy.addEventListener("click", () => {
    const write = navigator.clipboard?.writeText.bind(navigator.clipboard);
    void copyWithFeedback(copy, store.getState().log.join("\n"), write, {
      busy: "Copying...",
      done: "Copied",
      failed: "Copy failed: copy the log below by hand",
      onFailed: () => {
        const box = $<HTMLDetailsElement>("spike-log-box");
        box.open = true;
        doc.getSelection()?.selectAllChildren($("spike-log"));
      },
    });
  });
  retry.addEventListener("click", () => {
    location.reload();
  });

  log(`worker spike: ${navigator.userAgent}`);
  log(
    `cores ${String(navigator.hardwareConcurrency)}, memory ${String((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? "-")} GB, ${crossOriginIsolated ? "isolated" : "not isolated"}`,
  );
  log(
    `plan: baseline ${String(plan.baselineMs / 1000)} s, ${String(plan.pairs)} pairs, sizes ${plan.sizes.join("/")}, methods sift+aliked in the measuring worker, then XFeat in its own worker; smooth = p95 and p99 at most ${String(GAP_FACTOR)}x the baseline and no gap over ${String(GAP_CAP_MS)} ms`,
  );
  void camera.start().then((r) => {
    if (r === "on") {
      const s =
        video.srcObject instanceof MediaStream
          ? video.srcObject.getVideoTracks()[0]?.getSettings()
          : undefined;
      log(
        `camera: ${String(s?.width ?? video.videoWidth)}x${String(s?.height ?? video.videoHeight)} at ${String(s?.frameRate ?? "-")} fps`,
      );
      store.dispatch(A.cameraOn());
    }
  });
}

/**
 * The run: the camera at rest, the photos, every pair in the measuring
 * worker, then XFeat in its own worker. Resolves whether the measuring
 * worker crashed; rejects only on a page error.
 */
async function runSpike(d: RunDeps): Promise<boolean> {
  const { store, video, plan, log } = d;
  const now = () => performance.now();
  const step = (s: SpikeStep): void => {
    store.dispatch(A.stepBegan({ step: s, now: now() }));
  };
  const guard = guardRun({
    doc: document,
    wakeLock: "wakeLock" in navigator ? navigator.wakeLock : undefined,
    log,
  });
  const gaps = recordGaps(video);
  if (typeof video.requestVideoFrameCallback !== "function") {
    log("no requestVideoFrameCallback: frame gaps cannot be measured");
  }
  let crashed = false;
  const started = now();
  try {
    // 1. The camera at rest, nothing else running.
    gaps.take();
    await sleep(plan.baselineMs);
    const base = gapStats(gaps.take());
    log(`baseline (camera at rest): ${gapLine(base)}`);

    // 2. The photos, as the photo test takes them.
    step({ kind: "photos", taken: 0 });
    const shots: Blob[] = [];
    for (let i = 0; i < 2 * plan.pairs; i++) {
      await sleep(plan.photoGapMs);
      const frame = captureFrame(video, CAPTURE_MAX);
      const t = now();
      shots.push(await framePng(frame, `photo ${String(i + 1)}`));
      log(
        `photo ${String(i + 1)}: ${String(frame.width)}x${String(frame.height)}, PNG encoded on the main thread in ${msText(now() - t)}`,
      );
      store.dispatch(A.photoTaken());
    }
    log(`while taking photos: ${gapLine(gapStats(gaps.take()))}`);

    // 3. Every pair in the photo test's measuring worker.
    step({ kind: "pairs", done: 0 });
    // The URL is written inside `new Worker(...)`: only that form makes
    // the build bundle the worker (a separate URL ships its raw source).
    const client = createMeasureClient(
      () =>
        new Worker(
          new URL("./feature-match-measure.worker.ts", import.meta.url),
          { type: "module" },
        ) as unknown as MeasureWorker,
    );
    const pairs: MethodResult[][] = [];
    const live = setInterval(() => {
      store.dispatch(A.liveVerdict(cameraVerdict(gapStats(gaps.peek()), base)));
    }, 1000);
    try {
      for (let i = 0; i < plan.pairs; i++) {
        const name = `pair ${String(i + 1)}`;
        const t = now();
        // Only a measured pair feeds the time estimate: a fast failure
        // would make every later pair look quick.
        let ms: number | null = null;
        try {
          const done = await client.measure(jobOf(shots, i, plan), (line) =>
            log(`${name}: ${line}`),
          );
          ms = now() - t;
          pairs.push([...done.results]);
          log(
            `${name}: done in ${msText(now() - t)}, measuring ${msText(done.measureMs)}`,
          );
        } catch (e) {
          crashed ||= e instanceof WorkerCrashed;
          log(`ERROR ${name}: ${stackOf(e)}`);
        }
        store.dispatch(A.pairMeasured({ ms, now: now() }));
      }
    } finally {
      clearInterval(live);
      client.close();
    }
    const run = gapStats(gaps.take());
    log(`while the worker measured: ${gapLine(run)}`);
    log(
      `camera verdict: ${cameraVerdict(run, base)}; ${verdictSweep(run, base)}`,
    );

    // 4. XFeat in its own module worker.
    step({ kind: "xfeat" });
    const xfeat = await tryXFeat(shots, plan, log);
    log(`while XFeat was tried: ${gapLine(gapStats(gaps.take()))}`);

    const result = spikeSummary({
      run,
      base,
      xfeat,
      methods: methodTimes(pairs),
      workerCrashed: crashed,
      hidden: guard.wasHidden(),
    });
    log(`RESULT camera smooth: ${result.camera.text}`);
    log(`RESULT XFeat in a worker: ${result.xfeat.text}`);
    for (const m of result.methods) {
      log(`RESULT ${m.label} (${m.backend}): ${m.text}`);
    }
    if (result.notice) {
      log(`RESULT note: ${result.notice.message}`);
    }
    log(`SPIKE-DONE in ${((now() - started) / 60_000).toFixed(1)} min`);
    store.dispatch(A.finished(result));
    return crashed;
  } finally {
    gaps.stop();
    guard.end();
  }
}

/** Pair `i` of the photos, as the photo test's queue sends a pair. */
function jobOf(shots: readonly Blob[], i: number, plan: SpikePlan): MeasureJob {
  return {
    a: shots[2 * i]!,
    b: shots[2 * i + 1]!,
    turn: null,
    methods: METHODS,
    sizes: plan.sizes,
    pair: "worker-spike",
  };
}

/** XFeat on the first pair in its own module worker, with a time limit. */
async function tryXFeat(
  shots: readonly Blob[],
  plan: SpikePlan,
  log: (line: string) => void,
): Promise<XFeatOutcome> {
  const client = createMeasureClient(
    () =>
      new Worker(new URL("./xfeat-probe.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as MeasureWorker,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ProbeTimeout(
          `the worker did not answer in ${String(XFEAT_LIMIT_MS / 1000)} s`,
        ),
      );
    }, XFEAT_LIMIT_MS);
  });
  try {
    const done = await Promise.race([
      client.measure(jobOf(shots, 0, plan), (line) => log(`xfeat: ${line}`)),
      late,
    ]);
    for (const r of done.results) {
      log(`xfeat: ${r.label} on ${r.backend}: ${r.error ?? "ran"}`);
    }
    return xfeatOutcome(done.results, null);
  } catch (e) {
    log(`ERROR xfeat: ${stackOf(e)}`);
    return e instanceof ProbeTimeout
      ? xfeatTimedOut(XFEAT_LIMIT_MS / 1000)
      : xfeatOutcome(null, errorText(e));
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

const show = (el: HTMLElement, on: boolean): void => {
  el.hidden = !on;
};

/** Draws the state; the only place that writes the view. */
function draw(
  doc: Document,
  root: HTMLElement,
  s: WorkerSpikeState,
  now: number,
): void {
  const $ = (id: string): HTMLElement => doc.getElementById(id)!;
  const running = s.phase === "running";
  const ended = s.phase === "done" || s.phase === "failed";
  root.dataset.phase = s.phase;
  show(root.querySelector(".spike-head")!, running);
  show($("spike-intro"), !running && !ended);
  show($("spike-keep"), running);
  show($("spike-start"), !running && !ended);
  ($("spike-start") as HTMLButtonElement).disabled = s.phase !== "ready";
  show($("spike-copy"), ended);
  show($("spike-retry"), s.phase === "failed" || s.result?.notice != null);
  show($("spike-log-box"), ended);
  show(root.querySelector(".finder")!, !ended);

  const status = $("spike-status");
  const chip = $("spike-cam-chip");
  chip.textContent = s.phase === "starting" ? "Starting camera..." : "";
  show(chip, s.phase === "starting");
  if (s.phase === "starting") {
    status.textContent = "Starting the camera...";
  } else if (s.phase === "ready") {
    status.textContent = "Ready. Tap Start when the camera shows the detail.";
  } else if (running && s.step !== null) {
    const p = spikeProgress({
      plan: s.plan,
      step: s.step,
      stepStartedAt: s.stepStartedAt,
      pairMs: s.pairMs,
      live: s.live,
      now,
    });
    status.textContent = p.status;
    $("spike-step").textContent = `Step ${String(p.step)} of ${String(p.of)}`;
    $("spike-bar").style.width = `${(p.fraction * 100).toFixed(1)}%`;
    $("spike-left").textContent = p.left;
  } else {
    status.textContent = "";
  }
  show(status, status.textContent !== "");

  show($("spike-error"), s.error !== null);
  if (s.error) {
    $("spike-error-msg").textContent = s.error.message;
    $("spike-error-todo").textContent = s.error.todo;
  }
  show($("spike-result"), s.result !== null);
  if (s.result) {
    const r = s.result;
    show($("spike-notice"), r.notice !== null);
    $("spike-notice-msg").textContent = r.notice?.message ?? "";
    $("spike-notice-todo").textContent = r.notice?.todo ?? "";
    $("spike-camera").textContent = r.camera.text;
    $("spike-camera-row").dataset.good =
      r.camera.verdict === "unknown"
        ? ""
        : String(r.camera.verdict === "smooth");
    $("spike-xfeat").textContent = r.xfeat.text;
    $("spike-xfeat-row").dataset.good =
      r.xfeat.started === null ? "" : String(r.xfeat.started);
    const list = $("spike-methods");
    list.replaceChildren(
      ...r.methods.map((m) => {
        const li = doc.createElement("li");
        const b = doc.createElement("strong");
        // The label already names the runtime; the backend goes to the log.
        b.textContent = m.label;
        li.append(b, `: ${m.text}`);
        return li;
      }),
    );
    if (r.methods.length === 0) {
      list.textContent = "No pair was measured.";
    }
  }
  if (ended) {
    $("spike-log").textContent = s.log.join("\n");
  }
}
