/**
 * The worker spike page (`feature-match-check.html?spike=worker`,
 * throwaway, deleted with the worker queue): do the measuring methods load
 * and run in a module worker, with the same numbers as on the main thread,
 * while the camera preview stays smooth? Every number goes to one log with
 * a Copy log button.
 *
 * @see worker-spike.ts.md
 */
import { nearestRankPercentile } from "gps-plus-slam-app-framework/utils/percentile";

import type { Backend } from "./bench-methods";
import { errorText } from "./bench-net";
import type { RunContext } from "./bench-run";
import { syntheticPair } from "./bench-synthetic";
import { cosine } from "./dino-io";
import {
  contextFacts,
  runCell,
  SPIKE_FRAME,
  type CellRequest,
  type CellResult,
  type SpikeMethod,
} from "./worker-spike-cells";
import type { SpikeAsk } from "./worker-spike.worker";

/** The smoothness rule: p95 and p99 within this factor of the baseline. */
const GAP_FACTOR = 1.25;
/** ... and no single gap above this. */
const GAP_CAP_MS = 250;
/** Counts may differ this much on WebGPU (float order); none on WASM. */
const WEBGPU_COUNT_TOL = 0.02;
const DINO_MIN_COSINE = 0.9999;
/** The other values each rule is also read at. */
const FACTOR_RANGE = [1.1, 1.25, 1.5];
const CAP_RANGE = [150, 250, 400];
const TOL_RANGE = [0, 0.01, 0.02, 0.05];

const BASELINE_MS = 10_000;
const RUNS = 5;
/** Desktop Chrome's measured time for the phone set, times 4. */
const PHONE_MINUTES = "about 10";

interface SpikeSet {
  readonly name: "full" | "phone";
  readonly methods: readonly SpikeMethod[];
  readonly contexts: readonly RunContext[];
  readonly cameraOff: boolean;
}

const SETS: Record<SpikeSet["name"], SpikeSet> = {
  full: {
    name: "full",
    methods: ["sift", "xfeat", "aliked", "siftlg", "dino"],
    contexts: ["main thread", "worker"],
    cameraOff: true,
  },
  phone: {
    name: "phone",
    methods: ["sift", "xfeat", "aliked"],
    contexts: ["worker"],
    cameraOff: false,
  },
};

interface Gaps {
  readonly gaps: readonly number[];
  readonly streamFps: number;
}

interface CellRecord {
  readonly kind: "timed" | "cold" | "second";
  readonly backend: Backend;
  readonly context: RunContext;
  readonly camera: boolean;
  readonly result: CellResult | null;
  readonly error: string | null;
  readonly gaps: Gaps | null;
}

/** The answer of a worker request, or its error. */
interface WorkerClient {
  call<T>(ask: SpikeAsk): Promise<T>;
  close(): void;
}

function spawnWorker(log: (line: string) => void): WorkerClient {
  const worker = new Worker(
    new URL("./worker-spike.worker.ts", import.meta.url),
    { type: "module" },
  );
  let next = 0;
  const held = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as {
      id: number;
      line?: string;
      result?: unknown;
      error?: string;
    };
    if (m.line !== undefined) {
      log(`  ${m.line}`);
      return;
    }
    const h = held.get(m.id);
    held.delete(m.id);
    if (m.error !== undefined) {
      h?.reject(new Error(m.error));
    } else {
      h?.resolve(m.result);
    }
  };
  worker.onerror = (ev) => {
    for (const h of held.values()) {
      h.reject(new Error(`worker crashed: ${ev.message}`));
    }
    held.clear();
  };
  return {
    call<T>(ask: SpikeAsk): Promise<T> {
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        held.set(id, { resolve: resolve as (v: unknown) => void, reject });
        worker.postMessage({ ...ask, id });
      });
    },
    close: () => worker.terminate(),
  };
}

/**
 * Records the gaps between the video's frame callbacks on the main thread
 * (what a stall of the page shows as) and the stream's own frame rate
 * (presented frames, which the compositor counts even through a stall).
 */
