# `sentry-scrub.ts` - the error-report scrubber

## Purpose

Removes links, file ids and coordinates from the text of an error report
before it leaves the device. `sentry.ts` runs it from Sentry's
`beforeSend`, `beforeSendTransaction`, `beforeSendSpan` and
`beforeBreadcrumb` hooks; it has no
dependency on the SDK, so its rules are tested on their own.

## Public API

- `REDACTED` - the string (`[redacted]`) every removed piece becomes.
- `scrubText(text, ownHost): string` - scrubs one string:
  - a link to `ownHost` keeps its path (stack traces need the script paths
    to find their source maps) but loses its query, its fragment and any
    id-like path segment;
  - a link to any other host keeps only the host (`https://host/[redacted]`):
    its path can name a shared file or, for map tiles, a place. A host with
    no scheme (`www.example.org/x`, `//cdn.example.org/x`) counts as a link;
  - a link ends only at a character no URL can hold (white space, `"`, `<`,
    `>`). Brackets, parentheses, `'` and braces are legal in a URL or written
    by the framework logger (`{n}`), so the rest of the link goes with them,
    and a closing `)` or `]` right behind a foreign link goes too;
  - a link's user name and password are removed
    (`https://[redacted]@host/...`): the browser quotes such a URL in the
    error it throws for it;
  - a link to this site that holds another link (`https://<own>/x/https://b/c`
    or two links joined with no space) counts as foreign;
  - a relative link (`/api/drive-proxy?id=...`, `./t?k=v`) loses its query,
    its fragment and any id-like segment;
  - a number labelled `lat`, `latitude`, `lon`, `lng` or `longitude`
    (`lat=48.1`, `"latitude":48.1`, quoted or not), also after a prefix
    (`originLat`, `start_lng`), loses its value; a word that merely ends
    in a label (`flat`, `salon`) does not count, nor do one to three digits
    running on into a word (`lon0a`, `lat2a9Q` in a hashed asset name). A
    separator is not required (`lat48.1`, `lat48_137154`, `lat48137154N`
    go). A host can read this way and is then cut (`lon[redacted].x.org`);
    the link rules remove what follows it just the same;
  - a pair of decimal numbers that looks like a latitude/longitude pair
    (`48.137154, 11.576124`, `48.1371,11.5761`, `-33.86882 151.20929`,
    `48.1, 11.576124`, `48.1371/11.5761`, `48.1371%2C11.5761`,
    `48.1371+11.5761`) is removed: one of the two needs three or more
    decimals, the other a decimal point;
  - a string that is nothing but a query or a fragment (`?id=...`,
    `#station-2`; the SDK's `http.query` and `http.fragment` span
    attributes) becomes `[redacted]`.
  - Order: coordinates first, then links, then the query-only rule. A
    `[redacted]` does not end a link: a coordinate removed from inside a link
    stays part of it, so its path and query after the marker go too
    (`?lat=48.1&key=abc`) and every pass reads the same link. The query-only
    rule runs last so that a string the other rules reduce to
    `?[redacted]` is not changed again.
- `scrubDeep(value, ownHost): T` - a copy of `value` with every string
  scrubbed. Arrays and plain objects are copied, cycles kept as cycles;
  numbers, booleans and other objects pass through, so event ids,
  timestamps and status codes survive. A number or string under a field
  named like a coordinate (`lat`, `originLon`, by the same rules as the text)
  becomes `[redacted]`: the SDK serialises a rejected plain object into the
  event, and the text rules never see a number. The input is never changed.

## Parameters and why these values

- `ID_SEGMENT_MIN_LENGTH = 25`: cloud-drive file ids are 25 to 44
  characters of `[A-Za-z0-9_-]`; the app's hashed asset names are short and
  carry a dot. A lower value (say 16) would start eating ordinary path
  words joined by hyphens; a higher one (say 40) would let shorter drive ids
  through.
- `PAIR_MIN_DECIMALS = 3`: three decimals of a degree are about 100 m, which
  already names a place, and ONE precise number of a pair is enough (a
  rounded latitude beside a precise longitude still names the place). Two
  would also remove ordinary pairs of measurements (`1.50, 2.25`) from log
  lines; four would let a 100 m position through. The cost of "either
  number": a pair of measurements where one has three decimals
  (`0.125 1.5`) is removed too, which removes more, never less. Labelled
  coordinates are removed at any precision.
- `MAX_DEPTH = 24`: deeper subtrees are replaced by `[redacted]` rather than
  sent unread. Sentry events are far shallower; the limit only matters for
  a pathological breadcrumb payload.

## Invariants

- Idempotent: scrubbing twice changes nothing more than scrubbing once
  (property test). Sentry runs the breadcrumb hook and the event hook over
  the same text.
- Text with no digits, slashes, `=`, `:`, `?` or `#` comes back unchanged.
- Removes more, never less, when `ownHost` is unknown: every link is then
  treated as foreign.
- Linear in the text: every rule is anchored on something it consumes (`://`,
  a label, a separator), never on a scan that restarts at each character. This
  runs on the phone in the error path, on text it does not control. A
  lookbehind reaching back over a word cost 7.2 s against 11 ms on 200 KB.

## Limits

- It does not remove names a person typed (scenario, session and reference
  point names, chosen folder and file names). The framework logger writes
  them into log lines, so they can appear in a report; the privacy page
  says so (see the audit in `sentry.ts.md`).
- A coordinate pair where both numbers have fewer than three decimals, or
  where one is a whole number, passes when it carries no label.
- A link inside a word with no separator before it (`x/api?id=1`), or with
  no slash at all (`t?key=abc`), is not recognised as a relative link.
- One to three digits glued between a label and a word (`lat48N`) are kept;
  with a separator (`lat=48N`), a decimal point (`lat48.1N`) or a fourth digit
  they go.
- A label with an encoded separator (`lat%3D48.1`) is not recognised outside
  a link; inside one it goes with the query.
- Object keys are not scrubbed, and numbers in an array (`[48.1371, 11.5761]`)
  pass, having no field name to read.

## Examples

```ts
scrubText('Set zero reference: 48.137154, 11.576124', 'gps.csutil.com');
// 'Set zero reference: [redacted]'
scrubText('GET /api/drive-proxy?id=1AbC...', 'gps.csutil.com');
// 'GET /api/drive-proxy?[redacted]'
scrubText('https://drive.google.com/file/d/1AbC.../view', 'gps.csutil.com');
// 'https://drive.google.com/[redacted]'
```

## Tests

- `sentry-scrub.test.ts` - each kind of line the app can produce, ids and
  numbers kept, input not mutated, cycles, the depth limit, labelled fields,
  and linear time: 2 MB inputs a rescanning rule could not finish within the
  test timeout, so no clock is read.
- `sentry-scrub.property.test.ts` - no coordinate pair survives (3 to 8
  decimals on one number, 1 to 2 on the other allowed), no camelCase
  labelled value survives, no foreign path survives (also after `{n}`, and
  with hosts and path segments built to read like a labelled number, such as
  `lon5.tiles.example.org`), nothing after a coordinate in a query survives,
  idempotence on random strings and on 2,000 strings built from report
  fragments (links, ids, queries, pairs, labels and punctuation), plain
  text unchanged. All were checked once at 100 times their run count.
- `sentry.test.ts` - the hooks that apply it.
