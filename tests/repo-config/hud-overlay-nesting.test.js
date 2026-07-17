// Repo-meta test: enforces the DOM-overlay / HUD stacking convention across
// every web app in this repo.
//
// Why this test matters: under the WebXR DOM Overlay feature, only the subtree
// of the element passed as `domOverlay.root` is composited over the camera feed
// during an `immersive-ar` session — the rest of the page is hidden. The
// framework binds that root to the *same element passed to `initAR(container)`*
// (see `buildSessionOptions` in
// GpsPlusSlamJs_AppFramework/src/ar/webxr-session.ts). Therefore every HUD /
// overlay node an app wants visible in AR MUST be a DOM descendant of the
// element it hands to `initAR`. If an app authors its overlay as a *sibling* of
// that container, the HUD silently disappears the moment AR starts — and that
// failure only shows up on real AR hardware, never in CI. This static guard is
// the only thing that catches the regression before the field.
//
// A new app added to this repo should be appended to APP_OVERLAY_CONTRACTS so
// it inherits the same protection. See
// GpsPlusSlamJs_Docs/docs/2026-06-05-0534-cross-app-alignment-smoothing-hud-stacking-and-recorder-setup-ux-user-feedback.md
// (Finding 3 / Decision D3) and the AppFramework README "DOM-Overlay / HUD
// stacking convention".
//
// Coverage limits: this checks the *authored* DOM in index.html, not the live
// rendered DOM after the app boots. It assumes apps do not reparent their
// overlay out of the container at runtime (none do). It cannot verify the
// element id strings actually match what each app passes to `initAR` /
// `getElementById` — that linkage is asserted indirectly by each app's own
// unit/e2e suite.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The DOM-overlay contract for each app: the `containerId` is the element the
 * app passes to `initAR()` (which becomes `domOverlay.root`); every id in
 * `overlayIds` is an overlay/HUD node that must be nested inside it so it stays
 * visible once the AR session starts.
 */
const APP_OVERLAY_CONTRACTS = [
  {
    name: 'RecorderApp',
    htmlPath: 'GpsPlusSlamJs_RecorderApp/index.html',
    containerId: 'app',
    overlayIds: ['hud'],
  },
  {
    name: 'AnchorStarter',
    htmlPath: 'GpsPlusSlamJs_AnchorStarter/index.html',
    containerId: 'app',
    overlayIds: ['overlay'],
  },
  {
    name: 'MinimalExample',
    htmlPath: 'GpsPlusSlamJs_MinimalExample/index.html',
    containerId: 'ar-root',
    overlayIds: ['status', 'enter-ar'],
  },
  {
    name: 'QrTrackingDemo',
    htmlPath: 'GpsPlusSlamJs_QrTrackingDemo/index.html',
    containerId: 'app',
    overlayIds: ['overlay'],
  },
  {
    name: 'PhysicsDemo',
    htmlPath: 'GpsPlusSlamJs_PhysicsDemo/index.html',
    containerId: 'app',
    overlayIds: ['overlay'],
  },
];

/**
 * Locate an element's opening tag by id. Returns the tag name and the
 * `[start, end)` character range of the opening tag itself.
 *
 * @param {string} html
 * @param {string} id
 * @returns {{ tagName: string, openStart: number, openEnd: number }}
 */
function findOpenTagById(html, id) {
  // Match `<tag ... id="theId" ...>` capturing the tag name. The id attribute
  // may appear anywhere among the attributes.
  const re = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`,
  );
  const match = re.exec(html);
  if (!match) {
    throw new Error(`No element with id="${id}" found`);
  }
  return {
    tagName: match[1].toLowerCase(),
    openStart: match.index,
    openEnd: match.index + match[0].length,
  };
}

/**
 * Given an opening tag of `tagName` at/after `searchFrom`, find the character
 * index of its matching close tag by balancing nested same-name tags. Returns
 * the index of the `</tagName>` that closes the element opened at the start.
 *
 * Robust for hand-authored markup: only same-name tags affect the balance, so
 * a `<div id="container">` ignores `<section>`, `<button>`, void elements, etc.
 *
 * @param {string} html
 * @param {string} tagName lowercased tag name of the container
 * @param {number} afterOpenIndex character index just past the container's open tag
 * @returns {number} index of the matching close tag
 */
function findMatchingCloseIndex(html, tagName, afterOpenIndex) {
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*?>`, 'gi');
  re.lastIndex = afterOpenIndex;
  let depth = 1;
  let match;
  while ((match = re.exec(html)) !== null) {
    const isClose = match[1] === '/';
    depth += isClose ? -1 : 1;
    if (depth === 0) {
      return match.index;
    }
  }
  throw new Error(`Unbalanced <${tagName}> — no matching close tag found`);
}

