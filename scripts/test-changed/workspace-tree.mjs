// The work tree as the impact graph sees it (impact-graph.mjs): every file
// that exists (tracked or untracked, never ignored), the source text of every
// module, and the workspace packages with their names, dependencies and
// `exports`. Shared by test-changed.mjs (which dependents run) and
// related-unit.mjs (which of a package's tests run), so both walk one graph.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { MODULE_RE, TSCONFIG_RE, buildImpactGraph } from './impact-graph.mjs';

/** Above this size a module is generated data, not source with imports. */
const MAX_TEXT_BYTES = 3_000_000;

/**
 * @param {string} root - the workspace root
 * @returns {import('./impact-graph.mjs').WorkspacePackage[]}
 */
export function workspacePackages(root) {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  return [...yaml.matchAll(/^\s*-\s+(\S+)\s*$/gm)]
    .map((m) => m[1])
    .filter((dir) => existsSync(path.join(root, dir, 'package.json')))
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
      const deps = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
        (field) => Object.keys(pkg[field] ?? {})
      );
      return { dir, name: String(pkg.name ?? ''), deps, exports: pkg.exports };
    });
}

/**
 * @param {string} root - the workspace root
 * @returns {string[]} every existing file, tracked or untracked, repo-relative
 */
export function existingFiles(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((f) => f !== '' && existsSync(path.join(root, f)));
}

/**
 * @param {string} root - the workspace root
 * @returns {import('./impact-graph.mjs').ImpactGraph}
 */
export function loadImpactGraph(root) {
  const files = [...new Set(existingFiles(root))];
  /** @type {Map<string, string>} */
  const texts = new Map();
  for (const f of files) {
    // Declaration files and tsconfigs draw type-level edges (impact-graph.mjs).
    if (!MODULE_RE.test(f) && !TSCONFIG_RE.test(f)) continue;
    const abs = path.join(root, f);
    if (statSync(abs).size > MAX_TEXT_BYTES) continue;
    texts.set(f, readFileSync(abs, 'utf8'));
  }
  return buildImpactGraph({ packages: workspacePackages(root), files, texts });
}
