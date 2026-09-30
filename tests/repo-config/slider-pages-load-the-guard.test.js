/**
 * Every page with a slider installs the framework's page-wide slider guard.
 *
 * Why this test matters (owner report 2026-09-30): on a phone, a vertical
 * swipe that started on a range input edited that slider instead of scrolling
 * the panel, on every demo page. The fix is ONE framework module,
 * `utils/slider-scroll-guard`, installed once per page with
 * `guardSlidersIn(document)`. Only the look-dev page proves it in a browser
 * (`GpsPlusSlamJs_DesignSystem/3d/slider-touch.smoke.spec.mjs`); this is the
 * cheap check that holds every other page to it, so a new page with a slider
 * cannot forget it.
 *
 * A page "has a slider" when its HTML holds a range input, or when a module
 * its entry scripts reach through local imports builds one at runtime. It
 * passes when one of the module scripts the page loads DIRECTLY calls
 * `guardSlidersIn(document)`: the page's own entry is where a reader looks.
 *
 * It also holds the guard module servable to the no-build design-system
 * pages (they fetch it as type-stripped TypeScript over `/fw/`, so it must
 * import nothing), and keeps pages off the per-slider install, which would
 * double-guard a slider that the page-wide install already covers.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Pages that keep sliders without the guard, each with its reason.
 * - The design-system catalog is a static specimen sheet, opened over
 *   file:// by `shoot.mjs`, where the `/fw/` route does not exist; its
 *   sliders drive nothing, so a swipe that moves one changes nothing.
 */
const EXEMPT = new Map([
  ['GpsPlusSlamJs_DesignSystem/index.html', 'static specimen sheet over file://'],
]);

