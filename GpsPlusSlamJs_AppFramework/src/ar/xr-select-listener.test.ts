import { describe, expect, it, vi } from 'vitest';

/**
 * Why these tests matter (Tour Viewer station blocks plan B2b step 5): a
 * visitor taps a pin in AR to read its whole text, and the only tap AR
 * offers is the session's `select`. The lifecycle around it is device-only
 * and race-prone, so it is pinned here: one listener per session (a second
 * would open the sheet twice), the tap's own ray when the viewer space is
 * known (the visitor taps the pin, not the screen centre), a new session
 * after an end heard again, a viewer space from an ended session never
 * used, and nothing heard after `dispose()`.
 */

const h = vi.hoisted(() => ({
  frame: null as ((ctx: unknown) => void) | null,
  unregister: vi.fn(),
}));

vi.mock('./xr-frame-loop.js', () => ({
  registerXrFrameUpdate: (fn: (ctx: unknown) => void) => {
    h.frame = fn;
    return h.unregister;
  },
}));

const { startXrSelectListener, targetRayOf } =
  await import('./xr-select-listener.js');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeSession(
  space: Promise<unknown> = Promise.resolve({ viewer: true })
) {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  return {
    requestReferenceSpace: vi.fn(() => space),
    addEventListener: vi.fn((type: string, fn: (event?: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn(
      (type: string, fn: (event?: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      }
    ),
    emit(type: string, event?: unknown) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

/** A select event whose frame gives the input's pose in the viewer. */
function tapEvent(matrix: number[]) {
  return {
    inputSource: { targetRaySpace: {} },
    frame: {
      getPose: () => ({ transform: { matrix: new Float32Array(matrix) } }),
    },
  };
}

// Exact in float32, as the pose matrix is.
const RAY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, 0.5, 0, 1];

describe('startXrSelectListener', () => {
  it('hears each tap once per session, with its ray once the viewer space is known', async () => {
    const taps: unknown[] = [];
    const listener = startXrSelectListener((tap) => taps.push(tap));
    const session = makeSession();
    h.frame?.({ session });
    h.frame?.({ session }); // every frame: still one listener
    expect(session.count('select')).toBe(1);
    session.emit('select', tapEvent(RAY)); // before the space resolved
    await flush();
    session.emit('select', tapEvent(RAY));
    session.emit('select'); // no event: the screen centre
    expect(taps).toEqual([null, { targetRayInViewer: RAY }, null]);
    listener.dispose();
  });

  it("hears a new session after an end, and never uses an ended session's late viewer space", async () => {
    const taps: unknown[] = [];
    let resolveLate: (v: unknown) => void = () => undefined;
    const first = makeSession(new Promise((r) => (resolveLate = r)));
    const listener = startXrSelectListener((tap) => taps.push(tap));
    h.frame?.({ session: first });
    first.emit('end');
    expect(first.count('select')).toBe(0);
    const second = makeSession(new Promise(() => undefined)); // never resolves
    h.frame?.({ session: second });
    resolveLate({ stale: true });
    await flush();
    second.emit('select', tapEvent(RAY));
    expect(taps).toEqual([null]);
    expect(second.count('select')).toBe(1);
    listener.dispose();
  });

  it('dispose() removes the listeners and the frame update, and hears nothing more', () => {
    const taps: unknown[] = [];
    const listener = startXrSelectListener((tap) => taps.push(tap));
    const session = makeSession();
    h.frame?.({ session });
    listener.dispose();
    listener.dispose();
    expect(h.unregister).toHaveBeenCalled();
    expect(session.count('select')).toBe(0);
    expect(session.count('end')).toBe(0);
    session.emit('select');
    h.frame?.({ session: makeSession() });
    expect(taps).toEqual([]);
  });
});

describe('targetRayOf', () => {
  it('is null without a viewer space, an event, a frame or a pose, and when the frame refuses', () => {
    const space = {} as XRReferenceSpace;
    expect(targetRayOf(tapEvent(RAY), null)).toBeNull();
    expect(targetRayOf(undefined, space)).toBeNull();
    expect(targetRayOf({ inputSource: {} }, space)).toBeNull();
    expect(
      targetRayOf({ inputSource: {}, frame: { getPose: () => null } }, space)
    ).toBeNull();
    expect(
      targetRayOf(
        {
          inputSource: {},
          frame: {
            getPose: () => {
              throw new Error('inactive frame');
            },
          },
        },
        space
      )
    ).toBeNull();
    expect(targetRayOf(tapEvent(RAY), space)).toEqual({
      targetRayInViewer: RAY,
    });
  });
});
