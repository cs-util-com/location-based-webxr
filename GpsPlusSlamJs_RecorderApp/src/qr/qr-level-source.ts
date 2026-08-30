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
// Deep-imported: the gate must ask the SAME module that rewrites the URL
// on the way to the network, or the two drift and the gate inspects an
// address nothing fetches.
import { normalizeShareUrl } from 'gps-plus-slam-app-framework/storage/share-link';
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

/**
 * Hosts our own encoder can name in a payload. `raw.githubusercontent.com`
 * is here because the launch contract's GitHub-template form expands to it;
 * the repo and path within it stay attacker-controlled, which is why this is
 * a host allowlist and not a claim that the CONTENT is trusted.
 */
const ARCHIVE_HOSTS: readonly string[] = ['raw.githubusercontent.com'];

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
  /**
   * Wire into the tracking controller's `shouldCacheLevel`.
   *
   * The controller keeps its own per-text level cache. Without this it caches
   * the FIRST answer for the session, so the backoff below — built precisely
   * so one transient failure does not poison a code for the rest of a walk —
   * is never asked for again and is unreachable in production.
   */
  shouldCacheLevel(level: QrLevel): boolean;
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
  const deadlines = new Set<Deadline>();
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
    // The LAUNCH url being ours is not enough. Its `?qr=` payload may be a
    // full URL, and the decoder returns it verbatim — so
    // `https://ours.example/?qr=https://evil.example/x.zip` passes the first
    // gate and would be fetched. A printed sticker costs an attacker nothing,
    // and the result is a ranged GET from the AR frame path to an address of
    // their choosing. The RESOLVED url is therefore checked too, against the
    // hosts we actually serve archives from.
    if (!isAllowedArchiveHost(archiveUrl, deps)) {
      return remember(text, { kind: 'not-ours' });
    }

    const id = await qrCodeId(text);
    // What is bounded here is the WAIT, not the request.
    //
    // `openRemoteArchive` has no abort seam today — no `signal` option — so
    // an underlying fetch cannot be cancelled from here, and pretending
    // otherwise (an AbortController nothing listens to) was worse than saying
    // so. What matters for correctness is that the tracking controller awaits
    // this INSIDE its detect step: an unbounded wait stalls QR detection for
    // the rest of the session, and a session-end wait outlives the session.
    // Racing a deadline fixes both. The orphaned request finishes into
    // nothing. A real abort needs a signal threaded through the storage
    // layer — filed, not faked.
    const deadline = new Deadline(timeoutMs, () => disposed);
    deadlines.add(deadline);
    try {
      const archive = await deadline.race(openArchive(archiveUrl));
      try {
        const levels = await deadline.race(readLevelsFrom(archive));
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
      deadline.cancel();
      deadlines.delete(deadline);
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

    // Only a real level is final. Everything else — absent, not ours, or a
    // transport failure — resolves to the same placeholder, and this source
    // decides when to ask again.
    //
    // The comparison is by IDENTITY, and that is only sound because the
    // tracking controller passes back the very object it awaited from
    // `fetchLevel` (`qr-tracking-controller.ts:242,247`). A caller that
    // cloned, normalized or round-tripped the level before asking would get
    // `true` for the placeholder and re-introduce the exact defect this
    // exists to prevent — a single failed lookup cached for the session.
    // A structural test (`qr.geo === undefined`) is deliberately NOT used:
    // an archive may legitimately carry a level with no geo, and that answer
    // is final too, so structurally it would be retried forever.
    shouldCacheLevel: (level) => level !== NO_LEVEL,
    dispose() {
      disposed = true;
      // Stop WAITING on everything in flight; the requests themselves cannot
      // be cancelled (see the deadline note above) but nothing waits on them.
      for (const deadline of deadlines) deadline.expire();
      deadlines.clear();
      inFlight.clear();
    },
  };
}

