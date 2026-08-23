// Repo-meta test: the multi-app site build is wired the way the deployment
// needs, checked WITHOUT running a single vite build.
//
// Why this test matters: `scripts/build-site.mjs` produces what
// `gps.csutil.com` serves, and every way it can be wrong is invisible locally.
// A local `pnpm dev` never uses a base or an outDir; the apps' committed vite
// configs stay at their `/` + `dist` defaults on purpose. So the base/outDir
// pairing exists ONLY in this script, is exercised ONLY by the deploy, and
// fails ONLY in production — as a 404 on an asset, not as a build error.
//
// The script's own header records one such break already: the OSM library build
// "was missing here and nowhere else supplied it, which broke the /osm/
// deployment while every local build passed against a stale dist left over from
// an earlier e2e run". That is the exact shape this file guards.
//
// A SOURCE-SHAPE TEST, deliberately (H11, repo-hygiene loop, owner interview
// 2026-07-20): the alternative is running eight real vite builds, which is what
// the deploy CI already does and which no unit gate can afford. This follows
// the `run-vitest-scoped` precedent — pin the wiring, let CI exercise the build.
//
// Coverage limits, stated because a source-shape test invites over-reading: it
// checks the TEXT of the script, so a refactor to a data-driven app table would
// need this file rewritten, and it cannot see whether vite actually honours the
// flags. What it does see is the class of mistake that has actually happened —
// a missing library build, and a base that disagrees with its output directory.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = readFileSync(join(repoRoot, 'scripts', 'build-site.mjs'), 'utf-8');

/**
 * Every `--base=/x/` in the script, in source order, with the index it was
 * found at — the index is what makes the ordering assertions possible.
 */
function basesInOrder() {
  return [...SCRIPT.matchAll(/--base=(\/[\w-]*\/?)/g)].map((m) => ({
    base: m[1],
    at: m.index ?? 0,
  }));
}

describe('the multi-app site build', () => {
  it('builds the landing app FIRST, into the dist-site root', () => {
    // ORDER IS LOAD-BEARING and the script says so: the landing app builds into
    // the SHARED root, so building it after the subpath apps would risk wiping
    // their subdirectories. A reorder is silent — the deploy still succeeds and
    // simply serves less than it should.
    const bases = basesInOrder();
    expect(bases.length).toBeGreaterThan(1);
    expect(bases[0]?.base).toBe('/');
    // …and nothing else claims the root.
    expect(bases.filter((b) => b.base === '/')).toHaveLength(1);
  });

  it('builds BOTH workspace libraries before any app that consumes them', () => {
    // The recorded production break: `build:osm` was missing, and every local
    // build passed against a stale `dist` from an earlier e2e run. Consumers
    // resolve these through package `exports`, i.e. through dist, so a missing
    // library build surfaces as the APP's typecheck failing with "cannot find
    // module" — a cascade that reads like the app's own bug.
    const framework = SCRIPT.indexOf("run', 'build:framework'");
    const osm = SCRIPT.indexOf("run', 'build:osm'");
    expect(framework, 'the framework build is missing').toBeGreaterThan(-1);
    expect(osm, 'the OSM package build is missing').toBeGreaterThan(-1);

    // Before every subpath app — the first non-root base is the earliest
    // consumer, and both libraries must precede it.
    const firstSubpath = basesInOrder().find((b) => b.base !== '/');
    expect(firstSubpath).toBeDefined();
    expect(framework).toBeLessThan(firstSubpath?.at ?? 0);
    expect(osm).toBeLessThan(firstSubpath?.at ?? 0);
  });

  it('gives every subpath app an --outDir that MATCHES its --base', () => {
    // THE ASSERTION THAT WOULD CATCH A REAL DEPLOY BREAK. `--base=/osm/` with
    // an output directory of `starter` produces a tree that builds cleanly,
    // deploys cleanly, and 404s every asset — because vite rewrites URLs to the
    // base while the files sit somewhere else. Nothing local reproduces it.
    const pairs = [
      ...SCRIPT.matchAll(
        /--base=(\/[\w-]+\/)[\s\S]{0,200}?join\(distSite, '([\w-]+)'\)/g
      ),
    ].map((m) => ({ base: m[1], dir: m[2] }));

    // Guard the guard: if the script's shape changes so nothing matches, this
    // test must fail rather than pass vacuously on an empty list.
    expect(pairs.length).toBeGreaterThanOrEqual(7);
    for (const { base, dir } of pairs) {
      expect(base, `base ${base} does not match outDir ${dir}`).toBe(`/${dir}/`);
    }
  });

  it('follows every subpath build with the bare-absolute-URL guard for the SAME base', () => {
    // The deployment check the script exists to enforce. A new app added
    // without its guard line loses it silently — the build is green and the
    // 404s appear only in production, which is precisely the failure mode the
    // guard was written for.
    const guarded = [
      ...SCRIPT.matchAll(
        /assertNoBareAbsoluteUrlsInDir\(\s*join\(distSite, '([\w-]+)'\),\s*'(\/[\w-]+\/)'/g
      ),
    ].map((m) => ({ dir: m[1], base: m[2] }));

    const built = [
      ...SCRIPT.matchAll(/--base=(\/[\w-]+\/)[\s\S]{0,200}?join\(distSite, '([\w-]+)'\)/g),
    ].map((m) => m[2]);

    expect(guarded.length).toBeGreaterThanOrEqual(7);
    // Every built subpath directory is guarded…
    for (const dir of built) {
      expect(
        guarded.some((g) => g.dir === dir),
        `${dir}/ is built but never checked for bare absolute URLs`
      ).toBe(true);
    }
    // …and every guard names the base that matches its own directory.
    for (const { dir, base } of guarded) {
      expect(base, `guard for ${dir}/ names base ${base}`).toBe(`/${dir}/`);
    }
  });

  it('keeps the header comment honest about which apps it deploys', () => {
    // The header draws the output tree, and it is the only place a reader
    // learns what the deployed site contains. A new app whose build is added
    // without a line in that tree makes the file's own map wrong — the drift
    // this repo has been bitten by in docs repeatedly.
    const header = SCRIPT.slice(0, SCRIPT.indexOf('*/'));
    const built = [
      ...SCRIPT.matchAll(/--base=(\/[\w-]+\/)[\s\S]{0,200}?join\(distSite, '([\w-]+)'\)/g),
    ].map((m) => m[2]);

    for (const dir of built) {
      expect(header, `the header tree omits ${dir}/`).toContain(`${dir}/`);
    }
  });
});
