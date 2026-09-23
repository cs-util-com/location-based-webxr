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

/** Every problem in the served graph, as "file: problem". */
function servedGraphProblems(entries, readFile = (f) => readFileSync(f, 'utf8')) {
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
      if (specifier === 'three') continue;
      if (!specifier.startsWith('.')) {
        problems.push(`${name}: bare import "${specifier}" (only "three" is import-mapped)`);
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
