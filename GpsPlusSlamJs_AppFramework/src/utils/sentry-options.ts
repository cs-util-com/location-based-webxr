/**
 * Sentry error-reporting configuration shared by the apps of this site.
 *
 * Builds the Recorder's reduced error-reporting configuration, and the
 * stricter one of the apps visitors use (Tour Viewer, map demo; pages and
 * their Web Workers), and starts the SDK with them. Every report passes the scrubber (`sentry-scrub.ts`) before it
 * leaves. What is sent, and what is not, is described on the site's privacy
 * page (`/legal/`); the configuration and that text change together.
 *
 * @see sentry-options.ts.md for the audit of what the framework logger sends
 */

import * as Sentry from '@sentry/browser';
import type { BrowserOptions } from '@sentry/browser';

import { errorReportEnvironment } from './error-report-environment';
import { scrubDeep } from './sentry-scrub';

/**
 * Where reports go. Hardcoded on purpose:
 * - one build serves every deployment (the live site and each branch
 *   preview); `environment` tells their reports apart;
 * - a DSN is not secret (Sentry's docs say it is safe in client code);
 * - keeps setup minimal (no per-deployment configuration).
 * The host names the data region; the privacy page names it too.
 */
export const SENTRY_DSN =
  'https://f45023a2803b24ca8cfe9e93362b909c@o369909.ingest.us.sentry.io/4510756888903680';

/**
 * Share of page loads whose timings are traced. One in ten is enough to see
 * slow loads and slow requests across sessions, at a tenth of the data a
 * fully traced session sends. Errors are not sampled: every error is reported.
 */
export const TRACES_SAMPLE_RATE = 0.1;

/**
 * Default integrations the profiles leave out:
 * - `BrowserSession` sends a session to the service on every page load,
 *   whether or not anything goes wrong;
 * - `CultureContext` adds the browser's locale and timezone to every report.
 * Neither helps to fix an error.
 */
const DROPPED_DEFAULT_INTEGRATIONS: ReadonlySet<string> = new Set([
  'BrowserSession',
  'CultureContext',
]);

/**
 * The Recorder's Sentry options, reduced to what fixing errors needs.
 *
 * @param ownHost this site's host; links to it keep their path in reports
 *   (stack traces need the script paths), links elsewhere keep only the host
 * @param pageHostname the page's host name, which picks the reports'
 *   environment label (live site, branch preview or this machine)
 */
export function sentryOptions(
  ownHost: string | undefined = globalThis.location?.host,
  pageHostname: string | undefined = globalThis.location?.hostname
): BrowserOptions {
  return {
    dsn: SENTRY_DSN,

    // Branch previews are production builds and send reports too; the
    // label keeps them, and local runs of a production build, apart from
    // the live site's.
    environment: errorReportEnvironment(pageHostname),

    // No default personal data: the SDK then tells the service not to infer
    // or store the sender's IP address.
    sendDefaultPii: false,

    tracesSampleRate: TRACES_SAMPLE_RATE,

    // Trace propagation for local dev; add API URLs here if a backend is added
    tracePropagationTargets: ['localhost'],

    // The SDK's defaults minus the ones that send without an error, plus
    // tracing. No console logging integration and no Logs product: warnings
    // and errors already reach Sentry as Issues through the framework logger.
    integrations: (defaults) => [
      ...defaults.filter(
        (integration) => !DROPPED_DEFAULT_INTEGRATIONS.has(integration.name)
      ),
      Sentry.browserTracingIntegration(),
    ],

    beforeSend: (event) => scrubDeep(event, ownHost),
    beforeSendTransaction: (event) => scrubDeep(event, ownHost),
    // Spans sent on their own (web-vital measurements) pass neither hook
    // above.
    beforeSendSpan: (span) => scrubDeep(span, ownHost),

    // Console breadcrumbs are dropped: the framework logger adds its own
    // breadcrumb for every log line, and the console also carries output
    // from code this app does not audit.
    beforeBreadcrumb: (breadcrumb) =>
      breadcrumb.category === 'console' ? null : scrubDeep(breadcrumb, ownHost),
  };
}

/**
 * Initialize the Sentry SDK with the Recorder's {@link sentryOptions}.
 * Should be called as early as possible in the application lifecycle.
 */
export function initSentry(): void {
  Sentry.init(sentryOptions());
}

/**
 * The page-address flag that sends one harmless test report, so a deployed
 * build can be checked end to end (report arrives, carries its app tag,
 * release and readable stack) without breaking anything.
 */
export const SENTRY_TEST_PARAM = 'sentry-test';

/** The message of that test report. */
export const SENTRY_TEST_MESSAGE =
  'Sentry test report, sent on purpose by the sentry-test page flag';

