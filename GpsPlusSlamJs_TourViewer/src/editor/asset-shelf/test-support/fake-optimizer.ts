/**
 * A test-driven optimizer for the shelf's tests: each `optimize` call
 * waits until the test settles it (`finish`, `keep`, `fail`, `crash`), so
 * a test decides exactly when a job ends - before a save, during one,
 * after a reload. Test-only.
 */
import {
  OptimizerCrashed,
  type AssetOptimizer,
  type OptimizeContext,
  type OptimizeOutcome,
} from "../asset-optimizers.js";

interface Call {
  readonly source: Blob;
  readonly ctx: OptimizeContext;
  readonly resolve: (outcome: OptimizeOutcome) => void;
  readonly reject: (error: unknown) => void;
}

export interface FakeOptimizer extends AssetOptimizer {
  /** The calls not settled yet, oldest first. */
  readonly calls: Call[];
  /** Ends the oldest call with a smaller file. */
  finish(
    blob: Blob,
    extension: string,
    size?: { width: number; height: number },
  ): void;
  keep(reason: string): void;
  fail(message: string): void;
  crash(): void;
}

export function fakeOptimizer(): FakeOptimizer {
  const calls: Call[] = [];
  const next = (): Call => {
    const call = calls.shift();
    if (call === undefined) throw new Error("no optimize call is waiting");
    return call;
  };
  return {
    calls,
    optimize(source, ctx) {
      return new Promise<OptimizeOutcome>((resolve, reject) => {
        const call = { source, ctx, resolve, reject };
        calls.push(call);
        ctx.signal.addEventListener("abort", () => {
          const at = calls.indexOf(call);
          if (at >= 0) calls.splice(at, 1);
          reject(new DOMException("stopped", "AbortError"));
        });
      });
    },
    finish(blob, extension, size) {
      next().resolve({ kind: "optimized", blob, extension, ...size });
    },
    keep(reason) {
      next().resolve({ kind: "kept", reason });
    },
    fail(message) {
      next().reject(new Error(message));
    },
    crash() {
      next().reject(new OptimizerCrashed());
    },
  };
}
