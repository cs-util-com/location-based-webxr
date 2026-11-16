# `sentry-scrub.ts` - the error-report scrubber

## Purpose

Removes links, file ids and coordinates from the text of an error report
before it leaves the device. `sentry-options.ts` runs it from Sentry's
`beforeSend`, `beforeSendTransaction`, `beforeSendSpan` and
`beforeBreadcrumb` hooks; it has no
dependency on the SDK, so its rules are tested on their own.

## Public API

- `REDACTED` - the string (`[redacted]`) every removed piece becomes.
- `scrubText(text, ownHost, options?): string` - scrubs one string:
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
    (`lat=48.1`, `"latitude":48.1`, `lat: '48.1'`, quoted or not), also after
    a prefix (`originLat`, `start_lng`), with a `c` in front (`clat`, `clng`,
    `clon`: the map demo's camera target in its page address) or with an index or a unit before a
    separator (`lat1=48.1`, `latDeg=48.1`), loses its value; `long` counts
    only with `:` or `=`, being an ordinary word, and not after a prefix
    (`isLong=1` stays); a word that merely ends
    in a label (`flat`, `salon`) does not count, nor do one to three digits
    running on into a word (`lon0a`, `lat2a9Q` in a hashed asset name). A
    separator is not required (`lat48.1`, `lat48_137154`, `lat48137154N`
    go). A host can read this way and is then cut (`lon[redacted].x.org`);
    the link rules remove what follows it just the same;
  - a pair of decimal numbers that looks like a latitude/longitude pair
    (`48.137154, 11.576124`, `48.1371,11.5761`, `-33.86882 151.20929`,
    `48.1, 11.576124`, `48.1371/11.5761`, `48.1371;11.5761`,
    `48.1371%2C11.5761`, `48.1371+11.5761`, `48.1371:11.5761`,
    `48.1371|11.5761`, `48.1371 - 11.5761`) is removed: one of the two needs
    three or more decimals, the other a decimal point. A hyphen counts as a
    separator only with a space on both sides; without them it is a minus
    sign. Clock times (`12:30`), stack positions (`.js:12:345`) and ranges of
    short decimals (`1.5 - 2.5`) stay, having no number with three decimals;
  - an H3 cell index (15 hex digits starting with `8`, standing on its own)
    is removed. Sentry's own ids are 16 (span), 32 (event, trace) or 40
    (commit) hex digits and stay;
  - a string that is nothing but a query or a fragment (`?id=...`,
    `#station-2`; the SDK's `http.query` and `http.fragment` span
    attributes) becomes `[redacted]`.
  - Order: coordinate pairs, then labels (a label takes one number, and
    `lat=48.1,11.57` holds two), then H3 cells (removing a pair can leave a
    cell standing on its own), then links, then the query-only rule. A
    `[redacted]` does not end a link: a coordinate removed from inside a link
    stays part of it, so its path and query after the marker go too
    (`?lat=48.1&key=abc`) and every pass reads the same link. The query-only
    rule runs last so that a string the other rules reduce to
    `?[redacted]` is not changed again.
  - `options.strict` (the `ScrubOptions` type) adds two rules for the apps
    visitors use (the Tour Viewer and the map demo), applied after the shared
    ones:
    - quoted text on one line, in double, single or back quotes, loses its
      content (`"[redacted]"`): a file or station name, or a snippet of a
      file the browser quotes in a parse error. An apostrophe pairs with the
      next single quote on its line and takes the text between with it;
    - a run of six or more digits standing on its own (`way/123456789`,
      `"id":2345678`) is removed: it can be an OSM id, which names one
      building. Digits inside a word or a decimal number, and the column of a
      stack line (`.js:1:1234567`), stay.
    - Removing quoted text can join what a space kept apart (two links, a
      label and its number), so the strict rules repeat until the text no
      longer changes (`MAX_STRICT_PASSES = 8` bounds the loop; it settles in
      two or three).
- `scrubDeep(value, ownHost, options?): T` - a copy of `value` with every string
  scrubbed, object keys included (a serialised object can be keyed by a
  place). Arrays and plain objects are copied, cycles kept as cycles;
  numbers, booleans and other objects pass through, so event ids,
  timestamps and status codes survive. Whatever a field named like a
  coordinate holds (`lat`, `latLng`, by the same rules as the text) becomes
  `[redacted]`, a whole array or object included, unless it is null or
  undefined: the SDK serialises a rejected plain object into the event, and
  the text rules never see a number. An array of exactly two numbers that
  reads as a coordinate pair becomes `[redacted]` under ANY key (`center:
[48.137, 11.575]`): both finite and within ±180, one with three or more
  decimals as JavaScript writes it, the other possibly whole (a number loses
  its `.0`). So does an array of three numbers whose first two read as such
  a pair (a GeoJSON `[lon, lat, alt]`). Two keys that scrub to the same text
  both stay: the later one gets the first free ` #2`, ` #3` suffix. The
  input is never changed. `options` is passed on to `scrubText`.
  - The error service's own ids are kept as they are: a string under
    `event_id`, `trace_id`, `span_id`, `parent_span_id` or `debug_id` that
    has an id's shape (16 or 32 hex digits, or a UUID). The SDK fills them
    before the hooks run, and the strict long-number rule would cut an id
    that happens to hold six or more digits in a row: a cut `debug_id` in
    `debug_meta.images` silently loses that bundle's source map (about 1 in
    40 debug ids hold such a group). Any other value under these names is
    scrubbed as usual. A bundle's `code_file` in `debug_meta` is scrubbed
    like any link, deliberately: it is the frame's file name, and the
    service pairs the two by that name, so both must read the same.

