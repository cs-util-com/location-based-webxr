/**
 * The code-lock release of the deferred anchors: one call that asks every
 * live anchor set to re-place its anchors once, at its next pass.
 *
 * The QR tracking controller calls {@link requestAnchorRelease} right after
 * a lock's votes were cast, so a code's exact correction lands at once
 * instead of waiting until the content is out of view. Each live set
 * registers a receiver ({@link registerReleaseReceiver}) and keeps its own
 * one-shot flag; with no set live, nothing is stored, so no stale request
 * can wait for a later set.
 *
 * Separately, a request marks the session as "a code voted"
 * ({@link hasCodeVoted}): a set created after the lock (content that loads
 * late) starts with its immature phase already ended. The bit is cleared
 * by the session disposer flush, like every other per-session state.
 *
 * Imports neither three nor the store: the controller's module closure stays
 * as it is. Sidecar: `anchor-release.ts.md`.
 */

import { createLogger } from '../utils/logger';
import { registerSessionDisposer } from './session-disposers';

const log = createLogger('AnchorRelease');

/** Why a release was requested; logged with the commits it causes. */
export type AnchorReleaseReason = 'code-lock';

/** A live anchor set's receiver: it records the request for its next pass. */
export type AnchorReleaseReceiver = (reason: AnchorReleaseReason) => void;

const receivers = new Set<AnchorReleaseReceiver>();
let codeVoted = false;
let disposerRegistered = false;

function ensureSessionReset(): void {
  if (disposerRegistered) return;
  disposerRegistered = true;
  registerSessionDisposer(() => {
    codeVoted = false;
    disposerRegistered = false;
  });
}

/**
 * Ask every live anchor set to re-place its anchors once, at its next pass,
 * and mark this session as one in which a code voted.
 */
export function requestAnchorRelease(reason: AnchorReleaseReason): void {
  if (reason !== 'code-lock') {
    throw new TypeError(
      `requestAnchorRelease: unknown reason ${String(reason)}`
    );
  }
  codeVoted = true;
  ensureSessionReset();
  for (const receiver of [...receivers]) {
    // Isolated: a broken set must not break the lock that asked.
    try {
      receiver(reason);
    } catch (error) {
      log.error('An anchor release receiver threw; continuing', error);
    }
  }
}

/**
 * Register a live set's receiver; returns the unregister function. A
 * receiver that throws is logged and the other receivers still run.
 */
export function registerReleaseReceiver(
  receiver: AnchorReleaseReceiver
): () => void {
  if (typeof receiver !== 'function') {
    throw new TypeError('registerReleaseReceiver: receiver must be a function');
  }
  receivers.add(receiver);
  return () => {
    receivers.delete(receiver);
  };
}

/**
 * Test-only: forget every receiver and the session bit. Test files clear the
 * session disposer registry without running it, which would otherwise leave
 * the bit set for the next test.
 */
export function __resetAnchorReleaseForTests(): void {
  receivers.clear();
  codeVoted = false;
  disposerRegistered = false;
}

/** Whether a code voted in this session (cleared by the session flush). */
export function hasCodeVoted(): boolean {
  return codeVoted;
}
