/**
 * Where the GPU trainer's library comes from and what of it the trainer
 * uses. Splat.js (MIT) is loaded at run time from one pinned commit of its
 * GitHub repository, served by jsDelivr, and never bundled. Its module has
 * no version export, so the check reads the exports the trainer calls and
 * refuses in words when one is missing or of the wrong kind.
 *
 * @see splat-js.ts.md
 */

/** The Splat.js commit the trainer was measured with. */
export const SPLAT_JS_COMMIT = "a84620c05f210a304b2d8de1d5c9f19d3657126f";

/** The smallest longer side (px) Splat.js shrinks a training photo to
 *  when the photos outgrow its memory budget (`adaptiveTrainCap` at the
 *  pinned commit); it never enlarges a smaller photo. */
export const SPLAT_JS_MIN_TRAIN_DIM = 320;

/** The one address the trainer loads Splat.js from. */
export const SPLAT_JS_URL = `https://cdn.jsdelivr.net/gh/arrival-space/splat.js@${SPLAT_JS_COMMIT}/src/index.js`;

/** One camera of Splat.js's ground-truth list (`parseCameras`): OpenCV
 *  world-to-camera, intrinsics in pixels of a `width` x `height` photo. */
export interface SplatCameraEntry {
  readonly image: string;
  readonly R_w2c_rowmajor: readonly number[];
  readonly t_w2c: readonly number[];
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
  readonly width: number;
  readonly height: number;
}

/** A seed point: world position (raw WebXR), colour in [0, 1]. */
export interface SeedPoint {
  readonly X: readonly [number, number, number];
  readonly rgb: readonly [number, number, number];
}

/** The `metrics` event's fields the trainer reads. */
export interface SplatMetrics {
  readonly iter: number;
  readonly psnrTrain?: number;
}

/** The `event` event's fields the trainer reads. */
export interface SplatEvent {
  readonly kind: string;
}

/** What the trainer calls on a Splat.js session. */
export interface SplatSessionLike {
  on(type: "event", fn: (e: SplatEvent) => void): unknown;
  on(type: "metrics", fn: (m: SplatMetrics) => void): unknown;
  load(files: { source: Blob; name: string }[]): Promise<unknown>;
  useKnownCameras(cams: unknown, opts: { points: SeedPoint[] }): unknown;
  seed(extra: { evalFrames: string[] }): Promise<unknown>;
  start(): void;
  pause(): void;
  evalFramePsnr(cameraIndex: number): Promise<number>;
  evalTestPsnr(): Promise<{ readonly psnr: number } | null>;
  exportPlyBlob(): Promise<Blob>;
  dispose(): void;
  readonly trainer: SplatTrainerLike | null;
  /** The test cameras (held out of training), once seeded. */
  readonly testCams?: readonly number[];
}

/** What the trainer reads of a session's model. */
export interface SplatTrainerLike {
  readonly iter: number;
  /** One entry per loaded photo, its camera at training resolution. */
  readonly camMeta: readonly unknown[];
  readonly excluded?: ReadonlySet<number>;
  /** The graphics device and canvas format a look is drawn with. */
  readonly device?: unknown;
  readonly canvasFormat?: string;
  /** Draws the model as seen from training camera `ci` into a configured
   *  WebGPU canvas context. */
  renderTrainCam?(ci: number, ctx: unknown): void;
}

/** The options of `createSession` the trainer sets. */
interface SplatSessionOptions {
  readonly maxIters: number;
  /** -1: no single chart hold-out; the named `evalFrames` are the test set. */
  readonly holdout: -1;
  readonly evalHoldEvery: number;
  readonly trainer: { readonly camOpt: false; readonly expComp: false };
  /** Splat.js's frame options: it shrinks the training photos to fit
   *  `targetBudgetBytes` (its own default 700e6 when absent). */
  readonly frames?: { readonly targetBudgetBytes?: number };
}

/** The exports of Splat.js the trainer uses. */
export interface SplatJsModule {
  createSession(opts: SplatSessionOptions): SplatSessionLike;
  parseCameras(json: { cameras: readonly SplatCameraEntry[] }): unknown;
  readonly TRAIN_MAX_DIM: number;
}

/** The library arrived but is not the one the trainer knows: a second
 *  try meets the same module, unlike a download that failed. */
export class SplatJsMismatchError extends Error {
  override readonly name = "SplatJsMismatchError";
}

/**
 * `mod` as the Splat.js the trainer knows, or a
 * {@link SplatJsMismatchError} that says what does not match: a module
 * that is not an object, a missing function, or a `TRAIN_MAX_DIM` that is
 * not a positive number.
 */
export function checkSplatJs(mod: unknown): SplatJsModule {
  const refuse = (what: string): Error =>
    new SplatJsMismatchError(
      `The splat trainer library is not the version this page expects (${what}).`,
    );
  if (typeof mod !== "object" || mod === null) throw refuse("no module");
  const m = mod as Record<string, unknown>;
  for (const name of ["createSession", "parseCameras"] as const) {
    if (typeof m[name] !== "function") throw refuse(`no ${name}`);
  }
  const dim = m["TRAIN_MAX_DIM"];
  if (typeof dim !== "number" || !(dim > 0)) throw refuse("no TRAIN_MAX_DIM");
  return mod as SplatJsModule;
}

/** Imports a module by address. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * The global under which the worker's `blob:` start module leaves its
 * importer. An `import()` takes its referrer policy from the module it is
 * written in: written in the `blob:` module it inherits the page's
 * `no-referrer`; written in a module served by this site it would send
 * this page's address to the CDN as the Referer.
 */
export const SHIM_IMPORT_KEY = "__splatTrainerImport";

/**
 * Loads Splat.js from {@link SPLAT_JS_URL} with `importer` and checks it.
 * Rejects with a sentence when the network fails, or with a
 * {@link SplatJsMismatchError} when the module is not the expected one.
 */
export async function loadSplatJs(
  importer: ModuleImporter,
): Promise<SplatJsModule> {
  let mod: unknown;
  try {
    mod = await importer(SPLAT_JS_URL);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The splat trainer library could not be loaded (${detail}).`,
      { cause: err },
    );
  }
  return checkSplatJs(mod);
}
