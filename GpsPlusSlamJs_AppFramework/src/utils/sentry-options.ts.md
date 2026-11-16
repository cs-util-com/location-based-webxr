# `sentry-options.ts` - the error-reporting configuration

## Purpose

The Sentry configuration of the site's apps, in one place: the Recorder's
options (`sentryOptions`) and the call that starts the SDK with them
(`initSentry`), and the strict profile of the apps visitors use, the Tour
Viewer and the map demo (`strictSentryOptions`, `workerSentryOptions`,
`startErrorReporting`, `startWorkerErrorReporting`).
It moved here from the Recorder (`src/utils/sentry.ts`) so the other apps
use the same DSN, environment rule and scrubber instead of a copy; the
Recorder's behaviour did not change in the move, and its tests moved with it
unchanged but for the import. What a report carries is described on the
site's privacy page (`/legal/`, source in
`GpsPlusSlamJs_Landing/legal/index.html`); the configuration and that text
change in the same commit.

Deep-imported (`gps-plus-slam-app-framework/utils/sentry-options`), never
through the `/utils` barrel: the barrel feeds the package root, and this
module starts a third-party SDK.

## Public API

### `initSentry(): void`

Initializes the Sentry SDK with `sentryOptions()`. The Recorder calls it as
early as possible in its `main.ts`, and only in production builds
(`import.meta.env.PROD`): the dev server sends nothing. Every production
build sends, branch previews included (each preview deploys the same build
as the live site), and so does a production build served on this machine
(`vite preview`, run by hand; the e2e suite runs the dev server and sends
nothing); the `environment` label below keeps their reports apart.

```ts
import { initSentry } from 'gps-plus-slam-app-framework/utils/sentry-options';

if (import.meta.env.PROD) initSentry();
```

### `sentryOptions(ownHost?, pageHostname?): BrowserOptions`

The Recorder's options, as a pure function so a unit test can pin them.
`ownHost` defaults to `location.host`; links to it keep their path in
reports, links to other hosts keep only the host (see `sentry-scrub.ts.md`).
`pageHostname` defaults to `location.hostname` and picks the
`environment` label (`error-report-environment.ts`). Every report carries
the tag `app: recorder` (`initialScope`), as the other apps carry theirs.

### `strictSentryOptions(app, ownHost?, pageHostname?): BrowserOptions`

The options of the apps visitors use. Same DSN, environment rule and
`sendDefaultPii: false` as the Recorder, and:

- `initialScope.tags.app` - the app's name (`tour-viewer`, `osm-demo`), so
  their reports are told apart from each other and from the Recorder's in
  the one project. A separate Sentry project per app would need an account
  step and its own DSN; nothing in the code asked for one, and a tag filters
  just as well.
- No tracing: no `browserTracingIntegration`, no `tracesSampleRate`. A
  visitor's page load sends nothing unless something goes wrong.
- The same dropped defaults (`BrowserSession`, `CultureContext`).
- `beforeSend` drops the event's `extra` before scrubbing. These apps set
  none; the SDK fills it with the object a promise was rejected with
  (`extra.__serialized__`), free-form data no scrubber rule is written for.
  The exception text the SDK writes from that object ("Object captured as
  promise rejection with keys: ...") stays and is scrubbed. The Recorder's
  profile keeps `extra`; `scrubDeep` scrubs its keys and its numeric pairs.
- Every hook scrubs with the strict profile of `sentry-scrub.ts`, which also
  removes quoted text (file, station and tour names, snippets of a file in a
  parse error) and runs of six or more digits (OSM ids). The service's own
  ids (event, trace and span ids, and the bundles' debug ids in
  `debug_meta`, which find the source maps) are left as they are; see
  `scrubDeep` in `sentry-scrub.ts.md`.
- Breadcrumbs: console ones are dropped, and the framework logger's (`log`)
  only at warning level and above: info and debug lines say what the
  visitor is doing (which station, which file) and are not needed to read an
  error. Clicks, fetches and navigations stay, scrubbed.

### `workerSentryOptions(app, ownHost?, pageHostname?): BrowserOptions`

`strictSentryOptions` plus a `thread: worker` tag, for `Sentry.init` inside a
Web Worker. A worker has its own global scope, so the page's `Sentry.init`
does not reach it.

### `startErrorReporting({ app, prod, search? }): boolean`

Starts the strict profile on a page, in the first statement of its entry
module (ES imports run first, so an error thrown while an imported module
loads is not reported), and
returns whether it did. Does nothing unless `prod` (pass
`import.meta.env.PROD`). When `search` (default `location.search`) carries the
`sentry-test` flag (`SENTRY_TEST_PARAM`), it sends one harmless test report
(`captureException` of an `Error` with `SENTRY_TEST_MESSAGE`, thrown
nowhere), so a deployed build can be checked end to end: the report arrives,
with its `app` tag, `environment`, release and a readable stack.

```ts
import { startErrorReporting } from 'gps-plus-slam-app-framework/utils/sentry-options';

startErrorReporting({
  app: 'osm-demo',
  prod: import.meta.env.PROD,
});
```

### `startWorkerErrorReporting({ app, prod }): boolean`

The same inside a Web Worker, with `workerSentryOptions`.

**Why the worker starts its own SDK rather than forwarding to the page.**
The SDK's own worker support (`webWorkerIntegration` on the page,
`registerWebWorker` in the worker) forwards only debug ids and unhandled
promise rejections; a worker's logger warnings (`log.warn` becomes
`captureMessage`) and its errors caught and logged inside the worker would
not arrive, and a hand-written forwarder would be a second message protocol
to keep. Started in the worker, the framework logger there reports exactly
as it does on the page, and uncaught errors are caught by the SDK's global
handlers where they happen, with the worker's own stack. An error the
worker catches and replies with is reported once, by the page that logs it.

