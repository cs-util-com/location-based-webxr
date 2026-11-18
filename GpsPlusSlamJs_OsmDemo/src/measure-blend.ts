/**
 * The time-of-day blend measurement (`?measure=blend`): a throwaway
 * readout on a spike branch. Once the city has settled it measures what the
 * blend's design decisions rest on (vertex and tree counts, the land-use
 * texture, the device limits, the sky's update paths, a colour upload, the
 * worker-to-page copy against a transfer, a tree colour mix, and a scheme
 * switch's rebuild), then shows one "Copy log" button with a plain-text
 * report, and a selectable text box when the clipboard is refused.
 *
 * @see measure-blend.ts.md
 */

import type * as THREE from "three";

import type { ColourSchemeName } from "./colour-schemes.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** The keyframe looks the blend would bake. */
const K = 4;
/** Runs per timing; the report gives the median. */
const RUNS = 7;
/** Runs per sky timing, enough for a p90. */
const SKY_RUNS = 20;
/** Sun steps of the timelapse across sunset (today's code, no blend). */
const SWEEP_STEPS = 20;
/** Scheme switches timed (alternating). */
const SWITCHES = 6;
/** How long the city must not rebuild before the measurement starts. */
const QUIET_MS = 8000;
/** The longest wait for one switch's mesh. */
const SWITCH_TIMEOUT_MS = 240_000;

export interface BlendMeasureView {
  readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  readonly sync: () => void;
  readonly instanced: () => THREE.InstancedMesh[];
  readonly skyUpdates: (runs: number) => {
    full: number[];
    sun: number[];
    bake: number[];
  };
  readonly lightSettings: (runs: number) => number[];
  readonly sunSweep: (
    fromDeg: number,
    toDeg: number,
    steps: number,
  ) => { elevationDeg: number; ms: number }[];
}

export interface BlendMeasureDeps {
  readonly view: BlendMeasureView;
  /** The scheme the page shows now. */
  readonly scheme: () => ColourSchemeName;
  readonly chooseScheme: (name: ColourSchemeName) => void;
}

export interface BlendMeasure {
  /** Every full mesh the page receives. */
  meshDrawn(mesh: TransferableMesh): void;
}

/** Whether the link asks for the measurement. */
export function blendMeasureRequested(search: string): boolean {
  return new URLSearchParams(search).get("measure") === "blend";
}

