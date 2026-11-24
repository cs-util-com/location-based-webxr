import { describe, it, expect } from 'vitest';
import type { Pose } from 'gps-plus-slam-app-framework/ar/qr/qr-pose';
import {
  MESSAGES,
  createAnchorsCheck,
  type AnchorsCheckController,
  type StartState,
  type XrAnchorLike,
  type XrFrameLike,
  type XrSessionLike,
  type XrSystemLike,
  type XrTransformLike,
} from './anchors-check-session';
import type { EpisodeEvent, TrackerEvent } from './anchor-jump-tracker';

const pose = (x: number, y: number, z: number): Pose => ({
  position: [x, y, z],
  rotation: [0, 0, 0, 1],
});
const transform = (p: Pose): XrTransformLike => ({
  position: { x: p.position[0], y: p.position[1], z: p.position[2] },
  orientation: {
    x: p.rotation[0],
    y: p.rotation[1],
    z: p.rotation[2],
    w: p.rotation[3],
  },
});

interface FrameSpec {
  camera?: Pose | null;
  emulated?: boolean;
  hit?: Pose | null;
  anchor?: Pose | null;
  /** What `trackedAnchors.has` answers; undefined: no `trackedAnchors`. */
  tracked?: boolean;
  getPoseThrows?: boolean;
  createAnchor?: XrFrameLike['createAnchor'] | null;
}

function frame(spec: FrameSpec = {}): XrFrameLike {
  const camera = spec.camera === undefined ? pose(0, 1.5, 0) : spec.camera;
  const f: XrFrameLike = {
    getViewerPose: () =>
      camera === null
        ? null
        : {
            transform: transform(camera),
            emulatedPosition: spec.emulated ?? false,
          },
    getPose: () => {
      if (spec.getPoseThrows) throw new Error('InvalidStateError');
      return spec.anchor ? { transform: transform(spec.anchor) } : null;
    },
    getHitTestResults: () =>
      spec.hit
        ? [{ getPose: () => ({ transform: transform(spec.hit!) }) }]
        : [],
    ...(spec.tracked === undefined
      ? {}
      : { trackedAnchors: { has: () => spec.tracked! } }),
  };
  if (spec.createAnchor !== null) {
    f.createAnchor =
      spec.createAnchor ??
      (() =>
        Promise.resolve({
          anchorSpace: 'anchor-space',
          delete: () => undefined,
        }));
  }
  return f;
}

function harness(
  opts: {
    features?: readonly string[] | null;
    requestFails?: boolean;
    sceneFails?: boolean;
    showEventsThrows?: boolean;
    xr?: boolean;
  } = {}
) {
  let listeners: Record<string, ((e?: unknown) => void)[]> = {};
  const requests: { mode: string; init: unknown }[] = [];
  const statuses: { text: string; tone: string }[] = [];
  const states: StartState[] = [];
  const shown: { events: readonly TrackerEvent[] }[] = [];
  const scene = {
    onFrame: null as null | ((t: number, f: XrFrameLike, s: unknown) => void),
    marker: [] as (Pose | null)[],
    anchor: [] as (Pose | null)[],
  };
  const features =
    opts.features === undefined
      ? ['hit-test', 'anchors', 'dom-overlay']
      : opts.features;
  // A fresh session per request, as WebXR gives one.
  const makeSession = (): XrSessionLike => {
    const own: Record<string, ((e?: unknown) => void)[]> = {};
    listeners = own;
    return {
      ...(features === null ? {} : { enabledFeatures: features }),
      requestReferenceSpace: () => Promise.resolve('viewer-space'),
      requestHitTestSource: () => Promise.resolve('hit-source'),
      addEventListener: (type: string, listener: (e?: unknown) => void) => {
        (own[type] ??= []).push(listener);
      },
      end: () => {
        for (const l of own.end ?? []) l();
        return Promise.resolve();
      },
    } as XrSessionLike;
  };
  const xr: XrSystemLike = {
    isSessionSupported: () => Promise.resolve(true),
    requestSession: (mode, init) => {
      requests.push({ mode, init });
      return opts.requestFails
        ? Promise.reject(new Error('NotAllowedError'))
        : Promise.resolve(makeSession());
    },
  };
  const transforms: Pose[] = [];
  const controller: AnchorsCheckController = createAnchorsCheck({
    xr: opts.xr === false ? undefined : xr,
    overlayRoot: 'overlay-root',
    scene: {
      start: (_s, onFrame) => {
        scene.onFrame = onFrame;
        return opts.sceneFails
          ? Promise.reject(new Error('no WebGL'))
          : Promise.resolve();
      },
      showReticle: () => undefined,
      showAnchor: (p) => scene.anchor.push(p),
      showMarker: (p) => scene.marker.push(p),
    },
    view: {
      status: (text, tone) => statuses.push({ text, tone }),
      setStartState: (s) => states.push(s),
      showEvents: (events) => {
        if (opts.showEventsThrows) throw new Error('list broke');
        shown.push({ events });
      },
    },
    makeTransform: (p) => {
      transforms.push(p);
      return { transformOf: p };
    },
    environment: { userAgent: 'test-agent' },
    nowIso: () => '2026-01-01T00:00:00.000Z',
  });
  const tick = (t: number, spec?: FrameSpec) =>
    scene.onFrame!(t, frame(spec), 'local-space');
  const select = async (spec?: FrameSpec) => {
    for (const l of listeners.select ?? []) l({ frame: frame(spec) });
    await new Promise((r) => setTimeout(r, 0));
  };
  const lastStatus = () => statuses[statuses.length - 1];
  const lastShown = () => shown[shown.length - 1]?.events ?? [];
  return {
    controller,
    requests,
    statuses,
    states,
    shown,
    scene,
    tick,
    select,
    lastStatus,
    lastShown,
    transforms,
  };
}

