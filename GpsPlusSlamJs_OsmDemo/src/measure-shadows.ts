/**
 * The building-shadow measurement (`?measure=shadows`): a throwaway runner
 * on a spike branch. Once the city has settled it times cached sun shadows
 * on the city (one map, or a near plus a far map) through the page's real
 * sun slider and frame loop, logs the device limits, sweeps the knobs the
 * shadow design rests on, and shows one "Copy log" button with a
 * plain-text report (a selectable text box when the clipboard is refused).
 *
 * @see measure-shadows.ts.md
 */

import * as THREE from "three";
import { enableSunShadows } from "gps-plus-slam-app-framework/visualization/sun-shadow";

import type { BuildingView } from "./building-view.js";
import { LOOK_CHOICES, TIME_OF_DAY, type LookChoice } from "./look-choice.js";
import {
  SPIKE_DEFAULT,
  SpikeShadows,
  nearHalfWidth,
  type SpikeConfig,
  type SpikeUpdate,
  type SpikeWorld,
} from "./measure-shadows-rig.js";
import type { TransferableMesh } from "./worker/protocol.js";

/** How long the city must not rebuild before the measurement starts. */
const QUIET_MS = 8000;
/** Slider steps per whole-step timing. */
const W_STEPS = 20;
/** Forced map renders per configuration and elevation. */
const FORCED_RUNS = 12;
/** Frames per ABAB block. */
const BLOCK_FRAMES = 30;
/** ABAB blocks per side. */
const BLOCKS = 4;
/** Frames per scripted pan. */
const PAN_FRAMES = 120;
/** The budgets every band verdict is reported at. */
const BUDGETS = [33, 50, 60] as const;
const STEP_TIMEOUT_MS = 4000;
const SWITCH_TIMEOUT_MS = 240_000;
const DEG = Math.PI / 180;

type Handles = ReturnType<BuildingView["shadowSpikeHandles"]>;
type CityMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.Material | THREE.Material[]
>;

export interface ShadowMeasureDeps {
  readonly handles: Handles;
  readonly hooks: BuildingView["shadowSpikeHooks"];
  readonly slider: HTMLInputElement;
  readonly scheme: () => LookChoice;
  readonly chooseScheme: (name: LookChoice) => void;
}

export interface ShadowMeasure {
  /** Every full mesh the page receives. */
  meshDrawn(mesh: TransferableMesh): void;
}

export function shadowMeasureRequested(search: string): boolean {
  return new URLSearchParams(search).get("measure") === "shadows";
}

// --- numbers ---------------------------------------------------------------

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil(q * sorted.length)),
  );
  return sorted[rank - 1]!;
}

const ms = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(1) : "n/a";

function line(label: string, values: readonly number[]): string {
  return (
    `${label}: p50 ${ms(quantile(values, 0.5))} p90 ${ms(quantile(values, 0.9))}` +
    ` p95 ${ms(quantile(values, 0.95))} min ${ms(Math.min(...values))}` +
    ` max ${ms(Math.max(...values))} n ${values.length}`
  );
}

const sleep = (waitMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, waitMs));

function withTimeout<T>(
  promise: Promise<T>,
  waitMs: number,
): Promise<T | null> {
  return Promise.race([promise, sleep(waitMs).then(() => null)]);
}

// --- frames and sun steps --------------------------------------------------

interface FrameSample {
  readonly ms: number;
  readonly near: boolean;
  readonly far: boolean;
  readonly again: boolean;
  readonly calls: number;
  readonly triangles: number;
}

interface StepResult {
  readonly handlerMs: number;
  readonly frames: FrameSample[];
}

interface StepState {
  t0: number;
  handlerMs: number | null;
  readonly frames: FrameSample[];
  readonly done: (result: StepResult) => void;
}

const NO_UPDATE: SpikeUpdate = { near: false, far: false, again: false };

/** The hooks' side: frame samples, sun-step timings, the spike's inputs. */
class Probe {
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  panUntilMs = 0;
  trailingNext = false;
  recording: FrameSample[] | null = null;
  private frameT0 = 0;
  private update: SpikeUpdate = NO_UPDATE;
  private step: StepState | undefined;
  private waiters: ((sample: FrameSample) => void)[] = [];

  constructor(
    private readonly h: Handles,
    private readonly spike: SpikeShadows,
  ) {}

  install(hooks: BuildingView["shadowSpikeHooks"]): void {
    this.h.renderer.info.autoReset = false;
    const sun = this.h.sun;
    this.sunDir.copy(sun.position).sub(sun.target.position).normalize();
    hooks.frameStart = () => {
      this.h.renderer.info.reset();
      this.frameT0 = performance.now();
    };
    hooks.beforeRender = () => this.beforeRender();
    hooks.frameEnd = () => this.frameEnd();
    hooks.sunStepStart = () => this.stepStart();
    hooks.sunStepEnd = (d) => {
      this.sunDir.set(d.x, d.y, d.z).normalize();
    };
  }