/** The q-quantile (nearest rank) of a list; NaN for an empty one. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(q * sorted.length)),
  );
  return sorted[rank - 1]!;
}

/** The median of a non-empty list; NaN for an empty one. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ms(values: readonly number[]): string {
  if (values.length === 0) return "n/a";
  const f = (v: number) => v.toFixed(v < 10 ? 2 : 1);
  return `median ${f(median(values))} ms, p90 ${f(quantile(values, 0.9))} (min ${f(Math.min(...values))}, max ${f(Math.max(...values))}, n ${values.length})`;
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

const sleep = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

interface Panel {
  status(text: string): void;
  done(report: string): void;
}

function mountPanel(): Panel {
  const box = document.createElement("div");
  box.id = "measure-blend";
  Object.assign(box.style, {
    position: "fixed",
    left: "8px",
    right: "8px",
    bottom: "8px",
    zIndex: "100000",
    background: "#111",
    color: "#eee",
    font: "14px/1.4 system-ui, sans-serif",
    padding: "12px",
    borderRadius: "8px",
    maxHeight: "60vh",
    overflow: "auto",
  });
  const status = document.createElement("p");
  status.style.margin = "0 0 8px";
  status.textContent = "Blend measurement: waiting for the city...";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy log";
  button.disabled = true;
  Object.assign(button.style, {
    width: "100%",
    minHeight: "64px",
    fontSize: "22px",
  });
  const text = document.createElement("textarea");
  text.readOnly = true;
  text.hidden = true;
  Object.assign(text.style, {
    width: "100%",
    height: "40vh",
    marginTop: "8px",
  });
  box.append(status, button, text);
  document.body.append(box);
  let report = "";
  const showText = (why: string) => {
    text.hidden = false;
    text.value = report;
    text.focus();
    text.select();
    status.textContent = `${why} Select the text below and copy it.`;
  };
  button.addEventListener("click", () => {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      showText("No clipboard here.");
      return;
    }
    clipboard.writeText(report).then(
      () => {
        status.textContent = "done. Copied: paste it into the chat.";
      },
      () => showText("The clipboard was refused."),
    );
  });
  return {
    status: (line) => {
      status.textContent = `Blend measurement: ${line}`;
    },
    done: (value) => {
      report = value;
      button.disabled = false;
      text.value = value;
      status.textContent = "done. Press Copy log, then paste it into the chat.";
    },
  };
}

/** Starts the measurement; it runs once, after the city has settled. */
export function startBlendMeasure(deps: BlendMeasureDeps): BlendMeasure {
  const panel = mountPanel();
  let latest: TransferableMesh | undefined;
  let lastAt = 0;
  const builds: { scheme: string; cityMs: number; colourMs: number }[] = [];
  let waiter:
    { scheme: string; resolve: (mesh: TransferableMesh) => void } | undefined;
  const measure: BlendMeasure = {
    meshDrawn(mesh) {
      latest = mesh;
      lastAt = performance.now();
      if (mesh.blendMeasure !== undefined) {
        builds.push({
          scheme: mesh.colourScheme ?? "?",
          cityMs: mesh.blendMeasure.buildCityMs,
          colourMs: mesh.blendMeasure.colourFillMs,
        });
      }
      if (waiter !== undefined && mesh.colourScheme === waiter.scheme) {
        const w = waiter;
        waiter = undefined;
        w.resolve(mesh);
      }
    },
  };
  void run().catch((error: unknown) => {
    panel.done(
      `blend measurement FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  });
  return measure;

  async function run(): Promise<void> {
    while (latest === undefined || performance.now() - lastAt < QUIET_MS) {
      await sleep(500);
    }
    const lines: string[] = [];
    const add = (line: string) => lines.push(line);
    const { view } = deps;
    const gl = view.gl;
    const mesh = latest;
    const settledBuilds = builds.length;

    add("== time-of-day blend measurement ==");
    add(`url: ${location.pathname}${location.search}`);
    add(`ua: ${navigator.userAgent}`);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    add(
      `gpu: ${info === null ? "n/a" : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))}`,
    );
    add(
      `webgl2: ${typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext}, dpr ${devicePixelRatio}, drawing buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    );
    add(
      `limits: MAX_VERTEX_UNIFORM_VECTORS ${gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)}, MAX_FRAGMENT_UNIFORM_VECTORS ${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)}, MAX_TEXTURE_SIZE ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}, MAX_VERTEX_ATTRIBS ${gl.getParameter(gl.MAX_VERTEX_ATTRIBS)}`,
    );

    // COUNTS, from the settled mesh.
    const m = mesh.blendMeasure;
    const buildingVertices =
      m === undefined ? Number.NaN : m.chunkVertices - m.barrierVertices;
    const barrierVertices = m?.barrierVertices ?? Number.NaN;
    const roadVertices = m?.roadVertices ?? Number.NaN;
    const vertices = buildingVertices + barrierVertices + roadVertices;
    add(`full builds before settling: ${settledBuilds}`);
    add(
      `vertices: buildings ${buildingVertices}, barriers ${barrierVertices}, roads ${roadVertices}, total ${vertices}`,
    );
    add(
      `  K=${K} attribute bytes: 3 B/vertex/look -> ${mb(vertices * 3 * K)}; 4 B/vertex/look (aligned) -> ${mb(vertices * 4 * K)}; feature index 4 B/vertex -> ${mb(vertices * 4)}`,
    );
    const meshes = view.instanced();
    const instances = meshes.reduce(
      (sum, o) => sum + (o.instanceColor?.count ?? 0),
      0,
    );
    const drawn = meshes.reduce((sum, o) => sum + o.count, 0);
    const form =
      new URLSearchParams(location.search).get("treeform") ?? "crown";
    add(
      `trees: placements mapped ${mesh.trees.length}, invented ${mesh.cosmeticTrees.length}; form ${form}: ${meshes.length} instanced meshes with instance colours, ${instances} instance slots, ${drawn} drawn now`,
    );
    const tint = mesh.groundTint;
    if (tint === undefined) {
      add("land use: no tint in this build");
    } else {
      const texels = tint.width * tint.height;
      add(
        `land use: window ${tint.width}x${tint.height} texels at ${tint.texelM.toFixed(2)} m; class raster ${mb(texels)}; RGBA ${mb(texels * 4)}, with mips ${mb((texels * 4 * 4) / 3)}; two pair textures with mips ${mb((texels * 4 * 4 * 2) / 3)}; class R8 no mips ${mb(texels)} + palette`,
      );
    }

    panel.status("timing the sky...");
    await nextFrame();
    const sky = view.skyUpdates(SKY_RUNS);
    add(
      "sky (each one synchronous call plus a one-pixel GPU read, so queued GPU work is in; the time is the main thread's blocked piece):",
    );
    add(
      `  full-table rebuild + bake, configure({visibilityKm}) + re-derived copies: ${ms(sky.full)}`,
    );
    add(
      `  sun-only rebuild + bake, configure({sunDirection}) + copies: ${ms(sky.sun)}`,
    );
    add(`  bake alone (cloud cover change): ${ms(sky.bake)}`);
    add(
      `  setLightSettings with visibility + sky balance changed: ${ms(view.lightSettings(SKY_RUNS))}`,
    );

    panel.status("timelapse across sunset...");
    await nextFrame();
    const longTasks: number[] = [];
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      observer = undefined;
    }
    const sweep: { elevationDeg: number; ms: number }[] = [];
    for (let i = 0; i < SWEEP_STEPS; i++) {
      // One step per frame, as a timelapse would: 6 to -6 degrees.
      const elevationDeg = 6 - (12 * i) / (SWEEP_STEPS - 1);
      sweep.push(...view.sunSweep(elevationDeg, elevationDeg, 1));
      await nextFrame();
    }
    await sleep(200);
    observer?.disconnect();
    add(
      `timelapse, ${SWEEP_STEPS} sun steps 6 to -6 degrees, one per frame, today's setSunAngles (no blend): ${ms(sweep.map((p) => p.ms))}`,
    );
    add(
      `  per step (elevation deg: blocked ms): ${sweep.map((p) => `${p.elevationDeg.toFixed(1)}: ${p.ms.toFixed(1)}`).join(", ")}`,
    );
    add(
      observer === undefined
        ? "  long tasks: not observable here"
        : `  long tasks over 50 ms during it: ${longTasks.length} (${longTasks.map((d) => d.toFixed(0)).join(", ")} ms)`,
    );

    panel.status("timing uploads...");
    await nextFrame();
    add(
      `upload, bufferSubData + GPU read: ${uploadLine(gl, view.sync, vertices * 3, "one look, 3 B/vertex")}`,
    );
    add(
      `upload, bufferSubData + GPU read: ${uploadLine(gl, view.sync, vertices * 3 * K, `K=${K} looks, 12 B/vertex`)}`,
    );
    add(
      `upload, bufferSubData + GPU read: ${uploadLine(gl, view.sync, vertices * 12, "today's Float32 colours, 12 B/vertex")}`,
    );

    panel.status("timing the worker copy and transfer...");
    const bytes = Math.max(0, Math.round(vertices * 3));
    const copy = await probe(bytes, K, false);
    const moved = await probe(bytes, K, true);
    add(`worker to page, K=${K} buffers of ${mb(bytes)} (post to receipt):`);
    add(`  copied: ${ms(copy)}`);
    add(`  transferred: ${ms(moved)}`);

    panel.status("timing the tree colour mix...");
    add(
      `tree instanceColor mix, K=${K}, ${instances} instances: ${treeMix(meshes, gl, view.sync)}`,
    );

    // SCHEME SWITCHES LAST: each is a full rebuild.
    const home = deps.scheme();
    const away: ColourSchemeName = home === "golden" ? "today" : "golden";
    const switchToMesh: number[] = [];
    const switchToFrame: number[] = [];
    for (let i = 0; i < SWITCHES; i++) {
      const target = i % 2 === 0 ? away : home;
      panel.status(`scheme switch ${i + 1} of ${SWITCHES} (${target})...`);
      const start = performance.now();
      const arrived = new Promise<TransferableMesh>((resolve, reject) => {
        waiter = { scheme: target, resolve };
        setTimeout(
          () =>
            reject(new Error(`no ${target} mesh in ${SWITCH_TIMEOUT_MS} ms`)),
          SWITCH_TIMEOUT_MS,
        );
      });
      deps.chooseScheme(target);
      await arrived;
      switchToMesh.push(performance.now() - start);
      await nextFrame();
      switchToFrame.push(performance.now() - start);
      await sleep(500);
    }
    add(`scheme switch ${home} <-> ${away} (a full worker rebuild):`);
    add(`  choice to mesh on the page: ${ms(switchToMesh)}`);
    add(`  choice to two frames later: ${ms(switchToFrame)}`);
    add(
      "worker city builds (buildCity wall time; colouring = colour choice + vertex fill + linear pass + road colours):",
    );
    for (const scheme of [...new Set(builds.map((b) => b.scheme))]) {
      const own = builds.filter((b) => b.scheme === scheme);
      add(
        `  ${scheme}: buildCity ${ms(own.map((b) => b.cityMs))}; colouring ${ms(own.map((b) => b.colourMs))}`,
      );
    }
    const shares = builds.map((b) => b.colourMs / b.cityMs);
    const city = median(builds.map((b) => b.cityMs));
    const colour = median(builds.map((b) => b.colourMs));
    add(
      `  colouring share of buildCity: median ${(100 * median(shares)).toFixed(1)} % over ${shares.length} builds; a K=${K} build = buildCity + ${K - 1} x colouring = about ${(city + (K - 1) * colour).toFixed(0)} ms (${((city + (K - 1) * colour) / city).toFixed(2)}x)`,
    );
    add("done");
    panel.done(lines.join("\n"));
  }
}