const episodesOf = (events: readonly TrackerEvent[]) =>
  events.filter((e): e is EpisodeEvent => 'readings' in e);

describe('support check', () => {
  // Why this matters: a phone without WebXR AR must be told plainly, with
  // the start button off, not left at a silent page.
  it('says so plainly when the browser has no WebXR', async () => {
    const h = harness({ xr: false });
    expect(await h.controller.checkSupport()).toBe(false);
    expect(h.states).toEqual(['unavailable']);
    expect(h.lastStatus()).toEqual({ text: MESSAGES.noWebXr, tone: 'error' });
  });

  it('enables the start button where immersive-ar is supported', async () => {
    const h = harness();
    expect(await h.controller.checkSupport()).toBe(true);
    expect(h.states).toEqual(['idle']);
    expect(h.lastStatus()?.text).toBe(MESSAGES.ready);
  });
});

describe('starting AR', () => {
  // Why this matters: today nothing requests `anchors`; the whole spike
  // rests on asking for it, optionally, with the overlay that shows the
  // verdicts over the camera image.
  it('requests anchors and the dom overlay as optional features', async () => {
    const h = harness();
    await h.controller.toggle();
    expect(h.requests).toEqual([
      {
        mode: 'immersive-ar',
        init: {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['anchors', 'dom-overlay'],
          domOverlay: { root: 'overlay-root' },
        },
      },
    ]);
    expect(h.states).toEqual(['starting', 'running']);
    expect(h.lastStatus()?.text).toBe(MESSAGES.aim);
  });

  // Why this matters: a refused session must revert the button and say why.
  it('reverts and reports when the session is refused', async () => {
    const h = harness({ requestFails: true });
    await h.controller.toggle();
    expect(h.states).toEqual(['starting', 'idle']);
    expect(h.lastStatus()).toEqual({
      text: 'Could not start AR: NotAllowedError',
      tone: 'error',
    });
  });

  // Why this matters: the first question of the spike is whether the
  // feature is granted at all; the answer goes on screen and in the log.
  it('says plainly when anchors are not granted, and refuses a placement', async () => {
    const h = harness({ features: ['hit-test'] });
    await h.controller.toggle();
    expect(h.lastStatus()).toEqual({ text: MESSAGES.noAnchors, tone: 'error' });
    h.tick(0, { hit: pose(0, 0, -1) });
    await h.select();
    expect(h.transforms).toEqual([]);
    expect(h.controller.log()).toContain('anchors: not granted');
  });

  // Why this matters: an older browser may not report enabledFeatures; then
  // the frame's createAnchor decides.
  it('falls back to frame.createAnchor when features are not reported', async () => {
    const h = harness({ features: null });
    await h.controller.toggle();
    h.tick(0, { createAnchor: null });
    expect(h.lastStatus()).toEqual({ text: MESSAGES.noAnchors, tone: 'error' });
    const log = h.controller.log();
    expect(log).toContain('anchors: not reported');
    expect(log).toContain('frame.createAnchor: missing');
  });
});

describe('a session that fails after it started', () => {
  // Why this matters: the session's own end handler resets the page; the
  // cause must be the last word on screen, not "AR ended".
  it('ends the session and leaves the cause on screen', async () => {
    const h = harness({ sceneFails: true });
    await h.controller.toggle();
    expect(h.lastStatus()).toEqual({
      text: 'Could not start AR: no WebGL',
      tone: 'error',
    });
    expect(h.states[h.states.length - 1]).toBe('idle');
  });
});