  /** Resolves on the next frame's end. */
  nextFrame(): Promise<FrameSample> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.h.requestFrame();
    });
  }

  /** Resolves when the next sun step and its frames are done. */
  armStep(): Promise<StepResult | null> {
    const promise = new Promise<StepResult>((done) => {
      this.step = { t0: -1, handlerMs: null, frames: [], done };
    });
    return withTimeout(promise, STEP_TIMEOUT_MS).then((result) => {
      if (result === null) this.step = undefined;
      return result;
    });
  }

  private beforeRender(): void {
    const now = performance.now();
    const target = this.h.controls.target;
    const trailing = this.trailingNext;
    this.trailingNext = false;
    this.update = this.spike.update({
      sunDir: this.sunDir,
      target,
      cameraDistanceM: this.h.camera.position.distanceTo(target),
      nowMs: now,
      panning: now < this.panUntilMs,
      trailing,
    });
  }

  private frameEnd(): void {
    this.h.sync();
    const info = this.h.renderer.info.render;
    const sample: FrameSample = {
      ms: performance.now() - this.frameT0,
      ...this.update,
      calls: info.calls,
      triangles: info.triangles,
    };
    this.update = NO_UPDATE;
    this.recording?.push(sample);
    if (sample.again) this.h.requestFrame();
    this.stepFrame(sample);
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(sample);
  }

  private stepStart(): void {
    const step = this.step;
    if (step === undefined || step.t0 >= 0) return;
    step.t0 = performance.now();
    queueMicrotask(() => {
      this.h.sync();
      step.handlerMs = performance.now() - step.t0;
    });
  }

  private stepFrame(sample: FrameSample): void {
    const step = this.step;
    if (step?.handlerMs == null) return;
    step.frames.push(sample);
    if (sample.again) return;
    this.step = undefined;
    step.done({ handlerMs: step.handlerMs, frames: step.frames });
  }
}

// --- the scene -------------------------------------------------------------

interface Casting {
  readonly trees: boolean;
  readonly side: THREE.Side | null;
}

const DEFAULT_CASTING: Casting = { trees: false, side: null };

function isBuilding(mesh: CityMesh): boolean {
  return mesh.geometry.getAttribute("aHeight01") !== undefined;
}

function isTree(mesh: CityMesh): boolean {
  return (
    mesh instanceof THREE.InstancedMesh &&
    mesh.userData["sharedResources"] !== true &&
    mesh.userData["cityLayer"] !== "furniture"
  );
}

function setShadowSide(mesh: CityMesh, side: THREE.Side | null): void {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  for (const material of materials) material.shadowSide = side;
}

/** Every mesh under the city root, typed once. */
function cityMeshes(h: Handles): CityMesh[] {
  const meshes: CityMesh[] = [];
  h.cityRoot.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object as CityMesh);
  });
  return meshes;
}

/** Buildings cast (trees too when asked); everything in the city receives. */
function applyCasting(h: Handles, casting: Casting, receive = true): void {
  h.ground.receiveShadow = receive;
  for (const mesh of cityMeshes(h)) {
    mesh.receiveShadow = receive;
    const building = isBuilding(mesh);
    mesh.castShadow = building || (casting.trees && isTree(mesh));
    if (building) setShadowSide(mesh, casting.side);
  }
}

interface Counts {
  buildings: number;
  buildingTriangles: number;
  trees: number;
  treeInstances: number;
  meshes: number;
}

function triangles(mesh: CityMesh): number {
  const geometry = mesh.geometry;
  const count =
    geometry.index?.count ?? geometry.getAttribute("position").count;
  return count / 3;
}

function countCity(h: Handles): Counts {
  const counts: Counts = {
    buildings: 0,
    buildingTriangles: 0,
    trees: 0,
    treeInstances: 0,
    meshes: 0,
  };
  for (const mesh of cityMeshes(h)) {
    counts.meshes += 1;
    if (isBuilding(mesh)) {
      counts.buildings += 1;
      counts.buildingTriangles += triangles(mesh);
    } else if (mesh instanceof THREE.InstancedMesh && isTree(mesh)) {
      counts.trees += 1;
      counts.treeInstances += mesh.count;
    }
  }
  return counts;
}

function buildingTop(h: Handles): number {
  const box = new THREE.Box3();
  let top = 0;
  for (const mesh of cityMeshes(h)) {
    if (!isBuilding(mesh)) continue;
    box.setFromObject(mesh);
    top = Math.max(top, box.max.y);
  }
  return top;
}

function worldOf(h: Handles): SpikeWorld {
  h.cityRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(h.cityRoot);
  const centre = box.getCenter(new THREE.Vector3());
  centre.y = h.ground.position.y;
  const halfExtentM =
    Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  return {
    centre,
    halfExtentM: Math.max(200, halfExtentM),
    maxHeightM: Math.max(10, buildingTop(h) - centre.y),
  };
}

// --- the run's context -----------------------------------------------------

interface Ctx {
  readonly deps: ShadowMeasureDeps;
  readonly h: Handles;
  readonly probe: Probe;
  readonly spike: SpikeShadows;
  readonly out: string[];
  readonly status: (text: string) => void;
  readonly view: { target: THREE.Vector3; offset: THREE.Vector3 };
  casting: Casting;
  shadowsReady: boolean;
}

function log(ctx: Ctx, text: string): void {
  ctx.out.push(text);
}

/** The page's view as it was when the run started, at a given distance. */
async function setView(
  ctx: Ctx,
  target: THREE.Vector3,
  distanceM?: number,
): Promise<void> {
  const offset = ctx.view.offset.clone();
  if (distanceM !== undefined) offset.setLength(distanceM);
  ctx.h.controls.target.copy(target);
  ctx.h.camera.position.copy(target).add(offset);
  ctx.h.controls.update();
  await ctx.probe.nextFrame();
}

