// Pure cross-package impact graph for the per-commit fast gate: which unit
// tests, in which workspace packages, a set of changed paths can reach. The
// shell (workspace-tree.mjs) supplies the tracked files, the module sources
// and the package manifests; keeping the walk pure makes every edge and every
// fallback testable.
//
// Edges a test can be reached by (a reverse walk from each changed file):
// - imports: static `from`, `import()`, `vi.mock`/`vi.importActual`,
//   `require`, `new URL(...)`, `import.meta.resolve`, with a package
//   specifier resolved through the package's `exports` to its SOURCE (`dist`
//   is the build of `src`, so the edge is drawn to `src`);
// - directories: an `import.meta.glob` or a template import
//   (`./kinds/${name}.js`) depends on every file under its literal prefix;
// - readers: a module that reads a file through `fs` or `fetch` and names it
//   by its basename; a reader in another package must also name the changed
//   file's package directory, so a common basename does not pull in unrelated
//   packages;
// - scanners: a unit test that walks a whole tree (`readdirSync`, a glob) is
//   reached by any source change in its own package, or in a package it names;
// - type-level: a tsconfig whose `include` or `files` names another
//   package's sources depends on them (the Recorder compiles the framework's
//   `src/**/*.ts`), and a declaration file's imports are edges like any
//   module's. An include glob matches as tsc matches it: by its extension,
//   minus the `exclude` of the program that compiles the file (a base that
//   only other tsconfigs extend is no program; its extenders are). Markdown takes part only as a file that is read or imported
//   (`?raw`): a changed markdown file reaches its readers, never its package.
//
// Fallbacks (FULL_SUITE_RULES): what a test can depend on without any edge
// above runs whole suites instead. A template import whose prefix is not a
// relative path (an absolute URL, a computed root) draws no edge; the tests
// that hold one read only their own package's files, which their package's
// related run already covers.

// Pure functions only: matchesGlob reads no file system.
import { posix as posixPath } from 'node:path';

