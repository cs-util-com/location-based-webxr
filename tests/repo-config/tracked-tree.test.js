// Why this test matters: `tracked-tree.js` is the one place the repo-config
// guards list and read the tracked tree. It exists to REMOVE work (one
// `git ls-files` per distinct pathspec and one read per file, instead of one
// per guard and per test), so a regression here is silent in the worst way:
// either the guards quietly see a different file set than `git ls-files`
// gives them (a guard that passes over the wrong list), or the memo stops
// memoising and the suite goes back to failing on 5 s timeouts under load
// (2026-09-28 load findings: a process start took 0.4-3.6 s under load).
//
// These tests run against injected fakes, so they cost no process spawn and
// no tree read themselves. The real listing is still proven non-vacuous by
// each guard's own "finds a non-trivial number of tracked files" case.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolve } from 'node:path';

import { createTrackedTree } from './tracked-tree.js';

const ROOT = resolve('/repo');

function fakes(listing = 'a.ts\nb/c.md\n') {
  const execCalls = [];
  const readCalls = [];
  return {
    execCalls,
    readCalls,
    tree: createTrackedTree({
      root: ROOT,
      exec: (args, cwd) => {
        execCalls.push({ args, cwd });
        return listing;
      },
      read: (path) => {
        readCalls.push(path);
        if (path.endsWith('missing.ts')) {
          const error = new Error(`ENOENT: no such file, open '${path}'`);
          error.code = 'ENOENT';
          throw error;
        }
        return `content of ${path}`;
      },
    }),
  };
}

describe('createTrackedTree', () => {
  describe('list', () => {
    it('runs `git ls-files` with the pathspecs verbatim, at the root', () => {
      // The guards' file sets depend on git's own pathspec semantics (in
      // `*/src/**.ts` the `*` crosses `/`), so the helper must pass them
      // through unchanged rather than re-implement the matching.
      const { tree, execCalls } = fakes();
      tree.list('*.md', '*.ts');
      expect(execCalls).toEqual([{ args: ['ls-files', '*.md', '*.ts'], cwd: ROOT }]);
    });

    it('returns the listed paths, one per line, with empty lines dropped', () => {
      const { tree } = fakes('a.ts\n\nb/c.md\n');
      expect(tree.list()).toEqual(['a.ts', 'b/c.md']);
    });

    it('spawns once per distinct pathspec list, however often it is asked', () => {
      const { tree, execCalls } = fakes();
      const first = tree.list();
      const second = tree.list();
      tree.list('*/src/**.ts');
      tree.list('*/src/**.ts');
      expect(second).toBe(first);
      expect(execCalls.map((call) => call.args)).toEqual([
        ['ls-files'],
        ['ls-files', '*/src/**.ts'],
      ]);
    });

    it('returns a frozen list, so one guard cannot reorder another guard\'s view', () => {
      // The list is shared by every guard in the worker. An in-place `sort()`
      // in one guard would otherwise change the order another guard sees.
      const { tree } = fakes();
      expect(Object.isFrozen(tree.list())).toBe(true);
      expect(() => tree.list().sort()).toThrow(TypeError);
    });
  });

  describe('read', () => {
    it('reads a repo-relative path resolved against the root, once', () => {
      const { tree, readCalls } = fakes();
      expect(tree.read('b/c.md')).toBe(`content of ${resolve(ROOT, 'b/c.md')}`);
      tree.read('b/c.md');
      expect(readCalls).toEqual([resolve(ROOT, 'b/c.md')]);
    });

    it('shares one entry between a relative path and the same absolute path', () => {
      // The readdir-based guards read by absolute path; keying on the
      // resolved path lets them hit the same cache entry.
      const { tree, readCalls } = fakes();
      tree.read('b/c.md');
      tree.read(resolve(ROOT, 'b/c.md'));
      expect(readCalls).toHaveLength(1);
    });

    it('rethrows a read error every time, as readFileSync would, without re-reading', () => {
      // Guards distinguish "tracked but deleted in the working tree" by the
      // throw; a cache that returned undefined instead would change what they
      // report.
      const { tree, readCalls } = fakes();
      expect(() => tree.read('x/missing.ts')).toThrow(/ENOENT/);
      expect(() => tree.read('x/missing.ts')).toThrow(/ENOENT/);
      expect(readCalls).toHaveLength(1);
    });
  });

  it('property: any call sequence spawns once per distinct pathspec list and reads each path once', () => {
    const pathspec = fc.constantFrom('*.md', '*.ts', '*/src/**.ts', '*.test.js');
    const file = fc.constantFrom('a.ts', 'b/c.md', 'x/missing.ts', 'd/e.js');
    const call = fc.oneof(
      fc.record({ kind: fc.constant('list'), specs: fc.array(pathspec, { maxLength: 3 }) }),
      fc.record({ kind: fc.constant('read'), file }),
    );
    fc.assert(
      fc.property(fc.array(call, { maxLength: 30 }), (calls) => {
        const { tree, execCalls, readCalls } = fakes();
        for (const c of calls) {
          if (c.kind === 'list') {
            expect(tree.list(...c.specs)).toEqual(['a.ts', 'b/c.md']);
          } else {
            try {
              tree.read(c.file);
            } catch {
              // the missing file throws on every call; counted below
            }
          }
        }
        const distinctSpecs = new Set(
          calls.filter((c) => c.kind === 'list').map((c) => c.specs.join('\0')),
        );
        const distinctFiles = new Set(
          calls.filter((c) => c.kind === 'read').map((c) => c.file),
        );
        expect(execCalls).toHaveLength(distinctSpecs.size);
        expect(readCalls).toHaveLength(distinctFiles.size);
      }),
    );
  });
});

describe('root vitest config', () => {
  it('shares workers across files (isolate: false), so the memo serves every guard in a worker', async () => {
    // Why this test matters: with isolation on, every test file is a fresh
    // process with an empty memo, and the suite goes back to ~50 worker
    // starts plus one listing and one read per guard. Beside a 3D browser
    // suite that is what failed the gate on timeouts (2026-09-28/30). Turning
    // isolation back on is a legitimate choice, but it must be a visible one.
    const { default: config } = await import('../../vitest.config.js');
    expect(config.test.isolate).toBe(false);
  });
});