/** Shadows on in `config` (null: off). */
function useConfig(ctx: Ctx, config: SpikeConfig | null): void {
  if (config === null) {
    ctx.spike.disable();
    return;
  }
  if (!ctx.shadowsReady) {
    enableSunShadows(ctx.h.renderer);
    ctx.shadowsReady = true;
  }
  ctx.spike.configure(config);
  if (!ctx.spike.enabled) ctx.spike.enable();
  applyCasting(ctx.h, ctx.casting);
}

async function setSunElevation(
  ctx: Ctx,
  elevationDeg: number,
): Promise<StepResult | null> {
  const step = ctx.probe.armStep();
  const now = ctx.h.sunAngles();
  ctx.h.setSunAngles({
    elevationRad: elevationDeg * DEG,
    azimuthRad: now.azimuthRad,
  });
  return step;
}

async function sliderStep(ctx: Ctx, value: number): Promise<StepResult | null> {
  const step = ctx.probe.armStep();
  ctx.deps.slider.value = String(value);
  ctx.deps.slider.dispatchEvent(new Event("input"));
  return step;
}

async function frames(ctx: Ctx, count: number): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  for (let i = 0; i < count; i += 1) samples.push(await ctx.probe.nextFrame());
  return samples;
}

/** Frames until no map renders for a few frames (a pending re-centre or split). */
async function settle(ctx: Ctx): Promise<FrameSample[]> {
  const samples: FrameSample[] = [];
  let quiet = 0;
  while (quiet < 4 && samples.length < 60) {
    const sample = await ctx.probe.nextFrame();
    samples.push(sample);
    quiet = sample.near || sample.far ? 0 : quiet + 1;
  }
  return samples;
}

// --- configurations --------------------------------------------------------

const cfg = (patch: Partial<SpikeConfig>): SpikeConfig => ({
  ...SPIKE_DEFAULT,
  ...patch,
});

const C1_2048 = cfg({ shape: "one", nearSize: 2048 });
const C1_1024 = cfg({ shape: "one", nearSize: 1024 });
const C2_2048 = cfg({});
const C2_SPLIT = cfg({ split: true });
const C2_1024 = cfg({ nearSize: 1024, farSize: 1024 });
const C2_2048_1024 = cfg({ farSize: 1024 });

const W_CONFIGS: readonly [string, SpikeConfig | null][] = [
  ["W0 shadows off", null],
  ["C1 one map 2048", C1_2048],
  ["C1 one map 1024 (low)", C1_1024],
  ["C2 near 2048 far 2048, one frame", C2_2048],
  ["C2 near 2048 far 2048, split frames", C2_SPLIT],
  ["C2 near 2048 far 1024, one frame", C2_2048_1024],
  ["C2 near 1024 far 1024, one frame", C2_1024],
  [
    "C2 near 1024 far 1024, split frames",
    cfg({ nearSize: 1024, farSize: 1024, split: true }),
  ],
];

// --- sections --------------------------------------------------------------

function deviceInfo(ctx: Ctx): void {
  const gl = ctx.h.renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu =
    debug === null
      ? "hidden"
      : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  const canvas = ctx.h.renderer.domElement;
  log(ctx, `ua: ${navigator.userAgent}`);
  log(ctx, `gpu: ${gpu}`);
  log(
    ctx,
    `canvas: ${canvas.width}x${canvas.height} dpr ${window.devicePixelRatio} pixelRatio ${ctx.h.renderer.getPixelRatio()}`,
  );
  log(
    ctx,
    `limits: MAX_TEXTURE_SIZE ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}` +
      ` MAX_FRAGMENT_UNIFORM_VECTORS ${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)}` +
      ` MAX_VARYING_VECTORS ${gl.getParameter(gl.MAX_VARYING_VECTORS)}` +
      ` MAX_TEXTURE_IMAGE_UNITS ${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}`,
  );
}

function sceneInfo(ctx: Ctx): void {
  const c = countCity(ctx.h);
  const w = ctx.spike.world;
  log(
    ctx,
    `city: meshes ${c.meshes} building chunks ${c.buildings} building triangles ${Math.round(c.buildingTriangles)}` +
      ` tree meshes ${c.trees} tree instances ${c.treeInstances}`,
  );
  log(
    ctx,
    `world: centre ${w.centre.x.toFixed(0)},${w.centre.z.toFixed(0)} half extent ${w.halfExtentM.toFixed(0)} m` +
      ` tallest ${w.maxHeightM.toFixed(0)} m; camera distance ${ctx.view.offset.length().toFixed(0)} m`,
  );
}

async function baseline(ctx: Ctx): Promise<FrameSample[]> {
  useConfig(ctx, null);
  const samples = await frames(ctx, 40);
  log(
    ctx,
    line(
      "frame, shadows off (no sun step)",
      samples.map((s) => s.ms),
    ),
  );
  return samples;
}

function linkErrors(ctx: Ctx): number {
  const programs = ctx.h.renderer.info.programs ?? [];
  return programs.filter(
    (p) =>
      (p as { diagnostics?: { runnable: boolean } }).diagnostics?.runnable ===
      false,
  ).length;
}

