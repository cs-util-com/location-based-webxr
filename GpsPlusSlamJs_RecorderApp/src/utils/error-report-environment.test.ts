/**
 * Error-report environment label tests.
 *
 * Why these tests matter: branch previews deploy the same production build
 * as the live site, so they send error reports too. Without a label their
 * reports mix with real visitors' and a preview's half-finished code reads
 * as a live failure. The label comes from the page's host alone; these
 * examples pin the three addresses the site is actually served from, and
 * the look-alikes that must never count as the live site.
 */

import { describe, it, expect } from 'vitest';
import { errorReportEnvironment } from './error-report-environment';

describe('errorReportEnvironment', () => {
  it('labels the live site "production"', () => {
    expect(errorReportEnvironment('gps.csutil.com')).toBe('production');
    // The worker's own address serves the same live deployment.
    expect(errorReportEnvironment('gps-plus-slam.csutil.workers.dev')).toBe(
      'production'
    );
  });

  it('labels a branch or commit preview "preview"', () => {
    expect(
      errorReportEnvironment('r943-gps-plus-slam.csutil.workers.dev')
    ).toBe('preview');
    expect(
      errorReportEnvironment('a1b2c3d4-gps-plus-slam.csutil.workers.dev')
    ).toBe('preview');
    expect(
      errorReportEnvironment('my-long-branch-gps-plus-slam.csutil.workers.dev')
    ).toBe('preview');
  });

  it('labels a page served from this machine "development"', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', '::1']) {
      expect(errorReportEnvironment(host), host).toBe('development');
    }
  });

  it('ignores letter case and a trailing dot, as hosts do', () => {
    expect(errorReportEnvironment('GPS.CSUTIL.COM')).toBe('production');
    expect(errorReportEnvironment('gps.csutil.com.')).toBe('production');
    expect(errorReportEnvironment('LOCALHOST')).toBe('development');
  });

  it('labels every other host "preview", never "production"', () => {
    // Look-alikes of the live address, another worker on the same account,
    // a sub-domain, a LAN address or tunnel, and no host at all.
    for (const host of [
      'gps.csutil.com.example.net',
      'evil-gps.csutil.com',
      'www.gps.csutil.com',
      'other-worker.csutil.workers.dev',
      'r943-gps-plus-slam.csutil.workers.dev.example.net',
      '-gps-plus-slam.csutil.workers.dev',
      'example.com',
      '192.168.1.20',
      'abc.ngrok-free.app',
      '',
    ]) {
      expect(errorReportEnvironment(host), host).toBe('preview');
    }
  });

  it('labels a host that is not a string "preview" instead of throwing', () => {
    // External data: a missing `location` (a worker, a test) or a bad value.
    expect(errorReportEnvironment(undefined)).toBe('preview');
    expect(errorReportEnvironment(null)).toBe('preview');
    expect(errorReportEnvironment(42 as unknown as string)).toBe('preview');
  });
});
