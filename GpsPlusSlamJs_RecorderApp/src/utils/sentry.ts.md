# Sentry Error Tracking Module

## Purpose

Builds the recorder's reduced error-reporting configuration
(`sentryOptions`) and starts the SDK with it (`initSentry`). What a report
carries is described on the site's privacy page (`/legal/`, source in
`GpsPlusSlamJs_Landing/legal/index.html`); the configuration and that text
change in the same commit.

## Public API

### `initSentry(): void`

Initializes the Sentry SDK with `sentryOptions()`. Called as early as
possible in `main.ts`, and only in production builds (`import.meta.env.PROD`).

```ts
import { initSentry } from './utils/sentry';

initSentry();
```

### `sentryOptions(ownHost?): BrowserOptions`

The options, as a pure function so a unit test can pin them. `ownHost`
defaults to `location.host`; links to it keep their path in reports, links
to other hosts keep only the host (see `sentry-scrub.ts.md`).

### `TRACES_SAMPLE_RATE`

`0.1`: one page load in ten is traced. Enough to see slow loads and slow
requests across sessions, at a tenth of the data a fully traced session
sends. A value of `0` would end performance data altogether; `1` (the old
value) traced every session. Errors are not sampled: every error is
reported.

## The configuration, and why

- `sendDefaultPii: false` - the SDK adds no automatic IP address to the user
  or the session, and sets `infer_ip: "never"` in the SDK settings it sends,
  so the service is told not to infer the IP from the connection (verified
  in the installed `@sentry/browser` client source). The connection itself
  still reaches the service; whether the project also has the server-side
  "prevent storing IP addresses" switch on is an account setting, not code.
- `tracesSampleRate: 0.1` - see above.
- Integrations: only `browserTracingIntegration()`. The console logging
  integration and the Logs product (`enableLogs`) are off: the framework
  logger already turns every warning and error into an Issue, so the Logs
  view was a second copy of the same lines.
- `beforeSend` and `beforeSendTransaction` pass the whole event through
  `scrubDeep` (links, file ids, coordinates; `sentry-scrub.ts.md`).
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

The Sentry Vite plugin in `config/vite.config.ts` uploads source maps during
production builds. This requires the `SENTRY_AUTH_TOKEN` environment
variable to be set in CI/CD.

## Tests

- `sentry.test.ts` pins the reduced configuration: no default personal
  data, the trace sample rate, no console logging integration and no Logs,
  a report with a tour link, a file id and a coordinate pair comes out
  without them, a trace's span is scrubbed, console breadcrumbs are dropped,
  and the DSN's region is the one the privacy page names.
- `sentry-scrub.test.ts`, `sentry-scrub.property.test.ts` - the scrubber.
- Whether reports really arrive is checked in the Sentry dashboard after a
  deploy; no test sends one.
