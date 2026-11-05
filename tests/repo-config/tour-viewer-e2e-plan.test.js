// Repo-meta test: the Tour Viewer's e2e plan
// (GpsPlusSlamJs_TourViewer/playwright-tests/e2e-plan.js).
//
// Why this test matters: the plan decides two things that fail silently.
// - Which Playwright project a spec runs in. A spec in neither project never
//   runs at all, and the run stays green; a spec in both runs twice. So the
//   table must name every spec file on disk exactly once, and nothing else.
// - Which specs a local test:changed run may skip. An editor-only change
//   skips the visitor's specs and the other way round, which is only honest
//   while (a) every spec's area is what the spec actually opens, and (b) the
//   folders the plan calls editor-only (or viewer-only) cannot be reached from
//   the other side's pages. Both are read from the code here, not trusted
//   from the table: a spec that opens the editor but says `viewer` would be
//   skipped by exactly the change that can break it.
// Coverage limits: the import scan follows relative static and dynamic
// imports (any file kind, a `?raw` or `?url` suffix dropped),
// `new URL("./...", import.meta.url)`, and the editor kit's subpaths into the
// kit's own sources; a relative import it cannot resolve to a file fails the
// test rather than being skipped. An import built from a variable is
// invisible to it. CI and the full cascade run every spec whatever this plan
// says.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'GpsPlusSlamJs_TourViewer');
const SPEC_DIR = join(PKG, 'playwright-tests');
const plan = await import(pathToFileURL(join(SPEC_DIR, 'e2e-plan.js')).href);

const specFiles = readdirSync(SPEC_DIR).filter((f) => f.endsWith('.spec.js')).sort();
/** @param {string} name */
const specText = (name) => readFileSync(join(SPEC_DIR, name), 'utf8');

describe('the e2e plan names every spec exactly once', () => {
  it('lists exactly the spec files on disk', () => {
    expect(Object.keys(plan.SPECS).sort()).toEqual(specFiles);
  });

  it('puts every spec in one known project and one known area', () => {
    for (const [name, entry] of Object.entries(plan.SPECS)) {
      expect(plan.PROJECTS, name).toContain(entry.project);
      expect(['editor', 'viewer', 'both'], name).toContain(entry.area);
    }
  });

  it('splits the specs between the projects with nothing left over or doubled', () => {
    const all = plan.PROJECTS.flatMap((p) => plan.specsOf(p));
    expect(all.sort()).toEqual(specFiles);
  });

  it('keeps a DOM worker count the runner accepts', () => {
    expect(Number.isInteger(plan.LOCAL_DOM_WORKERS)).toBe(true);
    expect(plan.LOCAL_DOM_WORKERS).toBeGreaterThanOrEqual(1);
    expect(plan.LOCAL_DOM_WORKERS).toBeLessThanOrEqual(16);
  });
});