function uploadLine(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  sync: () => void,
  bytes: number,
  label: string,
): string {
  const size = Math.max(4, Math.round(bytes));
  const data = new Uint8Array(size);
  for (let j = 0; j < size; j += 64) data[j] = j & 0xff;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, size, gl.DYNAMIC_DRAW);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    data[0] = i;
    sync();
    const start = performance.now();
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    sync();
    times.push(performance.now() - start);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.deleteBuffer(buffer);
  return `${label}, ${mb(size)}: ${ms(times)}`;
}

/** Post-to-receipt times of `RUNS` worker posts of `k` buffers. */
async function probe(
  bytes: number,
  k: number,
  transfer: boolean,
): Promise<number[]> {
  const worker = new Worker(
    new URL("./measure-blend-worker.ts", import.meta.url),
    { type: "module" },
  );
  const times: number[] = [];
  try {
    for (let i = 0; i < RUNS; i++) {
      const time = await new Promise<number>((resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<{ sentAt?: number; error?: string }>,
        ) => {
          const at = performance.timeOrigin + performance.now();
          if (
            event.data.error !== undefined ||
            event.data.sentAt === undefined
          ) {
            reject(new Error(event.data.error ?? "no stamp"));
            return;
          }
          resolve(at - event.data.sentAt);
        };
        worker.onerror = () => reject(new Error("the probe worker failed"));
        worker.postMessage({ bytes, k, transfer });
      });
      times.push(time);
    }
  } finally {
    worker.terminate();
  }
  return times;
}