async function compileTimes(ctx: Ctx): Promise<void> {
  const t0 = performance.now();
  useConfig(ctx, C1_2048);
  const first = await ctx.probe.nextFrame();
  log(
    ctx,
    `compile C1 (first frame with one shadow, synchronous): ${ms(performance.now() - t0)} ms (frame ${ms(first.ms)})`,
  );
  const t1 = performance.now();
  useConfig(ctx, C2_2048);
  await ctx.h.renderer.compileAsync(ctx.h.scene, ctx.h.camera);
  const hold = performance.now() - t1;
  const after = await ctx.probe.nextFrame();
  const flag = hold > 2000 ? " OVER 2 s" : "";
  log(
    ctx,
    `compile C2 (compileAsync hold): ${ms(hold)} ms${flag}; first frame after ${ms(after.ms)} ms; programs ${ctx.h.renderer.info.programs?.length ?? 0} link errors ${linkErrors(ctx)}`,
  );
}

function depthBits(ctx: Ctx): void {
  const map = ctx.h.sun.shadow.map;
  if (map === null) {
    log(ctx, "depth bits: no map yet");
    return;
  }
  const renderer = ctx.h.renderer;
  const gl = renderer.getContext();
  renderer.setRenderTarget(map as THREE.WebGLRenderTarget);
  const bits = gl.getFramebufferAttachmentParameter(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    0x8216, // FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE (WebGL2)
  ) as number;
  renderer.setRenderTarget(null);
  log(ctx, `shadow map FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE: ${bits}`);
}

async function forcedRenders(
  ctx: Ctx,
  label: string,
  config: SpikeConfig,
): Promise<void> {
  useConfig(ctx, config);
  await ctx.probe.nextFrame();
  const render: number[] = [];
  let calls = 0;
  let tris = 0;
  for (let i = 0; i < FORCED_RUNS; i += 1) {
    ctx.spike.forget();
    const sample = await ctx.probe.nextFrame();
    render.push(sample.ms);
    calls = sample.calls;
    tris = sample.triangles;
  }
  const cached = (await frames(ctx, 10)).map((s) => s.ms);
  log(
    ctx,
    `${line(`  ${label} map frame`, render)}; cached frame p50 ${ms(quantile(cached, 0.5))}; calls ${calls} triangles ${tris}`,
  );
}

async function forcedSection(ctx: Ctx): Promise<void> {
  const configs: [string, SpikeConfig][] = [
    ["C1 2048", C1_2048],
    ["C1 1024", C1_1024],
    ["C2 2048/2048", C2_2048],
    ["C2 2048/1024", C2_2048_1024],
    ["C2 1024/1024", C2_1024],
  ];
  for (const elevation of [40, 10, 3]) {
    await setSunElevation(ctx, elevation);
    log(ctx, `forced renders at sun ${elevation} deg (both maps when C2):`);
    for (const [label, config] of configs) {
      ctx.status(`forced renders ${label} at ${elevation} deg`);
      await forcedRenders(ctx, label, config);
    }
  }
  await setSunElevation(ctx, 10);
  for (const [label, casting] of [
    ["trees cast", { trees: true, side: null }],
    ["DoubleSide shadowSide", { trees: false, side: THREE.DoubleSide }],
  ] as const) {
    ctx.casting = casting;
    await forcedRenders(ctx, `C2 2048/2048, ${label}, 10 deg`, C2_2048);
  }
  ctx.casting = DEFAULT_CASTING;
}

interface WRun {
  readonly label: string;
  readonly w: number[];
  readonly handler: number[];
  readonly first: number[];
  readonly second: number[];
}

function wOf(step: StepResult): number {
  return step.handlerMs + step.frames.reduce((sum, f) => sum + f.ms, 0);
}

async function measureW(
  ctx: Ctx,
  label: string,
  config: SpikeConfig | null,
): Promise<WRun> {
  useConfig(ctx, config);
  const result: WRun = { label, w: [], handler: [], first: [], second: [] };
  await sliderStep(ctx, 380);
  await sleep(120);
  for (let i = 0; i < W_STEPS; i += 1) {
    const step = await sliderStep(ctx, 400 + i * 10);
    await sleep(80);
    if (step === null) continue;
    result.w.push(wOf(step));
    result.handler.push(step.handlerMs);
    result.first.push(step.handlerMs + (step.frames[0]?.ms ?? 0));
    if (step.frames[1] !== undefined) result.second.push(step.frames[1].ms);
  }
  log(ctx, line(`W ${label}`, result.w));
  log(ctx, `  ${line("handler (sky, light, atmosphere)", result.handler)}`);
  if (result.second.length > 0) {
    log(ctx, `  ${line("split: handler + first frame", result.first)}`);
    log(ctx, `  ${line("split: second frame", result.second)}`);
  }
  return result;
}

async function wSection(ctx: Ctx, mode: string): Promise<Map<string, WRun>> {
  const runs = new Map<string, WRun>();
  log(ctx, `--- whole sun step W (slider, ${mode}) ---`);
  for (const [label, config] of W_CONFIGS) {
    ctx.status(`W ${label} (${mode})`);
    runs.set(label, await measureW(ctx, label, config));
  }
  ctx.status(`W trees cast (${mode})`);
  ctx.casting = { trees: true, side: null };
  runs.set("trees", await measureW(ctx, "C2 2048/2048, trees cast", C2_2048));
  ctx.casting = DEFAULT_CASTING;
  return runs;
}