describe('placing', () => {
  // Why this matters: the anchor and the marker must start at the SAME pose,
  // or every later comparison between them is meaningless.
  it('creates the anchor at the hit pose and puts the marker there too', async () => {
    const h = harness();
    await h.controller.toggle();
    const hit = pose(0.2, 0, -1.5);
    h.tick(0, { hit });
    await h.select();
    expect(h.transforms).toEqual([hit]);
    expect(h.scene.marker).toEqual([hit]);
    expect(h.statuses.map((s) => s.text)).toContain(MESSAGES.placing);
    expect(h.lastStatus()?.text).toBe(MESSAGES.placed);
    expect(h.controller.log()).toContain(
      'placed anchor and marker at p=(0.200, 0.000, -1.500)'
    );
  });

  // Why this matters: the async-UI rule: a failed placement says so, the
  // log keeps it, and the next tap works.
  it('reports and logs a failed placement and lets the next tap try again', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -1) });
    await h.select({
      createAnchor: () => Promise.reject(new Error('no plane')),
    });
    expect(h.lastStatus()).toEqual({
      text: 'Could not create the anchor: no plane',
      tone: 'error',
    });
    expect(h.scene.marker).toEqual([]);
    expect(h.controller.log()).toContain(
      'could not create the anchor: no plane'
    );
    await h.select();
    expect(h.lastStatus()?.text).toBe(MESSAGES.placed);
  });

  it('asks to aim when there is no hit under the ring', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: null });
    await h.select();
    expect(h.lastStatus()?.text).toBe(MESSAGES.noHit);
    expect(h.transforms).toEqual([]);
  });

  // Why this matters: a second tap replaces the anchor; the old one is
  // deleted so ARCore does not keep tracking it.
  it('deletes the previous anchor when a new one is placed', async () => {
    const h = harness();
    await h.controller.toggle();
    const deleted: string[] = [];
    const make = (name: string) => () =>
      Promise.resolve<XrAnchorLike>({
        anchorSpace: name,
        delete: () => deleted.push(name),
      });
    h.tick(0, { hit: pose(0, 0, -1) });
    await h.select({ createAnchor: make('first') });
    await h.select({ createAnchor: make('second') });
    expect(deleted).toEqual(['first']);
  });

  // Why this matters: an anchor that arrives after its session ended
  // belongs to a dead session; it must be deleted, not shown or logged.
  it('deletes an anchor that arrives after the session ended', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -1) });
    let resolve!: (a: XrAnchorLike) => void;
    const deleted: string[] = [];
    await h.select({
      createAnchor: () => new Promise<XrAnchorLike>((r) => (resolve = r)),
    });
    await h.controller.toggle();
    resolve({ anchorSpace: 'late', delete: () => deleted.push('late') });
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted).toEqual(['late']);
    expect(h.scene.marker.filter((m) => m !== null)).toEqual([]);
    expect(h.controller.log()).not.toContain('placed anchor');
    expect(h.lastStatus()?.text).toBe(MESSAGES.ended);
  });

  // Why this matters: a createAnchor that never settles must not leave the
  // next session unable to place an anchor.
  it('lets a new session place although the old placement never settled', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -1) });
    await h.select({ createAnchor: () => new Promise<XrAnchorLike>(() => {}) });
    await h.controller.toggle();
    await h.controller.toggle();
    h.tick(5000, { hit: pose(0, 0, -1) });
    await h.select();
    expect(h.transforms).toHaveLength(2);
    expect(h.lastStatus()?.text).toBe(MESSAGES.placed);
  });
});