## Parameters and why these values

- `ID_SEGMENT_MIN_LENGTH = 25` (a segment ends at any character that is not
  part of a name, so an id in front of `'`, `)` or `,` goes; a dot continues
  the name): cloud-drive file ids are 25 to 44
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
- Strict digit runs from 6 digits: OSM node ids passed six digits long ago,
  so a real id is longer; five or fewer keep durations, counts and
  coordinates in pixels readable. Four would eat years and port numbers.
- `MAX_DEPTH = 24`: deeper subtrees are replaced by `[redacted]` rather than
  sent unread. Sentry events are far shallower; the limit only matters for
  a pathological breadcrumb payload.

## Invariants

- Idempotent: scrubbing twice changes nothing more than scrubbing once
  (property test), in both profiles. Sentry runs the breadcrumb hook and the event hook over
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
  says so (see the audit in `sentry-options.ts.md`).
- A coordinate pair where both numbers have fewer than three decimals, or
  where one is a whole number, passes when it carries no label.
- A link inside a word with no separator before it (`x/api?id=1`), or with
  no slash at all (`t?key=abc`), is not recognised as a relative link.
- One to three digits glued between a label and a word (`lat48N`) are kept;
  with a separator (`lat=48N`), a decimal point (`lat48.1N`) or a fourth digit
  they go.
- A label with an encoded separator (`lat%3D48.1`) is not recognised outside
  a link; inside one it goes with the query.
- The strict profile removes more than it needs to: a property name the
  browser quotes (`reading 'foo'`) and the keys of a logged JSON object go
  with the quoted text, which costs some debugging detail.
- A single number under an ordinary key passes (`{ x: 48.1371 }`), as does
  a place held as two numbers in separate fields (`{ x: 48.1371, y:
11.5761 }`) or in an array longer than two: nothing tells them from
  measurements.
- Not recognised in text either: a single unlabelled number, a pair split
  across two fields, comma decimals (`48,1371 11,5761`), DMS with primes
  (`48°8′13″`), Web Mercator metres. The privacy page therefore promises
  only coordinates "written as a pair or next to a label such as lat/lng".
- Two numbers within ±180 with three decimals (`[0.125, 2]`, a scale) are
  removed although they are no place: the price of catching `[48.137, 11]`.

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
  numbers kept, the service's ids kept in the strict profile (only in an
  id's shape), input not mutated, cycles, the depth limit, labelled fields,
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
  Added with the strict profile: no coordinate pair survives in any string
  field or key of a nested event-shaped value, nor as two numbers in an
  array, in either profile (keys are drawn from the pair leaves too, so the
  key check can fail: removing the key scrubbing, or the numeric-pair rule,
  turns it red at once); strict
  idempotence on report fragments with quotes, cells and long numbers mixed
  in and on random strings; no H3 cell or OSM id survives strict.
- `sentry-options.test.ts` - the hooks that apply it.