/**
 * Is this an address we actually serve archives from?
 *
 * The set is deliberately small and explicit: the configured asset prefix's
 * host, the Drive proxy's host, and the storage hosts our own encoder can
 * produce. Anything else is a stranger's address that happened to travel
 * inside our launch URL.
 *
 * Gated on the NORMALIZED url - the address that will actually be fetched -
 * not on the payload as printed (PR #380 review). `openRemoteArchive`
 * normalizes internally, so a share PAGE link reaches the network as a
 * different host than the one this saw: our own encoder's token table has
 * entries for `https://github.com/` and `https://drive.google.com/file/d/`,
 * and both were refused here while the TourViewer (which has no such gate)
 * accepted the same printed code. Checking the pre-normalized string was
 * therefore both too strict AND checking the wrong thing.
 *
 * The one RELATIVE address that is genuinely ours is the configured proxy
 * form, whose own JSDoc names `/api/drive-proxy`. It is recognised by
 * RESOLVING against the page origin and comparing origins - never by
 * treating "unparseable" as "ours". That shortcut shipped for one round and
 * reopened the exact hole this function exists to close (PR #381 review):
 * `new URL("//evil.example/x.zip")` throws without a base, but `fetch()`
 * resolves it against the document base and lands on
 * `https://evil.example/x.zip`. The dictionary codec passes every byte
 * >= 0x20 through as a literal, so that payload is fully attacker-controlled
 * and costs a few base64url characters on a printed sticker.
 *
 * A path-relative address resolves to whatever origin the page has, so it is
 * ours by construction; a protocol-relative one is not, and is measured
 * against the allowlist like any other absolute address.
 */
/**
 * An origin no real address can occupy, used only to tell a PATH-relative
 * url apart from a protocol-relative one. Same device `share-link.ts` uses
 * to parse its own relative proxy base.
 */
const RELATIVE_SENTINEL_ORIGIN = 'https://relative.invalid';

/** `new URL`, but `null` instead of a throw. */
function tryUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isAllowedArchiveHost(
  archiveUrl: string,
  deps: QrLevelSourceDeps
): boolean {
  const fetched = normalizeShareUrl(archiveUrl, {
    ...(deps.corsProxyBaseUrl !== undefined
      ? { corsProxyBaseUrl: deps.corsProxyBaseUrl }
      : {}),
  });
  // Resolved against a SENTINEL origin, which separates the two kinds of
  // "relative" that `new URL(value)` alone lumps together as a throw:
  //   `/api/drive-proxy?id=X`  -> origin is the sentinel  -> PATH-relative
  //   `//evil.example/x.zip`   -> origin is evil.example  -> cross-origin
  // Only the first can be reached without leaving our own origin, whatever
  // that origin turns out to be at runtime. Deciding this on the sentinel
  // rather than on `globalThis.location` keeps the rule deterministic and
  // testable off-DOM - and the answer is the same either way, because a
  // path-relative url resolves to the page origin by definition.
  const parsed = tryUrl(fetched, RELATIVE_SENTINEL_ORIGIN);
  if (parsed === null) return false;
  if (parsed.origin === RELATIVE_SENTINEL_ORIGIN) return true;
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set<string>(ARCHIVE_HOSTS);
  for (const candidate of [deps.assetPrefix, deps.corsProxyBaseUrl]) {
    if (candidate === undefined) continue;
    try {
      allowed.add(new URL(candidate).hostname.toLowerCase());
    } catch {
      // A malformed configured prefix simply contributes no host.
    }
  }
  return allowed.has(host);
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

/**
 * A bounded wait. Resolves whatever it is racing, or rejects once the deadline
 * passes — so a caller inside a per-frame code path can never be held open by
 * a slow or hung request.
 */
class Deadline {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expired: (() => void) | null = null;
  private readonly gate: Promise<never>;

  constructor(
    timeoutMs: number,
    private readonly isDisposed: () => boolean
  ) {
    this.gate = new Promise<never>((_, reject) => {
      const fail = (): void => {
        reject(new Error('qr level lookup timed out'));
      };
      this.expired = fail;
      this.timer = setTimeout(fail, timeoutMs);
    });
    // Nothing may observe an unhandled rejection if the race is won.
    this.gate.catch(() => undefined);
  }

  race<T>(work: Promise<T>): Promise<T> {
    if (this.isDisposed()) return Promise.reject(new Error('disposed'));
    return Promise.race([work, this.gate]);
  }

  expire(): void {
    this.expired?.();
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
