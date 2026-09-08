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

import { parseGeoPose } from './geo-pose.js';
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
    /** How trustworthy the minted `geo` is (QR-pose plan M1) — recorded at
     *  authoring time so viewers and the field validation can attribute
     *  error instead of guessing. Optional; validated when present. */
    mintQuality?: QrMintQuality;
  };
  /** AR content to instantiate (format deferred — plan §12). Opaque here. */
  content?: unknown;
}

/** Measurement quality captured when a `QrGeoPose` was minted. All fields
 *  optional (authoring surfaces differ in what they know); each is
 *  validated when present so a broken value fails loud at the boundary. */
export interface QrMintQuality {
  /** Reported GPS accuracy (m) at mint time. Positive. */
  gpsAccuracyM?: number;
  /** Number of GPS observations in the alignment solve at mint time. */
  alignmentSampleCount?: number;
  /** Alignment residual RMSE (m) at mint time. Non-negative. */
  alignmentRmseM?: number;
  /** ISO-8601 timestamp of the mint. Non-empty when present. */
  mintedAtIso?: string;

  // Session-mint fields. A code minted from a whole recording is observed in
  // several separate SIGHTINGS (bursts of detections, minutes apart), and how
  // far those sightings disagree is the evidence that the code stayed put.
  // Zero is meaningful and valid throughout: one sighting has no spread.

  /** Separate sightings the mint combined. Non-negative integer. */
  sightingCount?: number;
  /** Individual detections across those sightings. Non-negative integer. */
  detectionCount?: number;
  /** Cross-sighting rotation disagreement (deg). Non-negative. */
  rotationSpreadDeg?: number;
  /** Cross-sighting position disagreement (m). Non-negative. */
  translationSpreadM?: number;
  /** Spread of the measured physical size (m). Non-negative. */
  physicalSizeSpreadM?: number;
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
 * `undefined` when omitted. The rules live in `geo-pose.ts`, shared with
 * the tour manifest; this wrapper only supplies the document path and the
 * level's error type.
 */
function parseGeo(value: unknown): QrGeoPose | undefined {
  if (value === undefined) return undefined;
  return parseGeoPose(value, {
    path: 'qr.geo',
    fail: (message) => {
      // The level's historical wording for a non-object geo is kept: the
      // tests and the docs both quote it.
      throw new QrLevelValidationError(
        message === '"qr.geo" must be an object'
          ? '"qr.geo" must be an object when present'
          : message
      );
    },
  });
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
  const mintQuality = parseMintQuality(data.qr.mintQuality);

  return {
    version: data.version,
    qr: {
      ...(physicalSizeM !== undefined ? { physicalSizeM } : {}),
      ...(geo !== undefined ? { geo } : {}),
      ...(mintQuality !== undefined ? { mintQuality } : {}),
    },
    content: 'content' in data ? data.content : undefined,
  };
}

/** Validate the optional `qr.mintQuality` (see {@link QrMintQuality}). */
function parseMintQuality(value: unknown): QrMintQuality | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new QrLevelValidationError(
      '"qr.mintQuality" must be an object when present'
    );
  }
  // Field-by-field validation, driven by a table rather than by nine
  // near-identical if-blocks: the block list grew with the session-mint
  // fields, and copy-pasted validation is exactly how one of them ends up
  // silently unchecked.
  const quality: Record<string, number | string> = {};
  for (const [key, kind] of Object.entries(MINT_QUALITY_FIELDS)) {
    const raw = value[key];
    if (raw === undefined) continue;
    quality[key] = checkMintQualityField(key, raw, kind);
  }
  return quality;
}

/** The validation shapes a `mintQuality` field can take. */
type MintQualityKind = 'positive' | 'non-negative' | 'count' | 'text';

/** How each `mintQuality` field is validated. */
const MINT_QUALITY_FIELDS = {
  gpsAccuracyM: 'positive',
  alignmentSampleCount: 'count',
  alignmentRmseM: 'non-negative',
  mintedAtIso: 'text',
  sightingCount: 'count',
  detectionCount: 'count',
  rotationSpreadDeg: 'non-negative',
  translationSpreadM: 'non-negative',
  physicalSizeSpreadM: 'non-negative',
  // `satisfies` is load-bearing, not decoration: it is what makes "adding a
  // field means adding a row" TRUE rather than a promise. Without it a field
  // added to QrMintQuality with no row here is silently dropped by
  // serializeQrLevel — the exact trap this table was written to close.
} as const satisfies Record<keyof Required<QrMintQuality>, MintQualityKind>;

/** Validate one present `mintQuality` field, or throw naming it. */
function checkMintQualityField(
  key: string,
  raw: unknown,
  kind: MintQualityKind
): number | string {
  return kind === 'text'
    ? checkMintQualityText(key, raw)
    : checkMintQualityNumber(key, raw, kind);
}

function mintQualityError(key: string, expected: string): never {
  throw new QrLevelValidationError(
    `"qr.mintQuality.${key}" must be ${expected} when present`
  );
}

function checkMintQualityText(key: string, raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    mintQualityError(key, 'a non-empty string');
  }
  return raw;
}

function checkMintQualityNumber(
  key: string,
  raw: unknown,
  kind: Exclude<MintQualityKind, 'text'>
): number {
  if (!isFiniteNumber(raw)) mintQualityError(key, 'a finite number');
  if (kind === 'positive' && raw <= 0) {
    mintQualityError(key, 'a positive number');
  }
  if (kind === 'non-negative' && raw < 0) {
    mintQualityError(key, 'a non-negative number');
  }
  if (kind === 'count' && (raw < 0 || !Number.isInteger(raw))) {
    mintQualityError(key, 'a non-negative integer');
  }
  return raw;
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