async function drag(ctx: Ctx, from: number): Promise<number> {
  for (let i = 0; i < 40; i += 1) {
    ctx.deps.slider.value = String(from + i * 2);
    ctx.deps.slider.dispatchEvent(new Event("input"));
    await sleep(16);
  }
  await sleep(350);
  ctx.probe.trailingNext = true;
  const trailing = await ctx.probe.nextFrame();
  await settle(ctx);
  return trailing.ms;
}

async function cadenceSection(ctx: Ctx): Promise<void> {
  log(ctx, "--- slider drag, 40 inputs at 16 ms (C2 2048/2048 split) ---");
  const knobs: [string, Partial<SpikeConfig>][] = [
    ["every step", {}],
    ["cadence 150 ms", { cadenceMs: 150 }],
    ["cadence 300 ms", { cadenceMs: 300 }],
    ["sunUpdateDeg 0.25", { sunUpdateDeg: 0.25 }],
    ["sunUpdateDeg 1", { sunUpdateDeg: 1 }],
  ];
  for (const [label, patch] of knobs) {
    ctx.status(`drag ${label}`);
    useConfig(ctx, cfg({ split: true, ...patch }));
    await sliderStep(ctx, 400);
    await settle(ctx);
    const before = ctx.spike.nearRenders + ctx.spike.farRenders;
    ctx.probe.recording = [];
    const trailingMs = await drag(ctx, 400);
    const recorded = ctx.probe.recording;
    ctx.probe.recording = null;
    const renders = ctx.spike.nearRenders + ctx.spike.farRenders - before;
    log(
      ctx,
      `${line(
        `  ${label} frames`,
        recorded.map((s) => s.ms),
      )}; map renders ${renders}; trailing frame ${ms(trailingMs)}`,
    );
  }
}

function startLongTasks(): { stop: () => number[] } {
  const durations: number[] = [];
  let observer: PerformanceObserver | undefined;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    observer = undefined;
  }
  return {
    stop: () => {
      observer?.disconnect();
      return durations;
    },
  };
}

async function timelapseSection(ctx: Ctx): Promise<void> {
  log(ctx, "--- sun 6 deg to -6 deg in 20 steps (C2 2048/2048) ---");
  useConfig(ctx, C2_2048);
  const steps: number[] = [];
  const tasks = startLongTasks();
  for (let i = 0; i < 20; i += 1) {
    const step = await setSunElevation(ctx, 6 - (12 * i) / 19);
    if (step !== null) steps.push(wOf(step));
  }
  const long = tasks.stop();
  log(ctx, line("  step", steps));
  log(ctx, `  long tasks ${long.length} max ${ms(Math.max(0, ...long))} ms`);
}

async function block(ctx: Ctx, receive: boolean): Promise<number[]> {
  applyCasting(ctx.h, ctx.casting, receive);
  await ctx.probe.nextFrame();
  return (await frames(ctx, BLOCK_FRAMES)).map((s) => s.ms);
}

async function ababRound(
  ctx: Ctx,
  blocks: number,
): Promise<[number[][], number[][]]> {
  const on: number[][] = [];
  const off: number[][] = [];
  for (let i = 0; i < blocks; i += 1) {
    on.push(await block(ctx, true));
    off.push(await block(ctx, false));
  }
  return [on, off];
}

function p50s(blocks: number[][]): number[] {
  return blocks.map((b) => quantile(b, 0.5));
}

async function ababSection(ctx: Ctx): Promise<void> {
  log(
    ctx,
    `--- per-frame cost, ABAB ${BLOCKS}x${BLOCK_FRAMES} frames (A receive on, B off; C2 2048/2048, sun 20 deg) ---`,
  );
  useConfig(ctx, C2_2048);
  await setSunElevation(ctx, 20);
  await settle(ctx);
  let [on, off] = await ababRound(ctx, BLOCKS);
  const diff = () => quantile(on.flat(), 0.5) - quantile(off.flat(), 0.5);
  const spread = () => Math.max(...p50s(on)) - Math.min(...p50s(on));
  if (Math.abs(diff()) < spread()) {
    const [on2, off2] = await ababRound(ctx, BLOCKS);
    on = [...on, ...on2];
    off = [...off, ...off2];
    log(ctx, "  (blocks doubled: the A-A spread hid the difference)");
  }
  applyCasting(ctx.h, ctx.casting, true);
  log(
    ctx,
    `  A block p50s ${p50s(on).map(ms).join(" ")}; B block p50s ${p50s(off).map(ms).join(" ")}`,
  );
  log(
    ctx,
    `  on minus off p50 ${ms(diff())} ms; A-A spread ${ms(spread())} ms; on p95 ${ms(quantile(on.flat(), 0.95))}`,
  );
}

interface PanResult {
  readonly all: number[];
  readonly nearFrames: number[];
  readonly nearCount: number;
}

