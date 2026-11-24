// Repo-meta test: the osm-h3 publish workflow keeps the properties a release
// depends on.
//
// WHY THIS EXISTS. A publish workflow runs only when a release is made, which
// is rare, so a broken one is found at the worst moment: with a tag already
// public and nothing on npm. These checks pin what the workflow must do before
// it ever runs: fire only for its own tag prefix, refuse a tag that does not
// match the manifest, authenticate through Trusted Publishing (OIDC) rather
// than a stored token, and keep pre-releases off `latest`.
//
// WHAT IT CANNOT SEE. Whether npm accepts the publish: that needs the trusted
// publisher entry on npmjs.com, which names this workflow's FILE NAME. A
// rename of the file breaks the release without failing anything here, so
// the file name is pinned below as well.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = '.github/workflows/publish-osm-h3.yml';

describe('osm-h3 publish workflow', () => {
  // Why this test matters: npm's trusted publisher entry names this exact
  // file; a renamed workflow is refused by the registry at release time.
  it('exists under the file name the trusted publisher entry names', () => {
    expect(existsSync(join(ROOT, WORKFLOW))).toBe(true);
  });

  const text = existsSync(join(ROOT, WORKFLOW))
    ? readFileSync(join(ROOT, WORKFLOW), 'utf8')
    : '';
  const workflow = parse(text) ?? {};
  const job = workflow.jobs?.publish ?? {};
  const steps = job.steps ?? [];
  const runOf = (name) => steps.find((s) => s.name === name)?.run ?? '';

  it('fires on a published release, only for osm-h3@ tags', () => {
    // Why this test matters: the repo hosts several release streams; a
    // missing filter would publish osm-h3 on a framework release.
    expect(workflow.on?.release?.types).toEqual(['published']);
    expect(job.if).toBe("startsWith(github.event.release.tag_name, 'osm-h3@')");
  });

  it('authenticates through OIDC, never a stored token', () => {
    // Why this test matters: Trusted Publishing needs id-token: write, and a
    // NODE_AUTH_TOKEN or NPM_TOKEN would bring back the long-lived secret.
    expect(workflow.permissions?.['id-token']).toBe('write');
    expect(text).not.toMatch(/\$\{\{\s*secrets\./);
    for (const scope of [workflow, job, ...steps]) {
      expect(Object.keys(scope.env ?? {})).not.toContain('NODE_AUTH_TOKEN');
    }
  });

  it('checks out the tag and refuses a tag that does not match the manifest', () => {
    // Why this test matters: a typo in the release UI must not ship.
    const checkout = steps.find((s) => String(s.uses).startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe('${{ github.event.release.tag_name }}');
    const check = steps.find((s) => s.name === 'Verify tag matches package.json version');
    expect(check?.['working-directory']).toBe('GpsPlusSlamJs_Osm');
    expect(check?.run).toContain('osm-h3@');
    expect(check?.run).toContain('exit 1');
  });

  it('publishes from the package folder, pre-releases to next', () => {
    // Why this test matters: a pre-release on `latest` is what every
    // `pnpm add osm-h3` would then install.
    const publish = steps.find((s) => s.name === 'Publish osm-h3');
    expect(publish?.['working-directory']).toBe('GpsPlusSlamJs_Osm');
    expect(runOf('Publish osm-h3')).toMatch(
      /prerelease[\s\S]*pnpm publish --access public --no-git-checks --tag next/
    );
  });

  it('runs on the Node major the package declares as its floor', () => {
    // Why this test matters: the published engines floor is checked against
    // workflow pins; the publish job builds on that same major.
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'GpsPlusSlamJs_Osm', 'package.json'), 'utf8')
    );
    const floor = /^>=(\d+)/.exec(manifest.engines.node)?.[1];
    const setup = steps.find((s) => String(s.uses).startsWith('actions/setup-node@'));
    expect(String(setup?.with?.['node-version'])).toBe(floor);
  });
});