function recordGaps(video: HTMLVideoElement): () => Gaps {
  const gaps: number[] = [];
  let last: number | null = null;
  let first: { t: number; n: number } | null = null;
  let latest: { t: number; n: number } | null = null;
  let on = true;
  const tick = (now: number, meta: VideoFrameCallbackMetadata) => {
    if (!on) {
      return;
    }
    if (last !== null) {
      gaps.push(now - last);
    }
    last = now;
    first ??= { t: now, n: meta.presentedFrames };
    latest = { t: now, n: meta.presentedFrames };
    video.requestVideoFrameCallback(tick);
  };
  video.requestVideoFrameCallback(tick);
  return () => {
    on = false;
    if (last !== null) {
      gaps.push(performance.now() - last);
    }
    const span = first && latest ? (latest.t - first.t) / 1000 : 0;
    return {
      gaps,
      streamFps: first && latest && span > 0 ? (latest.n - first.n) / span : 0,
    };
  };
}

const pct = (v: readonly number[], p: number): number =>
  v.length === 0 ? NaN : nearestRankPercentile(v, p);
const ms = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : "-");

function gapStats(g: Gaps) {
  return {
    p95: pct(g.gaps, 0.95),
    p99: pct(g.gaps, 0.99),
    max: g.gaps.length === 0 ? NaN : Math.max(...g.gaps),
  };
}

const smooth = (g: Gaps, base: Gaps, factor: number, cap: number): boolean => {
  const s = gapStats(g);
  const b = gapStats(base);
  return s.p95 <= factor * b.p95 && s.p99 <= factor * b.p99 && s.max <= cap;
};

function gapLine(g: Gaps, base: Gaps | null): string {
  const s = gapStats(g);
  let line = `  frames: ${String(g.gaps.length)} gaps, p95 ${ms(s.p95)} p99 ${ms(s.p99)} max ${ms(s.max)} ms, stream ${g.streamFps.toFixed(1)} fps`;
  if (base) {
    const range = FACTOR_RANGE.map(
      (f) =>
        `x${String(f)} ${CAP_RANGE.map((c) => (smooth(g, base, f, c) ? "Y" : "n")).join("")}`,
    ).join(" ");
    line += ` | smooth ${smooth(g, base, GAP_FACTOR, GAP_CAP_MS) ? "PASS" : "FAIL"} (x${String(GAP_FACTOR)}, cap ${String(GAP_CAP_MS)}); range caps ${CAP_RANGE.join("/")}: ${range}`;
  }
  return line;
}

function cellLines(r: CellRecord): string[] {
  const head = `[${r.kind}] ${r.backend} / ${r.context} / camera ${r.camera ? "on" : "off"}`;
  if (!r.result) {
    return [`${head}: ERROR ${r.error ?? "?"}`];
  }
  const out = [`${head}: ${(r.result.ms / 1000).toFixed(1)} s`];
  for (const m of r.result.methods) {
    if (m.error) {
      out.push(`  ${m.id}: ERROR ${m.error}`);
      continue;
    }
    out.push(
      `  ${m.id} on ${m.backend}: init ${ms(m.initMs)} ms, downloads ${ms(m.downloadMs)} ms cached [${m.cached.map(String).join(",")}]`,
    );
    for (const s of m.sizes) {
      out.push(
        s.error
          ? `    @${String(s.longEdge)} ERROR ${s.error}`
          : `    @${String(s.longEdge)} kp ${String(s.keypoints)} matches ${String(s.matches)} extract ${ms(s.extractMs)} match ${ms(s.matchMs)} ms`,
      );
    }
  }
  const d = r.result.dino;
  if (d) {
    out.push(
      d.error
        ? `  dinov2-int8-${d.backend}: ERROR ${d.error}`
        : `  dinov2-int8-${d.backend}: init ${ms(d.initMs)} ms, forward ${ms(d.forwardMs)} ms, cached ${String(d.cached)}, embedding[0..2] ${(
            d.embedding ?? []
          )
            .slice(0, 3)
            .map((v) => v.toFixed(5))
            .join(" ")}`,
    );
  }
  return out;
}

