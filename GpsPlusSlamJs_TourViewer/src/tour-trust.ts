/**
 * Trust on first use, keyed by SOURCE (tour kit plan K1, §8 D2): the phone
 * remembers which key signed what it opened, per link (read as a URL,
 * `linkTrustKey`), per
 * printed code and per series, and warns when a source that was signed
 * now serves another key or no signature at all - the two ways someone who
 * took over a link would replace a creator's tour. Keyed by series alone,
 * the check would be bypassed by a fresh series id or a stripped
 * signature, which is why the sources come first.
 *
 * THE FIRST KEY STAYS. A warning does not update the record, so it repeats
 * on every open instead of being learned away after one dismissal (an
 * attacker would otherwise need the visitor to open the tour only once).
 * The one upgrade is unsigned -> signed: the first signature a source ever
 * shows becomes its reference. There is no "trust the new key" action yet:
 * key rotation is the spare key's job (K-D8), and accepting a new key is a
 * creator-tools decision for K2/K3.
 *
 * Kept in `localStorage` (per-device memory, which is all trust on first
 * use is). Safari deletes script-written storage after seven days without
 * a visit; the next open is then a first use again. A storage that cannot
 * be read or written reads as no records and never fails an open.
 */

/** What one open showed: its signer (null when unsigned) and its series
 *  (null without a manifest). A signature this browser cannot check is
 *  NOT an observation - the caller skips the judgement entirely. */
export interface TrustObservation {
  readonly author: string | null;
  readonly seriesId: string | null;
}

export interface TrustRecord {
  /** The key that signed the first signed sight; null while only unsigned
   *  sights were seen. */
  readonly author: string | null;
  readonly seriesId: string | null;
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
}

type TrustSourceKind = "link" | "code";

export type TrustWarning =
  | {
      readonly kind: "source-key-changed";
      readonly source: TrustSourceKind;
      readonly was: string;
      readonly now: string;
    }
  | {
      readonly kind: "source-lost-signature";
      readonly source: TrustSourceKind;
      readonly was: string;
    }
  | {
      readonly kind: "series-key-changed";
      readonly seriesId: string;
      readonly was: string;
      readonly now: string | null;
    };

/** Resolves a relative link (the site's own Drive proxy route) for
 *  parsing; never part of a key. `.invalid` cannot resolve (RFC 2606). */
const RELATIVE_BASE = "https://relative.invalid";

/**
 * A link's record key: the url the archive was read from, PARSED as a URL
 * and serialised again without its fragment (K1 milestone review R5). URL
 * serialisation folds the host's case and drops a default port, and a
 * fragment never reaches the server, so none of them makes another
 * source; the query is kept, because another query can name another file.
 * Without this, each spelling of one link was a "first use", and a
 * stripped signature served under one of them passed silently. A relative
 * link keeps its path and query; text that is no URL at all is kept as is.
 */
export function linkTrustKey(url: string): string {
  return `link:${canonicalLink(url)}`;
}

function canonicalLink(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, RELATIVE_BASE);
  } catch {
    return url;
  }
  parsed.hash = "";
  return parsed.origin === RELATIVE_BASE
    ? `${parsed.pathname}${parsed.search}`
    : parsed.href;
}

/**
 * A printed code's record key. A code reaches the page two ways - a scan
 * reads the printed text (a launch URL carrying `?qr=<payload>`), a
 * `?qr=` boot hands over the payload alone - so a launch URL is named by
 * its payload and both spell one source. Any other code (a plain link) is
 * named by its text.
 */
export function codeTrustKey(printed: string): string {
  let id = printed;
  try {
    id = new URL(printed).searchParams.get("qr") ?? printed;
  } catch {
    // Not a URL: the payload itself.
  }
  return `code:${id}`;
}

const SERIES_PREFIX = "series:";

function sourceKindOf(key: string): TrustSourceKind {
  return key.startsWith("code:") ? "code" : "link";
}