/**
 * Mixes K baked colours per instance into every tree's instance colours by
 * four weights (the CPU half), then uploads one mix of that size (the GPU
 * half, its own buffer, synced). Restores the scene's colours.
 */
function treeMix(
  meshes: readonly THREE.InstancedMesh[],
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  sync: () => void,
): string {
  const targets = meshes
    .map((o) => o.instanceColor)
    .filter((a): a is THREE.InstancedBufferAttribute => a !== null);
  const total = targets.reduce((sum, a) => sum + a.count, 0);
  if (total === 0) return "no instances";
  const saved = targets.map((a) => (a.array as Float32Array).slice());
  const baked = targets.map((a) => {
    const out = new Float32Array(a.count * 3 * K);
    for (let i = 0; i < out.length; i++) out[i] = ((i * 37) % 255) / 255;
    return out;
  });
  const cpu: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const w0 = 0.1 + run * 0.01;
    const w = [w0, 0.2, 0.3, 0.7 - w0];
    const start = performance.now();
    targets.forEach((attribute, t) => {
      const out = attribute.array as Float32Array;
      const src = baked[t]!;
      const n = attribute.count;
      for (let i = 0; i < n; i++) {
        const b = i * 3 * K;
        for (let c = 0; c < 3; c++) {
          out[i * 3 + c] =
            w[0]! * src[b + c]! +
            w[1]! * src[b + 3 + c]! +
            w[2]! * src[b + 6 + c]! +
            w[3]! * src[b + 9 + c]!;
        }
      }
      attribute.needsUpdate = true;
    });
    cpu.push(performance.now() - start);
  }
  targets.forEach((attribute, t) => {
    (attribute.array as Float32Array).set(saved[t]!);
    attribute.needsUpdate = true;
  });
  const upload = uploadLine(
    gl,
    sync,
    total * 3 * 4,
    "its instanceColor upload",
  );
  return `CPU mix + write ${ms(cpu)}; ${upload}`;
}
