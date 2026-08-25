/**
 * `buildQrLaunchUrl` — turn (app base URL, asset "map to load" URL) into
 * the launch URL that yields the SPARSEST printable QR code, applying every
 * strategy the 2026-07-05 payload benchmark validated
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-2027-qr-payload-compression-benchmark-results.md):
 *
 * - `raw` — `<base>/?qr=<url>` (minimally escaped); the universal baseline.
 * - `dictionary` — `<base>/?qr=~<A4 blob>`; the `~` marker makes dispatch
 *   unambiguous (a bare name could otherwise be valid base64url).
 * - `template` — raw-GitHub main-branch URLs shrink to `user/repo/path`
 *   (the host and branch are the app's convention, not payload).
 * - `name` — with `defaultAssetPrefix` configured, only the file name
 *   varies, so only the file name is encoded.
 * - `path-base32` (opt-in) — `HTTPS://<HOST>/S/<base32(deflate(dict))>`:
 *   the all-caps form rides QR alphanumeric mode (5.5 bits/char). Opt-in
 *   because the `/S/` route needs a Cloudflare rewrite that is not
 *   deployed yet.
 *
 * The winner is chosen by MEASUREMENT — every candidate is costed with the
 * oracle-locked estimator at the chosen EC level (default Q, decision D2)
 * and the fewest bits win; ties go to the more human-readable form.
 * Decode-side dispatch contract (for the future launch handler):
 * `http…` → raw; `~…` → dictionary; contains `/` → template; else name.
 *
 * Boundary validation throws `TypeError` (bad base/data URL, or a payload
 * so large no QR ≤ v25 holds it); this is a tooling-time API, not a
 * scan-time decoder, so failing loudly is correct here.
 */

import {
  estimateQrSize,
  type QrEcLevel,
  type QrSizeEstimate,
} from './qr-size-estimator';
import {
  encodeDictionaryPayload,
  packDictionaryBytes,
} from './codec-dictionary';
import { encodeBase32Up } from './base32up';
import { compressBytes } from './compression';

/** Not exported on purpose (knip): surfaces via `QrLaunchPlan.strategy`. */
type QrLaunchStrategy =
  | 'name'
  | 'template'
  | 'raw'
  | 'dictionary'
  | 'path-base32';

/** Not exported on purpose (knip): reachable via `QrLaunchPlan.candidates`. */
interface QrLaunchCandidate {
  strategy: QrLaunchStrategy;
  url: string;
  estimate: QrSizeEstimate;
}

export interface QrLaunchPlan extends QrLaunchCandidate {
  /** Every strategy that fit a QR ≤ v25, in readability-preference order. */
  candidates: readonly QrLaunchCandidate[];
}

export interface QrLaunchOptions {
  /** Error-correction level to optimise for. Default 'Q' (print robust). */
  ecLevel?: QrEcLevel;
  /**
   * Where the app's assets live by default, e.g.
   * `https://raw.githubusercontent.com/cs-util-com/GeoTales/refs/heads/main/`
   * (include the trailing slash). Asset URLs under it shrink to the bare
   * remainder — the shortest scannable form.
   */
  defaultAssetPrefix?: string;
  /**
   * Also generate the `HTTPS://<HOST>/S/<BASE32>` path form. Leave off
   * until the static deployment routes `/S/*` to the app.
   */
  allowPathForm?: boolean;
  /**
   * Extra query parameters printed into the launch URL alongside `?qr=`
   * (e.g. the per-code discriminator `{ c: '2' }` of the QR-pose plan).
   * Appended — percent-encoded — to every candidate BEFORE size estimation,
   * so the returned estimate and the fits-a-QR guarantee hold for the string
   * actually printed. The all-caps `/S/` path form cannot carry `&`/`=`/
   * lowercase in alphanumeric mode, so that candidate is dropped whenever
   * extra params are present.
   */
  extraQuery?: Readonly<Record<string, string>>;
}

