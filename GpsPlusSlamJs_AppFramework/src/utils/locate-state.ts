/**
 * What a "my location" button says, what each failure's fix is, and one
 * request for a position: the behaviour every locate button shares.
 *
 * WHY IT LIVES HERE. It began as the OSM demo's `locate-state.ts`; the
 * globe lab's pin (round-2 plan 2026-09-26-2055 M3g) needed the same
 * contract, and DEC-H3 gives shared behaviour one home. The OSM demo
 * imports the labels and the mapping from here; its Leaflet control is
 * still its own (it asks Leaflet, not the browser, for the position).
 *
 * WHY THE STATES ARE SPLIT THIS FINELY. Geolocation fails in three ways with
 * three different remedies: `denied` is fixed in browser settings, `timeout` by
 * walking somewhere with a view of the sky, and `unavailable` not at all. One
 * shared "location failed" would hide the only useful part of the message.
 *
 * Kept free of the DOM, so the labels, the mapping and the request can be
 * tested without a browser.
 *
 * @see locate-state.ts.md
 */

export type LocateState =
  'idle' | 'locating' | 'located' | 'denied' | 'timeout' | 'unavailable';

/**
 * The three ways a request for a position fails. The three types below are
 * not exported until a TypeScript caller needs them (the one caller of
 * `locateOnce` today is the globe lab's plain JavaScript); `check:deadcode`
 * rejects an exported type nothing imports.
 */
type LocateFailure = Extract<LocateState, 'denied' | 'timeout' | 'unavailable'>;

/**
 * The button's accessible label for a state.
 *
 * Every state has a distinct, non-empty label - including `locating`, which is
 * the in-progress state `CLAUDE.md`'s async-feedback rule requires for anything
 * that takes more than a few hundred ms. A GPS fix routinely takes seconds.
 *
 * The OSM demo's button is a square icon (a map pin, DEC-R2-3), so these
 * strings live in its `title` and `aria-label`, not in its text.
 */
export function labelFor(state: LocateState): string {
  switch (state) {
    case 'idle':
      return 'my location';
    case 'locating':
      return 'locating…';
    case 'located':
      return 'my location';
    case 'denied':
      return 'location permission denied';
    case 'timeout':
      return 'location timed out';
    case 'unavailable':
      return 'location unavailable';
  }
}

/**
 * The fix a failure names, for the line under the button; empty for the
 * states that need none. Each failure has its own: settings for `denied`,
 * another try with a view of the sky for `timeout`, and for `unavailable`
 * the plain statement that this device cannot help, rather than settings
 * that would not.
 */
export function locateAdvice(state: LocateState): string {
  switch (state) {
    case 'denied':
      return "Allow location for this site in your browser's settings, then try again.";
    case 'timeout':
      return 'Try again outdoors or by a window, with a view of the sky.';
    case 'unavailable':
      return 'This device or browser cannot tell where it is.';
    default:
      return '';
  }
}

/**
 * Maps a `GeolocationPositionError.code` to a state.
 *
 * Unknown codes degrade to `unavailable` rather than throwing. The codes are a
 * fixed set in the spec, but this is a browser API and the error object is
 * whatever the browser hands over - and a button that throws inside its own
 * error handler leaves the UI stuck on "locating…" forever, which is the one
 * outcome worse than a wrong message.
 */
export function stateForError(code: number | undefined): LocateFailure {
  switch (code) {
    case 1:
      return 'denied';
    case 3:
      return 'timeout';
    default:
      return 'unavailable';
  }
}

/**
 * What one request came to: a position, as far as a button needs one
 * (`accuracyM` in metres, `undefined` when the browser omits it), or the
 * failure.
 */
type LocateOutcome =
  | {
      readonly kind: 'located';
      readonly fix: {
        readonly lat: number;
        readonly lng: number;
        readonly accuracyM: number | undefined;
        readonly timestamp: number;
      };
    }
  | { readonly kind: 'failed'; readonly state: LocateFailure };

/** The part of `navigator.geolocation` a request uses. */
type LocateGeolocation = Pick<Geolocation, 'getCurrentPosition'>;

/**
 * Asks once where the device is (`getCurrentPosition`, a fresh fix:
 * `maximumAge` 0, high accuracy, the browser's own `timeoutMs`).
 *
 * NEVER REJECTS FOR ANYTHING THE BROWSER DOES: no geolocation at all, a
 * request that throws (an insecure context), an error code, a fix whose
 * coordinates are not a place, and a callback called twice all resolve,
 * the failures as `unavailable` unless the code says otherwise. So no
 * rejection leaves a button stuck in its in-progress state.
 *
 * It CAN stay pending: the browser's timeout starts only once permission
 * is granted, so while a permission prompt is open (or if a browser never
 * answers) the promise does not settle. A button awaiting it should
 * therefore let a tap cancel the wait rather than stay disabled.
 *
 * Rejects with a RangeError only for a caller's mistake: a timeout that is
 * not a positive number.
 */
export function locateOnce(
  geolocation: LocateGeolocation | undefined,
  options: { readonly timeoutMs: number }
): Promise<LocateOutcome> {
  const { timeoutMs } = options;
  if (!(timeoutMs > 0 && Number.isFinite(timeoutMs))) {
    return Promise.reject(
      new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`)
    );
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: LocateOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const fail = (state: LocateFailure) => {
      settle({ kind: 'failed', state });
    };
    if (typeof geolocation?.getCurrentPosition !== 'function') {
      fail('unavailable');
      return;
    }
    try {
      geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          ) {
            fail('unavailable');
            return;
          }
          settle({
            kind: 'located',
            fix: {
              lat: latitude,
              lng: longitude,
              accuracyM: Number.isFinite(accuracy) ? accuracy : undefined,
              timestamp: position.timestamp,
            },
          });
        },
        (error) => {
          fail(stateForError(error?.code));
        },
        { timeout: timeoutMs, maximumAge: 0, enableHighAccuracy: true }
      );
    } catch {
      fail('unavailable');
    }
  });
}