async function pan(
  ctx: Ctx,
  lengthM: number,
  settleMs: number,
): Promise<PanResult> {
  const dir = new THREE.Vector3(1, 0, 0);
  const stepM = (2 * lengthM) / PAN_FRAMES;
  ctx.probe.recording = [];
  for (let i = 0; i < PAN_FRAMES; i += 1) {
    const sign = i < PAN_FRAMES / 2 ? 1 : -1;
    const delta = dir.clone().multiplyScalar(sign * stepM);
    ctx.h.controls.target.add(delta);
    ctx.h.camera.position.add(delta);
    ctx.probe.panUntilMs = performance.now() + settleMs + 20;
    await ctx.probe.nextFrame();
  }
  ctx.probe.panUntilMs = 0;
  await sleep(settleMs + 30);
  await settle(ctx);
  const recorded = ctx.probe.recording;
  ctx.probe.recording = null;
  const near = recorded.filter((s) => s.near);
  return {
    all: recorded.map((s) => s.ms),
    nearFrames: near.map((s) => s.ms),
    nearCount: near.length,
  };
}

function panLine(label: string, r: PanResult): string {
  const p95 = quantile(r.all, 0.95);
  const nearP90 = quantile(r.nearFrames, 0.9);
  const pass = p95 <= 33 && (r.nearCount === 0 || nearP90 <= 50);
  return (
    `  ${label}: frames p50 ${ms(quantile(r.all, 0.5))} p95 ${ms(p95)} max ${ms(Math.max(...r.all))}` +
    ` n ${r.all.length}; near renders ${r.nearCount} p90 ${ms(nearP90)} max ${ms(Math.max(0, ...r.nearFrames))}` +
    ` -> ${pass ? "meets" : "misses"} p95<=33 and near p90<=50`
  );
}

async function panRun(
  ctx: Ctx,
  label: string,
  config: SpikeConfig,
  target: THREE.Vector3,
): Promise<void> {
  useConfig(ctx, config);
  await setView(ctx, target);
  const distance = ctx.h.camera.position.distanceTo(ctx.h.controls.target);
  const R = nearHalfWidth(distance, config.k);
  await settle(ctx);
  const result = await pan(ctx, 8.5 * 0.5 * R, config.settleMs ?? 0);
  log(ctx, `${panLine(`${label} R ${R}`, result)}`);
}

async function panSection(ctx: Ctx): Promise<void> {
  log(
    ctx,
    `--- scripted pans (out and back, length 8.5 x 0.5R each way, ${PAN_FRAMES} frames, C2 2048/2048, sun 20 deg) ---`,
  );
  await setSunElevation(ctx, 20);
  for (const k of [0.75, 1, 1.5]) {
    for (const recentreFraction of [0.25, 0.5]) {
      for (const settleMs of [null, 250]) {
        const label = `k ${k} re-centre ${recentreFraction} ${settleMs === null ? "every re-centre" : "on settle 250 ms"}`;
        ctx.status(`pan ${label}`);
        await panRun(
          ctx,
          label,
          cfg({ k, recentreFraction, settleMs }),
          ctx.view.target,
        );
      }
    }
  }
}

/** The orbit target at the city's edge away from the sun, sun at 3 deg. */
async function worstCaseSection(ctx: Ctx): Promise<void> {
  log(
    ctx,
    "--- worst case for D: target at the city edge away from the sun, sun 3 deg ---",
  );
  await setSunElevation(ctx, 3);
  const w = ctx.spike.world;
  const away = new THREE.Vector3(
    -ctx.probe.sunDir.x,
    0,
    -ctx.probe.sunDir.z,
  ).normalize();
  const target = w.centre.clone().addScaledVector(away, 0.9 * w.halfExtentM);
  await forcedAt(ctx, target);
  await panRun(ctx, "edge, k 1 re-centre 0.25", C2_2048, target);
  await panRun(
    ctx,
    "edge, k 1 re-centre 0.5",
    cfg({ recentreFraction: 0.5 }),
    target,
  );
}

async function forcedAt(ctx: Ctx, target: THREE.Vector3): Promise<void> {
  useConfig(ctx, C2_2048);
  await setView(ctx, target);
  await forcedRenders(ctx, "C2 2048/2048 at the edge", C2_2048);
}

async function zoomSection(ctx: Ctx): Promise<void> {
  log(
    ctx,
    "--- zoom 130 m to 560 m and back (crosses 3+ near steps; C2 2048/2048, k 1) ---",
  );
  useConfig(ctx, C2_2048);
  await setSunElevation(ctx, 20);
  await setView(ctx, ctx.view.target, 130);
  await settle(ctx);
  ctx.probe.recording = [];
  for (let i = 0; i <= 80; i += 1) {
    const t = i <= 40 ? i / 40 : (80 - i) / 40;
    await setView(ctx, ctx.view.target, 130 + t * 430);
  }
  await settle(ctx);
  const recorded = ctx.probe.recording;
  ctx.probe.recording = null;
  const near = recorded.filter((s) => s.near).map((s) => s.ms);
  log(
    ctx,
    `  ${line(
      "frames",
      recorded.map((s) => s.ms),
    )}`,
  );
  log(ctx, `  ${line("near-render frames", near)}`);
}

function memorySection(ctx: Ctx): void {
  log(ctx, "--- shadow map memory (8 B per texel) ---");
  for (const [label, config] of W_CONFIGS) {
    if (config === null) continue;
    const bytes = new SpikeShadows(
      ctx.h.sun,
      ctx.h.scene,
      ctx.spike.world,
      config,
    ).bytes();
    const mib = bytes / 2 ** 20;
    log(
      ctx,
      `  ${label}: ${mib.toFixed(0)} MiB ${mib <= 64 ? "(<= 64)" : "(OVER 64)"}`,
    );
  }
  const memory = ctx.h.renderer.info.memory;
  log(
    ctx,
    `  renderer textures ${memory.textures} geometries ${memory.geometries}`,
  );
}

