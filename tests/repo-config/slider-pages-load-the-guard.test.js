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
 * The call must RUN (review 2026-09-30): comments, HTML comments and string
 * contents are blanked before matching, and the call must be a top-level
 * statement or sit directly in a top-level function the module calls at top
 * level (`function main() { guardSlidersIn(document); } main();`).
 *
 * What it still cannot see:
 * - sliders built by a module the entry reaches only through a PACKAGE
 *   import (`gps-plus-slam-app-framework/...`) or a dynamic `import()`:
 *   only relative static imports are followed, so a framework component
 *   that builds a range input would make its pages slider pages unseen.
 *   None does today (2026-09-30);
 * - a call that runs only conditionally (`if (x) guardSlidersIn(document)`)
 *   or after an early `return` in its function;
 * - a page whose slider comes from HTML fetched or injected at runtime.
 * The scan is a small tokenizer, not a parser: a regex literal after an
 * unusual token could be misread, which fails loudly rather than passing.
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
 * - The design-system catalog is a specimen sheet that is not deployed
 *   (`build-lookdev.mjs` ships only `3d/` and `labs/`), opened over file://
 *   by `shoot.mjs`, where the `/fw/` route does not exist. Its sliders set
 *   no app state: the compass specimen only updates its own label, so a
 *   swipe that moves one changes a number on a sheet no phone user opens.
 */
const EXEMPT = new Map([
  ['GpsPlusSlamJs_DesignSystem/index.html', 'undeployed specimen sheet over file://'],
]);

const RANGE_IN_HTML = /<input\b[^>]*\btype\s*=\s*["']?range\b/is;
const RANGE_AT_RUNTIME =
  /\.type\s*=\s*["']range["']|setAttribute\(\s*["']type["']\s*,\s*["']range["']|type=\\?["']range\\?["']/;
const INSTALL = /\bguardSlidersIn\(\s*document\s*\)/g;
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const MODULE_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
const LOCAL_IMPORT = /(?:^|[;\s])(?:import|export)\s*(?:[\w*${}\s,]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/g;

/** Tokens after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER =
  /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|await|yield))\s*$/;

/**
 * `source` with its comments blanked (`code`), and also with the contents of
 * its strings, templates and regex literals blanked (`skeleton`). Both keep
 * every offset and newline, so a position means the same in all three.
 */
function scanJs(source) {
  const n = source.length;
  const code = source.split('');
  const skeleton = source.split('');
  const blank = (from, to, alsoCode) => {
    for (let k = from; k < Math.min(to, n); k++) {
      if (source[k] === '\n') continue;
      skeleton[k] = ' ';
      if (alsoCode) code[k] = ' ';
    }
  };
  /** Brace depth inside each open template `${`. */
  const holes = [];
  let inTemplate = false;
  let i = 0;
  while (i < n) {
    if (inTemplate) {
      const from = i;
      while (i < n && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{')) {
        i += source[i] === '\\' ? 2 : 1;
      }
      blank(from, i, false);
      inTemplate = false;
      if (source[i] === '$') holes.push(0);
      i += source[i] === '$' ? 2 : 1;
      continue;
    }
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      const close = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2);
      const stop = close < 0 ? n : next === '/' ? close : close + 2;
      blank(i, stop, true);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, j, false);
      i = j + 1;
    } else if (c === '`') {
      inTemplate = true;
      i += 1;
    } else if (c === '/' && REGEX_AFTER.test(source.slice(Math.max(0, i - 12), i))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j += 1;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += 1;
      }
      blank(i + 1, j, false);
      i = j + 1;
    } else {
      const top = holes.length - 1;
      if (top >= 0 && c === '{') holes[top] += 1;
      if (top >= 0 && c === '}') {
        if (holes[top] === 0) {
          // This `}` closes the `${`: back into the template's text.
          holes.pop();
          inTemplate = true;
        } else {
          holes[top] -= 1;
        }
      }
      i += 1;
    }
  }
  return { code: code.join(''), skeleton: skeleton.join('') };
}

/** Offsets of the `{` still open at `index` in a skeleton, outermost first. */
function openBraces(skeleton, index) {
  const open = [];
  for (let k = 0; k < index; k++) {
    if (skeleton[k] === '{') open.push(k);
    else if (skeleton[k] === '}') open.pop();
  }
  return open;
}

