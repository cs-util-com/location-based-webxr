/**
 * Tests for `recordDiagnostic` — the log-only action (owner decision,
 * 2026-08-23).
 *
 * Why these tests matter: this action exists to be WRITTEN INTO A RECORDING and
 * for nothing else. That makes its two failure modes unusual, and neither is
 * visible from an app running normally:
 *
 * - **It reaches no reducer and must not need one.** The persistence middleware
 *   writes after `next(action)` regardless of whether any reducer matched, so
 *   the action is deliberately reducer-less. If a future refactor makes
 *   persistence depend on a matching reducer, these tests say so.
 * - **Its slice prefix decides whether it is recorded at all.** The middleware
 *   persists only whitelisted prefixes and drops everything else SILENTLY — no
 *   warning, no error. A typo in the type string would therefore produce an
 *   action that dispatches cleanly, changes nothing, and is never written
 *   anywhere.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSlamAppStore } from './create-slam-app-store';
import { recordDiagnostic } from './diagnostics-action';
import { startSession } from './recording-slice';
import { slicePrefixOf } from './persistence-middleware';
import type { StorageBackend } from '../storage/storage-backend';
import { NullStorageBackend } from '../storage/null-storage-backend';

/** A backend that records what the middleware asked it to write. */
function recordingBackend(): {
  backend: StorageBackend;
  written: { type: string }[];
} {
  const written: { type: string }[] = [];
  const backend = new NullStorageBackend();
  // `unknown`, because that is what the backend's own signature says — the
  // middleware hands it whatever was dispatched. Narrowing here rather than
  // declaring a convenient parameter type keeps the fake honest against the
  // real interface; the convenient version compiled under `test:unit` and
  // failed `typecheck:tests`, which is the split this repo's gate exists for.
  vi.spyOn(backend, 'writeAction').mockImplementation((action: unknown) => {
    if (typeof action === 'object' && action !== null && 'type' in action) {
      written.push(action as { type: string });
    }
    return Promise.resolve();
  });
  return { backend, written };
}

describe('recordDiagnostic', () => {
  it('is a plain action with a stable slice prefix', () => {
    // The prefix is the whole contract with the persistence middleware, so it
    // is asserted directly rather than inferred from a round trip.
    expect(recordDiagnostic.type).toBe('diagnostics/note');
    expect(slicePrefixOf(recordDiagnostic.type)).toBe('diagnostics');
  });

  it('carries its payload through untouched', () => {
    const action = recordDiagnostic({
      kind: 'ar-entry-ready',
      atMs: 1234,
      detail: { afterS: 2.5, aligned: true, contentReady: false },
    });

    expect(action.payload).toEqual({
      kind: 'ar-entry-ready',
      atMs: 1234,
      detail: { afterS: 2.5, aligned: true, contentReady: false },
    });
  });

  it('is written to the recording while a session is running', async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. Without the prefix in the store's
    // whitelist the dispatch below succeeds and writes nothing — the exact
    // silent failure the middleware's drop path produces.
    const { backend, written } = recordingBackend();
    const store = createSlamAppStore({ storageBackend: backend });

    store.dispatch(
      startSession({
        scenarioName: 'test',
        sessionName: 'diagnostics',
        startTime: 0,
      })
    );
    store.dispatch(
      recordDiagnostic({ kind: 'ar-entry-ready', atMs: 1, detail: {} })
    );
    // The write queue is asynchronous by contract, so the spy is inspected
    // only after the store's own flush — not on the accident that today's
    // queue starts a write synchronously when a slot is free.
    await store.flushPendingActionWrites();

    expect(written.map((action) => action.type)).toContain(
      recordDiagnostic.type
    );
  });

  it('is NOT written when no session is recording', async () => {
    // The middleware's session gate applies to this action like any other: a
    // diagnostic dispatched outside a recording is a no-op, not a stray file.
    const { backend, written } = recordingBackend();
    const store = createSlamAppStore({ storageBackend: backend });

    store.dispatch(
      recordDiagnostic({ kind: 'ar-entry-ready', atMs: 1, detail: {} })
    );
    // Flushed BEFORE the negative assertion: an empty spy checked
    // synchronously would also pass while a wrong write was still queued.
    await store.flushPendingActionWrites();

    expect(written).toHaveLength(0);
  });

  it('changes no state, so nothing can come to depend on it', () => {
    // The owner's requirement in their own words: "not really consumed by the
    // store". A reducer added later would make the action's meaning ambiguous —
    // is the recording the record, or is the state? — so the absence of one is
    // asserted rather than assumed.
    const store = createSlamAppStore({
      storageBackend: new NullStorageBackend(),
    });
    const before = store.getState();

    store.dispatch(
      recordDiagnostic({ kind: 'anything', atMs: 7, detail: { a: 1 } })
    );

    expect(store.getState()).toEqual(before);
  });
});
