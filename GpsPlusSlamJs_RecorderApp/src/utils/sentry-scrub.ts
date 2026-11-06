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
 * Characters that end a link inside free text: only those no real URL can
 * hold, because a browser encodes them. Brackets, parentheses and `'` are
 * legal in a URL (`?a[0]=s`, `https://[2001:db8::1]/`), so ending a link at one
 * would keep the rest of it; the price is that a closing `)` or `]` right
 * behind a foreign link goes with the link. Braces do not end a link either:
 * the framework logger writes `{n}` for digits inside one. A `[redacted]`
 * inside a link is therefore part of it, which is what removes the `key` of
 * `?lat=[redacted]&key=abc`.
 */
const URL_STOP = String.raw`\s"<>`;

/**
 * Found from its `://`, not from the start of the scheme, so that a long word
 * with no `://` is not rescanned from each of its letters, and whether a link
 * is found does not depend on the character in front of it, which another
 * rule may replace (`lat=0https://...` becomes `lat=[redacted]https://...`).
 */
const ABSOLUTE_URL = new RegExp(
  String.raw`(?<=[a-z][a-z0-9+.-]*)(:\/\/)([^${URL_STOP}/?#]+)([^${URL_STOP}]*)`,
  'gi'
);

/** What a link with no scheme of its own can follow. */
const LINK_LEAD = String.raw`(^|[\s"'(=[])`;

/** `www.example.org/x` and `//cdn.example.org/x`: a host with no scheme. */
const BARE_HOST_URL = new RegExp(
  String.raw`${LINK_LEAD}(\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^${URL_STOP}]*)`,
  'gi'
);

/**
 * `/x`, `./x` or `../x`, query optional: a link with none is matched too, so
 * that it is consumed once rather than rescanned from each `=/` inside it.
 */
const RELATIVE_URL = new RegExp(
  String.raw`${LINK_LEAD}(\.{0,2}\/[^${URL_STOP}?#]*)([?#][^${URL_STOP}]+)?`,
  'g'
);

/**
 * Ends at anything that is not part of a name, not only at `/`: a closing
 * `'`, `)` or `]` stays inside a link (see `URL_STOP`). A dot continues the
 * name, which is what keeps a long hashed asset name.
 */
const ID_SEGMENT = new RegExp(
  String.raw`\/[A-Za-z0-9_-]{${ID_SEGMENT_MIN_LENGTH},}(?![A-Za-z0-9_.-])`,
  'g'
);

/**
 * A label's separator and its number, quoted or not: `":"48.1"`, `= 48`,
 * `: '48.1'`. An index or a unit between the two (`lat1=48.1`, `latDeg=48.1`)
 * counts only with a real separator: without one the digits are the value.
 * A `[redacted]` is a value too, so that `lat1=[redacted]` keeps its index on a
 * second pass.
 */
const LABELLED_VALUE = String.raw`((?:\d{1,2}|_?[Dd]eg(?:rees)?)["']?\s*[:=]\s*|["']?\s*(?:[:=]\s*)?)["']?(?:-?\d+(?:\.\d+)?["']?|\[redacted\])`;

/**
 * One to three digits running on into a word are not a value (`lon0a`,
 * `lat2a9Q` in a hashed asset name): at best they are a whole degree, about
 * 111 km. From four digits on the number names a place, word or not.
 */
const NOT_A_SHORT_RUN_ON = String.raw`(?!\d{1,3}[A-Za-z])`;

/**
 * `lat`, `latitude`, `lon`, `lng` or `longitude` in any case, after anything
 * but a letter (`lat`, `start_lat`, `0lat`); not inside a longer word
 * (`flat`, `salon`). A digit in front does not stop it, because another rule
 * may turn that digit into `]`, and the second pass must find what the first
 * found. `long` counts only with a separator, being an ordinary word. A host
 * can read this way too (`lon5.tiles.example.org`) and is cut
 * like any other text: the link rules still remove all that follows it.
 */
const KEYED_COORDINATE = new RegExp(
  String.raw`(?<![a-z])(lat|latitude|lon|lng|longitude|long(?=["']?\s*[:=]))${NOT_A_SHORT_RUN_ON}${LABELLED_VALUE}`,
  'gi'
);

/**
 * The same labels in camelCase (`originLat`). Found from the label, with the
 * prefix only looked at, so that a long word is not rescanned from each of its
 * letters.
 */
