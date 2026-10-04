/**
 * WHY (globe plan 2026-09-26-0539 §7.1): the globe lab maps `three` to the
 * FRAMEWORK's copy, and 3d-tiles-renderer's bare `three` resolves through the
 * same map, so the page runs exactly one three. The globe package still
 * type-checks and unit-tests against its OWN copy. If the two drift, the
 * tests pass against one version while the page runs another, and a
 * version-specific break shows only in a browser. This holds them equal.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const threeVersion = (pkg) =>
  JSON.parse(
    readFileSync(join(repoRoot, pkg, 'node_modules', 'three', 'package.json'), 'utf8')
  ).version;

describe('the globe and the framework run one three', () => {
  it('installs the same three version in both packages', () => {
    const framework = threeVersion('GpsPlusSlamJs_AppFramework');
    expect(framework).toMatch(/^\d+\.\d+\.\d+/);
    expect(threeVersion('GpsPlusSlamJs_Globe')).toBe(framework);
  });
});