### `wantsTestReport(search): boolean`

Whether a query string carries the test flag; never throws.

### `SENTRY_DSN` (module-private)

The one project every app reports to. Hardcoded: a DSN is not secret, and
one build serves every deployment.

### `TRACES_SAMPLE_RATE`

`0.1`: one page load in ten is traced. Enough to see slow loads and slow
requests across sessions, at a tenth of the data a fully traced session
sends. A value of `0` would end performance data altogether; `1` (the old
value) traced every session. Errors are not sampled: every error is
reported.

## The configuration, and why

- `environment` - `production` on the live site (`gps.csutil.com` and the
  worker's own `gps-plus-slam.csutil.workers.dev`), `development` on this
  machine (`localhost`, loopback), `preview` on a branch or commit preview
  (`<label>-gps-plus-slam.csutil.workers.dev`) and on any other host
  (`error-report-environment.ts.md` says why unknown hosts are previews).
  The label is derived from the page address the report already carries,
  so it adds nothing a report did not hold.
- `sendDefaultPii: false` - the SDK adds no automatic IP address to the user
  or the session, and sets `infer_ip: "never"` in the SDK settings it sends,
  so the service is told not to infer the IP from the connection (verified
  in the installed `@sentry/browser` client source). The connection itself
  still reaches the service; whether the project also has the server-side
  "prevent storing IP addresses" switch on is an account setting, not code.
- `tracesSampleRate: 0.1` - see above.
- Integrations, given as a FUNCTION of the SDK's defaults (an array would
  be added to all of them): the defaults minus `BrowserSession` and
  `CultureContext`, plus `browserTracingIntegration()`.
  - `BrowserSession` (a default in `@sentry/browser` 10.73, `sdk.js`
    `getDefaultIntegrations`) sends a session to the service on every page
    load, error or not; without it the Recorder contacts the service only
    for an error, a warning, or the sampled trace of one load in ten.
  - `CultureContext` adds the browser's locale and timezone to every
    report; neither helps to fix an error.
  - The defaults that catch and describe errors stay (global handlers,
    browser API errors, breadcrumbs, linked errors, dedupe, inbound
    filters, HTTP context).
  - The console logging integration and the Logs product (`enableLogs`)
    are off: the framework logger already turns every warning and error
    into an Issue, so the Logs view was a second copy of the same lines.
- `beforeSend`, `beforeSendTransaction` and `beforeSendSpan` pass the whole
  event or span through `scrubDeep` (links, file ids, coordinates, bare
  queries such as the `http.query` span attribute; `sentry-scrub.ts.md`).
  `beforeSendSpan` is the only hook a standalone span passes: web-vital
  measurements (layout shift, interaction delay) are sent that way, outside
  any transaction.
- `beforeBreadcrumb` drops console breadcrumbs (the framework logger adds
  its own breadcrumb for every log line, and the console also carries output
  of code this app does not audit, such as the core library) and scrubs
  every other breadcrumb.
- The DSN's host names the data region (`ingest.us.sentry.io`, the US
  region). Moving the project to another region needs a new Sentry
  organisation, an account step outside the code; when it happens, the DSN,
  the test that pins the region and the privacy page change together.
- Retention is set in the Sentry account, not here.

## Audit: what the framework logger sends (2026-10-25)

How the logger reaches Sentry (`gps-plus-slam-app-framework`,
`src/utils/logger.ts`):

- every `log.debug/info/warn/error` adds a breadcrumb `[tag] message`
  (category `log`); breadcrumbs ride along with the next event that is
  sent, up to the SDK's default of 100;
