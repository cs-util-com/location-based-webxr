// Repo-meta test: every package's vite dev-server port is unique.
//
// Why this test matters: THREE packages were configured for port 5182 at once —
// `GpsPlusSlamJs_Landing`, `GpsPlusSlamJs_PhysicsDemo` and
// `GpsPlusSlamJs_QrTrackingDemo` — and each one's config carried a comment
// asserting the port was distinct "so it can coexist with the others". Every one
// of those comments was written in good faith from local knowledge, and two of
// them were wrong.
//
// A port clash here does NOT fail loudly, which is the whole reason this is worth
// a test. Every Playwright config sets `reuseExistingServer: !process.env.CI`, so
// the second package to run does not fail to bind — it attaches to the first
// package's dev server and runs its entire e2e suite against the WRONG
// APPLICATION. Observed: five `GpsPlusSlamJs_QrTrackingDemo` tests failing with
// `getByTestId('start-screen')` → "element(s) not found", and the captured page
// snapshot was the landing page's "Story chapters" navigation. Killing the
// process holding 5182 and re-running the identical tree gave 37 passed.
//
// It is invisible on CI (which never reuses a server, and runs each package in
// its own job) and intermittent locally — it only bites when one package's dev
// server outlives its stage, which is what a long or interrupted root cascade
// produces. So it reads as an unrelated flaky package, and re-running "fixes" it.
//
// Coverage limits: this reads the literal `port:` in each `vite.config.ts`. A
// package that sets its port some other way — an env var, a CLI flag with no
// config default — is invisible here. That is acceptable because the convention
// in this repo is a literal, and a new package that breaks the convention is a
// bigger conversation than a port number.

import { describe, it, expect } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

/** `{ package, port }` for every package that pins a dev-server port. */
function configuredPorts() {
  // Through the shared tracked tree (tracked-tree.js; gate-speed plan
  // 2026-10-04, G6): the tracked depth-1 configs, filtered from the
  // whole-repo listing the other guards already memoise (a pathspec would
  // cost one more `git` process). A package's untracked config is invisible
  // until it is added.
  return trackedFiles()
    .filter((rel) => /^GpsPlusSlamJs_[^/]*\/vite\.config\.ts$/.test(rel))
    .map((rel) => {
      let text;
      try {
        text = readTracked(rel);
      } catch {
        return undefined; // tracked but deleted in the working tree
      }
      // The `server.port` literal. Anchored on `port:` rather than on any
      // four-digit number, so a version or a timeout cannot be mistaken for one.
      const match = /\bport:\s*(\d{4})\b/.exec(text);
      return match === null
        ? undefined
        : { pkg: rel.split('/')[0], port: Number(match[1]) };
    })
    .filter((found) => found !== undefined);
}

describe('dev-server ports', () => {
  it('are configured by more than one package, or this test proves nothing', () => {
    // A guard on the guard: if the scan silently found nothing — a renamed
    // config, a changed convention — every assertion below would pass vacuously
    // and the repo would look clean while three packages fought over a port.
    expect(configuredPorts().length).toBeGreaterThan(3);
  });

  it('are unique across every package', () => {
    const byPort = new Map();
    for (const { pkg, port } of configuredPorts()) {
      byPort.set(port, [...(byPort.get(port) ?? []), pkg]);
    }
    // Reported as the full clash map rather than as a boolean: when this fails,
    // the useful information is WHICH packages collided on WHICH port, and a
    // `toBe(true)` would make the reader go and work that out by hand.
    const clashes = [...byPort.entries()]
      .filter(([, packages]) => packages.length > 1)
      .map(([port, packages]) => `${port}: ${packages.join(', ')}`);

    expect(clashes).toEqual([]);
  });
});
