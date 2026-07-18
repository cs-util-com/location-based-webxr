import { beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { Group, Matrix4 } from 'three';

/**
 * Property-based race test for the hit-test reticle driver.
 *
 * Why this test matters: the driver's whole reason to exist in the framework
 * is that its hand-rolled app copies drifted exactly in the rare
 * interleavings (request in flight across a session end, transient failures
 * followed by retries, dispose mid-request). The example-based tests pin the
 * interleavings we know about; this property drives the driver through
 * arbitrary sequences of frame ticks, request settlements, session ends and
 * taps, and asserts the invariants that must hold under EVERY interleaving:
 *
 *   1. Listener discipline: at most one 'end' and one 'select' listener is
 *      ever added per session.
 *   2. Request discipline: a session never has two of its own hit-test
 *      requests in flight at once.
 *   3. Source hygiene: a source that resolves stale (its issuing session
 *      already ended) is cancelled promptly, never adopted — and
 *      `frame.getHitTestResults` is only ever called with a source issued by
 *      the session currently delivering frames.
 *   4. Teardown: after dispose(), the adopted source of the still-live
 *      session is cancelled (exactly once) and the reticle mesh is removed.
 *
 * Invariant breaches inside fakes/loops are collected as strings in
 * `world.violations` and asserted empty once, unconditionally — keeping
 * `expect` out of conditionals and callbacks.
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

/**
 * Settle the driver's request chain. It is a fixed-depth promise chain (two
 * awaits + a then/catch), so a handful of microtask turns is enough — a
 * macrotask (`setTimeout`) flush here would dominate the property's runtime.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

interface TrackedSource {
  id: number;
  cancel: ReturnType<typeof vi.fn>;
  /** Generation (session index) the issuing request belonged to. */
  issuedGen: number;
  /** Was the issuing session already ended when this source resolved? */
  staleAtResolve: boolean;
}

interface PendingRequest {
  issuedGen: number;
  resolve: (source: TrackedSource) => void;
  reject: (error: Error) => void;
}

interface FakeSession {
  gen: number;
  requestReferenceSpace: () => Promise<object>;
  requestHitTestSource: () => Promise<TrackedSource>;
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: () => void;
  emit: (type: string) => void;
}

/** Mutable interpreter state shared by the helpers below. */
interface World {
  currentGen: number;
  session: FakeSession;
  pending: PendingRequest[];
  resolved: TrackedSource[];
  violations: string[];
  /** Stale sources already reported, so a breach is recorded once. */
  reportedStale: Set<number>;
}

