// The entry script of a package's CLI tool (vitest, prettier) as the package
// itself resolves it, so the gate's wrappers can run the tool through node
// with an argv: no shell (a file name is never interpreted) and no cmd.exe
// command-line limit.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * @param {string} pkgDir - the package whose dependency resolution applies
 * @param {string} tool - the npm package name, which is also its bin name
 * @returns {string} the absolute path of the tool's bin script
 * @throws when the package does not resolve the tool, or the tool has no such bin
 */
export function toolBin(pkgDir, tool) {
  const require = createRequire(path.join(pkgDir, 'package.json'));
  const manifest = require.resolve(`${tool}/package.json`);
  const { bin } = /** @type {{ bin?: string | Record<string, string> }} */ (JSON.parse(readFileSync(manifest, 'utf8')));
  const rel = typeof bin === 'string' ? bin : bin?.[tool];
  if (!rel) throw new Error(`${tool} has no "${tool}" bin`);
  return path.join(path.dirname(manifest), rel);
}