/** The warning for one record against the observation, or null. */
function warningFor(
  key: string,
  record: TrustRecord,
  observed: TrustObservation,
): TrustWarning | null {
  if (record.author === null || record.author === observed.author) return null;
  if (key.startsWith(SERIES_PREFIX)) {
    return {
      kind: "series-key-changed",
      seriesId: key.slice(SERIES_PREFIX.length),
      was: record.author,
      now: observed.author,
    };
  }
  return observed.author === null
    ? {
        kind: "source-lost-signature",
        source: sourceKindOf(key),
        was: record.author,
      }
    : {
        kind: "source-key-changed",
        source: sourceKindOf(key),
        was: record.author,
        now: observed.author,
      };
}

/** The record after this sight: the first key kept, unsigned upgraded. */
function nextRecord(
  record: TrustRecord | undefined,
  observed: TrustObservation,
  nowMs: number,
): TrustRecord {
  if (record === undefined) {
    return { ...observed, firstSeenMs: nowMs, lastSeenMs: nowMs };
  }
  return {
    author: record.author ?? observed.author,
    seriesId: record.seriesId ?? observed.seriesId,
    firstSeenMs: record.firstSeenMs,
    lastSeenMs: nowMs,
  };
}

/**
 * Judge one open against what the phone remembers. Pure: returns the
 * warnings and the records to store, never touching `known`.
 *
 * @param sourceKeys the open's sources (`linkTrustKey`, `codeTrustKey`)
 */
export function judgeTrust(
  known: ReadonlyMap<string, TrustRecord>,
  sourceKeys: readonly string[],
  observed: TrustObservation,
  nowMs: number,
): { warnings: TrustWarning[]; records: Map<string, TrustRecord> } {
  const keys = [
    ...sourceKeys,
    ...(observed.seriesId === null
      ? []
      : [`${SERIES_PREFIX}${observed.seriesId}`]),
  ];
  const records = new Map(known);
  const warnings: TrustWarning[] = [];
  for (const key of keys) {
    const record = known.get(key);
    const warning =
      record === undefined ? null : warningFor(key, record, observed);
    if (warning !== null) warnings.push(warning);
    records.set(key, nextRecord(record, observed, nowMs));
  }
  return { warnings, records };
}

// --- on the device ------------------------------------------------------

/** The two `Storage` methods this module uses (localStorage has them). */
export interface TrustStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "tour-viewer.trust.v1";

/** `localStorage`, or undefined where reading it throws (site data
 *  blocked) or it does not exist (Node). `localStorage` is a getter, and
 *  `typeof` still runs it - hence the try. */
export function trustStorage(): TrustStorage | undefined {
  try {
    return (globalThis as { localStorage?: TrustStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Records kept per device. An open writes up to three (link, code,
 * series); a visitor who opens 160 different tours fills it, and then the
 * least recently seen are forgotten (a first use again). About 200 bytes a
 * record: 500 is ~100 KB of the ~5 MB a browser grants `localStorage`.
 * Reverses for a visitor who opens more than ~160 tours and expects the
 * oldest to still be remembered.
 */
export const MAX_TRUST_RECORDS = 500;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecordShape(value: unknown): value is TrustRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    isNullableString(r["author"]) &&
    isNullableString(r["seriesId"]) &&
    Number.isFinite(r["firstSeenMs"]) &&
    Number.isFinite(r["lastSeenMs"])
  );
}

/** The records on this device; none when the storage is missing, throws
 *  (site data blocked), or holds something unreadable. A record that does
 *  not read costs itself only. */
export function loadTrustRecords(
  storage: TrustStorage | undefined,
): Map<string, TrustRecord> {
  const out = new Map<string, TrustRecord>();
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return out;
    for (const [key, value] of Object.entries(parsed)) {
      if (isRecordShape(value)) out.set(key, value);
    }
  } catch {
    // Unreadable or blocked storage: no memory, never a failed open.
  }
  return out;
}

/** Store the records, keeping the most recently seen
 *  {@link MAX_TRUST_RECORDS}. A write that throws (quota, blocked) is
 *  dropped: the next open is then a first use, never a failure. */
export function saveTrustRecords(
  storage: TrustStorage | undefined,
  records: ReadonlyMap<string, TrustRecord>,
): void {
  const kept = [...records]
    .sort((a, b) => b[1].lastSeenMs - a[1].lastSeenMs)
    .slice(0, MAX_TRUST_RECORDS);
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // See above.
  }
}
