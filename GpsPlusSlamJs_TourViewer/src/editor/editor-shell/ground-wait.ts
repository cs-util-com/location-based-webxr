/**
 * A wait for the 3D view's ground: "Put on the ground" on ground that has
 * not loaded at all yet reads it again until some has, rather than put
 * something at no known height; it gives up after a while, and stops when
 * called off. It stops at the first ground that loads, a coarse level
 * included: on a slope that height can still change by a little once
 * finer tiles arrive (the inspector then shows how far off it stands).
 *
 * @see ground-wait.ts.md
 */

/** How often the ground is read again, and how long it is waited for
 *  (ms): long enough for the tiles of a fresh view to arrive on a slow
 *  connection. */
export const GROUND_WAIT = { everyMs: 250, timeoutMs: 20_000 } as const;

export type GroundWaited<T> =
  | { readonly kind: "ground"; readonly value: T }
  | { readonly kind: "timeout" }
  | { readonly kind: "stopped" };

/**
 * `read()` once it gives something other than null: at once when it does
 * already, else every `everyMs` until it does, `timeoutMs` passes, or
 * `signal` is called off (then nothing more is read).
 */
export function waitForGround<T>(
  read: () => T | null,
  options: {
    readonly everyMs?: number;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<GroundWaited<T>> {
  const everyMs = options.everyMs ?? GROUND_WAIT.everyMs;
  const timeoutMs = options.timeoutMs ?? GROUND_WAIT.timeoutMs;
  const { signal } = options;
  if (signal?.aborted === true) return Promise.resolve({ kind: "stopped" });
  const first = read();
  if (first !== null) return Promise.resolve({ kind: "ground", value: first });
  return new Promise((resolve) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const end = (outcome: GroundWaited<T>) => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      end({ kind: "stopped" });
    };
    signal?.addEventListener("abort", onAbort);
    const again = () => {
      timer = null;
      const value = read();
      if (value !== null) {
        end({ kind: "ground", value });
      } else if (Date.now() - started >= timeoutMs) {
        end({ kind: "timeout" });
      } else {
        timer = setTimeout(again, everyMs);
      }
    };
    timer = setTimeout(again, everyMs);
  });
}
