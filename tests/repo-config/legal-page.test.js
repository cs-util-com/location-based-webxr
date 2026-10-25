// Repo-meta test: the site-wide legal notice and privacy page
// (GpsPlusSlamJs_Landing/legal/index.html, served at /legal/).
//
// Why this test matters: the page exists for people to find it and to tell
// them the truth, and each of the ways it can fail is silent:
// - its "Last updated" date is written by hand (a build-time date would claim
//   a change on every deploy), so the text can change while the date does
//   not, or the date can be bumped for nothing. Pinning a hash of the visible
//   text TOGETHER with the date makes either change fail here until both are
//   updated in the same commit;
// - an app added to the site build without a link to the page leaves its
//   visitors with no way to reach it;
// - the site build must emit the page and let every app link it by its
//   root-absolute path, which its own base-path guard would otherwise refuse;
// - the page names the data region of the Recorder's error service; moving
//   the service to another region without changing the text would make the
//   page wrong.
//
// Coverage limits: these are source-shape checks. Whether the built page
// renders is the Landing app's e2e (playwright-tests/legal.spec.js); whether
// the text is TRUE of the code is a reading job, listed in the page's
// sidecar (legal/index.html.md), which a hash cannot do.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf-8');

const PAGE_PATH = 'GpsPlusSlamJs_Landing/legal/index.html';
const PAGE = read(PAGE_PATH);

/**
 * The page's text as a reader sees it: what is inside <main>, without
 * comments, style or tags, entities decoded, whitespace collapsed, and
 * without the "Last updated" sentence (the date is pinned on its own).
 * Markup and style changes therefore do not trip the hash; a word does.
 */
function visibleText(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return main
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/Last updated: \d{4}-\d{2}-\d{2}\./, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The pinned pair. When the page's visible text changes in substance, set
 * `date` to the day of the change, put the same date on the page, and paste
 * the new hash the failure prints. For a typo fix, update only the hash.
 */
const PINNED = {
  date: '2026-10-25',
  sha256: 'a76bd5ade9750e4c164c76c46eecf5a8e83bbfcc541d964d1d9ad1e5c75e663f',
};

describe('the legal page date and text', () => {
  it('shows the pinned "Last updated" date', () => {
    const match = PAGE.match(/Last updated: (\d{4}-\d{2}-\d{2})\./);
    expect(match, 'the page lost its "Last updated: YYYY-MM-DD." line').not.toBeNull();
    expect(match?.[1]).toBe(PINNED.date);
  });

  it('has the visible text the pinned date belongs to', () => {
    const hash = createHash('sha256').update(visibleText(PAGE)).digest('hex');
    expect(
      hash,
      `${PAGE_PATH} text changed: update "Last updated" on the page if the ` +
        `change is one of substance, and set PINNED in this file to the same ` +
        `date and to sha256 ${hash}`
    ).toBe(PINNED.sha256);
  });

  it('keeps the comment that says when the date changes, directly above it', () => {
    expect(PAGE).toMatch(/<!--[^]*?legal-page\.test\.js[^]*?-->\s*<p class="updated"/);
  });

  it('does not make the reader responsible for checking it for changes', () => {
    // Such a clause moves no duty and is called unfair by the guidance on
    // transparency; the page promises the order of events instead.
    expect(visibleText(PAGE)).not.toMatch(/responsible for checking|check this page (regularly|for changes)/i);
    expect(visibleText(PAGE)).toMatch(/We change this page before we change/);
  });

  it('keeps both sections and the marked operator placeholder until it is filled in', () => {
    expect(PAGE).toContain('id="notice"');
    expect(PAGE).toContain('id="privacy"');
    expect(visibleText(PAGE)).toContain('support@cs-util.com');
    expect(visibleText(PAGE)).toContain('cs-util.com');
  });
});

/** Every package the site build runs `vite build` for, by package name. */
function deployedPackageNames() {
  const script = read('scripts/build-site.mjs');
  return [
    ...script.matchAll(/'--filter',\s*'([\w-]+)',\s*'exec',\s*'vite',\s*'build'/g),
  ].map((m) => m[1]);
}

/** Package name -> workspace folder, from every GpsPlusSlamJs_* package.json. */
function packageFolders() {
  const folders = new Map();
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('GpsPlusSlamJs_')) continue;
    const manifest = join(repoRoot, entry.name, 'package.json');
    if (!existsSync(manifest)) continue;
    folders.set(JSON.parse(readFileSync(manifest, 'utf-8')).name, entry.name);
  }
  return folders;
}

/** Pages beyond an app's index.html that a visitor lands on directly. */
const EXTRA_PAGES = ['GpsPlusSlamJs_TourViewer/edit.html'];

const LINK = /href="\/legal\/(#[\w-]+)?"/;

describe('every app on the site links the legal page', () => {
  const names = deployedPackageNames();
  const folders = packageFolders();

  it('finds the apps the site build deploys', () => {
    // Guard the guard: the landing page and the eight subpath apps today. A
    // change to the script's shape that matches nothing must fail here, not
    // pass on an empty list.
    expect(names.length).toBeGreaterThanOrEqual(9);
    expect(names).toContain('gps-plus-slam-landing');
  });

  it.each(deployedPackageNames())('%s links /legal/ from its first page', (name) => {
    const folder = folders.get(name);
    expect(folder, `no workspace folder for ${name}`).toBeDefined();
    const html = read(`${folder}/index.html`);
    expect(html, `${folder}/index.html has no link to /legal/`).toMatch(LINK);
  });

  it.each(EXTRA_PAGES)('%s links /legal/', (page) => {
    expect(read(page)).toMatch(LINK);
  });

  it("the blog's shared layout links /legal/", () => {
    expect(read('GpsPlusSlamJs_Landing/scripts/blog/render.mjs')).toMatch(LINK);
  });
});

describe('the site build serves the legal page', () => {
  const script = read('scripts/build-site.mjs');

  it('builds it as a second entry of the landing app', () => {
    expect(read('GpsPlusSlamJs_Landing/vite.config.ts')).toMatch(
      /legal:\s*fileURLToPath\(new URL\("legal\/index\.html"/
    );
  });

  it('exempts it, and only it, from the bare-absolute-URL guard, and requires it in the tree', () => {
    expect(script).toMatch(/const SITE_WIDE_PAGES = \['\/legal\/'\];/);
    expect(script).toContain('!isSiteWidePage(url)');
    expect(script).toContain('...SITE_WIDE_PAGES.map(');
    expect(script).toContain('...SITE_WIDE_PAGES,');
  });
});

describe("the page's error-report paragraph matches the Recorder", () => {
  it('names the data region the Recorder sends error reports to', () => {
    const sentry = read('GpsPlusSlamJs_RecorderApp/src/utils/sentry.ts');
    const region = sentry.match(/\.ingest\.([a-z]+)\.sentry\.io\//)?.[1];
    expect(region, 'the Recorder DSN names no data region').toBeDefined();
    expect(visibleText(PAGE)).toContain(`Sentry's ${region?.toUpperCase()} data region`);
  });
});