/** Worker against main thread, camera off, per backend: counts and DINOv2. */
function equalityLines(records: readonly CellRecord[]): string[] {
  const out: string[] = [];
  const find = (b: Backend, c: RunContext) =>
    records.find(
      (r) =>
        r.kind === "timed" &&
        r.backend === b &&
        r.context === c &&
        !r.camera &&
        r.result,
    )?.result;
  for (const backend of ["webgpu", "wasm"] as const) {
    const main = find(backend, "main thread");
    const work = find(backend, "worker");
    if (!main || !work) {
      out.push(`  ${backend}: no pair of main-thread and worker cells`);
      continue;
    }
    const tol = backend === "wasm" ? 0 : WEBGPU_COUNT_TOL;
    for (const m of main.methods) {
      const w = work.methods.find((x) => x.id === m.id);
      if (!w || m.error || w.error) {
        out.push(
          `  ${m.id}: not compared (main ${m.error ?? "ok"}, worker ${w?.error ?? (w ? "ok" : "missing")})`,
        );
        continue;
      }
      let worst = 0;
      for (const s of m.sizes) {
        const ws = w.sizes.find((x) => x.longEdge === s.longEdge);
        if (!ws || s.error || ws.error) {
          worst = Infinity;
          continue;
        }
        for (const [a, b] of [
          [s.keypoints, ws.keypoints],
          [s.matches, ws.matches],
        ] as const) {
          worst = Math.max(worst, Math.abs(a - b) / Math.max(1, a));
        }
      }
      const range = TOL_RANGE.map(
        (t) => `${String(t * 100)}% ${worst <= t ? "Y" : "n"}`,
      ).join(" ");
      out.push(
        `  ${m.id}: largest count difference ${(worst * 100).toFixed(2)} % -> ${worst <= tol ? "PASS" : "FAIL"} (tolerance ${String(tol * 100)} %); range ${range}`,
      );
    }
    const dm = main.dino?.embedding;
    const dw = work.dino?.embedding;
    if (main.dino || work.dino) {
      if (dm && dw) {
        const c = cosine(Float32Array.from(dm), Float32Array.from(dw));
        out.push(
          `  dinov2-int8-${backend}: embedding cosine ${c.toFixed(6)} -> ${c >= DINO_MIN_COSINE ? "PASS" : "FAIL"} (>= ${String(DINO_MIN_COSINE)})`,
        );
      } else {
        out.push(
          `  dinov2-int8-${backend}: not compared (main ${main.dino?.error ?? "ok"}, worker ${work.dino?.error ?? "ok"})`,
        );
      }
    }
  }
  return out;
}

