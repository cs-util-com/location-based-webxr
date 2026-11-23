/**
 * What the measuring worker does with one request: decode both photos,
 * cut and turn the squares of a rotation pair, run the ticked methods
 * once with the photo test's settings, and answer with the results. The
 * browser parts (the PNG decoder, the WebGPU probe, the method builder)
 * come in through `MeasureEnv`, so this runs in a unit test; the worker
 * entry `feature-match-measure.worker.ts` wires the real ones.
 *
 * @see measure-worker-core.ts.md
 */
import type { Frame } from "./bench-image";
import { runSettings, type MethodSelection } from "./bench-methods";
import { errorText } from "./bench-net";
import {
  runBenchmark,
  type BenchMethod,
  type MethodResult,
  type MethodRunner,
} from "./bench-run";
import { requestOf, type MeasureAnswer } from "./measure-protocol";
import { rotationSquare } from "./rotation-square";

export interface MeasureEnv {
  /** A stored PNG back as a frame, pixel for pixel. */
  readonly decode: (blob: Blob) => Promise<Frame>;
  /** Whether WebGPU runs here (asked in the worker: it has its own GPU). */
  readonly webgpu: () => Promise<boolean>;
  /** The methods to run, built for the worker. */
  readonly build: (selection: MethodSelection) => BenchMethod[];
  readonly now: () => number;
  /**
   * The methods this worker has loaded, by method id, kept for the next
   * pair. One per worker: a worker started again starts empty.
   */
  readonly kept: KeptRunners;
}

/** Loaded method runners by method id (their ONNX sessions, sift.js). */
type KeptRunners = Map<string, Promise<MethodRunner>>;

/** The note a runner loaded for an earlier pair adds to its result. */
const KEPT_NOTE = "loaded for an earlier pair";

/**
 * Wraps each method so it loads once per worker: the first pair's load
 * is kept in `kept`, later pairs take it with an init time of 0, and the
 * per-pair dispose is a no-op. A load that fails is forgotten, so the
 * next pair tries again.
 */
function keepLoaded(
  methods: readonly BenchMethod[],
  kept: KeptRunners,
): BenchMethod[] {
  return methods.map((m) => ({
    id: m.id,
    label: m.label,
    init: async () => {
      const had = kept.get(m.id);
      const p = had ?? m.init();
      if (had === undefined) {
        kept.set(m.id, p);
        p.catch(() => {
          if (kept.get(m.id) === p) {
            kept.delete(m.id);
          }
        });
      }
      const r = await p;
      return {
        ...r,
        initMs: had === undefined ? r.initMs : 0,
        notes: had === undefined ? r.notes : [...r.notes, KEPT_NOTE],
        dispose: () => undefined,
      };
    },
  }));
}

/**
 * Drops and disposes the kept runner of every method whose pair failed
 * (a size with an error): a lost GPU device or a broken session must not
 * fail every later pair.
 */
function dropFailed(results: readonly MethodResult[], kept: KeptRunners) {
  for (const r of results) {
    const p = kept.get(r.id);
    if (p !== undefined && r.sizes.some((s) => s.error !== null)) {
      kept.delete(r.id);
      p.then(
        (runner) => runner.dispose(),
        () => undefined,
      );
    }
  }
}

/**
 * The time a pair took to measure, in ms: both extracts and the match of
 * every size that ran. Downloads, session creation and failed sizes are
 * left out, so it is the cost of one more pair.
 */
export function measureMsOf(results: readonly MethodResult[]): number {
  let ms = 0;
  for (const r of results) {
    for (const s of r.sizes) {
      const t = 2 * s.extract.median + s.match.median;
      if (s.error === null && Number.isFinite(t)) {
        ms += t;
      }
    }
  }
  return ms;
}

const hasJob = (data: unknown): number | null => {
  const job = (data as { job?: unknown } | null)?.job;
  return typeof job === "number" && Number.isInteger(job) && job > 0
    ? job
    : null;
};

/**
 * Answers one message: a request is measured and answered with progress
 * lines and then `done` or `failed`. A malformed message that names a job
 * is answered `failed`, so the page does not wait for it; one without a
 * job is dropped. Never rejects.
 */
export async function handleMeasure(
  data: unknown,
  env: MeasureEnv,
  post: (answer: MeasureAnswer) => void,
): Promise<void> {
  const req = requestOf(data);
  if (req === null) {
    const job = hasJob(data);
    if (job !== null) {
      post({ type: "failed", job, message: "malformed request" });
    }
    return;
  }
  const { job } = req;
  let a: Frame;
  let b: Frame;
  try {
    [a, b] = await Promise.all([env.decode(req.a), env.decode(req.b)]);
  } catch (e) {
    post({
      type: "failed",
      job,
      message: `a photo could not be decoded: ${errorText(e)}`,
    });
    return;
  }
  try {
    if (req.turn !== null) {
      a = rotationSquare(a, 0).frame;
      b = rotationSquare(b, req.turn).frame;
    }
    const settings = runSettings(
      { pair: req.pair, backends: [], precisions: [], runs: 1 },
      await env.webgpu(),
    );
    const methods = keepLoaded(
      env.build({
        ...req.methods,
        xfeat: false,
        backends: settings.backends,
        precisions: settings.precisions,
      }),
      env.kept,
    );
    const log = (line: string) => post({ type: "progress", job, line });
    log(settings.line);
    const results = await runBenchmark(
      methods,
      { a, b, warp: null },
      { sizes: req.sizes, runs: settings.runs, warmup: settings.warmup },
      { now: env.now, yieldToUi: () => Promise.resolve(), log },
    );
    dropFailed(results, env.kept);
    post({
      type: "done",
      job,
      results,
      frames: {
        a: { width: a.width, height: a.height },
        b: { width: b.width, height: b.height },
      },
      settings: settings.line,
      measureMs: measureMsOf(results),
    });
  } catch (e) {
    post({ type: "failed", job, message: errorText(e) });
  }
}