/** Module sources whose text is scanned for edges. */
export const MODULE_RE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_RE = /\.test\.(?:[cm]?[jt]sx?)$/;
// A `*.spec` under `src/` is a unit test (the Recorder's vitest include lists
// src/**/*.spec.ts); elsewhere it is a Playwright spec (the design system's pages).
const SRC_SPEC_RE = /(?:^|\/)src\/(?:.*\/)?[^/]+\.spec\.(?:[cm]?[jt]sx?)$/;
const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|unmock|importActual|importMock)\s*\(\s*|\brequire\s*\(\s*|\bnew\s+URL\s*\(\s*|import\.meta\.resolve\s*\(\s*)(["'`])([^"'`\n]+)\1/g;
const GLOB_RE = /import\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*(\[[^\]]*\]|["'`][^"'`]+["'`])/g;
const FS_READ_RE = /\breadFileSync\b|\breadFile\s*\(|\bcreateReadStream\b|\bfs\.promises\b|\bfetch\s*\(/;
// An `import.meta.glob` is not a scanner: its folder edge says exactly what it loads.
const SCANNER_RE = /\breaddirSync\b|\breaddir\s*\(|\bglobSync\b|\bfs\.glob\b|\bopendirSync\b/;
// By basename: `setup.ts`, `test-setup.ts`, `vitest.setup.ts`, `setupTests.ts`; a
// module that merely ends in `-setup` (`creator-setup.ts`) is ordinary source.
const SETUP_RE = /^(?:(?:test|vitest)[-_.])?setup(?:Tests)?\.[cm]?[jt]sx?$/i;
/**
 * The `setupFiles` / `globalSetup` value of a config: the only path strings that
 * load a file (a coverage `exclude` names files it loads not).
 */
const CONFIG_LOADS_RE = /\b(?:setupFiles|globalSetup)\s*:\s*(\[[^\]]*\]|["'`][^"'`\n]+["'`])/g;
/** A path string in a config (a `setupFiles` entry), relative to the config or the package. */
const CONFIG_PATH_RE = /["'`]((?:\.{1,2}\/)*[\w@-][\w./@-]*\.[cm]?[jt]sx?)["'`]/g;
const CONFIG_RE = /(?:^|\/)vite(?:st)?\.config\.[cm]?[jt]s$/;
/** A config `resolve.alias` entry: `'spec': fileURLToPath(new URL('../dir', import.meta.url))`. */
const ALIAS_RE =
  /(["'])([^"'\n]+)\1\s*:\s*(?:fileURLToPath\s*\(\s*)?new\s+URL\s*\(\s*(["'`])([^"'`\n]+)\3\s*,\s*import\.meta\.url\s*\)/g;
const MANIFEST_RE = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json)$/;
/** A tsconfig, whose `include`/`files` can name another package's sources. */
export const TSCONFIG_RE = /(?:^|\/)tsconfig[^/]*\.json$/;
const DECLARATION_RE = /\.d\.[cm]?ts$/;
const BUILD_CONFIG_RE = /(?:^|\/)(?:tsdown|tsup|rollup|rolldown|esbuild|webpack)\.config\.[cm]?[jt]s$/;
const isMarkdown = (/** @type {string} */ p) => p.toLowerCase().endsWith('.md');

/**
 * The changes that run a package's whole suite, and its dependents', because
 * no edge can say which tests they reach. Each rule's name is its reason.
 * @type {readonly { name: string, test: (path: string, exists: boolean) => boolean }[]}
 */
export const FULL_SUITE_RULES = Object.freeze([
  // A deleted markdown file breaks no test that would still pass without it.
  { name: 'deleted or renamed', test: (p, exists) => !exists && !isMarkdown(p) },
  { name: 'a manifest or tsconfig', test: (p) => MANIFEST_RE.test(p) },
  { name: 'a vite or vitest config', test: (p) => CONFIG_RE.test(p) },
  // Ambient declarations reach every file of a program without any import.
  { name: 'a declaration file', test: (p) => DECLARATION_RE.test(p) },
  // The build shapes dist, which every dependent type-checks and runs against.
  { name: 'a build config', test: (p) => BUILD_CONFIG_RE.test(p) },
  { name: 'a setup file every test may load', test: (p) => SETUP_RE.test(p.split('/').pop() ?? '') },
  { name: 'a mock every test may load', test: (p) => p.includes('__mocks__/') },
]);

/** A config, setup file or mock that an import reaches runs its package whole. */
const loadsEveryTest = (/** @type {string} */ p) =>
  CONFIG_RE.test(p) || SETUP_RE.test(p.split('/').pop() ?? '') || p.includes('__mocks__/');

/**
 * @typedef {{ dir: string, name: string, deps: readonly string[], exports?: unknown }} WorkspacePackage
 * @typedef {{
 *   packages: readonly WorkspacePackage[],
 *   fileSet: ReadonlySet<string>,
 *   texts: ReadonlyMap<string, string>,
 *   importers: ReadonlyMap<string, ReadonlySet<string>>,
 *   dirDeps: readonly [string, string][],
 * }} ImpactGraph
 */

/** @param {string} path @returns {string} */
const normalize = (path) => path.replaceAll('\\', '/');

/** @param {string} path @returns {boolean} a unit test (Playwright specs are not) */
export function isUnitTest(path) {
  return (TEST_RE.test(path) || SRC_SPEC_RE.test(path)) && !path.includes('playwright-tests/');
}

/**
 * @param {readonly WorkspacePackage[]} packages
 * @param {string} path
 * @returns {string | null} the package dir holding `path`, or null for a root file
 */
function packageOf(packages, path) {
  const top = path.split('/')[0];
  return path.includes('/') && packages.some((p) => p.dir === top) ? top : null;
}

/** POSIX join + normalize of repo-relative paths (`..` pops a segment). */
function joinPath(/** @type {string} */ dir, /** @type {string} */ rel) {
  const out = [];
  for (const part of `${dir}/${rel}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

const dirname = (/** @type {string} */ p) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** The first existing file a module specifier can name. */
function tryFile(/** @type {ReadonlySet<string>} */ files, /** @type {string} */ base) {
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.mjs', '.mts', '.json', '.d.ts'].map((x) => base + x),
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.js$/, '.d.ts'),
    base.replace(/\.mjs$/, '.mts'),
    base.replace(/\.jsx$/, '.tsx'),
    ...['/index.ts', '/index.tsx', '/index.js', '/index.mjs'].map((x) => base + x),
  ];
  return candidates.find((c) => files.has(c)) ?? null;
}

/**
 * @param {readonly WorkspacePackage[]} packages
 * @param {ReadonlySet<string>} files
 * @param {string} from - the importing file
 * @param {string} rawSpec
 * @param {ReadonlyMap<string, readonly [string, string][]>} aliases - per
 *   package dir, the `[specifier, target folder]` of its configs' aliases
 * @returns {string | null}
 */
function resolveSpecifier(packages, files, from, rawSpec, aliases) {
  const spec = rawSpec.split('?')[0].split('#')[0];
  if (spec.startsWith('.')) return tryFile(files, joinPath(dirname(from), spec));
  for (const [alias, target] of aliases.get(packageOf(packages, from) ?? '') ?? []) {
    if (spec !== alias && !spec.startsWith(`${alias}/`)) continue;
    const found = tryFile(files, joinPath(target, spec.slice(alias.length)));
    if (found) return found;
  }
  const m = spec.match(/^((?:@[^/]+\/)?[^/]+)(?:\/(.*))?$/);
  const pkg = m && packages.find((p) => p.name === m[1]);
  if (!m || !pkg) return null;
  const sub = m[2] ? `./${m[2]}` : '.';
  const pick = (/** @type {any} */ v) => (typeof v === 'string' ? v : v && (v.import || v.default || v.types));
  /** @type {string | null} */
  let target = null;
  const exp = /** @type {Record<string, unknown> | undefined} */ (pkg.exports);
  if (exp && typeof exp === 'object') {
    if (exp[sub]) target = pick(exp[sub]);
    else {
      for (const [key, value] of Object.entries(exp)) {
        const star = key.indexOf('*');
        if (star === -1) continue;
        const [head, tail] = [key.slice(0, star), key.slice(star + 1)];
        if (sub.startsWith(head) && sub.endsWith(tail) && sub.length >= head.length + tail.length) {
          target = pick(value)?.replace('*', sub.slice(head.length, sub.length - tail.length)) ?? null;
          break;
        }
      }
    }
  }
  if (!target) return tryFile(files, `${pkg.dir}/src/${m[2] || 'index'}`);
  const source = target
    .replace(/^\.\//, '')
    .replace(/^dist\//, 'src/')
    .replace(/\.d\.ts$/, '')
    .replace(/\.m?js$/, '');
  return tryFile(files, `${pkg.dir}/${source}`);
}

/**
 * @param {object} input
 * @param {readonly WorkspacePackage[]} input.packages
 * @param {readonly string[]} input.files - every tracked repo path
 * @param {ReadonlyMap<string, string>} input.texts - module path to source
 *   text, declaration files and tsconfigs included
 * @returns {ImpactGraph}
 */
export function buildImpactGraph({ packages, files, texts }) {
  const fileSet = new Set(files.map(normalize));
  /** @type {Map<string, Set<string>>} */
  const importers = new Map();
  /** @type {[string, string][]} */
  const dirDeps = [];
  const edge = (/** @type {string | null} */ dep, /** @type {string} */ from) => {
    if (!dep || dep === from) return;
    const set = importers.get(dep) ?? new Set();
    set.add(from);
    importers.set(dep, set);
  };
  tsconfigEdges(packages, fileSet, texts, edge);
  // A config's alias says how its package's files resolve a specifier; it is
  // no import of the config (which would run the whole suite on any change
  // behind the alias target's index).
  /** @type {Map<string, [string, string][]>} */
  const aliases = new Map();
  /** @type {Map<string, Set<number>>} config to the offsets of its alias targets */
  const aliasTargets = new Map();
  for (const [from, text] of texts) {
    const dir = CONFIG_RE.test(from) ? packageOf(packages, from) : null;
    if (!dir) continue;
    for (const m of text.matchAll(ALIAS_RE)) {
      aliases.set(dir, [...(aliases.get(dir) ?? []), [m[2], joinPath(dirname(from), m[4])]]);
      const offsets = aliasTargets.get(from) ?? new Set();
      offsets.add(/** @type {number} */ (m.index) + m[0].search(/\bnew\s+URL\b/));
      aliasTargets.set(from, offsets);
    }
  }
  for (const [from, text] of texts) {
    if (TSCONFIG_RE.test(from)) continue;
    for (const m of text.matchAll(SPEC_RE)) {
      if (aliasTargets.get(from)?.has(/** @type {number} */ (m.index))) continue;
      const spec = m[2];
      const hole = spec.indexOf('${');
      if (hole === -1) {
        edge(resolveSpecifier(packages, fileSet, from, spec, aliases), from);
        continue;
      }
      const prefix = spec.slice(0, hole);
      if (prefix.startsWith('.')) {
        dirDeps.push([from, joinPath(dirname(from), prefix.endsWith('/') ? prefix : dirname(`${prefix}x`))]);
      }
    }
    // A config loads the files it names by path (`setupFiles`) without importing them.
    if (CONFIG_RE.test(from)) {
      const pkgDir = packageOf(packages, from);
      const loads = [...text.matchAll(CONFIG_LOADS_RE)].map((l) => l[1]).join(' ');
      for (const m of loads.matchAll(CONFIG_PATH_RE)) {
        const bases = [joinPath(dirname(from), m[1])];
        if (pkgDir && !m[1].startsWith('.')) bases.push(joinPath(pkgDir, m[1]));
        for (const b of bases) if (fileSet.has(b)) edge(b, from);
      }
    }
    for (const m of text.matchAll(GLOB_RE)) {
      for (const q of m[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
        const glob = q[1].replace(/^!/, '');
        const wild = glob.search(/[*{[]/);
        const prefix = wild === -1 ? glob : glob.slice(0, wild);
        const base = prefix.startsWith('/')
          ? `${packageOf(packages, from) ?? ''}${prefix}`
          : joinPath(dirname(from), prefix);
        // `./items/*.ts` depends on `items/`; `./item-*.ts` on the folder that holds it.
        dirDeps.push([from, prefix.endsWith('/') ? base : dirname(base) || base]);
      }
    }
  }
  return { packages, fileSet, texts, importers, dirDeps };
}

const WILD_RE = /[*?{[]/;

/** @param {string} text @param {string} key @returns {string[] | undefined} a JSONC string array */
function jsonList(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((q) => q[1]) : undefined;
}

/**
 * @param {string} from - the tsconfig that names `ref`
 * @param {string} ref - an `extends` or a reference `path`
 * @param {boolean} folderMeansTsconfig - a reference may name a folder
 * @returns {string | null} the named tsconfig, or null for a package specifier
 */
function tsconfigPath(from, ref, folderMeansTsconfig) {
  if (!ref.startsWith('.')) return null;
  const p = joinPath(dirname(from), ref);
  if (p.endsWith('.json')) return p;
  return folderMeansTsconfig ? `${p}/tsconfig.json` : `${p}.json`;
}

/** Does a repo path match a resolved tsconfig pattern? A literal names a file or a folder. */
function matchesPattern(/** @type {string} */ file, /** @type {string} */ pattern) {
  if (WILD_RE.test(pattern)) return posixPath.matchesGlob(file, pattern);
  return file === pattern || file.startsWith(`${pattern}/`);
}

/**
 * The edges of the tsconfig programs whose `include` or `files` name another
 * package's files, matched as tsc matches them: an include glob by its own
 * extension (`src/**` + `/*.ts` never names a `.md` sidecar or a `.js`), a
 * folder or an extensionless glob by module files only, minus the program's
 * `exclude`; a `files` entry is never excluded. `include`, `files` and
 * `exclude` are inherited through `extends` until a config sets its own, each
 * relative to the config that sets it. A tsconfig that another extends and
 * none references is a base, not a program: only its extenders compile (the
 * Recorder's tsconfig.base.json includes every framework source, and its app
 * and vitest programs exclude the framework tests). Entries inside the
 * tsconfig's own package are its package's own business (a change there
 * already selects the package). Read with a pattern, not JSON.parse:
 * tsconfigs are JSONC (comments, trailing commas).
 *
 * @param {readonly WorkspacePackage[]} packages
 * @param {ReadonlySet<string>} fileSet
 * @param {ReadonlyMap<string, string>} texts - the tsconfigs among them are read
 * @param {(dep: string | null, from: string) => void} edge
 */
function tsconfigEdges(packages, fileSet, texts, edge) {
  /** @typedef {'include' | 'files' | 'exclude'} ListKey */
  /** @type {Map<string, { parent: string | null, lists: Record<ListKey, string[] | undefined> }>} */
  const configs = new Map();
  const referenced = new Set();
  const extended = new Set();
  for (const [from, text] of texts) {
    if (!TSCONFIG_RE.test(from)) continue;
    const ext = text.match(/"extends"\s*:\s*"([^"]+)"/);
    const parent = ext ? tsconfigPath(from, ext[1], false) : null;
    if (parent) extended.add(parent);
    const refs = text.match(/"references"\s*:\s*\[([^\]]*)\]/);
    for (const r of refs ? refs[1].matchAll(/"path"\s*:\s*"([^"]+)"/g) : []) {
      const p = tsconfigPath(from, r[1], true);
      if (p) referenced.add(p);
    }
    configs.set(from, {
      parent,
      lists: { include: jsonList(text, 'include'), files: jsonList(text, 'files'), exclude: jsonList(text, 'exclude') },
    });
  }
  /** @param {string} from @param {ListKey} key @returns {string[]} repo-relative patterns */
  const inherited = (from, key) => {
    const seen = new Set();
    for (let c = from; configs.has(c) && !seen.has(c); c = configs.get(c)?.parent ?? '') {
      seen.add(c);
      const list = configs.get(c)?.lists[key];
      if (list) return list.map((p) => joinPath(dirname(c), p));
    }
    return [];
  };
  for (const from of configs.keys()) {
    if (extended.has(from) && !referenced.has(from)) continue;
    const own = packageOf(packages, from);
    const foreign = (/** @type {string} */ p) => {
      const wild = p.search(WILD_RE);
      return packageOf(packages, wild === -1 ? p : p.slice(0, wild)) !== own;
    };
    for (const f of inherited(from, 'files').filter(foreign)) {
      if (fileSet.has(f)) edge(f, from);
    }
    const exclude = inherited(from, 'exclude');
    for (const pattern of inherited(from, 'include').filter(foreign)) {
      const byExtension = WILD_RE.test(pattern) && /\.\w+$/.test(pattern.split('/').pop() ?? '');
      for (const f of fileSet) {
        if (isMarkdown(f) || !matchesPattern(f, pattern)) continue;
        if (!byExtension && !MODULE_RE.test(f)) continue;
        if (exclude.some((x) => matchesPattern(f, x))) continue;
        edge(f, from);
      }
    }
  }
}

/**
 * @param {ImpactGraph} graph
 * @param {string} dir
 * @returns {string[]} the packages that depend on `dir`, directly or not
 */
function dependentsOf(graph, dir) {
  const byName = new Map(graph.packages.map((p) => [p.name, p.dir]));
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of graph.packages) {
      if (out.has(p.dir) || p.dir === dir) continue;
      if (p.deps.some((n) => byName.get(n) === dir || out.has(byName.get(n)))) {
        out.add(p.dir);
        grew = true;
      }
    }
  }
  return [...out];
}

/**
 * What a change reaches.
 *
 * @param {ImpactGraph} graph
 * @param {readonly string[]} changedPaths - repo-relative, either slash style
 * @returns {{
 *   tests: string[],
 *   packages: string[],
 *   fullSuite: { dir: string, reason: string }[],
 * }} `tests`: the reached unit tests in workspace packages; `packages`: every
 *   package holding a reached file or a full suite (the packages whose gate
 *   has anything to check); `fullSuite`: the packages whose whole unit suite
 *   must run, with the rule that says why. All sorted.
 */
export function impactOf(graph, changedPaths) {
  // Markdown stays in: a test can read it by name (fixtures/PROVENANCE.md).
  const changed = [...new Set(changedPaths.map(normalize))].filter((p) => p !== '');
  /** @type {Map<string, string>} */
  const full = new Map();
  for (const path of changed) {
    const dir = packageOf(graph.packages, path);
    if (!dir) continue;
    const rule = FULL_SUITE_RULES.find((r) => r.test(path, graph.fileSet.has(path)));
    if (!rule) continue;
    for (const d of [dir, ...dependentsOf(graph, dir)]) {
      if (!full.has(d)) full.set(d, `${path} is ${rule.name}`);
    }
  }

  /** @type {Map<string, string[]>} */
  const readers = new Map();
  for (const path of changed) {
    const base = path.split('/').pop() ?? path;
    const dir = packageOf(graph.packages, path);
    for (const [file, text] of graph.texts) {
      if (!FS_READ_RE.test(text) || !text.includes(base)) continue;
      if (packageOf(graph.packages, file) !== dir && !(dir && text.includes(dir))) continue;
      readers.set(path, [...(readers.get(path) ?? []), file]);
    }
  }

  const walk = (/** @type {boolean} */ withReaders) => {
    const seen = new Set(changed);
    const todo = [...changed];
    while (todo.length > 0) {
      const f = /** @type {string} */ (todo.pop());
      const next = [
        ...(graph.importers.get(f) ?? []),
        ...graph.dirDeps.filter(([, d]) => f.startsWith(`${d}/`)).map(([from]) => from),
        ...(withReaders ? (readers.get(f) ?? []) : []),
      ];
      for (const n of next) {
        if (!seen.has(n)) {
          seen.add(n);
          todo.push(n);
        }
      }
    }
    return seen;
  };
  // Import edges alone decide which configs and setup files a change reaches;
  // a reader edge to a config (a vite config reading its page) does not make
  // the config load the change.
  for (const f of walk(false)) {
    const dir = packageOf(graph.packages, f);
    if (dir && loadsEveryTest(f) && !changed.includes(f) && !full.has(dir)) {
      full.set(dir, `${f} imports the change`);
    }
  }
  const seen = walk(true);
  const tests = new Set([...seen].filter((f) => isUnitTest(f) && packageOf(graph.packages, f)));
  const changedDirs = new Set(changed.map((p) => packageOf(graph.packages, p)).filter(Boolean));
  if (changed.some((p) => MODULE_RE.test(p) && !isUnitTest(p))) {
    for (const [file, text] of graph.texts) {
      const dir = packageOf(graph.packages, file);
      if (!dir || !isUnitTest(file) || !SCANNER_RE.test(text)) continue;
      if (changedDirs.has(dir) || [...changedDirs].some((d) => d !== dir && text.includes(/** @type {string} */ (d)))) {
        tests.add(file);
      }
    }
  }
  const packages = new Set([...full.keys()]);
  for (const f of [...seen, ...tests]) {
    // A changed markdown file alone gives its package's gate nothing to check.
    if (isMarkdown(f) && changed.includes(f)) continue;
    const dir = packageOf(graph.packages, f);
    if (dir) packages.add(dir);
  }
  return {
    tests: [...tests].sort(),
    packages: [...packages].sort(),
    fullSuite: [...full].map(([dir, reason]) => ({ dir, reason })).sort((a, b) => a.dir.localeCompare(b.dir)),
  };
}