const CAMEL_KEYED_COORDINATE = new RegExp(
  String.raw`(?<=[A-Za-z])(Lat|Latitude|Lon|Lng|Longitude)${NOT_A_SHORT_RUN_ON}${LABELLED_VALUE}`,
  'g'
);

const PAIR_PRECISE = String.raw`-?\d{1,3}\.\d{${PAIR_MIN_DECIMALS},}`;
const PAIR_ANY = String.raw`-?\d{1,3}\.\d+`;
const PAIR_SEPARATOR = String.raw`(?:\s*(?:,|;|\/|\+|%2[Cc]|%20)\s*|\s+)`;
const COORDINATE_PAIR = new RegExp(
  String.raw`(?<![\d.])(?:${PAIR_PRECISE}${PAIR_SEPARATOR}${PAIR_ANY}|${PAIR_ANY}${PAIR_SEPARATOR}${PAIR_PRECISE})(?!\d|\.\d)`,
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

/** Removes the number behind every coordinate label. */
function scrubLabelled(text: string): string {
  return text
    .replace(KEYED_COORDINATE, `$1$2${REDACTED}`)
    .replace(CAMEL_KEYED_COORDINATE, `$1$2${REDACTED}`);
}

/**
 * Scrubs one link. A user name and password go in every case. The link keeps
 * its path only when it points at this site and holds no second link.
 */
function scrubLink(
  prefix: string,
  authority: string,
  rest: string,
  own: string | undefined
): string {
  const at = authority.lastIndexOf('@');
  const host = authority.slice(at + 1);
  const head = `${prefix}${at === -1 ? '' : `${REDACTED}@`}${host}`;
  if (host.toLowerCase() === own && !rest.includes('://')) {
    return head + scrubOwnRest(rest);
  }
  return rest === '' || rest === '/' ? head + rest : `${head}/${REDACTED}`;
}

/**
 * Scrubs one piece of text.
 *
 * - A link to `ownHost` keeps its path (stack traces need the script paths)
 *   but loses its query, its fragment and any id-like path segment.
 * - A link to any other host keeps only the host: its path can name a shared
 *   file or, for map tiles, a place. A host with no scheme in front
 *   (`www.example.org/x`) counts as one.
 * - A link's user name and password are removed.
 * - A relative link loses its query, its fragment and any id-like segment.
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
  // Coordinates go BEFORE links, so the link rules see a link's final text,
  // markers included, and read it the same way on a second pass. Pairs go
  // before labels: a label takes one number, and `lat=48.1,11.57` holds two.
  const scrubbed = scrubLabelled(text.replace(COORDINATE_PAIR, REDACTED))
    .replace(
      ABSOLUTE_URL,
      (_match, scheme: string, authority: string, rest: string) =>
        scrubLink(scheme, authority, rest, own)
    )
    .replace(
      BARE_HOST_URL,
      (
        _match,
        lead: string,
        slashes: string | undefined,
        host: string,
        rest: string
      ) => lead + scrubLink(slashes ?? '', host, rest, own)
    )
    .replace(
      RELATIVE_URL,
      (_match, lead: string, path: string, tail: string | undefined) =>
        `${lead}${scrubOwnPath(path)}${tail === undefined ? '' : `?${REDACTED}`}`
    );
  return QUERY_OR_FRAGMENT_ONLY.test(scrubbed) ? REDACTED : scrubbed;
}

/** Whether a field of this name holds a coordinate, by the text rules. */
function isCoordinateKey(key: string): boolean {
  const asText = `${key}=0`;
  return scrubLabelled(asText) !== asText;
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
 * timestamps and status codes survive, except that whatever a coordinate's
 * field name (`lat`, `latLng`) holds is replaced by {@link REDACTED}, unless it
 * is empty. A subtree deeper than {@link MAX_DEPTH} is replaced too. The input
 * is never changed.
 */
export function scrubDeep<T>(value: T, ownHost: string | undefined): T {
  const copies = new WeakMap<object, unknown>();

  const walkObject = (node: Record<string, unknown>, depth: number) => {
    const out: Record<string, unknown> = {};
    copies.set(node, out);
    for (const [key, item] of Object.entries(node)) {
      const isEmpty = item === null || item === undefined;
      out[key] =
        !isEmpty && isCoordinateKey(key) ? REDACTED : walk(item, depth + 1);
    }
    return out;
  };

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
    return isPlainObject(node) ? walkObject(node, depth) : node;
  };

  return walk(value, 0) as T;
}
