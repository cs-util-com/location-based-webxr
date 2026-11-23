// Repo-meta test: a worker's URL is written inside `new Worker(...)`.
//
// WHY. Vite bundles a module worker only when it sees the whole expression
// `new Worker(new URL("./x.worker.ts", import.meta.url), ...)`. A URL built
// first and passed in later (`const url = new URL(...); new Worker(url)`, or a
// helper that takes the URL) is treated as a plain asset: the production build
// ships the worker's raw TypeScript source, every spawn fails on the phone,
// and the dev server (which every e2e runs against) works as if nothing were
// wrong. Only the build shows it, so this guard checks the source shape.
//
// WHAT IT CANNOT DO. It matches the literal form only: a URL whose path does
// not contain "worker", or one built from a variable, is not seen.

import { describe, it, expect } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

const WORKER_URL =
  /new URL\(\s*(["'`])([^"'`]*worker[^"'`]*\.(?:ts|js|mjs))\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * Every worker URL in `source` that is not the first argument of
 * `new Worker(` or `new SharedWorker(`, as `line: text`. Comment lines are
 * skipped (sidecar-style examples in doc comments name the form on purpose).
 *
 * @param {string} source
 * @returns {string[]}
 */
export function looseWorkerUrls(source) {
  const out = [];
  for (const m of source.matchAll(WORKER_URL)) {
    const before = source.slice(0, m.index);
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineHead = before.slice(lineStart).trim();
    if (lineHead.startsWith('*') || lineHead.startsWith('//')) {
      continue;
    }
    if (/new (?:Shared)?Worker\(\s*$/.test(before)) {
      continue;
    }
    const line = before.split('\n').length;
    out.push(`${String(line)}: ${m[0]}`);
  }
  return out;
}

describe('looseWorkerUrls', () => {
  // Why: the guard is only as good as its matcher; these pin both the shape
  // Vite bundles and the shapes it silently ships as raw source.
  it('accepts the URL written inside new Worker(...)', () => {
    expect(
      looseWorkerUrls(
        'const w = new Worker(\n  new URL("./a.worker.ts", import.meta.url),\n  { type: "module" },\n);',
      ),
    ).toEqual([]);
    expect(
      looseWorkerUrls('new SharedWorker(new URL(`./b-worker.js`, import.meta.url))'),
    ).toEqual([]);
  });

  it('flags a URL built apart from new Worker(...)', () => {
    expect(
      looseWorkerUrls(
        'const spawn = (url) => () => new Worker(url);\nspawn(new URL("./a.worker.ts", import.meta.url));',
      ),
    ).toEqual(['2: new URL("./a.worker.ts", import.meta.url)']);
  });

  it('skips comment lines', () => {
    expect(
      looseWorkerUrls(' * `new URL("./a.worker.ts", import.meta.url)` passed in\n// new URL("./b.worker.ts", import.meta.url)'),
    ).toEqual([]);
  });
});

describe('worker URLs in the tracked source', () => {
  // Why: a loose worker URL breaks only the production build, which no e2e
  // runs against; this is the one place it goes red before a phone sees it.
  it('are all written inside new Worker(...)', () => {
    const files = trackedFiles('*.ts', '*.js', '*.mjs').filter(
      (f) =>
        !f.includes('/node_modules/') &&
        !f.includes('/public/') &&
        // Tests read files next to them by URL; they never ship.
        !/\.(test|spec)\.[cm]?[jt]s$/.test(f) &&
        !f.startsWith('tests/repo-config/'),
    );
    expect(files.length).toBeGreaterThan(100);
    const found = [];
    for (const f of files) {
      const source = readTracked(f);
      if (!source.includes('import.meta.url')) {
        continue;
      }
      for (const hit of looseWorkerUrls(source)) {
        found.push(`${f}:${hit}`);
      }
    }
    expect(found).toEqual([]);
  });
});
