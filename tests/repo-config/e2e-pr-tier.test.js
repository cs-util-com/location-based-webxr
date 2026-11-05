// Repo-meta test: the per-PR browser tier, the Playwright tests tagged `@pr`.
//
// Why this test matters: a pull request runs only the tagged tests (the full
// set runs on the full run). A tag that drifts out of a spec takes a core
// flow out of every PR without a red; a tag that drifts in makes the tier
// slower without anyone deciding it. So the tagged list is pinned here, per
// package, by count and by name, and a change to it is a visible diff of
// this file; changing it means saying why in the commit.
//
// What earns a tag: one test per core flow a pull request could break
// (opening, editing and saving a tour, the visitor's walk, a page's boot
// without errors, a known error path), and where a 2D and a 3D test cover
// the same flow, the 3D one: the long-text test "words typed just before
// Ctrl+S are in the saved tour" stands in for editor.spec.js's "Ctrl+S
// saves, and the browser's own save never opens".
//
// What counts as a tag: a test title ending in " @pr" (Playwright reads an
// `@word` in a title as a tag, and its grep matches the title), or the one
// conditional form a loop needs, a template title ending in
// `${<condition> ? " @pr" : ""}`. A title tag rather than the `{ tag }`
// option, because the option's extra argument makes Prettier re-indent the
// whole test body, a diff that collides with every branch editing the spec.
// Any other "@pr" in a spec file (a describe title, the middle of a title, a
// helper, the tag option) fails the scan, because the scan could not name
// what it selects.
//
// Coverage limits: it reads the source, not Playwright's loader, so a
// conditional tag is pinned as its condition, not as the instances it
// selects; and a spec file must sit under a package's own folder (not
// `node_modules`, `dist` or `test-results`).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tourPlan = await import(
  pathToFileURL(join(ROOT, 'GpsPlusSlamJs_TourViewer/playwright-tests/e2e-plan.js')).href
);
const SKIP = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.vite']);