// --- verdicts --------------------------------------------------------------

const p90 = (values: readonly number[] | undefined) =>
  values === undefined ? Number.NaN : quantile(values, 0.9);

function band(
  runs: Map<string, WRun>,
  budget: number,
  one: string,
  split: string,
  low: string,
): string {
  if (p90(runs.get(one)?.w) <= budget) return "band 1";
  const s = runs.get(split);
  if (p90(s?.first) <= budget && p90(s?.second) <= budget) return "band 2";
  const w0 = p90(runs.get("W0 shadows off")?.w);
  const mapFrame = Math.max(p90(s?.first), p90(s?.second));
  const b3 =
    w0 <= budget && mapFrame <= 100
      ? "band 3 (falls to band 4 until the drag-hitch question is answered); "
      : "";
  const lowRun = runs.get(low);
  const lowOk = p90(lowRun?.w) <= budget;
  return `${b3}band 4: ${lowOk ? "low tier (one map 1024) meets band 1" : "low misses band 1: phone off"}`;
}

function verdicts(ctx: Ctx, runs: Map<string, WRun>, mode: string): void {
  log(ctx, `--- band verdicts (${mode}) ---`);
  const pairs: [string, string, string][] = [
    [
      "2048/2048",
      "C2 near 2048 far 2048, one frame",
      "C2 near 2048 far 2048, split frames",
    ],
    [
      "1024/1024",
      "C2 near 1024 far 1024, one frame",
      "C2 near 1024 far 1024, split frames",
    ],
  ];
  for (const budget of BUDGETS) {
    for (const [label, one, split] of pairs) {
      log(
        ctx,
        `  ${budget} ms, C2 ${label}: ${band(runs, budget, one, split, "C1 one map 1024 (low)")}`,
      );
    }
    const trees = p90(runs.get("trees")?.w);
    const plain = p90(runs.get("C2 near 2048 far 2048, one frame")?.w);
    log(
      ctx,
      `  ${budget} ms, trees cast: W p90 ${ms(trees)} vs ${ms(plain)} (${trees <= budget === plain <= budget ? "same side" : "crosses"} of the budget)`,
    );
  }
}

// --- the run ---------------------------------------------------------------

async function otherScheme(
  ctx: Ctx,
  waitMesh: (name: LookChoice) => Promise<boolean>,
): Promise<string | null> {
  const now = ctx.deps.scheme();
  const other =
    now === TIME_OF_DAY
      ? LOOK_CHOICES.find((c) => c !== TIME_OF_DAY)
      : TIME_OF_DAY;
  if (other === undefined) return null;
  ctx.status(`switching the look to ${other}`);
  const drawn = waitMesh(other);
  ctx.deps.chooseScheme(other);
  if (!(await drawn)) return null;
  await sleep(1500);
  return other;
}

async function run(
  ctx: Ctx,
  waitMesh: (name: LookChoice) => Promise<boolean>,
): Promise<void> {
  deviceInfo(ctx);
  sceneInfo(ctx);
  log(ctx, `look: ${ctx.deps.scheme()}`);
  // A hand on the slider stops any sun driver, so nothing moves the sun
  // behind the measurement.
  await sliderStep(ctx, 500);
  ctx.status("baseline");
  await baseline(ctx);
  ctx.status("compiles");
  await compileTimes(ctx);
  depthBits(ctx);
  log(
    ctx,
    `defaults: floor ${SPIKE_DEFAULT.floorDeg} deg, full ${SPIKE_DEFAULT.fullDeg} deg, fade f ${SPIKE_DEFAULT.fadeF}, k ${SPIKE_DEFAULT.k}, re-centre ${SPIKE_DEFAULT.recentreFraction}, sunUpdateDeg ${SPIKE_DEFAULT.sunUpdateDeg}; bias 0, normalBias one texel; buildings cast, all receive`,
  );
  await forcedSection(ctx);
  const first = ctx.deps.scheme();
  const runs = await wSection(ctx, first);
  verdicts(ctx, runs, first);
  await cadenceSection(ctx);
  await timelapseSection(ctx);
  await ababSection(ctx);
  await panSection(ctx);
  await worstCaseSection(ctx);
  await zoomSection(ctx);
  memorySection(ctx);
  const other = await otherScheme(ctx, waitMesh);
  if (other === null) {
    log(ctx, "second look: switch did not finish");
    return;
  }
  log(ctx, `look: ${other}`);
  applyCasting(ctx.h, ctx.casting);
  const runs2 = await wSection(ctx, other);
  verdicts(ctx, runs2, other);
}

/** The best guess stays on afterwards, with link knobs for a look check. */
function leaveOn(ctx: Ctx): void {
  const params = new URLSearchParams(window.location.search);
  const f = Number(params.get("shadowF") ?? SPIKE_DEFAULT.fadeF);
  const k = Number(params.get("shadowK") ?? SPIKE_DEFAULT.k);
  ctx.casting = {
    trees: params.get("shadowTrees") === "1",
    side: params.get("shadowSide") === "double" ? THREE.DoubleSide : null,
  };
  useConfig(
    ctx,
    cfg({ fadeF: Number.isFinite(f) ? f : 0.9, k: Number.isFinite(k) ? k : 1 }),
  );
  void setView(ctx, ctx.view.target).then(() => setSunElevation(ctx, 20));
}

