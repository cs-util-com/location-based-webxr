/**
 * Resolves a scanned QR code to the level file behind it, during a recording.
 *
 * This is the recorder's FIRST network call on a session path, and the input
 * is a sticker someone printed. Both facts shape everything here:
 *
 * - **Nothing is fetched until `qrCodeIsOurs` passes.** Feeding raw decoded
 *   text to the payload decoder would send any text containing a `/` to
 *   raw.githubusercontent.com and any `http…` text to itself — an
 *   attacker-chosen address, reached from the frame path, by pointing a phone
 *   at a sticker. The host allowlist runs first, always.
 * - **It never rejects.** The tracking controller treats a rejected
 *   `fetchLevel` as an error and flaps its status at the detection cadence, so
 *   every failure resolves to a geo-less placeholder instead: a level that
 *   never solves and never votes.
 * - **"Absent" and "broken" are cached differently.** A code that genuinely
 *   has no level in its archive is cached forever — asking again cannot change
 *   the answer. A transport failure is retried with a bounded backoff, because
 *   one DNS hiccup at the first sighting must not poison that code for the
 *   rest of the recording.
 * - **Everything is abortable.** The controller awaits this inside its detect
 *   step, so a hung request would stall detection itself.
 */

import { openRemoteArchive } from 'gps-plus-slam-app-framework/storage';
import { ByteSourceReader } from 'gps-plus-slam-app-framework/storage';
import { parseQrLevelEntries } from 'gps-plus-slam-app-framework/ar/qr/qr-level-archive';
import { qrCodeId } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-code-id';
import { qrCodeIsOurs } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-code-origin';
import { resolveQrPayload } from 'gps-plus-slam-app-framework/utils/qr-payload/qr-launch-dispatch';
import type { QrLevel } from 'gps-plus-slam-app-framework/ar/qr/qr-level';

/** A level that can never solve and never vote — the honest "no". */
const NO_LEVEL: QrLevel = { version: 1, qr: {} };

/** First retry delay after a transport failure; doubles, capped. */
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60_000;

/** How long one resolve may take before it is abandoned. */
const DEFAULT_TIMEOUT_MS = 15_000;

export type QrLevelLookupState =
  | { kind: 'level'; level: QrLevel; id: string }
  | { kind: 'absent'; id: string }
  | { kind: 'not-ours' }
  | { kind: 'failed'; detail: string; retryAtMs: number; attempts: number };

export interface QrLevelSourceDeps {
  allowedHosts: readonly string[];
  /** Bare-name payloads resolve under this prefix. */
  assetPrefix: string;
  /** The site worker's Drive CORS proxy, when one is configured. */
  corsProxyBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Reports what happened, for the HUD. */
  onState?: (text: string, state: QrLevelLookupState) => void;
  /**
   * Injected so these paths are testable without a network — the repo's
   * convention everywhere else that reads a remote archive.
   */
  openArchive?: (url: string) => Promise<OpenedArchiveLike>;
  readLevels?: (
    archive: OpenedArchiveLike
  ) => Promise<ReadonlyMap<string, QrLevel>>;
}

/** The slice of an opened archive this module uses. Not exported: callers
 *  reach it structurally through the injected functions, and a named export
 *  nothing imports is what the dead-code check flags. */
interface OpenedArchiveLike {
  source: unknown;
  dispose: () => void;
}

export interface QrLevelSource {
  /** Wire this into the tracking controller's `fetchLevel`. Never rejects. */
  fetchLevel(text: string): Promise<QrLevel>;
  /** The last thing that happened for a code, for the status line. */
  stateFor(text: string): QrLevelLookupState | undefined;
  /** Abort in-flight work and stop retrying (session end). */
  dispose(): void;
}

