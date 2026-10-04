import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

/**
 * The timing page must not change the recorder by one byte.
 *
 * Why this guard exists rather than a promise in a commit message: the page
 * exists to measure the app, and an instrument that perturbs what it measures
 * is worse than no instrument. The two ways this code could reach the recorder
 * are a link in `index.html` and an import from anywhere outside `src/timing/`;
 * both are asserted below. The third property - that nothing here talks to the
 * network - is asserted too, because "nothing leaves the device" is the reason
 * the owner can run this on a recording of a real place.
 */

const timingDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(timingDir, '..');
const appRoot = resolve(srcDir, '..');

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allSourceFiles(full));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('the timing page is isolated from the recorder', () => {
  // Why this matters: a link would put the page one tap away in the app the
  // owner records with, and `ar-hittest-test.html` shows how easily a dev-only
  // entry acquires one. The page is reached by typing its URL.
  it('is linked from neither the recorder entry nor its own siblings', () => {
    const indexHtml = readFileSync(resolve(appRoot, 'index.html'), 'utf8');
    expect(indexHtml).not.toContain('alignment-timing');
    const hitTest = readFileSync(
      resolve(appRoot, 'ar-hittest-test.html'),
      'utf8'
    );
    expect(hitTest).not.toContain('alignment-timing');
  });

  // Why this matters: an import from the app side would pull the timing code
  // into the recorder's bundle and let it run in a real session.
  it('is imported by nothing outside src/timing/', () => {
    const offenders = allSourceFiles(srcDir)
      .filter((file) => !file.startsWith(timingDir))
      .filter((file) => /alignment-timing/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(appRoot, file));
    expect(offenders).toEqual([]);
  });

  // Why this matters: the page replays a recording of a real place. Nothing it
  // measures may be transmitted, and the cheapest durable proof is that the
  // vocabulary for transmitting anything does not appear at all. `navigator`
  // is read for the device line only, which is why it is not on this list.
  it('contains no way to send anything anywhere', () => {
    // Comments are stripped first: this guard is about what the CODE can do,
    // and the modules are allowed to explain in prose that they do none of it.
    // The stripper is deliberately naive (no string/regex awareness) - these
    // files carry no URL literals, and a false positive here is a prompt to
    // look, not a silent pass.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const forbidden =
      /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|indexedDB)\b/;
    const files = [
      ...allSourceFiles(timingDir).filter((f) => !/\.test\.ts$/.test(f)),
      resolve(appRoot, 'alignment-timing.html'),
    ];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const match = forbidden.exec(source);
      expect(
        match?.[0],
        `${relative(appRoot, file)} names "${match?.[0]}" - the timing page ` +
          `must neither transmit nor persist anything.`
      ).toBeUndefined();
    }
  });

  // Why this matters: the page is only built (and therefore only deployable)
  // if it is an entry of the app's own bundler config. Without this the page
  // works on a dev server and 404s on the device, which is the one place it
  // has to work.
  it('is a build entry of the recorder app', () => {
    const viteConfig = readFileSync(
      resolve(appRoot, 'config/vite.config.ts'),
      'utf8'
    );
    expect(viteConfig).toContain('alignment-timing.html');
  });
});