// --- the panel -------------------------------------------------------------

interface Panel {
  status(text: string): void;
  done(report: string): void;
}

function panelBox(): HTMLDivElement {
  const box = document.createElement("div");
  box.id = "measure-shadows";
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
  return box;
}

function copyButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copy log";
  button.disabled = true;
  Object.assign(button.style, {
    width: "100%",
    minHeight: "64px",
    fontSize: "22px",
  });
  return button;
}

function mountPanel(): Panel {
  const box = panelBox();
  const status = document.createElement("p");
  status.style.margin = "0 0 8px";
  status.textContent = "Shadow measurement: waiting for the city...";
  const button = copyButton();
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
    status: (value) => {
      status.textContent = `Shadow measurement: ${value}`;
    },
    done: (value) => {
      report = value;
      button.disabled = false;
      text.value = value;
      box.dataset["done"] = "1";
      status.textContent = "done. Press Copy log, then paste it into the chat.";
    },
  };
}

// --- start -----------------------------------------------------------------

/** Installs the two-map chunk rewrite (inert with fewer than two shadows). */
function installTwoMapChunk(): void {
  THREE.ShaderChunk.lights_fragment_begin = withTwoMap(
    THREE.ShaderChunk.lights_fragment_begin,
  );
}

const THREE_SHADOW_BLOCK = `		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

const TWO_MAP_BLOCK = `		// TWO MAP SHADOW (spike)
		#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 0
		if ( directLight.visible && receiveShadow ) {
			vec3 nearCoord = vDirectionalShadowCoord[ 0 ].xyz;
			float nearEdge = max( abs( nearCoord.x - 0.5 ), abs( nearCoord.y - 0.5 ) ) * 2.0;
			float nearWeight = ( 1.0 - smoothstep( 0.85, 0.95, nearEdge ) ) * step( 0.0, nearCoord.z ) * ( 1.0 - smoothstep( 0.98, 0.995, nearCoord.z ) );
			DirectionalLightShadow nearShadow = directionalLightShadows[ 0 ];
			DirectionalLightShadow farShadow = directionalLightShadows[ 1 ];
			float nearLit = nearWeight > 0.0 ? getShadow( directionalShadowMap[ 0 ], nearShadow.shadowMapSize, nearShadow.shadowIntensity, nearShadow.shadowBias, nearShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
			float farLit = nearWeight < 1.0 ? getShadow( directionalShadowMap[ 1 ], farShadow.shadowMapSize, nearShadow.shadowIntensity, farShadow.shadowBias, farShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] ) : 1.0;
			directLight.color *= mix( farLit, nearLit, nearWeight );
		}
		#elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS >= 2 && UNROLLED_LOOP_INDEX == 1
		#elif defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif`;

function withTwoMap(chunk: string): string {
  if (chunk.includes("TWO MAP SHADOW")) return chunk;
  if (!chunk.includes(THREE_SHADOW_BLOCK)) {
    throw new Error("shadow spike: three's shadow line was not found");
  }
  return chunk.replace(THREE_SHADOW_BLOCK, TWO_MAP_BLOCK);
}

interface MeshWatch {
  lastMs: number;
  seen: boolean;
  waiting: { name: LookChoice; resolve: (ok: boolean) => void } | undefined;
}

async function waitQuiet(
  watch: MeshWatch,
  status: (t: string) => void,
): Promise<void> {
  while (!watch.seen || performance.now() - watch.lastMs < QUIET_MS) {
    status("waiting for the city to settle...");
    await sleep(500);
  }
}

export function startShadowMeasure(deps: ShadowMeasureDeps): ShadowMeasure {
  installTwoMapChunk();
  const panel = mountPanel();
  const h = deps.handles;
  const watch: MeshWatch = { lastMs: 0, seen: false, waiting: undefined };
  const waitMesh = (name: LookChoice) =>
    withTimeout(
      new Promise<boolean>((resolve) => {
        watch.waiting = { name, resolve };
      }),
      SWITCH_TIMEOUT_MS,
    ).then((ok) => ok === true);
  void (async () => {
    await waitQuiet(watch, (text) => panel.status(text));
    const world = worldOf(h);
    const spike = new SpikeShadows(h.sun, h.scene, world);
    const probe = new Probe(h, spike);
    probe.install(deps.hooks);
    const ctx: Ctx = {
      deps,
      h,
      probe,
      spike,
      out: [
        `shadow measurement ${new Date().toISOString()} ${window.location.search}`,
      ],
      status: (text) => panel.status(text),
      view: {
        target: h.controls.target.clone(),
        offset: h.camera.position.clone().sub(h.controls.target),
      },
      casting: DEFAULT_CASTING,
      shadowsReady: false,
    };
    try {
      await run(ctx, waitMesh);
    } catch (error) {
      ctx.out.push(
        `ERROR ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
      );
    }
    leaveOn(ctx);
    panel.done(ctx.out.join("\n"));
  })();
  return {
    meshDrawn: (mesh) => {
      watch.lastMs = performance.now();
      watch.seen = true;
      const waiting = watch.waiting;
      if (waiting !== undefined && mesh.colourScheme === waiting.name) {
        watch.waiting = undefined;
        waiting.resolve(true);
      }
    },
  };
}
