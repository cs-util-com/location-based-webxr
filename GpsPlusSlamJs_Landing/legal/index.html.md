# `legal/index.html` - the site-wide legal notice and privacy page

## Purpose

One page for the whole site, served at `/legal/`: the legal notice (who
runs the site and how to reach them) and the privacy text for every app on
it. Built by this package's Vite config as a second entry, so the site build
(`scripts/build-site.mjs`) emits `dist-site/legal/index.html` next to the
landing page.

## Structure

- Two sections, `#notice` and `#privacy`, so every link can name its
  section (`/legal/#privacy`).
- No script and no external file: an inline style block with its own
  colours (dark, light when the device asks), so it loads the same from
  every app and needs nothing from any app's build.
- `#privacy` has one part per data flow: the hosting (every app), then the
  Tour Viewer, the Recorder, the anchor starter, the four demos that contact
  nothing else, the map demo, the developer test pages, and the start page
  with the blog; then storage on the device, the rights, and the order of
  changes.
- The summary at the top ("In short") must not claim more than the parts
  below it: it says the camera image and sensor readings are not sent, and
  names the two ways location does leave the device (map requests for the
  area you are in, the anchor starter's link).

## Placeholders (visible on purpose)

- `[Operator: name and c/o postal address - to be added before this page
goes live]` (`data-testid="operator-placeholder"`): the operator's name
  and postal address are added before the page is final. The project name
  (cs-util.com) and the email (support@cs-util.com) are final.
- `[Retention: number of days, ...]` (`data-testid="retention-placeholder"`):
  how long the error service keeps the Recorder's reports, which is an
  account setting, not code.
- `[EXIF: to be confirmed]`: whether photos taken by the Tour Viewer carry
  location metadata, carried over from the Tour Viewer's earlier page.

## Ready, not in effect: the usage-statistics paragraph

An HTML comment after the hosting part ("This website (every app)") holds a
finished `#privacy-statistics` part for usage statistics: what a cookieless
counting tool receives, why (legitimate interest), how long it is kept, and
how to object (the browser's Global Privacy Control or Do Not Track, or a
mail to the operator). It opens with `NOT IN EFFECT` and says what the
commit that adds a statistics tool must do with it: uncomment it, fill in
its brackets (tool, company, region, retention, whether the tool honours
the browser signal), check every claim against the tool's configuration,
drop "no usage statistics" from "In short", and move the date and the
pinned hash. It covers cookieless counting only; a tool that sets cookies,
reads device storage or follows visitors across sites needs consent first.

- A comment is not visible text, so it does not change the pinned hash
  (`visibleText` strips comments; the hash test stayed green when it was
  added).
- `tests/repo-config/legal-page.test.js` holds it there, marked, with no
  `--` and no nested `<!` inside (a comment ends at `-->` and must not
  nest; keeping every `--` out keeps it unambiguous), and checks that the
  visible text still says "no usage statistics".

## Invariants

- Nothing claims more than the code does. Facts and where they come from:
  - hosting and the worker log: `wrangler.toml` (Workers Logs on,
    invocation logs persisted; the worker runs first for `/api/*` and also
    for every request that matches no asset, so both are logged); the logs
    are kept 3 days on the account's plan;
  - the file service passes on only the file id, `Range` and the cache
    validators `If-None-Match` / `If-Modified-Since`
    (`GpsPlusSlamJs_SiteWorker`, `drive-proxy.ts` and its forwarding test);
  - a bare-name `?qr=` tour link resolves under GitHub's raw host
    (`GpsPlusSlamJs_TourViewer/src/code-tour.ts`, `DEFAULT_ASSET_PREFIX`);
  - the editor's "Done editing" dialog and its "Move the debug data out"
    button: `GpsPlusSlamJs_TourViewer/edit.html`;
  - the Tour Viewer's storage, sensors and tour files: unchanged from the
    page this replaced (`GpsPlusSlamJs_TourViewer/legal.html.md` history);
  - the Recorder's error reports: `GpsPlusSlamJs_RecorderApp/src/utils/
sentry.ts.md` (configuration and the audit of what log lines carry);
    the map tiles: the framework's `utils/osm-tiles.ts`; the Recorder no
    longer sends a session per page load nor locale and timezone, so it
    contacts the error service only for an error, a warning or a sampled
    trace;
  - the starter's link carries the marker's position: its
    `url-anchor-state.ts`;
  - the map demo's hosts: the OSM package's `source/overpass-source.ts`
    and `elevation/terrarium.ts`, the demo's `dem-provider.ts` and the
    Leaflet stylesheet in its `index.html`;
  - the developer test pages: `/lookdev/` is the design system's look-dev
    build (`build-lookdev.mjs`), whose modules reach OpenStreetMap tiles,
    Overpass, Mapterhorn and the AWS terrain tiles; the Recorder's
    `ar-hittest-test.html` and `alignment-timing.html` are extra Vite
    entries that load nothing from other hosts. They carry no link to this
    page, by decision (the repo-config test lists them as exempt).
- A change of what any app sends or stores changes this page in the same
  commit, and with it the "Last updated" date and the pinned hash.
- "Last updated" is written by hand, never at build time: a build changes
  nothing a reader is told. The HTML comment above it says when to change
  it; `tests/repo-config/legal-page.test.js` pins a hash of the visible
  text together with the date. That makes every change of either a
  deliberate edit of the test file; it cannot force the date to move with
  the text (a typo fix updates the hash alone).
- No clause makes the reader responsible for checking the page for
  changes; the "Changes" paragraph promises the order of events instead.
- The page names no jurisdiction; the placeholders stay generic.

## Open questions (not decided here)

- The referrer policy for tour downloads (whether a tour's host should
  learn this site's address); the Tour Viewer part says the host receives
  it, which is true while no policy is set.
- Which transfer safeguard the hosting provider relies on; not named until
  it is checked.

## Linked from

Every app's first screen or footer (`tests/repo-config/legal-page.test.js`
holds the list): the landing page's links, the blog's footer
(`scripts/blog/render.mjs`), the Tour Viewer (setup footer, the visitor's
"What happens?", the editor), the Recorder's setup screen, the start panels
of the anchor starter and the QR-tracking, physics and wayfinding demos,
and a small fixed link in the minimal example and the map demo. The Tour
Viewer's old `/tour/legal.html` forwards here.

## Tests

- `tests/repo-config/legal-page.test.js` - the date and the visible text
  change together; every deployed app links `/legal/`; the site build emits
  and exempts the page; the ready usage-statistics paragraph stays a
  marked comment; the Recorder's error-service region matches the
  text.
- `playwright-tests/legal.spec.js` - the page loads with both sections and
  its placeholders, the privacy claims held to the code are there, nothing
  scrolls sideways on a phone, no console errors.