function makeSession(world: World, gen: number): FakeSession {
  const listeners = new Map<string, Array<() => void>>();
  const addCounts = new Map<string, number>();
  let inFlight = 0;
  return {
    gen,
    requestReferenceSpace: () => Promise.resolve({}),
    requestHitTestSource: () => {
      inFlight += 1;
      if (inFlight > 1) {
        world.violations.push(`gen ${gen}: ${inFlight} concurrent requests`);
      }
      return new Promise<TrackedSource>((resolve, reject) => {
        world.pending.push({
          issuedGen: gen,
          resolve: (source) => {
            inFlight -= 1;
            resolve(source);
          },
          reject: (error) => {
            inFlight -= 1;
            reject(error);
          },
        });
      });
    },
    addEventListener: (type, handler) => {
      const count = (addCounts.get(type) ?? 0) + 1;
      addCounts.set(type, count);
      if (count > 1) {
        world.violations.push(`gen ${gen}: '${type}' listener added ${count}x`);
      }
      const list = listeners.get(type) ?? [];
      list.push(handler);
      listeners.set(type, list);
    },
    removeEventListener: () => undefined,
    emit: (type) => {
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

const HIT_MATRIX = new Matrix4().makeTranslation(1, 2, 3).toArray();

/** A frame that reports one hit and flags reads of stale-session sources. */
function makeFrame(world: World) {
  return {
    getHitTestResults: (source: TrackedSource) => {
      if (source.issuedGen !== world.session.gen) {
        world.violations.push(
          `frame read source of gen ${source.issuedGen} during gen ${world.session.gen}`
        );
      }
      return [{ getPose: () => ({ transform: { matrix: HIT_MATRIX } }) }];
    },
  };
}

type Command = 'tick' | 'resolve' | 'reject' | 'end' | 'select';

function applyCommand(world: World, command: Command, tick: () => void): void {
  switch (command) {
    case 'tick':
      tick();
      break;
    case 'resolve': {
      const request = world.pending.shift();
      if (request) {
        const source: TrackedSource = {
          id: world.resolved.length,
          cancel: vi.fn(),
          issuedGen: request.issuedGen,
          staleAtResolve: request.issuedGen !== world.currentGen,
        };
        world.resolved.push(source);
        request.resolve(source);
      }
      break;
    }
    case 'reject':
      world.pending.shift()?.reject(new Error('transient'));
      break;
    case 'end':
      world.session.emit('end');
      world.currentGen += 1;
      world.session = makeSession(world, world.currentGen);
      break;
    case 'select':
      world.session.emit('select');
      break;
  }
}

/** Record any stale-resolved source that was not cancelled promptly. */
function checkStaleCancelled(world: World): void {
  for (const source of world.resolved) {
    const uncancelled = source.cancel.mock.calls.length === 0;
    if (
      source.staleAtResolve &&
      uncancelled &&
      !world.reportedStale.has(source.id)
    ) {
      world.reportedStale.add(source.id);
      world.violations.push(`stale source ${source.id} not cancelled`);
    }
  }
}

/** Post-dispose checks: adopted-source cancellation and cancel-once. */
function checkTeardown(world: World): void {
  const adopted = world.resolved.filter(
    (source) => !source.staleAtResolve && source.issuedGen === world.currentGen
  );
  // Within one session the driver requests at most once successfully, so at
  // most one adopted source can exist for the final session.
  if (adopted.length > 1) {
    world.violations.push(`${adopted.length} adopted sources in final gen`);
  }
  for (const source of adopted) {
    if (source.cancel.mock.calls.length !== 1) {
      world.violations.push(
        `adopted source ${source.id} cancelled ${source.cancel.mock.calls.length}x after dispose`
      );
    }
  }
  for (const source of world.resolved) {
    if (source.cancel.mock.calls.length > 1) {
      world.violations.push(`source ${source.id} cancelled more than once`);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  h.capturedFrameCb = null;
});

describe('startHitTestReticle — interleaving invariants (property)', () => {
  it('holds its race invariants under arbitrary command interleavings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom<Command>(
            'tick',
            'resolve',
            'reject',
            'end',
            'select'
          ),
          { maxLength: 30 }
        ),
        async (commands) => {
          h.capturedFrameCb = null;
          h.unregisterSpy.mockClear();

          const world: World = {
            currentGen: 0,
            session: null as unknown as FakeSession,
            pending: [],
            resolved: [],
            violations: [],
            reportedStale: new Set(),
          };
          world.session = makeSession(world, 0);
          const frame = makeFrame(world);

          const arWorldGroup = new Group();
          const handle = startHitTestReticle({
            arWorldGroup,
            onSelect: vi.fn(),
          });
          const tick = () => {
            h.capturedFrameCb?.({
              frame,
              referenceSpace: {},
              session: world.session,
              dt: 0,
              elapsed: 0,
            });
          };

          for (const command of commands) {
            applyCommand(world, command, tick);
            await flush();
            checkStaleCancelled(world);
          }

          handle.dispose();
          await flush();
          checkTeardown(world);

          expect(world.violations).toEqual([]);
          expect(arWorldGroup.children).toHaveLength(0);
          expect(h.unregisterSpy).toHaveBeenCalledTimes(1);
        }
      ),
      { numRuns: 150 }
    );
  }, 30_000);
});