describe('each spec is classified by what it opens', () => {
  const opensEditor = (/** @type {string} */ text) =>
    /["'`]\/edit\.html/.test(text) || /from\s+["']\.\/editor3d-fixture\.js["']/.test(text);
  // A visitor or check page: "/", "/?...", or any page other than the editor.
  const opensOtherPage = (/** @type {string} */ text) =>
    /goto\(\s*["'`]\/(?!edit\.html)/.test(text) ||
    /goto\(\s*(VISITOR_PAGE|query|path)\b/.test(text) ||
    // ar-fakes.js's helpers that open the visitor's page (its data exports
    // open nothing).
    /\b(openFixtureTour|installTourViewerArFakes)\b/.test(text);

  it('marks a spec that opens the editor as editor or both', () => {
    const wrong = specFiles.filter(
      (name) => opensEditor(specText(name)) && plan.SPECS[name].area === 'viewer'
    );
    expect(wrong, 'these open edit.html but say viewer').toEqual([]);
  });

  it('marks a spec that opens another page as viewer or both', () => {
    const wrong = specFiles.filter(
      (name) => opensOtherPage(specText(name)) && plan.SPECS[name].area === 'editor'
    );
    expect(wrong, 'these open a non-editor page but say editor').toEqual([]);
  });

  it('runs every spec on the editor fixture (a WebGL scene) in the webgl project', () => {
    const wrong = specFiles.filter(
      (name) =>
        /from\s+["']\.\/editor3d-fixture\.js["']/.test(specText(name)) &&
        plan.SPECS[name].project !== 'webgl'
    );
    expect(wrong).toEqual([]);
  });

  it('names the importers of an editor-only helper as editor or both', () => {
    for (const helper of ['editor3d-fixture.js', 'editor-menus.js', 'editor-tours.js']) {
      expect(plan.pathArea(`GpsPlusSlamJs_TourViewer/playwright-tests/${helper}`)).toBe('editor');
      const importer = new RegExp(`from\\s+["']\\./${helper.replace('.', '\\.')}["']`);
      for (const name of specFiles) {
        if (importer.test(specText(name))) {
          expect(['editor', 'both'], `${name} imports ${helper}`).toContain(
            plan.SPECS[name].area
          );
        }
      }
    }
  });
});

const KIT = join(ROOT, 'GpsPlusSlamJs_EditorKit');
/** @type {Record<string, string>} the kit's `exports`: "./chrome" -> "./src/chrome/index.ts" */
const KIT_EXPORTS = JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')).exports;

/** @param {string} file - absolute @returns {string} repo-relative, forward slashes */
const repoPath = (file) => relative(ROOT, file).replaceAll('\\', '/');

/**
 * Every file reachable from `entries` by relative imports and by the editor
 * kit's subpaths (followed into the kit's sources), as repo-relative paths,
 * plus every import the scan could not resolve to a file.
 * @param {string[]} entries - absolute paths
 * @returns {{ seen: Set<string>, unresolved: string[] }}
 */
function reachable(entries) {
  const seen = new Set();
  /** @type {string[]} */
  const unresolved = [];
  const queue = [...entries];
  const SPECIFIER =
    /(?:from\s+|import\s*\(\s*|import\s+|new URL\(\s*)["']([^"']+)["']/g;
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    const key = repoPath(file);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!/\.(ts|js|mjs)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const [, raw] of text.matchAll(SPECIFIER)) {
      const spec = raw.replace(/\?.*$/, '');
      const kit = /^gps-plus-slam-editor-kit\/(.+)$/.exec(spec);
      if (kit) {
        const target = KIT_EXPORTS[`./${kit[1]}`];
        if (target) queue.push(join(KIT, target));
        else unresolved.push(`${key}: ${raw} (not a kit export)`);
        continue;
      }
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(file), spec);
      const candidate = [
        base,
        base.replace(/\.js$/, '.ts'),
        `${base}.ts`,
        `${base}.js`,
        join(base, 'index.ts'),
      ].find((p) => existsSync(p) && statSync(p).isFile());
      if (candidate) queue.push(candidate);
      else unresolved.push(`${key}: ${raw}`);
    }
  }
  return { seen, unresolved };
}

/** @param {string} html - a page in the package @returns {string[]} its module entries */
function pageEntries(html) {
  const text = readFileSync(join(PKG, html), 'utf8');
  const out = [];
  for (const [, src] of text.matchAll(/<script[^>]*type="module"[^>]*src="\/([^"]+)"/g)) {
    out.push(join(PKG, src));
  }
  for (const [, spec] of text.matchAll(/import\s+(?:[^"']*from\s+)?["']\.\/([^"']+)["']/g)) {
    out.push(join(PKG, spec));
  }
  return out.filter((p) => existsSync(p));
}

describe("the plan's editor-only and viewer-only folders hold", () => {
  const pages = readdirSync(PKG).filter((f) => f.endsWith('.html'));

  it('finds the entry module of the editor and of the visitor page', () => {
    // A guard against a scan that silently reads nothing.
    expect(pageEntries('edit.html').map((p) => relative(PKG, p).replaceAll('\\', '/'))).toEqual([
      'src/editor/edit-main.ts',
    ]);
    expect(pageEntries('index.html').length).toBeGreaterThan(0);
  });

  const fromOthers = reachable(pages.filter((p) => p !== 'edit.html').flatMap(pageEntries));
  const fromEditor = reachable(pageEntries('edit.html'));

  it('resolves every relative and kit import it meets to a file', () => {
    // A skipped import is a blind spot: whatever sits behind it (a JSON
    // table, an SVG, a `?raw` text, a kit module) would never be checked.
    expect(fromOthers.unresolved).toEqual([]);
    expect(fromEditor.unresolved).toEqual([]);
  });

  it('follows the editor into the kit, and the other pages into non-script files', () => {
    // A guard against a scan that silently stops at the package's edge or
    // at the first stylesheet (the landing imports its own CSS).
    expect(
      [...fromEditor.seen].some((p) => p.startsWith('GpsPlusSlamJs_EditorKit/src/chrome/'))
    ).toBe(true);
    expect([...fromOthers.seen].some((p) => p.endsWith('.css'))).toBe(true);
  });

  it('reaches no editor-only module from any page other than the editor', () => {
    expect(fromOthers.seen.size).toBeGreaterThan(20);
    const leaks = [...fromOthers.seen].filter((p) => plan.pathArea(p) === 'editor');
    expect(leaks).toEqual([]);
  });

  it('reaches no viewer-only module from the editor', () => {
    expect(fromEditor.seen.size).toBeGreaterThan(20);
    const leaks = [...fromEditor.seen].filter((p) => plan.pathArea(p) === 'viewer');
    expect(leaks).toEqual([]);
  });
});

describe('selectSpecs', () => {
  const editorSpecs = specFiles.filter((n) => plan.SPECS[n].area !== 'viewer');
  const viewerSpecs = specFiles.filter((n) => plan.SPECS[n].area !== 'editor');

  it('runs the editor and both specs for an editor-only change', () => {
    const s = plan.selectSpecs(['GpsPlusSlamJs_TourViewer/src/editor3d/editor3d-scene.ts']);
    expect(s).toEqual({ all: false, areas: ['editor'], specs: editorSpecs });
  });

  it('treats an editor-kit chrome change as an editor change', () => {
    const s = plan.selectSpecs(['GpsPlusSlamJs_EditorKit/src/chrome/menu.ts']);
    expect(s.all === false && s.specs).toEqual(editorSpecs);
  });

  it('runs the viewer and both specs for a landing-only change', () => {
    const s = plan.selectSpecs(['GpsPlusSlamJs_TourViewer/src/landing/landing-film.ts']);
    expect(s).toEqual({ all: false, areas: ['viewer'], specs: viewerSpecs });
  });

  it('runs everything for a shared module, a shared helper, an unknown path or both areas', () => {
    for (const paths of [
      ['GpsPlusSlamJs_TourViewer/src/main.ts'],
      ['GpsPlusSlamJs_TourViewer/src/landing/film-math.ts'],
      ['GpsPlusSlamJs_TourViewer/playwright-tests/ar-fakes.js'],
      ['GpsPlusSlamJs_TourViewer/package.json'],
      ['GpsPlusSlamJs_AppFramework/src/index.ts'],
      ['GpsPlusSlamJs_EditorKit/src/index.ts'],
      ['GpsPlusSlamJs_TourViewer/src/editor/x.ts', 'GpsPlusSlamJs_TourViewer/index.html'],
    ]) {
      expect(plan.selectSpecs(paths).all, paths.join(' + ')).toBe(true);
    }
  });

  it('runs a changed spec by itself, and nothing for a unit test or a sidecar', () => {
    expect(plan.selectSpecs(['GpsPlusSlamJs_TourViewer/playwright-tests/summary.spec.js'])).toEqual({
      all: false,
      areas: [],
      specs: ['summary.spec.js'],
    });
    expect(
      plan.selectSpecs([
        'GpsPlusSlamJs_TourViewer/src/editor/edit-main.test.ts',
        'GpsPlusSlamJs_TourViewer/src/editor/edit-main.ts.md',
        'GpsPlusSlamJs_TourViewer/docs/test-timings.md',
      ])
    ).toEqual({ all: false, areas: [], specs: [] });
  });

  it('keeps markdown the app serves or reads as input in the full run', () => {
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer/public/notes.md')).toBe(null);
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer/playwright-tests/fixtures/x.md')).toBe(null);
  });

  it('skips only doc markdown, by the same rule as test:changed', () => {
    // A free-standing .md that is no sidecar, README, CHANGELOG or docs/
    // file may be read by the app (a `?raw` import), so it keeps its area.
    for (const doc of [
      'GpsPlusSlamJs_TourViewer/src/editor/edit-main.ts.md',
      'GpsPlusSlamJs_TourViewer/README.md',
      'GpsPlusSlamJs_TourViewer/docs/plan.md',
      'GpsPlusSlamJs_EditorKit/src/chrome/menu-button.ts.md',
    ]) {
      expect(plan.pathArea(doc), doc).toBe('none');
    }
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer/notes.md')).toBe(null);
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer/src/landing/copy.md')).toBe('viewer');
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer/src/editor/help.md')).toBe('editor');
  });

  it('calls only the kit folders that exist editor-only', () => {
    expect(plan.pathArea('GpsPlusSlamJs_EditorKit/src/chrome/menu-button.ts')).toBe('editor');
    expect(plan.pathArea('GpsPlusSlamJs_EditorKit/src/chrome/menu-button.test.ts')).toBe('none');
    // No such folders today: a new one runs every spec until it is classified.
    expect(plan.pathArea('GpsPlusSlamJs_EditorKit/src/scene/x.ts')).toBe(null);
    expect(plan.pathArea('GpsPlusSlamJs_EditorKit/src/globe/x.ts')).toBe(null);
  });

  it('accepts either slash style', () => {
    expect(plan.pathArea('GpsPlusSlamJs_TourViewer\\src\\editor\\x.ts')).toBe('editor');
  });
});

// Why this test matters (test-suite pruning plan 2026-11-04, T-M1): CI runs
// the browser specs as one job per lane (`E2E_LANE`), so a spec in no lane
// never runs on CI and the run stays green, and a spec in two runs twice.
// Plain `--shard` is not used because it cuts the alphabetical list, which
// would put every `editor3d-globe-*` spec in one shard.
describe('the e2e plan puts every spec in exactly one CI lane', () => {
  it('names the lanes: the page tests and four 3D lanes', () => {
    expect(plan.LANES).toEqual(['dom', 'webgl-1', 'webgl-2', 'webgl-3', 'webgl-4']);
  });

  it('puts every spec in exactly one lane, and every lane holds a spec', () => {
    const all = plan.LANES.flatMap((lane) => plan.specsOfLane(lane));
    expect([...all].sort()).toEqual(specFiles);
    for (const lane of plan.LANES) {
      expect(plan.specsOfLane(lane).length, lane).toBeGreaterThan(0);
    }
  });

  it('keeps each lane inside one project: dom is the dom project, webgl-N its 3D specs', () => {
    expect(plan.specsOfLane('dom')).toEqual(plan.specsOf('dom'));
    for (const lane of plan.LANES.filter((l) => l !== 'dom')) {
      for (const name of plan.specsOfLane(lane)) {
        expect(plan.SPECS[name].project, `${name} in ${lane}`).toBe('webgl');
      }
    }
  });

  it('gives every webgl spec a lane number from 1 to 4, and no dom spec one', () => {
    for (const [name, entry] of Object.entries(plan.SPECS)) {
      if (entry.project === 'webgl') {
        expect([1, 2, 3, 4], name).toContain(entry.lane);
      } else {
        expect(entry.lane, name).toBeUndefined();
      }
    }
  });

  it('refuses a lane it does not know', () => {
    expect(() => plan.specsOfLane('webgl-5')).toThrow(RangeError);
    expect(() => plan.specsOfLane('')).toThrow(RangeError);
  });
});
