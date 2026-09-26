/**
 * The framework's atmosphere modules are served to the design system's
 * no-build 3D look-dev page as TypeScript, type-stripped on the fly
 * (`GpsPlusSlamJs_DesignSystem/serve.mjs`), and deployed by crawling the same
 * graph (`build-lookdev.mjs`). That only works for a restricted dialect:
 *
 * - imports are `three` (import-mapped) or RELATIVE with a `.js` suffix;
 *   an extensionless or other bare specifier 404s in the browser (the
 *   framework mixes both styles, and `utils/logger` pulls `@sentry/browser`);
 * - no syntax that type stripping cannot erase: `enum`, parameter
 *   properties (`constructor(private x…)`).
 *
 * WHY A ROOT TEST. The only other thing that notices is the design system's
 * gate, and `test:changed` never runs it for a framework-only change (the
 * page reaches the framework over HTTP, not as a dependency). This file runs
 * for every commit. Private repo plan 2026-09-23-0048 §4.1; M1 milestone
 * review, finding 4.
 *
 * It walks the whole reachable graph, not just the atmosphere directory, so
 * a helper imported from elsewhere (e.g. `utils/clamp01.ts`) is held to the
 * same rules.
 *
 * THE GLOBE (globe plan 2026-09-26-0539 §7.1, W7 M0) is served the same way,
 * from its own package, to the globe lab. Its graph is checked against the
 * LAB's import map (the bare specifiers that page maps), so each page is held
 * to what it can actually resolve.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ATMOSPHERE = join(
  repoRoot,
  'GpsPlusSlamJs_AppFramework',
  'src',
  'visualization',
  'atmosphere'
);
const SPECIFIER =
  /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?['"]([^'"]+)['"]/g;

/**
 * Every problem in the served graph, as "file: problem". `mapped` is the
 * page's import-mapped bare specifiers.
 */
function servedGraphProblems(
  entries,
  readFile = (f) => readFileSync(f, 'utf8'),
  mapped = ['three']
) {
  const problems = [];
  const queue = [...entries];
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFile(file);
    const name = relative(repoRoot, file);
    if (/^\s*(?:export\s+)?(?:const\s+)?enum\s+\w+/m.test(source)) {
      problems.push(`${name}: enum (type stripping cannot erase it)`);
    }
    if (/constructor\s*\([^)]*\b(?:private|public|protected|readonly)\s+\w+/.test(source)) {
      problems.push(`${name}: parameter property (type stripping cannot erase it)`);
    }
    for (const match of source.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (mapped.includes(specifier)) continue;
      if (!specifier.startsWith('.')) {
        problems.push(
          `${name}: bare import "${specifier}" (import-mapped: ${mapped.join(', ')})`
        );
        continue;
      }
      if (!specifier.endsWith('.js')) {
        problems.push(`${name}: import "${specifier}" has no .js suffix`);
        continue;
      }
      const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
      if (!existsSync(target)) {
        problems.push(`${name}: import "${specifier}" resolves to nothing`);
        continue;
      }
      queue.push(target);
    }
  }
  return problems;
}

function atmosphereEntries() {
  return readdirSync(ATMOSPHERE)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .map((f) => join(ATMOSPHERE, f));
}

describe('atmosphere modules stay servable to the no-build look-dev page', () => {
  // Non-vacuous: the entry list must actually contain the modules.
  it('finds the atmosphere modules', () => {
    expect(atmosphereEntries().length).toBeGreaterThanOrEqual(8);
  });

  it('imports only "three" and .js-suffixed relatives, with erasable syntax', () => {
    expect(servedGraphProblems(atmosphereEntries())).toEqual([]);
  });

  // The guard must be able to fail: each rule, planted in a fake file.
  it.each([
    ["import { log } from '../../utils/logger';", 'no .js suffix'],
    ["import * as Sentry from '@sentry/browser';", 'bare import'],
    ['export enum Mode { A, B }', 'enum'],
    ['class A { constructor(private x: number) {} }', 'parameter property'],
    ["import { x } from './missing.js';", 'resolves to nothing'],
  ])('flags %s', (source, expected) => {
    const fake = join(ATMOSPHERE, '__planted__.ts');
    const problems = servedGraphProblems([fake], () => source);
    expect(problems.join('\n')).toContain(expected);
  });
});

const GLOBE_SRC = join(repoRoot, 'GpsPlusSlamJs_Globe', 'src');
const GLOBE_LAB = join(repoRoot, 'GpsPlusSlamJs_DesignSystem', 'labs', 'globe', 'index.html');

/** Every production .ts under a directory, recursively. */
function productionTs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isDirectory()) return productionTs(path);
    return d.name.endsWith('.ts') && !d.name.includes('.test.') ? [path] : [];
  });
}

/** The bare specifiers the globe lab's import map resolves. */
function globeLabMapped() {
  const html = readFileSync(GLOBE_LAB, 'utf8');
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return Object.keys(JSON.parse(map[1]).imports).filter((k) => !k.endsWith('/'));
}

describe('the globe package stays servable to the no-build globe lab', () => {
  it('finds the globe modules and the lab import map', () => {
    expect(productionTs(GLOBE_SRC).length).toBeGreaterThanOrEqual(2);
    expect(globeLabMapped()).toEqual(
      expect.arrayContaining(['three', '3d-tiles-renderer', '3d-tiles-renderer/plugins'])
    );
  });

  it('imports only what the lab maps, and .js-suffixed relatives', () => {
    expect(servedGraphProblems(productionTs(GLOBE_SRC), undefined, globeLabMapped())).toEqual([]);
  });

  // A dependency the lab does not map would 404 on the page only.
  it('flags a bare import the lab does not map', () => {
    const fake = join(GLOBE_SRC, '__planted__.ts');
    const problems = servedGraphProblems(
      [fake],
      () => "import { Pass } from 'three/addons/postprocessing/Pass.js';",
      globeLabMapped()
    );
    expect(problems.join('\n')).toContain('bare import');
  });
});
