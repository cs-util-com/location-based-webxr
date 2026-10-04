/**
 * The "where am I?" behaviour shared by every locate button: its states'
 * labels, the error mapping, the fix each failure names, and one request
 * for a position.
 *
 * Why these tests matter:
 * The part of a locate button that goes wrong is the FEEDBACK. `CLAUDE.md`'s
 * async-UI rule asks for a distinguishable in-progress state and a
 * distinguishable outcome, for the success path and the failure path, and
 * geolocation fails in three different ways that need three different
 * remedies: "denied" is fixed in the browser's settings, "timeout" by going
 * somewhere with a view of the sky, and "unavailable" not at all. The labels
 * and the mapping moved here from the OSM demo (DEC-H3: shared behaviour
 * has one home) when the globe lab's pin needed the same contract; the
 * request is new with it, and must never leave a button stuck on
 * "locating" (it never rejects, whatever the browser hands it).
 *
 * @see locate-state.ts.md
 */

import { describe, it, expect } from 'vitest';

import {
  labelFor,
  locateAdvice,
  locateOnce,
  stateForError,
  type LocateState,
} from './locate-state.js';

describe('labelFor', () => {
  it('distinguishes idle from in-progress, which is the whole async-feedback rule', () => {
    expect(labelFor('idle')).not.toBe(labelFor('locating'));
    expect(labelFor('locating')).toMatch(/locating|…/i);
  });

  it('gives every state a non-empty label', () => {
    // A state with no label is a button that goes blank mid-interaction.
    const states: LocateState[] = [
      'idle',
      'locating',
      'located',
      'denied',
      'timeout',
      'unavailable',
    ];
    for (const state of states) expect(labelFor(state).trim()).not.toBe('');
  });

  it("says something actionable for each failure, not just 'error'", () => {
    const denied = labelFor('denied');
    const timedOut = labelFor('timeout');
    const unavailable = labelFor('unavailable');
    expect(new Set([denied, timedOut, unavailable]).size).toBe(3);
    expect(denied).toMatch(/denied|permission/i);
    expect(timedOut).toMatch(/timed out|timeout/i);
  });

  it('keeps the labels the OSM demo shipped with (the move changed no text)', () => {
    // The demo's button reads these through `title` and `aria-label`; a
    // screen reader user would hear any drift.
    expect(labelFor('idle')).toBe('my location');
    expect(labelFor('locating')).toBe('locating…');
    expect(labelFor('located')).toBe('my location');
    expect(labelFor('denied')).toBe('location permission denied');
    expect(labelFor('timeout')).toBe('location timed out');
    expect(labelFor('unavailable')).toBe('location unavailable');
  });
});

describe('stateForError', () => {
  it('maps the three GeolocationPositionError codes', () => {
    expect(stateForError(1)).toBe('denied');
    expect(stateForError(2)).toBe('unavailable');
    expect(stateForError(3)).toBe('timeout');
  });

  it('treats an unknown code as unavailable rather than crashing', () => {
    // A button that throws inside its own error handler leaves the UI stuck
    // in `locating` forever.
    expect(stateForError(99)).toBe('unavailable');
    expect(stateForError(undefined)).toBe('unavailable');
  });
});

describe('locateAdvice', () => {
  it('names a different fix for each failure', () => {
    const denied = locateAdvice('denied');
    const timedOut = locateAdvice('timeout');
    const unavailable = locateAdvice('unavailable');
    expect(new Set([denied, timedOut, unavailable]).size).toBe(3);
    // Denied is fixed in the browser's site settings...
    expect(denied).toMatch(/settings/i);
    // ...a timeout by trying again where the sky is visible...
    expect(timedOut).toMatch(/try again/i);
    expect(timedOut).toMatch(/sky|outdoors|window/i);
    // ...and unavailable has no fix on this device: it says so rather than
    // sending the user to settings that cannot help.
    expect(unavailable).not.toMatch(/settings/i);
  });

  it('has nothing to fix outside a failure', () => {
    for (const state of ['idle', 'locating', 'located'] as const) {
      expect(locateAdvice(state)).toBe('');
    }
  });
});

