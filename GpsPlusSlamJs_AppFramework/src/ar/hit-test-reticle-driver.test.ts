import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, Vector3 } from 'three';

/**
 * Lifecycle + tap-handling tests for the shared hit-test reticle driver.
 *
 * Why these tests matter: this driver was promoted from three app-local
 * copies precisely because its logic is race-prone and device-only — the
 * per-frame rendering is verified manually, but the surrounding XR lifecycle
 * is pure, testable logic that a refactor (or the next copy-paste) can
 * silently break:
 *
 *   1. The session `'end'`/`'select'` listeners must be registered EXACTLY
 *      ONCE per session. The request-retry path resets
 *      `hitTestSourceRequested` on a transient failure, so listeners living
 *      in that block would stack a duplicate on every failed request.
 *   2. `dispose()` must tear down the live XR state: cancel the running
 *      `XRHitTestSource` and remove the listeners via the stored handler.
 *   3. In-flight `requestHitTestSource` races must not leak: a source that
 *      resolves after `dispose()` — or after the session that issued the
 *      request has ended — must be cancelled, never adopted.
 *   4. `onSelect` must fire on EVERY tap with a nullable position (both
 *      migrated tap apps react to surface-less taps: GPS gating and
 *      "point at the floor" hints are app-side decisions).
 *
 * The XR frame loop is mocked to hand the test the raw frame callback (so
 * throws propagate instead of being swallowed by `runXrFrameUpdates`'s
 * per-callback try/catch); the reticle view-model and three.js objects are
 * real, so visibility/pose assertions go through the actual
 * `updateReticle` basis-change math.
 */

const h = vi.hoisted(() => ({
  capturedFrameCb: null as ((ctx: unknown) => void) | null,
  unregisterSpy: vi.fn(),
}));

vi.mock('./xr-frame-loop.js', () => ({
  registerXrFrameUpdate: (fn: (ctx: unknown) => void) => {
    h.capturedFrameCb = fn;
    return h.unregisterSpy;
  },
}));

const { startHitTestReticle } = await import('./hit-test-reticle-driver.js');
const { WEBXR_TO_NUE } = await import('./webxr-nue-basis.js');

/** Flush all pending microtasks (the request chain awaits twice). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FakeSession {
  requestReferenceSpace: ReturnType<typeof vi.fn>;
  requestHitTestSource: ReturnType<typeof vi.fn> | undefined;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  /** Fire all listeners of a type that were added to this fake session. */
  emit(type: string): void;
}

