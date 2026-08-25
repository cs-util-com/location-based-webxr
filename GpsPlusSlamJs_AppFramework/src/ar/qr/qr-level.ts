/**
 * QR level-file loader — Phase 6 / §8 of the QR-code detection & tracking plan.
 *
 * The printed QR encodes only a short URL; everything else lives in the level
 * file fetched from that URL: the physical QR size (drives `solvePnP` + the size
 * self-check), the QR's absolute geo pose (drives the synthetic GPS vote), and
 * the AR content to instantiate. Keeping size/geo out of the QR keeps the
 * printed code low-density and lets authors fix a mis-measured size or relocate
 * without reprinting.
 *
 * This module fetches and DEFENSIVELY validates that external, user-authored
 * document at the boundary (CLAUDE.md "write defensively"). The AR `content`
 * format is an open question (plan §12) — it is carried through opaquely and
 * NOT interpreted here; only the fields the pose + vote need are validated.
 */

import type { Quaternion } from 'gps-plus-slam-js';
import type { QrGeoPose } from './qr-gps-vote.js';

/**
 * A validated QR level file.
 *
 * Both `physicalSizeM` and `geo` are OPTIONAL (Note 3 of the follow-up plan:
 * flat optionals + a capability model, not a discriminated union). Their
 * PRESENCE gates which capabilities activate, and the use-cases are combinable:
 * - `geo` present → the high-weight GPS vote (`buildQrGpsVotes`) runs.
 * - `physicalSizeM` present → size is authored; otherwise it must be MEASURED
 *   first (Note 4 depth path) before size-dependent features (PnP solve, vote)
 *   unlock. See the size lifecycle in `state/qr-detected-slice.ts`.
 * - neither → a debug/observe or trigger-only level (still keyed by payload).
 */
export interface QrLevel {
  /** Schema version for forward-compat. */
  version: number;
  qr: {
    /** Printed physical side length, meters. Optional — may be measured instead. */
    physicalSizeM?: number;
    /** Absolute geo pose of the QR center + heading. Optional — geo-less levels skip the vote. */
    geo?: QrGeoPose;
  };
  /** AR content to instantiate (format deferred — plan §12). Opaque here. */
  content?: unknown;
}

/** Thrown when a fetched level file fails validation. */
export class QrLevelValidationError extends Error {
  constructor(message: string) {
    super(`qr-level: ${message}`);
    this.name = 'QrLevelValidationError';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate the optional `qr.physicalSizeM`. When present it MUST be a positive
 * number (a `0`/negative authored size is a bug, not a "measure it instead"
 * signal). Returns `undefined` when omitted.
 */
function parsePhysicalSize(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value <= 0) {
    throw new QrLevelValidationError(
      '"qr.physicalSizeM" must be a positive number when present'
    );
  }
  return value;
}

/**
 * Validate the optional `qr.geo`. When present every field is validated (a
 * partial geo is a bug — it would silently place the vote wrong). Returns
 * `undefined` when omitted; heading is normalized into `[0, 360)`.
 */
function parseGeo(value: unknown): QrGeoPose | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new QrLevelValidationError('"qr.geo" must be an object when present');
  }
  const { lat, lon, alt, headingDeg } = value;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new QrLevelValidationError(
      '"qr.geo.lat" must be a number in [-90, 90]'
    );
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    throw new QrLevelValidationError(
      '"qr.geo.lon" must be a number in [-180, 180]'
    );
  }
  if (!isFiniteNumber(alt)) {
    throw new QrLevelValidationError('"qr.geo.alt" must be a finite number');
  }
  return { lat, lon, alt, ...parseOrientation(headingDeg, value.rotation) };
}

/**
 * The orientation half of `qr.geo` (6-DoF extension, QR-pose plan
 * 2026-08-25): `headingDeg` is optional WHEN a rotation is present — a
 * floor/ceiling code has no honest heading, and a filler read by a
 * rotation-unaware consumer would silently mis-place it. A pose with
 * NEITHER cannot orient anything and rejects loudly.
 */
