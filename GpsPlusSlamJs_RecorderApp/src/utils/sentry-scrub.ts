/**
 * Error-report scrubber: removes links, file ids and coordinates from the
 * text of an error report before it leaves the device.
 *
 * Pure and dependency-free, so `sentry.ts` can run it from Sentry's
 * `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb` hooks and the
 * rules can be tested without the SDK.
 *
 * @see sentry-scrub.ts.md
 */

/** What every removed piece of text is replaced with. */
export const REDACTED = '[redacted]';

/**
 * A path segment this long, made of the characters file ids use, is treated
 * as an id. Cloud-drive file ids are 25 to 44 characters; the app's own
 * hashed asset names carry a dot and are far shorter.
 */
const ID_SEGMENT_MIN_LENGTH = 25;

/**
 * The fewest decimals at least ONE number of a pair needs for the pair to
 * count as a coordinate: three decimals are about 100 m, which is already a
 * place, and one precise half next to a rounded one still names it. The
 * other number needs a decimal point. Pairs where both numbers have fewer
 * decimals are left alone so ordinary pairs of measurements survive.
 */
const PAIR_MIN_DECIMALS = 3;

/** A subtree deeper than this is replaced, never sent unread. */
const MAX_DEPTH = 24;

/**
 * Characters that end a link inside free text. Braces are NOT among them:
 * the framework logger writes `{n}` for digits inside a link, and the rest
 * of the link after it must go too. `[` and `]` are, so that a scrubbed link
 * (`.../[redacted]`) is left as it is on a second pass.
 */
const URL_STOP = String.raw`\s"'<>()[\]`;

/**
 * No word boundary before the scheme: whether a link is found must not
 * depend on the character in front of it, which another rule may replace
 * (`lat=0https://...` becomes `lat=[redacted]https://...`).
 */
const ABSOLUTE_URL = new RegExp(
  String.raw`([a-z][a-z0-9+.-]*:\/\/)([^${URL_STOP}/?#]+)([^${URL_STOP}]*)`,
  'gi'
);

const RELATIVE_URL_WITH_QUERY = new RegExp(
  String.raw`(^|[\s"'(=])(\/[^${URL_STOP}?#]*)([?#][^${URL_STOP}]+)`,
  'g'
);

const ID_SEGMENT = new RegExp(
  String.raw`\/[A-Za-z0-9_-]{${ID_SEGMENT_MIN_LENGTH},}(?=\/|$)`,
  'g'
);

/** A label's separator and its number, quoted or not: `":"48.1"`, `= 48`. */
const LABELLED_VALUE = String.raw`("?\s*[:=]?\s*)"?-?\d+(?:\.\d+)?"?`;

/**
 * `lat`, `latitude`, `lon`, `lng` or `longitude` in any case, after anything
 * but a letter (`lat`, `start_lat`, `0lat`); not inside a longer word
 * (`flat`, `salon`). A digit in front does not stop it, because another rule
 * may turn that digit into `]`, and the second pass must find what the first
 * found.
 */
const KEYED_COORDINATE = new RegExp(
  String.raw`(?<![a-z])(lat|latitude|lon|lng|longitude)${LABELLED_VALUE}`,
  'gi'
);

/** The same labels in camelCase after a lowercase prefix (`originLat`). */
const CAMEL_KEYED_COORDINATE = new RegExp(
  String.raw`(?<![A-Za-z])([a-z][A-Za-z0-9]*?(?:Lat|Latitude|Lon|Lng|Longitude))${LABELLED_VALUE}`,
  'g'
);

const PAIR_PRECISE = String.raw`-?\d{1,3}\.\d{${PAIR_MIN_DECIMALS},}`;
const PAIR_ANY = String.raw`-?\d{1,3}\.\d+`;
const PAIR_SEPARATOR = String.raw`(?:\s*,\s*|\s+)`;
const COORDINATE_PAIR = new RegExp(
  String.raw`(?<![\d.])(?:${PAIR_PRECISE}${PAIR_SEPARATOR}${PAIR_ANY}|${PAIR_ANY}${PAIR_SEPARATOR}${PAIR_PRECISE})(?![\d.])`,
  'g'
);