describe('frames', () => {
  // Why this matters: end to end through the wiring, a camera jump must
  // reach the on-screen list with the anchor's verdict at every delay.
  it('feeds frames to the tracker and shows a jump with its verdict', async () => {
    const h = harness();
    await h.controller.toggle();
    const spot = pose(0, 0, -2);
    h.tick(0, { hit: spot });
    await h.select();
    for (let i = 1; i < 6; i++)
      h.tick(i * 33, { camera: pose(0, 1.5, -0.01 * i), anchor: spot });
    // The world shifts 0.8 m in x, and the anchor goes with it.
    for (let i = 6; i < 80; i++) {
      h.tick(i * 33, {
        camera: pose(0.8, 1.5, -0.01 * i),
        anchor: pose(0.8, 0, -2),
      });
    }
    const [jump] = episodesOf(h.lastShown());
    expect(jump?.kind).toBe('jump');
    expect(jump?.truncated).toBe(false);
    expect(jump?.readings.at(-1)?.comparison?.verdicts.main).toBe(
      'frame switch'
    );
    expect(h.controller.log()).toContain('jump 1');
  });

  // Why this matters: a lost anchor may return a frozen pose; WebXR's
  // trackedAnchors says so, and such a pose is neither shown nor judged.
  it('does not show or judge an anchor that trackedAnchors does not hold', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -2) });
    await h.select();
    h.tick(33, { anchor: pose(0, 0, -2), tracked: false });
    expect(h.scene.anchor.at(-1)).toBeNull();
    expect(h.controller.log()).toContain('anchor now (tracked no): p=(0.000');
    h.tick(66, { anchor: pose(0, 0, -2), tracked: true });
    expect(h.scene.anchor.at(-1)).toEqual(pose(0, 0, -2));
  });

  // Why this matters: an exception in the frame callback would stop the
  // render loop for good; it is logged once and the next frame runs.
  it('keeps running when a frame throws, and says so once', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -2) });
    await h.select();
    expect(() => h.tick(33, { getPoseThrows: true })).not.toThrow();
    expect(() => h.tick(66, { getPoseThrows: true })).not.toThrow();
    const errors = h.statuses.filter((s) => s.text.includes('A frame failed'));
    expect(errors).toHaveLength(1);
    const log = h.controller.log();
    expect(log).toContain('a frame failed: InvalidStateError');
    expect(log).toContain('frame errors: 2 (first: InvalidStateError)');
    h.tick(99, { anchor: pose(0, 0, -2) });
    expect(h.scene.anchor.at(-1)).toEqual(pose(0, 0, -2));
  });

  // Why this matters: a getPose that throws on every frame must cost only
  // the anchor reading, not the camera tracking: jumps are still logged.
  it('keeps tracking the camera when every anchor read throws', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0, { hit: pose(0, 0, -2) });
    await h.select();
    for (let i = 1; i < 6; i++)
      h.tick(i * 33, { camera: pose(0, 1.5, 0), getPoseThrows: true });
    for (let i = 6; i < 80; i++)
      h.tick(i * 33, { camera: pose(0.8, 1.5, 0), getPoseThrows: true });
    const log = h.controller.log();
    expect(log).toContain('jump 1: dt 33 ms');
    expect(log).toContain('frame errors: 79 (first: InvalidStateError)');
  });

  // Why this matters: the error path itself must not throw; a view that
  // fails would otherwise stop the render loop from inside the catch.
  it('survives a view that throws while it reports an error', async () => {
    const h = harness({ showEventsThrows: true });
    await h.controller.toggle();
    expect(() => h.tick(0)).not.toThrow();
    expect(() => h.tick(33)).not.toThrow();
    expect(h.controller.log()).toContain('a frame failed: list broke');
  });

  // Why this matters: an emulated position is ARCore saying tracking is
  // lost; it must be logged as a loss, not as two jumps.
  it('treats an emulated viewer pose as a tracking loss', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0);
    h.tick(33, { emulated: true, camera: pose(5, 1.5, 0) });
    h.tick(66, { camera: pose(2, 1.5, 0) });
    expect(h.controller.log()).toContain('tracking-loss 1: dt 66 ms');
  });

  // Why this matters: the stop button ends the session, the button reverts
  // and the log is kept for copying, with the session lines.
  it('ends the session on the second toggle and keeps the log', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0);
    await h.controller.toggle();
    expect(h.states).toEqual(['starting', 'running', 'idle']);
    expect(h.lastStatus()?.text).toBe(MESSAGES.ended);
    expect(h.scene.anchor[h.scene.anchor.length - 1]).toBeNull();
    const log = h.controller.log();
    expect(log).toContain('userAgent: test-agent');
    expect(log).toContain('[t 0 ms] session start');
    expect(log).toContain('[t 0 ms] session end');
  });

  // Why this matters: two sessions' frames are not consecutive; a restart
  // must not log a gap or a jump between them.
  it('does not compare the frames of two sessions', async () => {
    const h = harness();
    await h.controller.toggle();
    h.tick(0);
    h.tick(33);
    await h.controller.toggle();
    await h.controller.toggle();
    h.tick(5000, { camera: pose(9, 1.5, 9) });
    h.tick(5033, { camera: pose(9, 1.5, 9) });
    expect(episodesOf(h.lastShown())).toEqual([]);
    expect(h.controller.log().match(/session start/g)).toHaveLength(2);
  });
});