/** Build a minimal `XRSession` fake exposing only what the driver calls. */
function makeSession(
  requestHitTestSource?: ReturnType<typeof vi.fn>
): FakeSession {
  const listeners = new Map<string, Array<() => void>>();
  return {
    requestReferenceSpace: vi.fn(() => Promise.resolve({})),
    requestHitTestSource,
    addEventListener: vi.fn((type: string, handler: () => void) => {
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    }),
    removeEventListener: vi.fn(),
    emit: (type: string) => {
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

interface FakeFrame {
  getHitTestResults: ReturnType<typeof vi.fn>;
}

/** A frame whose single hit reports the given column-major pose matrix. */
function makeHitFrame(matrix: number[] | null): FakeFrame {
  if (matrix === null) {
    return { getHitTestResults: vi.fn(() => []) };
  }
  const hit = { getPose: vi.fn(() => ({ transform: { matrix } })) };
  return { getHitTestResults: vi.fn(() => [hit]) };
}

/** Invoke the captured per-frame callback with a fake XR context. */
function tick(session: FakeSession, frame: FakeFrame): void {
  h.capturedFrameCb?.({
    frame,
    referenceSpace: {},
    session,
    dt: 0,
    elapsed: 0,
  });
}

/** Count calls of `addEventListener`/`removeEventListener` for one type. */
function listenerCalls(
  spy: ReturnType<typeof vi.fn>,
  type: string
): unknown[][] {
  return spy.mock.calls.filter((call) => call[0] === type);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.capturedFrameCb = null;
});

describe('startHitTestReticle — XR lifecycle', () => {
  it("registers the session 'end' listener exactly once across request retries", async () => {
    // The core regression: a transient `requestHitTestSource` failure resets
    // `hitTestSourceRequested`, so the next frame retries the request. The
    // 'end' listener must NOT be re-added on that retry.
    const requestHitTestSource = vi.fn(() =>
      Promise.reject(new Error('transient'))
    );
    const session = makeSession(requestHitTestSource);
    const frame = makeHitFrame(null);

    startHitTestReticle({ arWorldGroup: new Group() });

    tick(session, frame); // frame 1: request starts, 'end' registered
    await flush(); // request rejects -> hitTestSourceRequested reset
    tick(session, frame); // frame 2: retries the request
    await flush();

    expect(listenerCalls(session.addEventListener, 'end')).toHaveLength(1);
    // The retry actually happened (proves the reset path is exercised), so
    // the single-listener result is not just "it only ran once".
    expect(requestHitTestSource).toHaveBeenCalledTimes(2);
  });

  it("lets a fresh session re-register its own 'end' listener after the first ends", async () => {
    // If the session-end reset does not also clear the stored
    // remove-listeners closure, the once-per-session guard stays satisfied
    // and the second session never attaches its own 'end' listener — so its
    // end would never reset the source and a third session would keep a
    // stale, dead handle.
    const session1 = makeSession(
      vi.fn(() => Promise.resolve({ cancel: vi.fn() }))
    );
    const frame = makeHitFrame(null);

    startHitTestReticle({ arWorldGroup: new Group() });

    tick(session1, frame);
    await flush();
    expect(listenerCalls(session1.addEventListener, 'end')).toHaveLength(1);

    session1.emit('end');

    // A fresh session takes over the persistent frame loop.
    const session2 = makeSession(
      vi.fn(() => Promise.resolve({ cancel: vi.fn() }))
    );
    tick(session2, frame);
    await flush();

    expect(listenerCalls(session2.addEventListener, 'end')).toHaveLength(1);
  });

  it("dispose() cancels the live hit-test source and removes the 'end' listener", async () => {
    const cancel = vi.fn();
    const session = makeSession(vi.fn(() => Promise.resolve({ cancel })));
    const frame = makeHitFrame(null);
    const arWorldGroup = new Group();

    const handle = startHitTestReticle({ arWorldGroup });

    tick(session, frame);
    await flush(); // source adopted
    expect(arWorldGroup.children).toHaveLength(1);

    handle.dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
    expect(arWorldGroup.children).toHaveLength(0);

    const added = listenerCalls(session.addEventListener, 'end');
    const removed = listenerCalls(session.removeEventListener, 'end');
    expect(removed).toHaveLength(1);
    // The exact same handler instance must be removed that was added,
    // otherwise `removeEventListener` is a no-op and the listener leaks.
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
  });

  it('dispose() is idempotent — a second call does not cancel or unregister twice', async () => {
    const cancel = vi.fn();
    const session = makeSession(vi.fn(() => Promise.resolve({ cancel })));
    const arWorldGroup = new Group();

    const handle = startHitTestReticle({ arWorldGroup });
    tick(session, makeHitFrame(null));
    await flush();

    handle.dispose();
    handle.dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose() tolerates cancel() throwing (session already dead)', async () => {
    // The app's session-teardown path may run dispose() before this driver's
    // own 'end' listener has fired (listener order is registration order), so
    // cancel() can hit an already-ended session and throw. Teardown must
    // still complete: mesh removed, frame callback unregistered.
    const cancel = vi.fn(() => {
      throw new DOMException('session ended', 'InvalidStateError');
    });
    const session = makeSession(vi.fn(() => Promise.resolve({ cancel })));
    const arWorldGroup = new Group();

    const handle = startHitTestReticle({ arWorldGroup });
    tick(session, makeHitFrame(null));
    await flush();

    expect(() => handle.dispose()).not.toThrow();
    expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
    expect(arWorldGroup.children).toHaveLength(0);
  });

  it('cancels a source that resolves after dispose() (no dangling source)', async () => {
    // Race: dispose() runs while `requestHitTestSource` is still in flight.
    // The resolved source must be cancelled instead of adopted post-teardown.
    const cancel = vi.fn();
    const source = { cancel };
    let resolveSource!: () => void;
    const session = makeSession(
      vi.fn(
        () =>
          new Promise<typeof source>((resolve) => {
            resolveSource = () => resolve(source);
          })
      )
    );

    const handle = startHitTestReticle({ arWorldGroup: new Group() });
    tick(session, makeHitFrame(null));
    await flush(); // request now pending on `resolveSource`

    handle.dispose();
    resolveSource();
    await flush();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a source that resolves after its issuing session ended (never adopts it into the next session)', async () => {
    // Race: session 1 ends while its request is in flight; session 2 starts
    // and issues its own request. When session 1's source finally resolves it
    // belongs to a dead session — adopting it would shadow session 2's source
    // (the reticle would silently stop tracking), and not cancelling it leaks
    // the stale handle.
    const cancel1 = vi.fn();
    const source1 = { cancel: cancel1 };
    let resolveSource1!: () => void;
    const session1 = makeSession(
      vi.fn(
        () =>
          new Promise<typeof source1>((resolve) => {
            resolveSource1 = () => resolve(source1);
          })
      )
    );

    startHitTestReticle({ arWorldGroup: new Group() });
    tick(session1, makeHitFrame(null));
    await flush(); // session 1's request pending

    session1.emit('end');

    const source2 = { cancel: vi.fn() };
    const session2 = makeSession(vi.fn(() => Promise.resolve(source2)));
    tick(session2, makeHitFrame(null)); // session 2 issues its own request
    resolveSource1(); // ...and only now does session 1's source resolve
    await flush();

    expect(cancel1).toHaveBeenCalledTimes(1);

    // Session 2's own source must drive the reticle: a surface hit shows it.
    const matrix = new Matrix4().makeTranslation(1, 2, 3).toArray();
    const frame = makeHitFrame(matrix);
    tick(session2, frame);
    expect(frame.getHitTestResults).toHaveBeenCalledWith(source2);
  });

  it("ignores a previous session's late request failure (no duplicate in-flight request)", async () => {
    // Race: session 1's request REJECTS after session 2 already started its
    // own request. The catch must not reset `hitTestSourceRequested` for the
    // new session — that would let a later frame start a second, concurrent
    // request whose loser leaks uncancelled.
    let rejectSource1!: () => void;
    const session1 = makeSession(
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectSource1 = () => reject(new Error('late failure'));
          })
      )
    );

    startHitTestReticle({ arWorldGroup: new Group() });
    tick(session1, makeHitFrame(null));
    await flush(); // session 1's request pending

    session1.emit('end');

    const request2 = vi.fn(() => new Promise(() => undefined)); // stays pending
    const session2 = makeSession(request2);
    tick(session2, makeHitFrame(null)); // session 2 issues its own request
    rejectSource1(); // ...then session 1's request fails late
    await flush();
    tick(session2, makeHitFrame(null)); // must NOT start another request
    await flush(); // let any (wrongly) started request reach the session

    expect(request2).toHaveBeenCalledTimes(1);
  });
});