/**
 * A value that is nothing but a query or a fragment: the SDK stores a
 * request's `?id=...` and `#...` as span attributes of their own, with no
 * path in front that would mark them as part of a link.
 */
const QUERY_OR_FRAGMENT_ONLY = /^[?#]\S+$/;

/** A path of this site: id-like segments go, the rest stays. */
function scrubOwnPath(path: string): string {
  return path.replace(ID_SEGMENT, `/${REDACTED}`);
}

/**
 * Splits a link's remainder at its first `?` or `#`; a non-empty query or
 * fragment is replaced as a whole (a tour link carries the tour's address
 * there, the file service the file id).
 */
function scrubOwnRest(rest: string): string {
  const cut = rest.search(/[?#]/);
  if (cut === -1) return scrubOwnPath(rest);
  const tail = rest.slice(cut);
  return (
    scrubOwnPath(rest.slice(0, cut)) + (tail.length > 1 ? `?${REDACTED}` : tail)
  );
}

/**
 * Scrubs one piece of text.
 *
 * - A link to `ownHost` keeps its path (stack traces need the script paths)
 *   but loses its query, its fragment and any id-like path segment.
 * - A link to any other host keeps only the host: its path can name a shared
 *   file or, for map tiles, a place.
 * - A relative link loses its query and fragment.
 * - A latitude/longitude pair, or a number labelled lat/lon (also as
 *   `originLat` or `start_lat`), is removed.
 * - A string that is only a query or a fragment (`?id=...`) is removed. This
 *   rule runs last, so that a string the other rules turn into one
 *   (`?48.1371 11.5761` -> `?[redacted]`) is not changed again on a second
 *   pass.
 *
 * @param text any string; non-strings are the caller's concern
 * @param ownHost this site's host (`location.host`); when unknown every link
 *   is treated as foreign, which removes more, never less
 */
export function scrubText(text: string, ownHost: string | undefined): string {
  const own = ownHost?.toLowerCase();
  // Coordinates go BEFORE links: `[redacted]` ends a link, so a coordinate
  // removed from inside a kept link of this site after the link rules had
  // run would split that link on a second pass and expose what follows.
  const scrubbed = text
    .replace(KEYED_COORDINATE, `$1$2${REDACTED}`)
    .replace(CAMEL_KEYED_COORDINATE, `$1$2${REDACTED}`)
    .replace(COORDINATE_PAIR, REDACTED)
    .replace(
      ABSOLUTE_URL,
      (match, scheme: string, host: string, rest: string) => {
        if (own !== undefined && host.toLowerCase() === own) {
          return scheme + host + scrubOwnRest(rest);
        }
        return rest === '' || rest === '/'
          ? match
          : `${scheme}${host}/${REDACTED}`;
      }
    )
    .replace(
      RELATIVE_URL_WITH_QUERY,
      (_match, lead: string, path: string) =>
        `${lead}${scrubOwnPath(path)}?${REDACTED}`
    );
  return QUERY_OR_FRAGMENT_ONLY.test(scrubbed) ? REDACTED : scrubbed;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy of `value` with every string scrubbed by {@link scrubText}.
 *
 * Arrays and plain objects are copied (cycles are kept as cycles); numbers,
 * booleans and other objects are passed through untouched, so event ids,
 * timestamps and status codes survive. A subtree deeper than {@link MAX_DEPTH}
 * is replaced by {@link REDACTED}. The input is never changed.
 */
export function scrubDeep<T>(value: T, ownHost: string | undefined): T {
  const copies = new WeakMap<object, unknown>();

  const walk = (node: unknown, depth: number): unknown => {
    if (typeof node === 'string') return scrubText(node, ownHost);
    if (node === null || typeof node !== 'object') return node;
    const seen = copies.get(node);
    if (seen !== undefined) return seen;
    if (depth > MAX_DEPTH) return REDACTED;
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      copies.set(node, out);
      for (const item of node) out.push(walk(item, depth + 1));
      return out;
    }
    if (!isPlainObject(node)) return node;
    const out: Record<string, unknown> = {};
    copies.set(node, out);
    for (const [key, item] of Object.entries(node)) {
      out[key] = walk(item, depth + 1);
    }
    return out;
  };

  return walk(value, 0) as T;
}