/** @param {string} dir @returns {string[]} spec files under dir, absolute */
function specFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...specFiles(path));
    else if (/\.spec\.m?js$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** @param {string} dir @returns {string[]} Playwright configs under dir, absolute */
function configFiles(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...configFiles(path));
    else if (/^playwright\.config\.m?js$/.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * The index just past the string literal that starts at `i`.
 * @param {string} s @param {number} i @returns {number}
 */
function endOfLiteral(s, i) {
  const quote = s[i];
  for (let j = i + 1; j < s.length; j += 1) {
    if (s[j] === '\\') j += 1;
    else if (s[j] === quote) return j + 1;
  }
  throw new Error(`unterminated string literal at ${i}`);
}

const PLAIN_TAG = / @pr$/;
const CONDITIONAL_TAG = /\$\{\s*([^{}?]+?)\s*\?\s*(["'])\s?@pr\2\s*:\s*(["'])\3\s*\}$/;

/**
 * Whether the line holding `at` is a comment line: one that starts, after
 * its indentation, with "//", "/*" or "*" (a line of a block comment). A
 * test commented out is written so; a full parser for the rest (a test
 * after code on its line) is not worth its own failure modes here.
 * @param {string} text @param {number} at @returns {boolean}
 */
function onCommentLine(text, at) {
  const start = text.lastIndexOf('\n', at - 1) + 1;
  return /^\s*(\/\/|\/\*|\*)/.test(text.slice(start, at));
}

/**
 * The tagged tests of one spec file, and how many "@pr" the file holds.
 * @param {string} text
 * @returns {{ tagged: string[], mentions: number }}
 */
function scanSpec(text) {
  /** @type {string[]} */
  const tagged = [];
  const call = /\btest\(\s*/g;
  let match;
  while ((match = call.exec(text))) {
    // A commented-out test is no test: its tag must not count. Its "@pr"
    // still counts among the mentions below, so the guard says so.
    if (onCommentLine(text, match.index)) continue;
    const at = match.index + match[0].length;
    if (!'"\'`'.includes(text[at] ?? '')) continue;
    const end = endOfLiteral(text, at);
    const title = text.slice(at + 1, end - 1);
    if (PLAIN_TAG.test(title)) {
      tagged.push(title.slice(0, -' @pr'.length));
      continue;
    }
    const conditional = text[at] === '`' ? CONDITIONAL_TAG.exec(title) : null;
    if (conditional) {
      const base = title.slice(0, conditional.index);
      tagged.push(`${base} [if ${conditional[1].replace(/\s+/g, ' ')}]`);
    }
  }
  return { tagged, mentions: (text.match(/@pr\b/g) ?? []).length };
}

/** package folder -> its tagged tests, as "spec file: title" */
function scanPackages() {
  /** @type {Record<string, string[]>} */
  const byPackage = {};
  /** @type {string[]} */
  const unreadable = [];
  for (const pkg of readdirSync(ROOT)
    .filter((d) => d.startsWith('GpsPlusSlamJs_'))
    .sort()) {
    for (const file of specFiles(join(ROOT, pkg)).sort()) {
      const { tagged, mentions } = scanSpec(readFileSync(file, 'utf8'));
      const name = relative(join(ROOT, pkg), file).replaceAll('\\', '/');
      if (mentions !== tagged.length) {
        unreadable.push(`${pkg}/${name}: ${mentions} "@pr" but ${tagged.length} tagged tests`);
      }
      if (tagged.length > 0) {
        byPackage[pkg] = [...(byPackage[pkg] ?? []), ...tagged.map((t) => `${name}: ${t}`)];
      }
    }
  }
  return { byPackage, unreadable };
}

/** The pinned per-PR tier. Edit together with the tags, never apart. */
const EXPECTED = {
  GpsPlusSlamJs_AnchorStarter: [
    'playwright-tests/placement-flow.spec.js: a boot on a ready report: placeable, guided, wired, and a user-ended session tears down',
    'playwright-tests/placement-flow.spec.js: renders a warming-up tracking report as a progress phase',
    'playwright-tests/placement-flow.spec.js: placing saves the anchor into ?show=, surfaces the share affordances and starts the wayfinding HUD',
    'playwright-tests/placement-flow.spec.js: the saved link round-trips: marker, banner, HUD and the placed altitude come back on reload',
    'playwright-tests/placement-flow.spec.js: a failed anchor creation reverts cleanly, leaks nothing, and a retry places exactly one marker',
    'playwright-tests/placement-flow.spec.js: blocks placement until it can be placed: first the alignment hint, then the point-at-the-ground hint',
    'playwright-tests/placement-flow.spec.js: a post-initAR failure rewinds to the start screen, ends the session, and the retry boots',
    'playwright-tests/share-link.spec.js: confirms the copy and reverts to idle, even when clicked twice inside the window',
    'playwright-tests/share-link.spec.js: shows a fallback hint when clipboard write fails',
    'playwright-tests/smoke.spec.js: boots to the start screen honestly: the capability gate fires, the live panels stay hidden, on a clean console',
  ],
  GpsPlusSlamJs_DesignSystem: [
    '3d/pages.fast.spec.mjs: every deployable page has a ready signal here',
    '3d/pages.fast.spec.mjs: the catalog page opens without errors',
    '3d/pages.fast.spec.mjs: the look-dev page boots in its default look and draws, without errors',
    '3d/pages.fast.spec.mjs: the globe lab opens with the relief and the band, and draws, without errors',
    '3d/pages.fast.spec.mjs: the globe-terrain carrier lab opens and draws without errors',
    '3d/pages.fast.spec.mjs: the terrain colour comparison page starts and drives the lab',
    '3d/pages.fast.spec.mjs: the AR shadows lab opens and draws without errors',
  ],
  GpsPlusSlamJs_Landing: [
    'playwright-tests/legal.spec.js: the legal page loads with both sections, the operator placeholder and the claims held to the code',
    'playwright-tests/scroll-story.spec.js: boots with a canvas or the static floor, the snippet open, every chapter activating, the QR handoff, and zero errors',
    'playwright-tests/scroll-story.spec.js: a ?qr= launch forwards to the tour viewer with the payload intact',
    'playwright-tests/scroll-story.spec.js: shows every chapter readable on a phone (${orientation}) [if orientation === "portrait"]',
  ],
  GpsPlusSlamJs_OsmDemo: [
    'playwright-tests/boot-and-shell.spec.js: loads the rule table, draws a basemap, reports its scale, says when it is still widening, on a clean console and a real worker, the views filling the row',
    'playwright-tests/boot-and-shell.spec.js: a dead worker is REPORTED, not left hanging',
    'playwright-tests/boot-and-shell.spec.js: locates when pressed without a fix, then OFFERS to enter AR',
    "playwright-tests/boot-and-shell.spec.js: the offer's button is wired to AR entry, and the prompt clears the offer",
    'playwright-tests/data-and-caching.spec.js: a reload is served from OPFS without refetching',
    'playwright-tests/map-and-cells.spec.js: draws the cells, the extent, the outlines, the popup — and redraws on a category switch',
    'playwright-tests/scene-3d.spec.js: draws pixels and buildings, repaints after a resize, shows the terrain as a ramp, and the GPU path matches the CPU one',
  ],
  GpsPlusSlamJs_PhysicsDemo: [
    'playwright-tests/replay-flow.spec.js: reconstructs the mesh from a real recording and spawns bouncing balls',
    'playwright-tests/replay-shadows.spec.js: on first load (${label}), with no change, the shadow shows [if skin === "off"]',
  ],
  GpsPlusSlamJs_QrTrackingDemo: [
    'playwright-tests/qr-demo.spec.js: starts scanning, measures the size, converges and glues the debug objects',
    'playwright-tests/qr-demo.spec.js: withholds the overlay while the size stays unknown',
    'playwright-tests/smoke.spec.js: loads and gates WebXR-less desktop without crashing',
  ],
  GpsPlusSlamJs_RecorderApp: [
    'playwright-tests/alignment-timing.spec.js: boots, prints its parameters and the device, offers the swept repeat counts, and refuses to run empty',
    'playwright-tests/debug-wheel.spec.js: is absent without the flag - no gear, and the hook reports null',
    'playwright-tests/debug-wheel.spec.js: with ?debug=1 the gear opens a panel, a preset change reaches the wheel, and the sun check asks first',
    'playwright-tests/enter-ar-flow.spec.js: clicking enabled Enter AR hides the setup modal, for a new scenario and for an existing one',
    'playwright-tests/enter-ar-flow.spec.js: Enter AR enables without opening a folder; folder section collapsed by default',
    'playwright-tests/map-browser.spec.js: a full-bleed map under floating overlays: search, tile selection, playback and close',
    'playwright-tests/map-browser.spec.js: the map is there first, tours and tiles stream in, and the progress pill counts up and hides',
    'playwright-tests/map-browser.spec.js: the CTA embeds on click, confirms and hides; a denied write leaves a retry label',
    'playwright-tests/replay-mode.spec.js: without WebXR the page boots to the replay setup, on a clean console',
    'playwright-tests/setup-modal.spec.js: the first open: the modal on top, the sections in order and collapsed, then expanded',
    'playwright-tests/setup-modal.spec.js: the storage steps: the blocker said once, the folder step optional, its progress bar, and a click that cannot crash',
    'playwright-tests/setup-modal.spec.js: Enter AR and its hint stay in the pinned footer, in the viewport on a short screen',
    'playwright-tests/smoke.spec.js: boots to the setup modal with its controls and Tailwind applied, on a clean console',
    'playwright-tests/test-hooks-verification.spec.js: REQUIRED_TEST_HOOKS matches the exposed window.testHooks surface',
    'playwright-tests/toast.spec.js: appears, announces politely, composites over AR, replaces the previous message and goes away on its own',
  ],
  GpsPlusSlamJs_TourViewer: [
    'playwright-tests/ar-layout.spec.js: every AR panel control fits a ${viewport.width}x${viewport.height} screen, with the size offer open [if viewport.height === 640]',
    "playwright-tests/ar-mode.spec.js: the plain page is the creator's setup; a ?qr= launch is the visitor's screen",
    'playwright-tests/ar-mode.spec.js: a visitor who refuses the location starts the tour on codes alone: no location request, no GPS watch, no GPS escape, and a code places the tour (QR-first M1b-1)',
    'playwright-tests/ar-mode.spec.js: visitor mode boots to running: session started, alignment bound, capture at 8 Hz',
    'playwright-tests/ar-mode.spec.js: the creator measures the code, finishes, and downloads a rebuilt zip that carries the level and tour.json',
    'playwright-tests/ar-mode.spec.js: a first measurement of a code the tour does not store is minted into the rebuilt zip, and re-minted by the Finish',
    "playwright-tests/ar-mode.spec.js: the visitor's content waits for the lock; the escape after its clock places by GPS instead",
    "playwright-tests/ar-mode.spec.js: viewer mode relocalizes against the tour's level: budgeted votes, marker, the station's photos",
    'playwright-tests/ar-mode.spec.js: a crash does not lose the walk: placed content survives a reload and lands in the zip',
    "playwright-tests/blocks-tour.spec.js: the visitor sees a station's pin, its captured photo, its picture and its placed model in the world",
    'playwright-tests/blocks-tour.spec.js: the editor opens a tour of every free block, edits its pin, saves it whole, and the saved file opens again',
    'playwright-tests/editor-entry.spec.js: opens the tour behind the link, busy until it has',
    'playwright-tests/editor-files.spec.js: edits survive a closed tab: the same file reopened offers them, and Restore brings them back',
    "playwright-tests/editor.spec.js: edits a pin's text and saves a tour that carries it",
    'playwright-tests/editor.spec.js: saves in place to the file it opened, and keeps the walk recording',
    'playwright-tests/editor.spec.js: refuses to write over a file that changed meanwhile, and offers the download',
    'playwright-tests/editor.spec.js: saves by itself a few seconds after a change, quietly, and the next open finds no leftover draft',
    'playwright-tests/editor.spec.js: Done saves what is pending, says where it is and how to update the tour, and moves the walk out into a file of its own',
    'playwright-tests/editor.spec.js: a tour without a file is saved into the file its first Save asks for, and from then on in place and by itself',
    'playwright-tests/editor3d-edit.spec.js: drags a selected pin over the ground with the mouse: one step, kept above the ground, saved, undone and redone',
    "playwright-tests/editor3d-globe-approach.spec.js: the flight lands close to the tour, looking steeply down, and moves the view's frame only by its recentring",
    "playwright-tests/editor3d-globe-buildings.spec.js: the buildings load in their worker on the relief's ground, out of the picking's way",
    'playwright-tests/editor3d-globe-default.spec.js: the plain editor link opens the sample tour on the globe',
    "playwright-tests/editor3d-globe-default.spec.js: opens on the whole Earth over the creator's zone, and a right click on the ground places its first station",
    'playwright-tests/editor3d-globe-default.spec.js: without WebGL a plain page says so, and the tour still saves',
    "playwright-tests/editor3d-globe-default.spec.js: 'needs no GPS' is set in the 3D view's Tour details, saved, and read back",
    'playwright-tests/editor3d-long-text.spec.js: words typed just before Ctrl+S are in the saved tour',
    'playwright-tests/launch-and-errors.spec.js: a ?qr= launch opens the archive with no interaction',
    'playwright-tests/launch-and-errors.spec.js: the page boots without console errors',
    'playwright-tests/launch-and-errors.spec.js: boots the landing without console errors',
    'playwright-tests/open-file.spec.js: opens a tour zip from the device through the file chooser',
    'playwright-tests/setup-flow.spec.js: starts at the host tiles, and a chosen host carries on to the link',
    'playwright-tests/stations.spec.js: a station tour: the visitor at the code finds the first station, its knight speaks and asks, a walk finds the next, the last is skipped',
    'playwright-tests/streaming.spec.js: streams the gallery from range requests without downloading the whole archive',
    "playwright-tests/visitor-start.spec.js: the start page leads with the tour's name and puts the round button on the first ${viewport.width}x${viewport.height} screen [if viewport.height === 640]",
    'playwright-tests/visitor-walk.spec.js: the peek names the nearest station; the list opens by the grab and by a drag, and closes',
  ],
  GpsPlusSlamJs_WayfindingHudDemo: [
    'playwright-tests/entrance.spec.js: the outline grows monotonically, the dot pops last, and the settled frame is the static sprite',
    'playwright-tests/indicator-style.spec.js: toggling switches the live HUD between procedural and image indicators',
    'playwright-tests/smoke.spec.js: loads the simulator with the real HUD, draws the ring the status line claims, on a clean console',
    'playwright-tests/walk-flow.spec.js: arriving hides the ring, walking away reactivates it beyond distanceMax',
    'playwright-tests/walk-flow.spec.js: the deadband: a deactivated target survives a look-away, and the sliders re-create the HUD live',
  ],
};

describe('the per-PR browser tier', () => {
  const { byPackage, unreadable } = scanPackages();

  it('reads every "@pr" in a spec file as a test tag it can name', () => {
    expect(unreadable).toEqual([]);
  });

  it('holds the pinned count per package', () => {
    const counts = Object.fromEntries(Object.entries(byPackage).map(([p, t]) => [p, t.length]));
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([p, t]) => [p, t.length]));
    expect(counts).toEqual(expected);
  });

  it('holds the pinned tests by name', () => {
    expect(byPackage).toEqual(EXPECTED);
  });

  // Each Tour Viewer lane is its own CI job, and a tier job that selects no
  // test fails ("No tests found"): so every lane must hold a tagged test.
  // A spec that moves lanes, or a lane whose last tag goes, fails here first.
  it('gives every Tour Viewer CI lane at least one tier test', () => {
    const taggedSpecs = new Set(
      (byPackage.GpsPlusSlamJs_TourViewer ?? []).map((entry) =>
        entry.slice(0, entry.indexOf(':')).split('/').pop(),
      ),
    );
    for (const lane of tourPlan.LANES) {
      const held = tourPlan.specsOfLane(lane).filter((name) => taggedSpecs.has(name));
      expect(held.length, `lane ${lane}`).toBeGreaterThan(0);
    }
  });

  // A config that does not read the tier runs its whole suite on every PR
  // (or, without the retries rule, retries a flake twice where the tier
  // allows one): the tag would pin a list nobody selects.
  it('has every Playwright config select the tier and its retries', () => {
    const configs = readdirSync(ROOT)
      .filter((d) => d.startsWith('GpsPlusSlamJs_'))
      .flatMap((pkg) => configFiles(join(ROOT, pkg)));
    expect(configs.length).toBeGreaterThanOrEqual(9);
    for (const file of configs) {
      const text = readFileSync(file, 'utf8');
      const name = relative(ROOT, file);
      expect(text, name).toMatch(/grep: playwrightGrep\(import\.meta\.url\)/);
      expect(text, name).toMatch(/retries: tierRetries\(process\.env/);
    }
  });
});

describe('scanSpec', () => {
  // Why: the guard above is only as honest as its scanner; these pin the
  // forms it accepts and the ones it must refuse to read.
  it('reads a plain tag and a conditional one, and ignores an untagged test', () => {
    const text = [
      'test("a @pr", async () => {});',
      "test('b', async () => {});",
      'test(`c ${v.w}${v.w === 640 ? " @pr" : ""}`, async () => {});',
      "test(`d${x === 'y' ? ' @pr' : ''}`, async () => {});",
    ].join('\n');
    expect(scanSpec(text)).toEqual({
      tagged: ['a', 'c ${v.w} [if v.w === 640]', "d [if x === 'y']"],
      mentions: 3,
    });
  });

  it('counts an "@pr" it cannot read as a tag, so the guard fails on it', () => {
    for (const text of [
      'test.describe("d @pr", () => {});',
      'test("title with @pr in it", async () => {});',
      'test("e", { tag: "@pr" }, async () => {});',
      'test(`g${x ? " @pr" : ""} tail`, async () => {});',
      'test("h", async () => {}); // @pr',
      '// test("i @pr", async () => {});',
      '/* test("j @pr", async () => {}); */',
    ]) {
      const { tagged, mentions } = scanSpec(text);
      expect(mentions, text).toBeGreaterThan(tagged.length);
    }
  });

  // Why: a commented-out tagged test once counted as a tier test, so the
  // pinned set could name a test that never runs.
  it('reads no tag from a commented-out test, and keeps a "//" inside a title', () => {
    const text = [
      '  // test("gone @pr", async () => {});',
      '/* test("also gone @pr", async () => {}); */',
      ' * test("in a doc comment @pr", async () => {});',
      'test("kept // not a comment @pr", async () => {});',
    ].join('\n');
    expect(scanSpec(text).tagged).toEqual(['kept // not a comment']);
  });
});
