/**
 * Serialise an async action, coalescing to the most recent request.
 *
 * WHY THE DEMO NEEDS THIS. `refresh()` is fired by every map click and every
 * category change, and it awaits `pipeline.update()` — a real Overpass fetch,
 * measured at 18.2 s for a res-7 tile. The map stays clickable for that whole
 * window, so without a guard two clicks give two `pipeline.update()` calls
 * racing into the same `AffordanceIndex`, two `mapView.render()` calls, and a
 * status line written by whichever settles last, which may be the EARLIER
 * position.
 *
 * The symptom is not "a race" — it is "the map is showing the wrong place",
 * described confidently by a status line that agrees with itself. Nothing about
 * it points at concurrency.
 *
 * WHY LATEST-WINS RATHER THAN A SIMPLE LOCK. Rejecting clicks while busy would
 * also serialise the work, and would break the demo's only interaction: an 18 s
 * dead zone after every click reads as a broken page. So no request is refused
 * — the newest one always runs, and the ones it superseded never do. The
 * intermediate work is what gets dropped, never the user's final intent.
 *
 * @see latest-only.ts.md
 */

/** A coalescing wrapper. `busy` is true while the wrapped action is running. */
export interface LatestOnly<T> {
  (input: T): Promise<void>;
  readonly busy: boolean;
}

/**
 * Wraps `run` so at most one call is in flight and only the newest waiting
 * input survives.
 *
 * The returned promise settles once the runner has gone idle, so a caller that
 * awaits it knows the view reflects the last input accepted — not merely that
 * its own input was handled, which for a superseded input would be a lie.
 *
 * Never rejects: a runner that throws leaves the wrapper ready for the next
 * call, because turning a transient Overpass 429 into a permanently dead demo
 * would be a worse failure than the race it replaced. Reporting the error stays
 * the runner's job — it has the context to say what failed.
 */
export function latestOnly<T>(
  run: (input: T) => Promise<void>,
): LatestOnly<T> {
  let active: Promise<void> | undefined;
  /** The one input waiting behind the active run. Newer inputs replace it. */
  let queued: { input: T } | undefined;

  async function drain(input: T): Promise<void> {
    let next: T | undefined = input;
    let hasNext = true;
    while (hasNext) {
      try {
        await run(next as T);
      } catch {
        // Swallowed deliberately — see the docstring. The runner reports.
      }
      if (queued === undefined) {
        hasNext = false;
      } else {
        next = queued.input;
        queued = undefined;
      }
    }
  }

  const wrapper = (input: T): Promise<void> => {
    if (active !== undefined) {
      // Replace rather than append: everything between the current run and the
      // newest input is work whose result would be overwritten anyway.
      queued = { input };
      return active;
    }
    active = drain(input).finally(() => {
      active = undefined;
    });
    return active;
  };

  Object.defineProperty(wrapper, "busy", {
    get: () => active !== undefined,
  });

  return wrapper as LatestOnly<T>;
}
