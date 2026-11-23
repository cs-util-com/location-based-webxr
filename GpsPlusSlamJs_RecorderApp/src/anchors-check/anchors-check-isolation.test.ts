import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

/**
 * The anchors check page is a measurement page reached by typing its URL.
 * It must not be reachable from the recorder, must not pull its code into
 * the recorder's bundle, must not send or store anything, and must be built
 * so it exists on a deployed preview.
 */

const checkDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(checkDir, '..');
const appRoot = resolve(srcDir, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) ? [full] : [];
  });
}

describe('the anchors check page is isolated from the recorder', () => {
  // Why this matters: a link would put a test page one tap away in the app
  // people record with.
  it('is linked from no other page of the app', () => {
    for (const page of [
      'index.html',
      'ar-hittest-test.html',
      'alignment-timing.html',
    ]) {
      expect(readFileSync(resolve(appRoot, page), 'utf8')).not.toContain(
        'ar-anchors-check'
      );
    }
  });

  // Why this matters: an import from the app side would run the check's
  // code inside a real recording session.
  it('is imported by nothing outside src/anchors-check/', () => {
    const offenders = sourceFiles(srcDir)
      .filter((file) => !file.startsWith(checkDir))
      .filter((file) => /anchors-check/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(appRoot, file));
    expect(offenders).toEqual([]);
  });

  // Why this matters: the log holds poses of a real walk; it leaves the
  // phone only by the user's own copy.
  it('contains no way to send or store anything', () => {
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden =
      /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b/;
    const files = [
      ...sourceFiles(checkDir).filter((f) => !/\.test\.ts$/.test(f)),
      resolve(appRoot, 'ar-anchors-check.html'),
    ];
    for (const file of files) {
      const match = forbidden.exec(strip(readFileSync(file, 'utf8')));
      expect(match?.[0], relative(appRoot, file)).toBeUndefined();
    }
  });

  // Why this matters: only a bundler entry is built, so only then does the
  // page exist on a deployed preview, the one place it is used.
  it('is a build entry of the recorder app', () => {
    const config = readFileSync(
      resolve(appRoot, 'config/vite.config.ts'),
      'utf8'
    );
    expect(config).toContain('ar-anchors-check.html');
  });
});
