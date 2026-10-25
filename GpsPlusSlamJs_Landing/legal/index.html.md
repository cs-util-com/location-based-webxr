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
  nothing else, the map demo, and the start page with the blog; then storage
  on the device, the rights, and the order of changes.

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

## Invariants

- Nothing claims more than the code does. Facts and where they come from:
  - hosting and the file service log: `wrangler.toml` (Workers Logs on,
    invocation logs persisted, every `/api/*` request); the logs are kept
    3 days on the account's plan;
  - the file service passes on only the file id and the range headers
    (`GpsPlusSlamJs_SiteWorker`, `drive-proxy.ts`);
  - the Tour Viewer's storage, sensors and tour files: unchanged from the
    page this replaced (`GpsPlusSlamJs_TourViewer/legal.html.md` history);
  - the Recorder's error reports: `GpsPlusSlamJs_RecorderApp/src/utils/
sentry.ts.md` (configuration and the audit of what log lines carry);
    the map tiles: the framework's `utils/osm-tiles.ts`;
  - the starter's link carries the marker's position: its
    `url-anchor-state.ts`;
  - the map demo's hosts: the OSM package's `source/overpass-source.ts`
    and `elevation/terrarium.ts`, the demo's `dem-provider.ts` and the
    Leaflet stylesheet in its `index.html`.
- A change of what any app sends or stores changes this page in the same
  commit, and with it the "Last updated" date and the pinned hash.
- "Last updated" is written by hand, never at build time: a build changes
  nothing a reader is told. The HTML comment above it says when to change
  it; `tests/repo-config/legal-page.test.js` pins a hash of the visible
  text together with the date, so neither changes without the other.
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
  and exempts the page; the Recorder's error-service region matches the
  text.
- `playwright-tests/legal.spec.js` - the page loads with both sections and
  its placeholders, the privacy claims held to the code are there, nothing
  scrolls sideways on a phone, no console errors.