/** The main thread's longest animation-frame gap while `work` runs. */
async function longestFrameGap<T>(
  work: () => Promise<T>,
): Promise<{ value: T; ms: number; longestGap: number }> {
  let longest = 0;
  let last = performance.now();
  let on = true;
  const tick = (now: number) => {
    longest = Math.max(longest, now - last);
    last = now;
    if (on) {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  const value = await work();
  const took = performance.now() - t0;
  on = false;
  longest = Math.max(longest, performance.now() - last);
  return { value, ms: took, longestGap: longest };
}

/** Starts the spike on the page: replaces the body with its own view. */
export function startWorkerSpike(doc: Document = document): void {
  const params = new URLSearchParams(location.search);
  const set = SETS[params.get("set") === "full" ? "full" : "phone"];
  doc.title = "Feature matching: worker spike";
  const body = doc.body;
  body.replaceChildren();
  body.style.cssText = "font: 14px/1.4 system-ui, sans-serif; margin: 12px;";
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
  ): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    e.textContent = text;
    body.append(e);
    return e;
  };
  el("h1", "Worker spike").style.fontSize = "1.2rem";
  el(
    "p",
    set.name === "phone"
      ? `Tap Run and keep the page open: it takes ${PHONE_MINUTES} minutes, plus the first download of about 66 MB of models. Then tap Copy log and paste it in the chat.`
      : "The full set: every method, main thread and worker, camera off and on.",
  );
  const run = el("button", "Run");
  const copy = el("button", "Copy log");
  const state = el("span");
  state.setAttribute("aria-live", "polite");
  const video = el("video");
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = "display: block; width: 240px; margin: 8px 0;";
  const pre = el("pre");
  pre.id = "spike-log";
  pre.style.cssText = "white-space: pre-wrap; font-size: 12px;";
  const t0 = performance.now();
  const log = (line: string) => {
    pre.textContent += `[${((performance.now() - t0) / 1000).toFixed(1)}s] ${line}\n`;
  };

  copy.addEventListener("click", () => {
    state.textContent = "copying...";
    navigator.clipboard.writeText(pre.textContent ?? "").then(
      () => {
        state.textContent = "copied";
      },
      (e: unknown) => {
        state.textContent = `copy failed (${errorText(e)}): select the log by hand`;
      },
    );
  });

  let stream: MediaStream | null = null;
  const cameraOn = async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: SPIKE_FRAME.width },
        height: { ideal: SPIKE_FRAME.height },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    const s = stream.getVideoTracks()[0]?.getSettings();
    log(
      `camera on: ${String(s?.width)}x${String(s?.height)} at ${String(s?.frameRate)} fps`,
    );
  };
  const cameraOff = () => {
    for (const t of stream?.getTracks() ?? []) {
      t.stop();
    }
    stream = null;
    video.srcObject = null;
  };

  run.addEventListener("click", () => {
    run.disabled = true;
    state.textContent = "running...";
    runAll(set, video, log, cameraOn, cameraOff).then(
      () => {
        state.textContent = "done: tap Copy log";
        body.dataset.spike = "done";
      },
      (e: unknown) => {
        log(`ERROR spike: ${errorText(e)}`);
        state.textContent = "failed: tap Copy log";
        body.dataset.spike = "done";
      },
    );
  });
}