describe('startHitTestReticle — reticle driving', () => {
  it('shows the reticle at the NUE-transformed hit pose when a surface is found', async () => {
    const source = { cancel: vi.fn() };
    const session = makeSession(vi.fn(() => Promise.resolve(source)));
    const arWorldGroup = new Group();

    const handle = startHitTestReticle({ arWorldGroup });
    tick(session, makeHitFrame(null));
    await flush(); // adopt the source

    const matrix = new Matrix4().makeTranslation(1, 2, 3).toArray();
    tick(session, makeHitFrame(matrix));

    expect(handle.isVisible()).toBe(true);
    // The driver must route the pose through the real view-model, which
    // applies the WebXR→NUE basis change (the bit a hand-rolled copy is most
    // likely to drop).
    const expected = new Vector3().setFromMatrixPosition(
      new Matrix4().multiplyMatrices(
        WEBXR_TO_NUE,
        new Matrix4().fromArray(matrix)
      )
    );
    const actual = handle.getWorldPosition(new Vector3());
    expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
  });

  it('hides the reticle when the source is live but no surface is hit', async () => {
    const source = { cancel: vi.fn() };
    const session = makeSession(vi.fn(() => Promise.resolve(source)));

    const handle = startHitTestReticle({ arWorldGroup: new Group() });
    tick(session, makeHitFrame(null));
    await flush();

    const matrix = new Matrix4().makeTranslation(1, 2, 3).toArray();
    tick(session, makeHitFrame(matrix));
    expect(handle.isVisible()).toBe(true);

    tick(session, makeHitFrame(null));
    expect(handle.isVisible()).toBe(false);
  });

  it('keeps the reticle hidden on runtimes without requestHitTestSource', async () => {
    // Older WebXR builds: `requestHitTestSource` is undefined -> source stays
    // null -> reticle hidden every frame, and nothing throws.
    const session = makeSession(undefined);
    const frame = makeHitFrame(null);

    const handle = startHitTestReticle({ arWorldGroup: new Group() });
    tick(session, frame);
    await flush();
    tick(session, frame);

    expect(handle.isVisible()).toBe(false);
    expect(frame.getHitTestResults).not.toHaveBeenCalled();
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe('startHitTestReticle — onSelect (tap) handling', () => {
  /** Boot a driver with an adopted source and a visible-or-not reticle. */
  async function startWithSelect() {
    const onSelect = vi.fn();
    const source = { cancel: vi.fn() };
    const session = makeSession(vi.fn(() => Promise.resolve(source)));
    startHitTestReticle({ arWorldGroup: new Group(), onSelect });
    tick(session, makeHitFrame(null));
    await flush(); // adopt the source
    return { onSelect, session };
  }

  it('fires with the reticle world position when a surface is present', async () => {
    const { onSelect, session } = await startWithSelect();
    const matrix = new Matrix4().makeTranslation(1, 2, 3).toArray();
    tick(session, makeHitFrame(matrix));

    session.emit('select');

    expect(onSelect).toHaveBeenCalledTimes(1);
    const position = onSelect.mock.calls[0]?.[0] as Vector3;
    const expected = new Vector3().setFromMatrixPosition(
      new Matrix4().multiplyMatrices(
        WEBXR_TO_NUE,
        new Matrix4().fromArray(matrix)
      )
    );
    expect(position.distanceTo(expected)).toBeLessThan(1e-10);
  });

  it('fires with null on a surface-less tap (the app decides what to do)', async () => {
    // Both migrated tap apps NEED surface-less taps: MinimalExample's GPS
    // gate takes precedence over the surface check, and WayfindingHudDemo
    // shows its "point at the floor" hint. Swallowing these taps would
    // silently drop that behavior.
    const { onSelect, session } = await startWithSelect();
    tick(session, makeHitFrame(null)); // no surface

    session.emit('select');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBeNull();
  });

  it("registers the 'select' listener exactly once across request retries", async () => {
    const onSelect = vi.fn();
    const requestHitTestSource = vi.fn(() =>
      Promise.reject(new Error('transient'))
    );
    const session = makeSession(requestHitTestSource);
    const frame = makeHitFrame(null);

    startHitTestReticle({ arWorldGroup: new Group(), onSelect });
    tick(session, frame);
    await flush();
    tick(session, frame); // retry frame
    await flush();

    expect(listenerCalls(session.addEventListener, 'select')).toHaveLength(1);
    expect(requestHitTestSource).toHaveBeenCalledTimes(2);
  });

  it("wires no 'select' listener at all when onSelect is omitted", async () => {
    // The button-driven app (AnchorStarter) reads the handle at press time;
    // it must not pay for a tap listener it never uses.
    const session = makeSession(
      vi.fn(() => Promise.resolve({ cancel: vi.fn() }))
    );

    const handle = startHitTestReticle({ arWorldGroup: new Group() });
    tick(session, makeHitFrame(null));
    await flush();

    expect(listenerCalls(session.addEventListener, 'select')).toHaveLength(0);
    handle.dispose();
    expect(listenerCalls(session.removeEventListener, 'select')).toHaveLength(
      0
    );
  });

  it("dispose() removes the 'select' listener it added", async () => {
    const session = makeSession(
      vi.fn(() => Promise.resolve({ cancel: vi.fn() }))
    );
    const handle = startHitTestReticle({
      arWorldGroup: new Group(),
      onSelect: vi.fn(),
    });
    tick(session, makeHitFrame(null));
    await flush();

    handle.dispose();

    const added = listenerCalls(session.addEventListener, 'select');
    const removed = listenerCalls(session.removeEventListener, 'select');
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(1);
    // Same handler instance, or removeEventListener is a silent no-op.
    expect(removed[0]?.[1]).toBe(added[0]?.[1]);
  });
});
