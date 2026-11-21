// Tests for scripts/splat-csp-deploy.mjs - the site build's check that the
// splat trainer page ships with its content security policy intact.
//
// Why these tests matter: the trainer page runs code from another host in a
// worker, and its policy is a meta tag, so it governs only what the built
// page puts after it. The unit tests read the SOURCE page; only the build
// shows what is deployed (a bundler that hoists a script above the meta, or
// drops or rewrites it, or a worker chunk that names another commit). The
// pages here are synthetic, shaped like the real build's output.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertSplatPolicyShipped, policyMeta } from './splat-csp-deploy.mjs';

const PIN =
  'https://cdn.jsdelivr.net/gh/arrival-space/splat.js@0123456789abcdef0123456789abcdef01234567/';
const POLICY = `default-src 'self'; script-src 'self' blob: ${PIN}; connect-src 'self'`;
const META = `<meta\n      http-equiv="Content-Security-Policy"\n      content="${POLICY}"\n    />`;
const SOURCE = `<!doctype html><html><head><meta charset="UTF-8" />${META}<script type="module" src="../src/splat-trainer/splat-main.ts"></script></head></html>`;

/** A built page: `head` goes after the charset meta. */
const page = (head) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${head}</head><body></body></html>`;

const GOOD_HEAD =
  `${META}<link rel="icon" href="data:," />` +
  '<script type="module" crossorigin src="/tour/assets/splat-abc.js"></script>' +
  '<link rel="modulepreload" crossorigin href="/tour/assets/dist-def.js">';

/** @type {string} */
let root;

/** @param {string} rel @param {string} text */
function put(rel, text) {
  const file = join(root, ...rel.split('/'));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

/** A deploy with the given page head and worker chunk code. */
function site(head = GOOD_HEAD, worker = `const u="${PIN}src/index.js";`) {
  put('tour/splat/index.html', page(head));
  if (worker !== null) put('tour/assets/splat-trainer.worker-Ab_1.js', worker);
}

const check = () =>
  assertSplatPolicyShipped({ siteDir: root, sourceHtml: SOURCE });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'splat-csp-deploy-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('policyMeta', () => {
  it('reads the policy across lines, whitespace collapsed', () => {
    expect(policyMeta(page(META))?.policy).toBe(POLICY);
    expect(
      policyMeta(page('<meta name="referrer" content="no-referrer" />'))
    ).toBeNull();
  });
});

describe('assertSplatPolicyShipped', () => {
  it('passes a page built the way the source declares', () => {
    site();
    expect(check).not.toThrow();
  });

  it('fails when the page is missing', () => {
    expect(check).toThrow(/tour\/splat\/index\.html is missing/);
  });

  it('fails when the built policy is gone or differs from the source', () => {
    site(GOOD_HEAD.replace(META, ''));
    expect(check).toThrow(/carries no Content-Security-Policy meta/);
    site(GOOD_HEAD.replace("connect-src 'self'", 'connect-src *'));
    expect(check).toThrow(/differs from the source page's/);
  });

  // Why: a meta policy governs only what the parser meets after it; a
  // script hoisted above it runs unpoliced.
  it('fails when a script or link comes before the policy', () => {
    site(`<script type="module" src="/tour/assets/a.js"></script>${GOOD_HEAD}`);
    expect(check).toThrow(/comes before the policy/);
  });

  it('fails on an inline script and on scripts from elsewhere', () => {
    site(`${GOOD_HEAD}<script>alert(1)</script>`);
    expect(check).toThrow(/an inline script/);
    site(
      `${GOOD_HEAD}<script type="module" src="https://example.com/x.js"></script>`
    );
    expect(check).toThrow(/a script from https:\/\/example\.com\/x\.js/);
    site(`${GOOD_HEAD}<link rel="modulepreload" href="/assets/x.js">`);
    expect(check).toThrow(/a module preload from \/assets\/x\.js/);
  });

  // Why: the source test pins the policy to the commit in the code, but
  // only the built worker shows the address that is really loaded.
  it('fails when the worker loads a Splat.js address script-src does not allow', () => {
    site(GOOD_HEAD, `const u="${PIN.replace('0123', '9999')}src/index.js";`);
    expect(check).toThrow(/which script-src does not allow/);
  });

  it('fails when there is no worker chunk or it names no Splat.js address', () => {
    site(GOOD_HEAD, null);
    expect(check).toThrow(/no trainer worker chunk/);
    site(GOOD_HEAD, 'const u = 1;');
    expect(check).toThrow(/name no Splat\.js address/);
  });
});