export function createQrLevelSource(deps: QrLevelSourceDeps): QrLevelSource {
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const states = new Map<string, QrLevelLookupState>();
  const openArchive =
    deps.openArchive ??
    ((url: string) =>
      openRemoteArchive(url, {
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.corsProxyBaseUrl !== undefined
          ? { corsProxyBaseUrl: deps.corsProxyBaseUrl }
          : {}),
      }));
  const readLevelsFrom = deps.readLevels ?? readLevels;
  const inFlight = new Map<string, Promise<QrLevel>>();
  const controllers = new Set<AbortController>();
  let disposed = false;

  function remember(text: string, state: QrLevelLookupState): QrLevel {
    states.set(text, state);
    deps.onState?.(text, state);
    return state.kind === 'level' ? state.level : NO_LEVEL;
  }

  /** Is the cached answer still the answer, or may we ask again? */
  function cached(text: string): QrLevel | null {
    const state = states.get(text);
    if (state === undefined) return null;
    if (state.kind === 'level') return state.level;
    // "Not ours" and "no such level in this archive" cannot change by asking
    // again; a transport failure can, once its backoff has elapsed.
    if (state.kind === 'failed' && now() >= state.retryAtMs) return null;
    return NO_LEVEL;
  }

  async function resolve(text: string): Promise<QrLevel> {
    if (!qrCodeIsOurs(text, deps.allowedHosts)) {
      return remember(text, { kind: 'not-ours' });
    }
    const payload = launchPayloadOf(text);
    if (payload === null) {
      return remember(text, { kind: 'not-ours' });
    }
    const archiveUrl = await resolveQrPayload(payload, deps.assetPrefix);
    if (archiveUrl === null) {
      return remember(text, { kind: 'not-ours' });
    }

    const id = await qrCodeId(text);
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const archive = await openArchive(archiveUrl);
      try {
        const levels = await readLevelsFrom(archive);
        const level = levels.get(id);
        if (level === undefined) return remember(text, { kind: 'absent', id });
        return remember(text, { kind: 'level', level, id });
      } finally {
        archive.dispose();
      }
    } catch (err) {
      const previous = states.get(text);
      const attempts = previous?.kind === 'failed' ? previous.attempts + 1 : 1;
      const backoff = Math.min(
        RETRY_BASE_MS * 2 ** (attempts - 1),
        RETRY_MAX_MS
      );
      return remember(text, {
        kind: 'failed',
        detail: err instanceof Error ? err.message : String(err),
        retryAtMs: now() + backoff,
        attempts,
      });
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  return {
    fetchLevel(text) {
      if (disposed) return Promise.resolve(NO_LEVEL);
      const hit = cached(text);
      if (hit !== null) return Promise.resolve(hit);
      // One request per code at a time: the detector fires at ~8 Hz and would
      // otherwise open a new archive read on every frame while the first is
      // still in flight.
      const existing = inFlight.get(text);
      if (existing !== undefined) return existing;
      const run = resolve(text).finally(() => {
        inFlight.delete(text);
      });
      inFlight.set(text, run);
      return run;
    },
    stateFor: (text) => states.get(text),
    dispose() {
      disposed = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      inFlight.clear();
    },
  };
}

/** The `?qr=` value of one of OUR launch URLs — never the raw text. */
function launchPayloadOf(text: string): string | null {
  try {
    return new URL(text).searchParams.get('qr');
  } catch {
    return null;
  }
}

/** Read every level out of an opened archive. */
async function readLevels(
  archive: OpenedArchiveLike
): Promise<ReadonlyMap<string, QrLevel>> {
  const { ZipReader, TextWriter } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new ByteSourceReader(archive.source as never));
  const entries = await reader.getEntries();
  const byName = new Map(
    entries.filter((e) => !e.directory).map((e) => [e.filename, e])
  );
  return parseQrLevelEntries([...byName.keys()], async (name) => {
    const entry = byName.get(name);
    if (entry === undefined) throw new Error(`missing entry: ${name}`);
    return (await entry.getData?.(new TextWriter())) ?? '';
  });
}
