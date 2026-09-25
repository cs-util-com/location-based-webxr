import type { VisitorFix } from "./start-distance.js";

export interface LocateHandle {
  /** The deciding fix, the last fix seen when time ran out, or `null` when
   *  there was none (denied, unavailable, no API, or cancelled). */
  readonly result: Promise<VisitorFix | null>;
  /** Stops watching and resolves `result` with `null`. Safe to call twice. */
  cancel(): void;
}

/**
 * A short-lived read of where the visitor is, for the tour-entry screen.
 *
 * Deliberately its own `watchPosition` handle rather than the framework's
 * `startGpsWatch`: that one is a module-level singleton which clears whatever
 * watch is already running, so using it here would fight the real GPS watch
 * the AR session starts moments later. This one always clears its own handle
 * before resolving.
 */
export function locateVisitor(options: {
  readonly timeoutMs: number;
  /** True once a fix settles the question and waiting longer buys nothing. */
  readonly isDecisive: (fix: VisitorFix) => boolean;
  readonly geolocation?: Geolocation | undefined;
}): LocateHandle {
  const geolocation =
    "geolocation" in options
      ? options.geolocation
      : typeof navigator === "undefined"
        ? undefined
        : navigator.geolocation;

  if (geolocation === undefined) {
    return { result: Promise.resolve(null), cancel() {} };
  }

  let last: VisitorFix | null = null;
  let done = false;
  let watchId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolve!: (fix: VisitorFix | null) => void;
  const result = new Promise<VisitorFix | null>((r) => {
    resolve = r;
  });

  function finish(fix: VisitorFix | null): void {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    if (watchId !== null) geolocation!.clearWatch(watchId);
    resolve(fix);
  }

  watchId = geolocation.watchPosition(
    (position) => {
      if (done) return;
      last = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      if (options.isDecisive(last)) finish(last);
    },
    (error) => {
      // Permission denied will not fix itself. Anything else (a tunnel, a cold
      // chip) may — keep waiting until the timeout.
      if (error.code === error.PERMISSION_DENIED) finish(last);
    },
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: options.timeoutMs },
  );
  timer = setTimeout(() => finish(last), options.timeoutMs);

  return { result, cancel: () => finish(null) };
}
