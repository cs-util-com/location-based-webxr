/**
 * Sentry Error Tracking Module
 *
 * Builds the recorder's reduced error-reporting configuration and starts the
 * SDK with it. What is sent, and what is not, is described on the site's
 * privacy page (`/legal/`); the configuration and that text change together.
 *
 * @see sentry.ts.md for the audit of what the framework logger sends
 */

import * as Sentry from '@sentry/browser';
import type { BrowserOptions } from '@sentry/browser';

import { scrubDeep } from './sentry-scrub';

/**
 * Share of page loads whose timings are traced. One in ten is enough to see
 * slow loads and slow requests across sessions, at a tenth of the data a
 * fully traced session sends. Errors are not sampled: every error is reported.
 */
export const TRACES_SAMPLE_RATE = 0.1;

/**
 * Default integrations the recorder leaves out:
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
 * The recorder's Sentry options, reduced to what fixing errors needs.
 *
 * @param ownHost this site's host; links to it keep their path in reports
 *   (stack traces need the script paths), links elsewhere keep only the host
 */
export function sentryOptions(
  ownHost: string | undefined = globalThis.location?.host
): BrowserOptions {
  return {
    // DSN is hardcoded intentionally:
    // - This is a single-environment static frontend (no staging/prod distinction)
    // - DSN is not secret (Sentry docs confirm it's safe to expose in client code)
    // - Keeps setup minimal per project philosophy (AGENTS.md)
    // - If multi-environment support is needed later, use: import.meta.env.VITE_SENTRY_DSN || ''
    // The host names the data region; the privacy page names it too.
    dsn: 'https://f45023a2803b24ca8cfe9e93362b909c@o369909.ingest.us.sentry.io/4510756888903680',

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
 * Initialize the Sentry SDK with {@link sentryOptions}.
 * Should be called as early as possible in the application lifecycle.
 */
export function initSentry(): void {
  Sentry.init(sentryOptions());
}
