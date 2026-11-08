// Why this test matters: the fast gate's wrappers run vitest and prettier
// through this lookup with an argv and no shell. A wrong path would turn
// every narrowed run into a crash, and a silent fallback would hide it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { toolBin } from './package-bin.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('toolBin', () => {
  it("finds a tool's bin script through the package's own resolution", () => {
    const bin = toolBin(ROOT, 'vitest');
    expect(existsSync(bin)).toBe(true);
    expect(bin.replaceAll('\\', '/')).toMatch(/\/vitest\/[^/]+\.m?js$/);
  });

  // The format stage's tool: prettier's `bin` is a plain string (vitest's is
  // an object), and its `exports` map must let `prettier/package.json` resolve.
  it('finds a tool whose bin is a plain string (prettier, from a package that declares it)', () => {
    const pkg = fileURLToPath(new URL('../../GpsPlusSlamJs_AppFramework', import.meta.url));
    const bin = toolBin(pkg, 'prettier');
    expect(existsSync(bin)).toBe(true);
    expect(bin.replaceAll('\\', '/')).toMatch(/\/prettier\/bin\/prettier\.c?js$/);
  });

  it('throws for a tool the package does not resolve', () => {
    expect(() => toolBin(ROOT, 'no-such-tool-r1139')).toThrow();
  });
});
