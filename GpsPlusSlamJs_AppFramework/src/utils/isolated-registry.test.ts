/**
 * WHY THESE TESTS MATTER.
 *
 * `frame-loop.ts`, `xr-frame-loop.ts` and `session-disposers.ts` were three
 * structurally identical modules — a `Set` of callbacks, a cached iteration
 * snapshot, register-returns-unregister, isolated invocation, clear — differing
 * only in what the callback is handed and (for disposers) whether the set is
 * emptied before running. Each re-derived the same two subtleties:
 *
 * 1. **Snapshot before iterating.** `frame-loop.ts`'s own comment calls
 *    iterating the live `Set` "a hard-to-debug source of non-determinism": an
 *    unregister from inside a tick would skip a not-yet-visited entry.
 * 2. **Isolate every callback**, so one throwing handler cannot abort the rest.
 *
 * Subtleties re-derived per site get re-derived DIFFERENTLY. These tests pin
 * them once, in the one place they now live, so the three call sites cannot
 * drift apart again.
 */

import { describe, expect, it, vi } from 'vitest';

import { createIsolatedRegistry } from './isolated-registry';

describe('createIsolatedRegistry', () => {
  it('invokes every registered callback with the emitted arguments', () => {
    const registry = createIsolatedRegistry<[number, string]>({
      onError: () => {},
    });
    const a = vi.fn();
    const b = vi.fn();
    registry.register(a);
    registry.register(b);

    registry.run(7, 'x');

    expect(a).toHaveBeenCalledWith(7, 'x');
    expect(b).toHaveBeenCalledWith(7, 'x');
  });

  it('isolates a throwing callback so the rest still run', () => {
    // The reason the pattern exists at all: one broken handler must not take
    // down the frame, the teardown, or the dispatch it happens to sit in.
    const onError = vi.fn();
    const registry = createIsolatedRegistry<[]>({ onError });
    const after = vi.fn();
    registry.register(() => {
      throw new Error('boom');
    });
    registry.register(after);

    expect(() => registry.run()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('returns an unregister function, and registration is idempotent', () => {
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const fn = vi.fn();
    registry.register(fn);
    const off = registry.register(fn);

    registry.run();
    expect(fn).toHaveBeenCalledTimes(1); // one entry, not two

    off();
    registry.run();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('DEFERS a registration made during a run to the next run', () => {
    // Subtlety 1. Without the snapshot the new entry would be visited in the
    // same pass, so a callback that registers a callback would run it a frame
    // early — and, if it registers unconditionally, forever.
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const late = vi.fn();
    registry.register(() => {
      registry.register(late);
    });

    registry.run();
    expect(late).not.toHaveBeenCalled();

    registry.run();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('DEFERS an unregistration made during a run to the next run', () => {
    // The other half of subtlety 1, and the one `frame-loop.ts` warns about:
    // dropping from the live Set mid-iteration SKIPS a not-yet-visited entry.
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const second = vi.fn();
    let offSecond = (): void => {};
    registry.register(() => offSecond());
    offSecond = registry.register(second);

    registry.run();
    // Still called this pass — the snapshot was taken before the first ran.
    expect(second).toHaveBeenCalledTimes(1);

    registry.run();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reuses the iteration snapshot until the registry changes', () => {
    // Not cosmetic: this runs at 60–90 Hz, and re-allocating an identical
    // array every frame between (rare) registry changes was measured worth
    // avoiding. Asserted through `snapshotCount` rather than by timing, which
    // would be flaky.
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    registry.register(() => {});

    registry.run();
    registry.run();
    registry.run();
    expect(registry.snapshotCount).toBe(1);

    registry.register(() => {});
    registry.run();
    expect(registry.snapshotCount).toBe(2);
  });

  it('clear() drops every registration without running any', () => {
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const fn = vi.fn();
    registry.register(fn);

    registry.clear();
    registry.run();

    expect(fn).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  it('runOnce() empties the registry BEFORE running, so a second call is a no-op', () => {
    // The disposer semantics. Clearing first is what makes a second flush
    // harmless rather than a double-teardown of an already-released resource,
    // and stops a disposer that re-registers during teardown from looping.
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const dispose = vi.fn();
    registry.register(dispose);

    registry.runOnce();
    registry.runOnce();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it('runOnce() does not loop when a disposer re-registers during teardown', () => {
    const registry = createIsolatedRegistry<[]>({ onError: () => {} });
    const again = vi.fn();
    registry.register(() => {
      registry.register(again);
    });

    registry.runOnce();

    // The re-registration survives as a pending entry but is NOT run by the
    // flush that triggered it — otherwise teardown could never terminate.
    expect(again).not.toHaveBeenCalled();
  });

  it('reports through the CALLER’s sink, never a logger of its own', () => {
    // REPLACES an earlier test for a `console.error` default. The default was
    // removed deliberately, so asserting it would pin behaviour that no longer
    // exists: this module must import nothing, or `logger.ts` — whose
    // subscriber list is one of these registries — becomes a
    // `logger → isolated-registry → logger` cycle the `check:cycles` gate
    // rejects. A required sink also keeps each registry reporting under its own
    // logger name instead of one shared one.
    const sink = vi.fn();
    const registry = createIsolatedRegistry<[string]>({ onError: sink });
    const boom = new Error('boom');
    registry.register(() => {
      throw boom;
    });

    registry.run('entry');

    expect(sink).toHaveBeenCalledWith(boom);
  });

  it('keeps running the remaining callbacks when the SINK itself throws', () => {
    // Defensive: the sink is caller-supplied, and `logger.ts`'s writes to
    // `console.error`, which a test spy can make throw. A sink failure must not
    // become the thing that aborts the dispatch it was reporting on.
    const registry = createIsolatedRegistry<[]>({
      onError: () => {
        throw new Error('sink failed');
      },
    });
    const after = vi.fn();
    registry.register(() => {
      throw new Error('boom');
    });
    registry.register(after);

    expect(() => registry.run()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