async function runAll(
  set: SpikeSet,
  video: HTMLVideoElement,
  log: (line: string) => void,
  cameraOn: () => Promise<void>,
  cameraOff: () => void,
): Promise<void> {
  const started = performance.now();
  log(`set ${set.name}: methods ${set.methods.join(", ")}`);
  log(`user agent: ${navigator.userAgent}`);
  const mainFacts = await contextFacts();
  log(`main thread: webgpu ${mainFacts.webgpu}; ${mainFacts.threads}`);
  const probe = spawnWorker(log);
  const workerFacts = await probe.call<typeof mainFacts>({ kind: "facts" });
  probe.close();
  log(`worker: webgpu ${workerFacts.webgpu}; ${workerFacts.threads}`);
  const backends = (["webgpu", "wasm"] as const).filter(
    (b) =>
      b === "wasm" ||
      (workerFacts.webgpu === "adapter" &&
        (mainFacts.webgpu === "adapter" ||
          !set.contexts.includes("main thread"))),
  );
  if (!backends.includes("webgpu")) {
    log("webgpu cells skipped: none (no adapter)");
  }
  const methodsFor = (b: Backend): SpikeMethod[] =>
    set.methods.filter((m) => m !== "sift" || b === "wasm");

  const records: CellRecord[] = [];
  const measure = async (
    kind: CellRecord["kind"],
    backend: Backend,
    context: RunContext,
    camera: boolean,
    cell: CellRequest,
    worker: WorkerClient | null,
    base: Gaps | null,
  ): Promise<void> => {
    log(
      `start ${kind} ${backend} / ${context} / camera ${camera ? "on" : "off"}`,
    );
    const stop = camera ? recordGaps(video) : null;
    let result: CellResult | null = null;
    let error: string | null = null;
    try {
      result = worker
        ? await worker.call<CellResult>({ kind: "cell", cell })
        : await runCell(cell, context, (l) => log(`  ${l}`));
    } catch (e) {
      error = errorText(e);
    }
    const gaps = stop ? stop() : null;
    const rec = { kind, backend, context, camera, result, error, gaps };
    records.push(rec);
    for (const line of cellLines(rec)) {
      log(line);
    }
    if (gaps) {
      log(gapLine(gaps, base));
    }
  };

  // Baseline: the camera on and nothing running.
  await cameraOn();
  const stopBase = recordGaps(video);
  await new Promise((r) => setTimeout(r, BASELINE_MS));
  const base = stopBase();
  log(`baseline (camera on, worker idle, ${String(BASELINE_MS / 1000)} s):`);
  log(gapLine(base, null));

  // Cold: a fresh worker, one pair with the queue's settings, then a
  // second pair in the same worker (what it caches, what init costs again).
  for (const backend of backends) {
    const worker = spawnWorker(log);
    try {
      for (const [kind, seed] of [
        ["cold", 1],
        ["second", 2],
      ] as const) {
        await measure(
          kind,
          backend,
          "worker",
          true,
          {
            backend,
            methods: methodsFor(backend),
            runs: 1,
            warmup: false,
            seed,
          },
          worker,
          base,
        );
      }
    } finally {
      worker.close();
    }
  }

  // Timed cells: 1 warm-up and RUNS runs; one worker for all of them.
  const worker = spawnWorker(log);
  try {
    const timed = async (camera: boolean) => {
      for (const context of set.contexts) {
        for (const backend of backends) {
          await measure(
            "timed",
            backend,
            context,
            camera,
            {
              backend,
              methods: methodsFor(backend),
              runs: RUNS,
              warmup: true,
              seed: 1,
            },
            context === "worker" ? worker : null,
            camera ? base : null,
          );
        }
      }
    };
    await timed(true);
    await pngCheck(worker, log);
    cameraOff();
    log("camera off");
    if (set.cameraOff) {
      await timed(false);
    }
  } finally {
    worker.close();
    cameraOff();
  }

  if (set.contexts.includes("main thread")) {
    log("worker against main thread (camera off):");
    for (const line of equalityLines(records)) {
      log(line);
    }
  }
  log(
    `SPIKE-DONE in ${((performance.now() - started) / 60_000).toFixed(1)} min`,
  );
}

/** One 1280 frame encoded to PNG on the main thread, decoded in the worker. */
async function pngCheck(
  worker: WorkerClient,
  log: (line: string) => void,
): Promise<void> {
  const { width, height } = SPIKE_FRAME;
  const { a } = syntheticPair(width, height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    log("png: ERROR no 2d context");
    return;
  }
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(a.rgba), width, height),
    0,
    0,
  );
  const enc = await longestFrameGap(
    () =>
      new Promise<Blob | null>((r) => {
        canvas.toBlob(r, "image/png");
      }),
  );
  const off = new OffscreenCanvas(width, height);
  off
    .getContext("2d")
    ?.putImageData(
      new ImageData(new Uint8ClampedArray(a.rgba), width, height),
      0,
      0,
    );
  const offEnc = await longestFrameGap(() =>
    off.convertToBlob({ type: "image/png" }),
  );
  log(
    `png encode ${String(width)}x${String(height)}: canvas.toBlob ${ms(enc.ms)} ms (longest main-thread frame gap ${ms(enc.longestGap)} ms), OffscreenCanvas.convertToBlob ${ms(offEnc.ms)} ms (gap ${ms(offEnc.longestGap)} ms), ${String(enc.value?.size ?? 0)} bytes`,
  );
  if (!enc.value) {
    log("png: ERROR toBlob gave null");
    return;
  }
  try {
    const rt = await worker.call<{ ms: number; differing: number }>({
      kind: "png",
      png: enc.value,
      rgba: a.rgba,
      width,
      height,
    });
    log(
      `png round trip in the worker: decode ${ms(rt.ms)} ms, ${String(rt.differing)} bytes differ -> ${rt.differing === 0 ? "PASS" : "FAIL"}`,
    );
  } catch (e) {
    log(`png round trip: ERROR ${errorText(e)}`);
  }
}