- `log.warn` also sends a standalone Issue (`captureMessage`);
- `log.error` sends `captureException` for each `Error` argument (message,
  stack and its enumerable properties), or a `captureMessage` when no
  argument is an `Error`.

What the log lines carry (a scan of all 379 `log.*` calls in the non-test
sources of the recorder, 225, and the framework, 154; 62 of them name
places, links, names or files and were read one by one):

- **Coordinates: one line.** `state/gps-event-coordinator.ts` logs
  `Set zero reference: <lat>, <lon>` at info level when a session starts,
  so the start position would ride along with any later report. The
  scrubber removes the pair. `storage/recording-migration.ts` warns with a
  `{ latitude, longitude }` object for a point it drops (the values are not
  finite numbers by construction, but they are labelled); the scrubber
  removes labelled values. `visualization/gps-event-markers.ts` logs
  positions in metres from the zero reference at debug level; not a place,
  but the pair rule removes those with three or more decimals too.
- **File ids and tour links: none in log lines.** No log call prints a
  remote URL or a file id. They do reach Sentry without the logger: the
  QR level files are fetched through the site's file service
  (`/api/drive-proxy?id=...`), and the SDK records fetches as breadcrumbs
  and, in a traced page load, as spans, URL included. The scrubber removes
  the query of every link to this site and the path of every link to
  another host.
- **Names a person typed: many lines, not scrubbed.** Scenario names,
  session names (they carry the date and time), reference point names, the
  chosen folder's and file's names appear in info and warning lines
  (`storage/folder-manager.ts`, `storage/scenario-storage.ts`,
  `ref-points/ref-point-handlers.ts`, `storage/zip-export.ts` and others).
  They help to find a fault and are not location data; the privacy page
  says that such names can appear in a report.
- **Outside the logger**, the SDK's default breadcrumbs add clicks (the
  clicked element's CSS selector), fetch and XHR calls (method, URL,
  status) and navigations (from and to URLs); the event carries the page
  URL and the browser's User-Agent and Referer. URLs go through the
  scrubber; console breadcrumbs are dropped.

## Configuration of the build

The Sentry Vite plugin in each app's Vite config (the Recorder's
`config/vite.config.ts`, the Tour Viewer's and the map demo's
`vite.config.ts`) uploads source maps during production builds. All three
apps build them `hidden` (no `sourceMappingURL` comment,
so a visitor's browser never fetches them) and run the plugin for their
Web Worker bundles too, which gives those bundles debug ids; all three take the
plugins from the framework's `scripts/sentry-vite-plugins.mjs`, which also
deletes the maps from the resolved output folder after the upload, so they
are not deployed, and turns the plugin's build telemetry off. The plugin is loaded only when the
`SENTRY_AUTH_TOKEN` environment variable is set, so a build without the
token (local, CI) uploads nothing and does not fail. No gate runs the
token path; what was checked by hand, and what was not, is in
`scripts/sentry-vite-plugins.mjs.md`.

## Tests

- `sentry-options.test.ts` pins the reduced configuration: the environment label
  for the three kinds of host, no default personal data, the trace sample rate, no console logging integration and no Logs,
  no session and no culture integration among the integrations the SDK
  really runs (resolved from its own `getDefaultIntegrations` the way
  `init` does), a report with a tour link, a file id and a coordinate pair
  comes out without them, a trace's span is scrubbed including its
  `http.query` and `http.fragment` attributes, a standalone span is
  scrubbed, console breadcrumbs are dropped, and the DSN's region is the
  one the privacy page names, the `app: recorder` tag, and a rejected
  object the SDK itself serialised (`eventFromException`) loses its
  coordinate pair.
- The same file pins the strict profile: no tracing, session or culture
  integration, the `app` tag and the Recorder's DSN, info and debug log
  breadcrumbs dropped, a report with a camera target, an H3 cell, an OSM id
  and a quoted file name comes out without them, the `extra` of a rejected
  object built by the SDK's own `eventFromException` is dropped (the input
  event left unchanged), a debug id, event id and trace ids holding long
  digit runs kept while the rest is scrubbed and a bundle's `code_file` still
  reads as its frame's file name, the worker's `thread` tag,
  and `startErrorReporting` / `startWorkerErrorReporting`: nothing outside
  production, one test report only with the flag (the SDK's `init` and
  `captureException` are mocked).
- `sentry-scrub.test.ts`, `sentry-scrub.property.test.ts` - the scrubber.
- Whether reports really arrive is checked in the Sentry dashboard after a
  deploy (the `sentry-test` flag sends one); no test sends one.