describe('DOM-overlay / HUD stacking convention', () => {
  for (const contract of APP_OVERLAY_CONTRACTS) {
    describe(contract.name, () => {
      const html = readFileSync(resolve(repoRoot, contract.htmlPath), 'utf8');
      const container = findOpenTagById(html, contract.containerId);
      const containerClose = findMatchingCloseIndex(
        html,
        container.tagName,
        container.openEnd,
      );

      for (const overlayId of contract.overlayIds) {
        it(`#${overlayId} is nested inside the #${contract.containerId} initAR container`, () => {
          const overlay = findOpenTagById(html, overlayId);
          // The overlay's opening tag must start *inside* the container's
          // inner range: after the container opens and before it closes.
          expect(overlay.openStart).toBeGreaterThan(container.openEnd);
          expect(overlay.openStart).toBeLessThan(containerClose);
        });
      }
    });
  }
});

/**
 * Discovered AR-app `index.html` paths (repo-root-relative, forward-slash) that
 * appear in `registered` paths subtracted out — i.e. AR apps with no overlay
 * contract. Pure so it's unit-testable with fixtures.
 *
 * @param {readonly string[]} discovered
 * @param {readonly string[]} registered
 * @returns {string[]}
 */
function appsMissingContracts(discovered, registered) {
  const reg = new Set(registered);
  return discovered.filter((p) => !reg.has(p));
}

/**
 * True if any `src/**` source file in `appDir` imports the framework
 * (`gps-plus-slam-app-framework`). This is the "is a consuming AR app" signal:
 * every app boots its WebXR/dom-overlay session through the framework, but they
 * do so via different entry points (`initAR` directly, or the `enable-gps-ar`
 * controller), so matching the framework import is more robust than matching a
 * single function name. The framework itself never imports its own package
 * name, so this also excludes it.
 */
function srcImportsFramework(appDir) {
  const srcDir = join(appDir, 'src');
  if (!existsSync(srcDir)) return false;
  return readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|js|jsx|mts|cts)$/.test(e.name))
    .some((e) =>
      readFileSync(join(e.parentPath, e.name), 'utf8').includes(
        'gps-plus-slam-app-framework',
      ),
    );
}

/**
 * Discover every AR app in the repo: a top-level workspace package (has both
 * `package.json` and `index.html`) whose source consumes the framework (so it
 * opens a WebXR dom-overlay session). Excludes the framework (no `index.html`,
 * and it never self-imports) and the static landing page (no `package.json` /
 * `src`). Returns repo-root-relative forward-slash `index.html` paths, matching
 * `APP_OVERLAY_CONTRACTS[].htmlPath`.
 *
 * @param {string} root repo root
 * @returns {string[]}
 */
function discoverArAppHtmlPaths(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter(
      (name) =>
        existsSync(join(root, name, 'index.html')) &&
        existsSync(join(root, name, 'package.json')) &&
        srcImportsFramework(join(root, name)),
    )
    .map((name) => `${name}/index.html`)
    .sort();
}

// --- Coverage guard ---------------------------------------------------------
//
// APP_OVERLAY_CONTRACTS above is hand-maintained. The failure mode is "someone
// adds a new AR app and forgets to register it" — the new app then ships with
// NO overlay-nesting protection (exactly what happened when the QrTrackingDemo
// was first added). This guard closes that gap: it discovers every AR app in
// the repo and asserts each one has a contract, so a missing registration turns
// into a red test instead of an unprotected app. We keep the explicit registry
// (the per-app container/overlay ids are clearer written out than auto-derived);
// the guard only enforces that the registry is COMPLETE.

describe('overlay-contract coverage guard', () => {
  // The pure diff that powers the guard: which discovered apps lack a contract.
  describe('appsMissingContracts', () => {
    it('flags a discovered AR app that has no contract', () => {
      expect(
        appsMissingContracts(
          ['a/index.html', 'b/index.html'],
          ['a/index.html'],
        ),
      ).toEqual(['b/index.html']);
    });

    it('is empty when every discovered app is registered', () => {
      expect(
        appsMissingContracts(
          ['a/index.html'],
          ['a/index.html', 'x/index.html'],
        ),
      ).toEqual([]);
    });
  });

  it('discovers the known AR apps (so the guard is not vacuous)', () => {
    const discovered = discoverArAppHtmlPaths(repoRoot);
    expect(discovered).toContain('GpsPlusSlamJs_QrTrackingDemo/index.html');
    expect(discovered).toContain('GpsPlusSlamJs_RecorderApp/index.html');
    expect(discovered.length).toBeGreaterThanOrEqual(4);
  });

  it('every AR app (workspace pkg + index.html + framework import) has an overlay contract', () => {
    const discovered = discoverArAppHtmlPaths(repoRoot);
    const registered = APP_OVERLAY_CONTRACTS.map((c) => c.htmlPath);
    // A non-empty result names the unregistered app(s) — add them to
    // APP_OVERLAY_CONTRACTS so they inherit the nesting protection.
    expect(appsMissingContracts(discovered, registered)).toEqual([]);
  });
});