/** A geolocation stand-in that answers `getCurrentPosition` as told. */
function geolocationThat(
  answer: (
    ok: PositionCallback,
    fail: PositionErrorCallback,
    options: PositionOptions | undefined
  ) => void
): {
  geolocation: Pick<Geolocation, 'getCurrentPosition'>;
  calls: PositionOptions[];
} {
  const calls: PositionOptions[] = [];
  return {
    calls,
    geolocation: {
      getCurrentPosition(ok, fail, options) {
        calls.push(options ?? {});
        answer(ok, fail ?? (() => undefined), options);
      },
    },
  };
}

const position = (
  coords: Partial<GeolocationCoordinates>
): GeolocationPosition =>
  ({
    coords: {
      latitude: 50.94,
      longitude: 6.96,
      accuracy: 12,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    },
    timestamp: 1_790_000_000_000,
  }) as GeolocationPosition;

const failure = (code: number): GeolocationPositionError =>
  ({ code, message: `code ${code}` }) as GeolocationPositionError;

describe('locateOnce', () => {
  it('resolves a granted request with the fix', async () => {
    const { geolocation, calls } = geolocationThat((ok) => {
      ok(position({}));
    });
    await expect(
      locateOnce(geolocation, { timeoutMs: 15_000 })
    ).resolves.toEqual({
      kind: 'located',
      fix: {
        lat: 50.94,
        lng: 6.96,
        accuracyM: 12,
        timestamp: 1_790_000_000_000,
      },
    });
    // The timeout is the browser's own, passed through, and a cached fix is
    // not accepted: the pin flies to where the user IS.
    expect(calls).toEqual([
      { timeout: 15_000, maximumAge: 0, enableHighAccuracy: true },
    ]);
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
    [42, 'unavailable'],
  ] as const)(
    'resolves error code %i as %s, never rejecting',
    async (code, state) => {
      const { geolocation } = geolocationThat((_ok, fail) => {
        fail(failure(code));
      });
      await expect(
        locateOnce(geolocation, { timeoutMs: 1_000 })
      ).resolves.toEqual({
        kind: 'failed',
        state,
      });
    }
  );

  it('reports a browser without geolocation as unavailable', async () => {
    await expect(locateOnce(undefined, { timeoutMs: 1_000 })).resolves.toEqual({
      kind: 'failed',
      state: 'unavailable',
    });
  });

  it('reports a request that throws as unavailable (a button must never stick)', async () => {
    const { geolocation } = geolocationThat(() => {
      throw new Error('insecure context');
    });
    await expect(
      locateOnce(geolocation, { timeoutMs: 1_000 })
    ).resolves.toEqual({
      kind: 'failed',
      state: 'unavailable',
    });
  });

  it.each([
    ['a latitude that is not a number', { latitude: Number.NaN }],
    ['a longitude out of range', { longitude: 200 }],
    ['a latitude out of range', { latitude: -91 }],
  ])('refuses a fix with %s as unavailable', async (_name, coords) => {
    const { geolocation } = geolocationThat((ok) => {
      ok(position(coords));
    });
    await expect(
      locateOnce(geolocation, { timeoutMs: 1_000 })
    ).resolves.toEqual({
      kind: 'failed',
      state: 'unavailable',
    });
  });

  it('drops an accuracy the browser did not give', async () => {
    const { geolocation } = geolocationThat((ok) => {
      ok(position({ accuracy: Number.NaN }));
    });
    const outcome = await locateOnce(geolocation, { timeoutMs: 1_000 });
    expect(outcome.kind === 'located' && outcome.fix.accuracyM).toBeUndefined();
  });

  it('settles once, whichever callback a browser calls twice', async () => {
    // A misbehaving implementation could answer twice; the first answer wins.
    const { geolocation } = geolocationThat((ok, fail) => {
      fail(failure(1));
      ok(position({}));
    });
    await expect(
      locateOnce(geolocation, { timeoutMs: 1_000 })
    ).resolves.toEqual({
      kind: 'failed',
      state: 'denied',
    });
  });

  it('refuses a timeout that is not a positive number', async () => {
    const { geolocation } = geolocationThat((ok) => {
      ok(position({}));
    });
    await expect(locateOnce(geolocation, { timeoutMs: 0 })).rejects.toThrow(
      RangeError
    );
    await expect(
      locateOnce(geolocation, { timeoutMs: Number.NaN })
    ).rejects.toThrow(RangeError);
  });
});
