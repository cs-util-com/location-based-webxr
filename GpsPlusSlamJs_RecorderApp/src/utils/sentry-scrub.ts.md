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
    its path can name a shared file or, for map tiles, a place. Braces do
    not end a link: the framework logger writes `{n}` for digits, and the
    path after it goes too;
  - a relative link (`/api/drive-proxy?id=...`) loses its query and fragment;
  - a number labelled `lat`, `latitude`, `lon`, `lng` or `longitude`
    (`lat=48.1`, `"latitude":48.1`, quoted or not), also after a prefix
    (`originLat`, `start_lng`), loses its value; a word that merely ends
    in a label (`flat`, `salon`) does not count, nor does a label inside a
    link's host (`lon5.tiles.example.org`, `lat:8080`) or a whole number
    running on into a word (`lon0a`, `lat2a9Q` in a hashed asset name). A
    separator is not required (`lat48.1` still goes). A character no host
    contains after the label overrides the host exception
    (`https://lat=48.1/x`);
  - a pair of decimal numbers that looks like a latitude/longitude pair
    (`48.137154, 11.576124`, `48.1371,11.5761`, `-33.86882 151.20929`,
    `48.1, 11.576124`) is removed: one of the two needs three or more
    decimals, the other a decimal point;
  - a string that is nothing but a query or a fragment (`?id=...`,
    `#station-2`; the SDK's `http.query` and `http.fragment` span
    attributes) becomes `[redacted]`.
  - Order: coordinates first, then links, then the query-only rule. Brackets
    end a link, but a `[redacted]` does not: a coordinate removed from inside
    a link stays part of that link, so its path and query after the marker
    go too (`?lat=48.1&key=abc`) and every pass reads the same link. The
    query-only rule runs last so that a string the other rules reduce to
    `?[redacted]` is not changed again.
- `scrubDeep(value, ownHost): T` - a copy of `value` with every string
  scrubbed. Arrays and plain objects are copied, cycles kept as cycles;
  numbers, booleans and other objects pass through, so event ids,
  timestamps and status codes survive. The input is never changed.

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

## Limits

- It does not remove names a person typed (scenario, session and reference
  point names, chosen folder and file names). The framework logger writes
  them into log lines, so they can appear in a report; the privacy page
  says so (see the audit in `sentry.ts.md`).
- A coordinate pair where both numbers have fewer than three decimals, or
  where one is a whole number, passes when it carries no label.
- A link to another site written INSIDE the path of a link to this site
  (`https://<own host>/x/https://other/path`) is kept with that path; only
  id-like segments are removed from it.
- A link inside a word with no separator before it (`x/api?id=1`) is not
  recognised as a relative link.
- A whole number glued between a label and a word (`lat48N`) is kept; with a
  separator (`lat=48N`) or a decimal point (`lat48.1N`) it goes.
- A name with no scheme in front (`lon5.tiles.example.org`) is not known to
  be a host, so it reads as a label and a number and is cut there.

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
  numbers kept, input not mutated, cycles, the depth limit.
- `sentry-scrub.property.test.ts` - no coordinate pair survives (3 to 8
  decimals on one number, 1 to 2 on the other allowed), no camelCase
  labelled value survives, no foreign path survives (also after `{n}`, and
  with hosts and path segments built to read like a labelled number, such as
  `lon5.tiles.example.org`), nothing after a coordinate in a query survives,
  idempotence on random strings and on 2,000 strings built from report
  fragments (links, ids, queries, pairs, labels and punctuation), plain
  text unchanged. All were checked once at 100 times their run count.
- `sentry.test.ts` - the hooks that apply it.