const RANGE_IN_HTML = /<input\b[^>]*\btype\s*=\s*["']?range\b/is;
const RANGE_AT_RUNTIME =
  /\.type\s*=\s*["']range["']|setAttribute\(\s*["']type["']\s*,\s*["']range["']|type=\\?["']range\\?["']/;
const INSTALL = /\bguardSlidersIn\(\s*document\s*\)/;
const MODULE_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
const LOCAL_IMPORT = /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;

function tracked(...patterns) {
  return execFileSync('git', ['ls-files', ...patterns], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('node_modules/') && !f.includes('/dist/'));
}

/** Tracked files that contain `text` literally (git grep exits 1 on no match). */
function gitGrep(text, ...patterns) {
  try {
    return execFileSync('git', ['grep', '-l', '-F', text, '--', ...patterns], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

function packageRootOf(file) {
  return file.split('/')[0];
}

/** A module file from an import specifier (TS sources are imported as `.js` or bare). */
function resolveModule(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.js`];
  return candidates.find((c) => existsSync(c) && !c.endsWith('/')) ?? null;
}

/**
 * The module scripts a page loads: `{ file, source }` for each `src` one
 * that exists here (`/src/...` is package-root-relative, as Vite serves it)
 * and `{ file: null, source }` for an inline one.
 */
function entryModules(page, html, read) {
  const out = [];
  for (const match of html.matchAll(MODULE_SCRIPT)) {
    const src = match[0].match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1];
    if (!src) {
      out.push({ file: null, source: match[1] });
      continue;
    }
    const file = src.startsWith('/')
      ? join(repoRoot, packageRootOf(page), src)
      : resolve(repoRoot, dirname(page), src);
    if (existsSync(file)) out.push({ file, source: read(file) });
  }
  return out;
}

/** True when a module reachable from `entries` through local imports builds a range input. */
function buildsSliderAtRuntime(entries, read) {
  const seen = new Set();
  const queue = entries.filter((e) => e.file).map((e) => e.file);
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = read(file);
    if (RANGE_AT_RUNTIME.test(source)) return true;
    for (const m of source.matchAll(LOCAL_IMPORT)) {
      const next = resolveModule(file, m[1]);
      if (next) queue.push(next);
    }
  }
  return false;
}

/** Every slider page that does not install the guard, as "page: reason". */
function unguardedPages(pages, readPage, read) {
  const problems = [];
  for (const page of pages) {
    if (EXEMPT.has(page)) continue;
    const html = readPage(page);
    const entries = entryModules(page, html, read);
    const hasSlider = RANGE_IN_HTML.test(html) || buildsSliderAtRuntime(entries, read);
    if (!hasSlider) continue;
    if (!entries.some((e) => INSTALL.test(e.source))) {
      problems.push(`${page}: has a slider, but no module script it loads calls guardSlidersIn(document)`);
    }
  }
  return problems;
}

const readRepo = (page) => readFileSync(join(repoRoot, page), 'utf8');
const readAbs = (file) => readFileSync(file, 'utf8');

describe('every page with a slider installs the page-wide slider guard', () => {
  const pages = tracked('*.html');

  // Non-vacuous: the pages the 2026-09-30 inventory found must be seen as
  // slider pages, or the check below would pass by finding nothing.
  it('finds the slider pages', () => {
    const sliderPages = pages.filter((p) => RANGE_IN_HTML.test(readRepo(p)));
    expect(sliderPages).toEqual(
      expect.arrayContaining([
        'GpsPlusSlamJs_DesignSystem/3d/index.html',
        'GpsPlusSlamJs_DesignSystem/labs/ar-shadows/index.html',
        'GpsPlusSlamJs_DesignSystem/labs/globe/index.html',
        'GpsPlusSlamJs_DesignSystem/labs/terrain/index.html',
        'GpsPlusSlamJs_OsmDemo/index.html',
        'GpsPlusSlamJs_PhysicsDemo/index.html',
        'GpsPlusSlamJs_RecorderApp/index.html',
        'GpsPlusSlamJs_WayfindingHudDemo/index.html',
      ])
    );
  });

  it('each one loads a module that calls guardSlidersIn(document)', () => {
    expect(unguardedPages(pages, readRepo, readAbs)).toEqual([]);
  });

  // The check must be able to fail, for both ways a page can have a slider.
  it('flags a page with a range input and no install', () => {
    const problems = unguardedPages(
      ['GpsPlusSlamJs_PhysicsDemo/__planted__.html'],
      () => '<input type="range"><script type="module">console.log(1)</script>',
      readAbs
    );
    expect(problems.join('\n')).toContain('__planted__.html');
  });

  it('flags a page whose module builds a slider at runtime', () => {
    // The entry imports a real sibling, which is read as building a slider.
    const problems = unguardedPages(
      ['GpsPlusSlamJs_PhysicsDemo/index.html'],
      () => '<script type="module" src="/src/main.ts"></script>',
      (file) =>
        file.endsWith(join('src', 'main.ts'))
          ? 'import { x } from "./replay-physics.js";'
          : 'const s = document.createElement("input"); s.type = "range";'
    );
    expect(problems.join('\n')).toContain('PhysicsDemo/index.html');
  });

  it('keeps pages off the per-slider install', () => {
    // git grep, not a read of every file: this suite runs beside other
    // whole-tree scans that share its 5 s timeout.
    const offenders = gitGrep('guardSliderAgainstScroll(', '*.ts', '*.js', '*.mjs')
      .filter((f) => !/\.(test|spec|property\.test)\.|\/tests?\//.test(f))
      .filter((f) => f !== 'GpsPlusSlamJs_AppFramework/src/utils/slider-scroll-guard.ts');
    expect(offenders).toEqual([]);
  });
});

describe('the slider guard stays servable to the no-build design-system pages', () => {
  it('imports nothing', () => {
    const source = readRepo('GpsPlusSlamJs_AppFramework/src/utils/slider-scroll-guard.ts');
    expect(source).not.toMatch(/^\s*(?:import|export)\b[^;]*\bfrom\s*['"]/m);
    expect(source).not.toMatch(/^\s*import\s*['"]/m);
    expect(source).not.toMatch(/\benum\s+\w+/);
  });
});
