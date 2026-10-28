/**
 * Which environment an error report comes from, by the page's host.
 *
 * Branch previews deploy the same production build as the live site, so
 * they send error reports too; the label keeps theirs, and those of a
 * production build run on this machine, apart from the live site's.
 *
 * @see error-report-environment.ts.md
 */

export type ErrorReportEnvironment = 'production' | 'preview' | 'development';

/**
 * The addresses the live site is served from: its own domain, and the
 * worker's own address, which serves the same live deployment.
 */
export const PRODUCTION_HOSTS: readonly string[] = [
  'gps.csutil.com',
  'gps-plus-slam.csutil.workers.dev',
];

/** This machine only (a LAN address or a tunnel counts as a preview). */
const LOOPBACK_HOSTS: readonly string[] = [
  'localhost',
  '127.0.0.1',
  '[::1]',
  '::1',
];

/**
 * The label for a page served at `hostname` (`location.hostname`).
 *
 * - `production`: exactly one of {@link PRODUCTION_HOSTS};
 * - `development`: this machine (`localhost`, loopback);
 * - `preview`: a branch or commit preview
 *   (`<label>-gps-plus-slam.csutil.workers.dev`), and every other host or
 *   a missing one. Unknown hosts are previews rather than production so
 *   that nothing but the live site can ever be counted as the live site,
 *   and no preview needs a pattern of its own to be kept apart.
 *
 * Letter case and a trailing dot are ignored, as for any host name.
 */
export function errorReportEnvironment(
  hostname: string | null | undefined
): ErrorReportEnvironment {
  if (typeof hostname !== 'string') return 'preview';
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (PRODUCTION_HOSTS.includes(host)) return 'production';
  if (LOOPBACK_HOSTS.includes(host)) return 'development';
  return 'preview';
}