function parseOrientation(
  headingDeg: unknown,
  rotationValue: unknown
): Pick<QrGeoPose, 'headingDeg' | 'rotation'> {
  const rotation = parseRotation(rotationValue);
  if (headingDeg === undefined && rotation === undefined) {
    throw new QrLevelValidationError(
      '"qr.geo" must carry "headingDeg" and/or "rotation"'
    );
  }
  if (headingDeg !== undefined && !isFiniteNumber(headingDeg)) {
    throw new QrLevelValidationError(
      '"qr.geo.headingDeg" must be a finite number when present'
    );
  }
  return {
    ...(headingDeg !== undefined
      ? { headingDeg: ((headingDeg % 360) + 360) % 360 }
      : {}),
    ...(rotation !== undefined ? { rotation } : {}),
  };
}

/**
 * Validate an optional `qr.geo.rotation`: a unit quaternion `[x, y, z, w]`
 * in the NUE GPS-world frame (see {@link QrGeoPose}). A small norm drift
 * (≤ 1e-3, e.g. JSON round-trip loss) is renormalized; anything further off
 * is a broken file, not a rotation.
 */
function parseRotation(value: unknown): Quaternion | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(isFiniteNumber)
  ) {
    throw new QrLevelValidationError(
      '"qr.geo.rotation" must be an array of 4 finite numbers when present'
    );
  }
  // Checked element reads: the length===4 guard above makes these always
  // defined, but `noUncheckedIndexedAccess` (tsc) and the every()-narrowing
  // eslint sees disagree about destructuring — this form satisfies both.
  const [x, y, z, w] = [value[0], value[1], value[2], value[3]];
  if (
    x === undefined ||
    y === undefined ||
    z === undefined ||
    w === undefined
  ) {
    throw new QrLevelValidationError(
      '"qr.geo.rotation" must be an array of 4 finite numbers when present'
    );
  }
  const norm = Math.hypot(x, y, z, w);
  if (Math.abs(norm - 1) > 1e-3) {
    throw new QrLevelValidationError(
      '"qr.geo.rotation" must be a unit quaternion'
    );
  }
  return [x / norm, y / norm, z / norm, w / norm];
}

/**
 * Validate an already-parsed value as a {@link QrLevel}. Throws
 * {@link QrLevelValidationError} with a descriptive message on any violation.
 */
export function parseQrLevel(data: unknown): QrLevel {
  if (!isRecord(data)) {
    throw new QrLevelValidationError('level file must be a JSON object');
  }
  if (!isFiniteNumber(data.version)) {
    throw new QrLevelValidationError('missing/invalid "version"');
  }
  if (!isRecord(data.qr)) {
    throw new QrLevelValidationError('missing/invalid "qr"');
  }
  const physicalSizeM = parsePhysicalSize(data.qr.physicalSizeM);
  const geo = parseGeo(data.qr.geo);

  return {
    version: data.version,
    qr: {
      ...(physicalSizeM !== undefined ? { physicalSizeM } : {}),
      ...(geo !== undefined ? { geo } : {}),
    },
    content: 'content' in data ? data.content : undefined,
  };
}

/**
 * Serialize a {@link QrLevel} to the JSON document `parseQrLevel` reads —
 * the writer half the schema never had (the authoring loop stands on the
 * exported file being re-readable). The input is re-validated first so a
 * programming error fails LOUD here instead of producing a broken file an
 * author uploads and a visitor cannot open.
 */
export function serializeQrLevel(level: QrLevel): string {
  const validated = parseQrLevel(level);
  return JSON.stringify(validated, null, 2);
}

/** Minimal `fetch` slice used by {@link fetchQrLevel}. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchQrLevelOptions {
  /** Injected fetch (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Fetch and validate a level file from `url`. Rejects with
 * {@link QrLevelValidationError} on a non-OK response, non-JSON body, or a
 * schema violation.
 */
export async function fetchQrLevel(
  url: string,
  options: FetchQrLevelOptions = {}
): Promise<QrLevel> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) {
    throw new QrLevelValidationError('no fetch implementation available');
  }

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { signal: options.signal });
  } catch (err) {
    throw new QrLevelValidationError(
      `fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    throw new QrLevelValidationError(
      `fetch ${url} returned status ${response.status}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new QrLevelValidationError(`response for ${url} was not valid JSON`);
  }
  return parseQrLevel(body);
}
