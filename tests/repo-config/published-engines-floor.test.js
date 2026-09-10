// Repo-meta test: a package's `engines.node` floor must be a version that
// some workflow in this repo actually runs.
//
// WHY THIS EXISTS. `engines.node` is a promise to whoever installs the
// package, and until 2026-09-08 nothing checked that the promise had ever
// been executed. The framework declared `>=22.15.0` while every workflow and
// `.nvmrc` ran 26, so the supported-but-never-run range was 22.15 through 25:
// four major lines in which a syntax form or a built-in could reach `dist/`
// and break only in a stranger's install, where nobody here would see it.
// The floor was raised to 26 (owner decision 2026-09-08) precisely because a
// promise no gate defends is worse than a narrower promise that is true.
//
// WHY IT IS DUPLICATED. The private repo's `GpsPlusSlamJs_Investigation` has
// a cross-repo version of this guard covering all three manifests, and that
// is the right home for the cross-repo view. But it does not run here: a
// change to `GpsPlusSlamJs_AppFramework/package.json` is gated by this repo's
// root `test:changed` and by this repo's CI, and neither touches the
// Investigation project. The round that introduced the guard changed both
// manifests below and ran a full cascade without it participating once - so
// the copy that guards these two packages has to live where these two
// packages are gated. Reviewed and accepted as deliberate duplication.
//
// WHAT IT CANNOT SEE. The comparison is on MAJOR versions, because a
// workflow pin of `node-version: "26"` carries no minor. A floor of
// `>=26.9.0` passes against a runner on 26.0. It catches the big lie - a
// floor on a line nothing runs - not the small one.
//
// WHY THE PACKAGE LIST IS HARD-CODED. No manifest field distinguishes
// "published to npm" from "not": `gps-plus-slam-recorder` and
// `gps-plus-slam-osm` both lack `"private": true` and are both 404 on the
// registry, while `gps-plus-slam-app-framework` is published. Deriving the
// set would be wrong in a way that reads as correct.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '../..');

const GUARDED = [
  // Published to npm (1.24.0 as of 2026-09-08).
  'GpsPlusSlamJs_AppFramework',
  // NOT published - the publish workflow fires only on an `app-framework@`
  // tag - but it declares a floor, and an unrun floor misleads whether or
  // not anyone can install it today.
  'GpsPlusSlamJs_Osm',
];

/** The major from a simple `>=X[.Y[.Z]]` range, else null (never a guess). */
function parseEngineFloorMajor(range) {
  const match = /^\s*>=\s*(\d+)(?:\.\d+)*\s*$/.exec(range);
  return match?.[1] === undefined ? null : Number(match[1]);
}

/** Every concrete `node-version:` major in a workflow, in file order. */
function parseWorkflowNodeMajors(yamlText) {
  const majors = [];
  for (const line of yamlText.split(/\r?\n/)) {
    // Matrix references (`${{ matrix.node }}`) and `node-version-file:` are
    // not concrete pins and are skipped; an empty result is treated below as
    // "cannot verify", never as "verified".
    const value = /^\s*node-version:\s*['"]?(\d+)(?:\.\d+)*['"]?\s*(?:#.*)?$/.exec(
      line
    )?.[1];
    if (value !== undefined) majors.push(Number(value));
  }
  return majors;
}

function workflowNodeMajors() {
  const dir = path.join(REPO_ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) =>
      parseWorkflowNodeMajors(readFileSync(path.join(dir, f), 'utf8'))
    );
}

describe('published engines floor', () => {
  const majors = workflowNodeMajors();

  it('finds at least one concrete node-version pin to compare against', () => {
    // Why this test matters: without it every assertion below would pass
    // vacuously the day the workflows move to a matrix reference, and a
    // green would mean "we checked nothing".
    expect(majors.length).toBeGreaterThan(0);
  });

  for (const pkg of GUARDED) {
    it(`${pkg}: the engines.node floor is a version some workflow runs`, () => {
      const manifest = JSON.parse(
        readFileSync(path.join(REPO_ROOT, pkg, 'package.json'), 'utf8')
      );
      const range = manifest.engines?.node;
      expect(
        range,
        `${pkg} declares no engines.node; a package without a floor promises everything`
      ).toBeDefined();

      const floor = parseEngineFloorMajor(range);
      expect(
        floor,
        `${pkg}: engines.node is "${range}", which is not the simple ">=X.Y.Z" form this guard understands - widen the guard deliberately rather than leaving the floor unchecked`
      ).not.toBeNull();

      expect(
        majors,
        `${pkg} promises Node >=${floor} but no workflow in this repo runs that major (workflows run: ${[...new Set(majors)].join(', ')}). Either add a matrix entry at the floor, or raise the floor to a version that is actually exercised - an unrun floor is an untested promise.`
      ).toContain(floor);
    });

    it(`${pkg}: carries no devEngines runtime block`, () => {
      // Why this test matters: `devEngines` existed only to express
      // "developed on 26, consumed on 22.15". With the two collapsed onto one
      // number it is redundant, and a stale copy would re-assert the split
      // this decision reversed - quietly, since nothing else reads it.
      const manifest = JSON.parse(
        readFileSync(path.join(REPO_ROOT, pkg, 'package.json'), 'utf8')
      );
      expect(manifest.devEngines).toBeUndefined();
    });
  }
});