/** Characters that must never appear literally inside a `?qr=` value. */
const QUERY_UNSAFE = /[&#+%\s]/;
/** raw-GitHub main-branch asset URL → (user, repo, path). */
const GITHUB_TEMPLATE =
  /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?main\/(.+)$/;
/** Bare-name payloads: no '/', no '~', never `http…`. */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const DICTIONARY_MARKER = '~';

export async function buildQrLaunchUrl(
  baseUrl: string,
  dataUrl: string,
  options: QrLaunchOptions = {}
): Promise<QrLaunchPlan> {
  const ecLevel = options.ecLevel ?? 'Q';
  const base = normalizeBaseUrl(baseUrl);
  validateDataUrl(dataUrl);
  const query = `${base}/?qr=`;
  const extraSuffix = buildExtraQuerySuffix(options.extraQuery);

  const urls: [QrLaunchStrategy, string | null][] = [
    ['name', nameUrl(query, dataUrl, options.defaultAssetPrefix)],
    ['template', templateUrl(query, dataUrl)],
    ['raw', rawUrl(query, dataUrl)],
    [
      'dictionary',
      query + DICTIONARY_MARKER + (await encodeDictionaryPayload(dataUrl)),
    ],
    [
      'path-base32',
      // The all-caps alphanumeric form cannot carry extra query params.
      options.allowPathForm && extraSuffix === ''
        ? await pathFormUrl(base, dataUrl)
        : null,
    ],
  ];
  const candidates = collectCandidates(urls, extraSuffix, ecLevel);

  const best = pickFewestBits(candidates);
  if (best === null) {
    throw new TypeError(
      'buildQrLaunchUrl: no launch form fits a scannable QR code (≤ v25) — the data URL is too long'
    );
  }
  return { ...best, candidates };
}

/** Estimate each printable candidate (suffix included — path-base32 is
 *  already null whenever the suffix is non-empty, and appending '' is a
 *  no-op, so one uniform expression covers every case). */
function collectCandidates(
  urls: readonly [QrLaunchStrategy, string | null][],
  extraSuffix: string,
  ecLevel: QrEcLevel
): QrLaunchCandidate[] {
  const candidates: QrLaunchCandidate[] = [];
  for (const [strategy, url] of urls) {
    const printed = url === null ? null : url + extraSuffix;
    const estimate = printed === null ? null : estimateQrSize(printed, ecLevel);
    if (printed !== null && estimate !== null) {
      candidates.push({ strategy, url: printed, estimate });
    }
  }
  return candidates;
}

/** Fewest bits wins; ties keep the earlier (more readable) candidate. */
function pickFewestBits(
  candidates: readonly QrLaunchCandidate[]
): QrLaunchCandidate | null {
  let best: QrLaunchCandidate | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.estimate.bits < best.estimate.bits) {
      best = candidate;
    }
  }
  return best;
}

/** `&k=v&k2=v2` (percent-encoded) for the extra printed params, or ''. */
function buildExtraQuerySuffix(
  extraQuery: Readonly<Record<string, string>> | undefined
): string {
  if (extraQuery === undefined) return '';
  return Object.entries(extraQuery)
    .map(
      ([key, value]) =>
        `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('');
}

/** Accepts `gps.csutil.com`, adds https://, strips one trailing slash. */
function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new TypeError(
      'buildQrLaunchUrl: base URL must be a non-empty string'
    );
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)
    ? baseUrl
    : `https://${baseUrl}`;
  const trimmed = withScheme.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(trimmed) || !isParseableUrl(trimmed)) {
    throw new TypeError(
      `buildQrLaunchUrl: base URL must be http(s), got "${baseUrl}"`
    );
  }
  return trimmed;
}

function validateDataUrl(dataUrl: string): void {
  if (
    typeof dataUrl !== 'string' ||
    !/^https?:\/\//i.test(dataUrl) ||
    !isParseableUrl(dataUrl)
  ) {
    throw new TypeError(
      'buildQrLaunchUrl: data URL must be an absolute http(s) URL'
    );
  }
}

function isParseableUrl(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Raw baseline: append as-is when query-legal, else percent-encode. */
function rawUrl(query: string, dataUrl: string): string {
  return (
    query + (QUERY_UNSAFE.test(dataUrl) ? encodeURIComponent(dataUrl) : dataUrl)
  );
}

/** `user/repo/path` for raw-GitHub main-branch assets. */
function templateUrl(query: string, dataUrl: string): string | null {
  const match = GITHUB_TEMPLATE.exec(dataUrl);
  if (match === null) {
    return null;
  }
  const payload = `${match[1]}/${match[2]}/${match[3]}`;
  return QUERY_UNSAFE.test(payload) ? null : query + payload;
}

/** Bare remainder under the configured asset prefix. */
function nameUrl(
  query: string,
  dataUrl: string,
  prefix: string | undefined
): string | null {
  if (prefix === undefined || !dataUrl.startsWith(prefix)) {
    return null;
  }
  const name = dataUrl.slice(prefix.length);
  return NAME_PATTERN.test(name) ? query + name : null;
}

/**
 * `HTTPS://<HOST>/S/<base32(deflate-raw(dictionary bytes))>` — only for a
 * host-only base URL (uppercasing a path would change its meaning).
 */
async function pathFormUrl(
  base: string,
  dataUrl: string
): Promise<string | null> {
  if (!/^https?:\/\/[^/]+$/i.test(base)) {
    return null;
  }
  const packed = await compressBytes(
    packDictionaryBytes(dataUrl),
    'deflate-raw'
  );
  return `${base.toUpperCase()}/S/${encodeBase32Up(packed)}`;
}