/**
 * The framework logger's breadcrumb levels the strict profile keeps: the
 * lines that also become reports. Info and debug lines name what the visitor
 * is doing (which station, which file) and are not needed to read an error.
 */
const STRICT_LOG_LEVELS: ReadonlySet<string> = new Set([
  'warning',
  'error',
  'fatal',
]);

/** Whether the strict profile keeps a breadcrumb at all. */
function keepsStrictBreadcrumb(breadcrumb: Sentry.Breadcrumb): boolean {
  if (breadcrumb.category === 'console') return false;
  if (breadcrumb.category === 'log') {
    return STRICT_LOG_LEVELS.has(breadcrumb.level ?? '');
  }
  return true;
}

/**
 * Sentry options for the apps visitors use (the Tour Viewer, the map demo):
 * errors only, no traces, no session and no locale, every report tagged with
 * `app`, and the scrubber's strict profile on everything that leaves, which
 * also removes quoted text and long numbers (see `sentry-scrub.ts.md`).
 * Same project and DSN as the Recorder; the `app` tag tells them apart.
 *
 * @param app the app's tag value, e.g. `tour-viewer`
 * @param ownHost this site's host, as for {@link sentryOptions}
 * @param pageHostname picks the environment, as for {@link sentryOptions}
 */
export function strictSentryOptions(
  app: string,
  ownHost: string | undefined = globalThis.location?.host,
  pageHostname: string | undefined = globalThis.location?.hostname
): BrowserOptions {
  const strict = { strict: true } as const;
  return {
    dsn: SENTRY_DSN,
    environment: errorReportEnvironment(pageHostname),
    sendDefaultPii: false,
    initialScope: { tags: { app } },
    // No tracing integration and no sample rate: no timings are sent, only
    // errors and the warnings the framework logger reports.
    integrations: (defaults) =>
      defaults.filter(
        (integration) => !DROPPED_DEFAULT_INTEGRATIONS.has(integration.name)
      ),
    beforeSend: (event) => scrubDeep(event, ownHost, strict),
    beforeSendTransaction: (event) => scrubDeep(event, ownHost, strict),
    beforeSendSpan: (span) => scrubDeep(span, ownHost, strict),
    beforeBreadcrumb: (breadcrumb) =>
      keepsStrictBreadcrumb(breadcrumb)
        ? scrubDeep(breadcrumb, ownHost, strict)
        : null,
  };
}

/**
 * {@link strictSentryOptions} for a Web Worker: the same, with a `thread`
 * tag, so a worker's report is told apart from the page's.
 */
export function workerSentryOptions(
  app: string,
  ownHost: string | undefined = globalThis.location?.host,
  pageHostname: string | undefined = globalThis.location?.hostname
): BrowserOptions {
  return {
    ...strictSentryOptions(app, ownHost, pageHostname),
    initialScope: { tags: { app, thread: 'worker' } },
  };
}

/** What {@link startErrorReporting} needs to know about the page. */
export interface ErrorReportingStart {
  /** The `app` tag, e.g. `osm-demo`. */
  readonly app: string;
  /** Whether this is a production build; dev servers send nothing. */
  readonly prod: boolean;
  /**
   * The page's query, read for the test flag only; defaults to
   * `location.search` (absent outside a browser).
   */
  readonly search?: string;
}

/** Whether the page address asks for a test report. */
export function wantsTestReport(search: string | undefined): boolean {
  if (!search) return false;
  try {
    return new URLSearchParams(search).has(SENTRY_TEST_PARAM);
  } catch {
    return false;
  }
}

/** Sends the harmless test report; it throws nothing on the page. */
function sendTestReport(): void {
  Sentry.captureException(new Error(SENTRY_TEST_MESSAGE));
}

/**
 * Starts error reporting on a visitor-facing page with
 * {@link strictSentryOptions}, and sends a test report when the page address
 * carries {@link SENTRY_TEST_PARAM}. Call it first thing in the page's entry.
 *
 * @returns whether reporting was started (only in a production build)
 */
export function startErrorReporting(start: ErrorReportingStart): boolean {
  if (!start.prod) return false;
  Sentry.init(strictSentryOptions(start.app));
  const search = start.search ?? globalThis.location?.search;
  if (wantsTestReport(search)) sendTestReport();
  return true;
}

/**
 * Starts error reporting inside a Web Worker with
 * {@link workerSentryOptions}: the worker's own uncaught errors and its
 * logger warnings and errors are reported from where they happen.
 *
 * @returns whether reporting was started (only in a production build)
 */
export function startWorkerErrorReporting(
  start: Pick<ErrorReportingStart, 'app' | 'prod'>
): boolean {
  if (!start.prod) return false;
  Sentry.init(workerSentryOptions(start.app));
  return true;
}