/** True when the module calls `name(...)` outside every block. */
function calledAtTopLevel(skeleton, name) {
  // The name comes first in the pattern: a leading `(?<!function\s+)` would
  // backtrack over every blanked comment at every offset, which is seconds.
  const call = new RegExp(`(?<![.\\w$])${name}\\s*\\(`, 'g');
  return [...skeleton.matchAll(call)].some(
    (m) =>
      !/\bfunction\s*$/.test(skeleton.slice(Math.max(0, m.index - 40), m.index)) &&
      openBraces(skeleton, m.index).length === 0
  );
}

/**
 * True when a module's `guardSlidersIn(document)` runs on load: it is a
 * top-level statement, or sits directly in a top-level function declaration
 * that the module calls at top level (the Vite entries' `main()`).
 */
function installRuns(source) {
  const { skeleton } = scanJs(source);
  return [...skeleton.matchAll(INSTALL)].some((m) => {
    const open = openBraces(skeleton, m.index);
    if (open.length === 0) return true;
    if (open.length !== 1) return false;
    const header = skeleton.slice(Math.max(0, open[0] - 400), open[0]);
    const name = header.match(/\bfunction\s+([\w$]+)\s*\([^)]*\)\s*(?::[^{};]*)?$/)?.[1];
    return name !== undefined && calledAtTopLevel(skeleton, name);
  });
}

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
  for (const match of html.replace(HTML_COMMENT, '').matchAll(MODULE_SCRIPT)) {
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
    const { code } = scanJs(read(file));
    if (RANGE_AT_RUNTIME.test(code)) return true;
    for (const m of code.matchAll(LOCAL_IMPORT)) {
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
    const hasSlider =
      RANGE_IN_HTML.test(html.replace(HTML_COMMENT, '')) || buildsSliderAtRuntime(entries, read);
    if (!hasSlider) continue;
    if (!entries.some((e) => installRuns(e.source))) {
      problems.push(
        `${page}: has a slider, but no module script it loads runs guardSlidersIn(document) on load`
      );
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

  // Review 2026-09-30 (A1): an install that never runs must not pass. Each
  // planted page has a range input and an entry that only LOOKS like it
  // installs the guard.
  const plantedPage = (script) =>
    unguardedPages(
      ['GpsPlusSlamJs_PhysicsDemo/__planted__.html'],
      () => `<input type="range"><script type="module">${script}</script>`,
      readAbs
    );
  const NEVER_RUNS = {
    'a line-commented install': '// guardSlidersIn(document);',
    'a block-commented install': '/*\n guardSlidersIn(document);\n*/',
    'an install inside a function nothing calls':
      'function setUp() {\n  guardSlidersIn(document);\n}\nconsole.log(setUp);',
    'an install in a callback of the entry function':
      'function main() {\n  const later = () => {\n    guardSlidersIn(document);\n  };\n  return later;\n}\nmain();',
    'an install quoted in a string': 'console.log("guardSlidersIn(document)");',
  };
  for (const [name, script] of Object.entries(NEVER_RUNS)) {
    it(`flags ${name}`, () => {
      expect(plantedPage(script).join('\n')).toContain('__planted__.html');
    });
  }

  it('flags an install in a commented-out script tag', () => {
    const problems = unguardedPages(
      ['GpsPlusSlamJs_PhysicsDemo/__planted__.html'],
      () =>
        '<input type="range"><!-- <script type="module">guardSlidersIn(document);</script> -->',
      readAbs
    );
    expect(problems.join('\n')).toContain('__planted__.html');
  });

  // The positive controls for the planted cases: the two shapes the real
  // entries use must pass, so the checks above fail for the right reason.
  // The strings and the regex are there to trip a naive comment stripper.
  const RUNS = {
    'a top-level install': 'const url = "https://example.org/a//b";\nguardSlidersIn(document);',
    'an install in an entry function the module calls':
      'const re = /["\'`{]/;\nasync function main(): Promise<void> {\n  const s = `${"{"}`;\n  guardSlidersIn(document);\n}\nvoid main().catch(() => {});',
  };
  for (const [name, script] of Object.entries(RUNS)) {
    it(`accepts ${name}`, () => {
      expect(plantedPage(script)).toEqual([]);
    });
  }

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
