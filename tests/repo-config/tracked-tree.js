// Shared, memoised view of the tracked tree for the repo-config guards.
//
// Why this exists: about ten guards each ran their own `git ls-files` (some
// several times, from inside each test) and read the same few thousand files
// again and again. Under machine load that repeated work, not any assertion,
// failed the suite: with a headless-Chromium 3D suite beside it, starting a
// process took 0.4-3.6 s instead of ~0.1 s and reading ~1 700 files took
// seconds, so guards blew vitest's 5 s timeout at random (load findings
// 2026-09-28; follow-up 2026-09-28-1913). The fix is to do each piece of work
// once per worker, never to raise a timeout.
//
// What it keeps IDENTICAL, on purpose:
//
//  - **The file set.** `list(...pathspecs)` runs the very same
//    `git ls-files <pathspecs>` the guards ran before, with the pathspecs
//    passed through verbatim. Git's pathspec semantics (in `*/src/**.ts` the
//    `*` crosses `/`) are NOT re-implemented in JavaScript, so there is no
//    second matcher to drift from the first.
//  - **Tracked files only.** A new, untracked file is still invisible to every
//    guard that lists through here, exactly as before (see
//    `duplicate-helpers.test.js`, "An UNTRACKED file is invisible", and the
//    2026-09-23 follow-up on guards blind to new files). This helper does not
//    change that property and must not quietly "fix" it.
//  - **Read errors.** `read(path)` throws what `readFileSync` threw, on every
//    call, so a guard's "tracked but deleted in the working tree" handling
//    sees the same thing it saw before.
//
// Tried and dropped (2026-09-30): filling the cache with parallel async reads.
// It saved ~1 s of wall time on a quiet machine and showed no gain beside a
// sustained 3D suite (15, 2, 14, 20, 26 timeouts against 11, 3, 19, 8, 7
// without it), so the helper stays synchronous.
//
// Memo lifetime: one module instance. Under the root vitest config's
// `isolate: false` that is one worker for one run (vitest stops the shared
// workers when its queue empties, so a watch-mode rerun starts with a fresh
// memo); with isolation on it would be one test file. Nothing here is written
// back to disk, and no guard writes to the tree, so a snapshot per worker per
// run is exact.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A memoised tracked-tree view over injected I/O (injected so the memo can be
 * tested without spawning git or touching the disk).
 *
 * @param {{
 *   root: string,
 *   exec: (args: string[], cwd: string) => string,
 *   read: (absolutePath: string) => string,
 * }} io
 */
export function createTrackedTree({ root, exec, read }) {
  /** @type {Map<string, readonly string[]>} */
  const listings = new Map();
  /** @type {Map<string, { text: string } | { error: unknown }>} */
  const texts = new Map();

  return {
    /**
     * `git ls-files <pathspecs>` at the root, as a frozen array of paths.
     * Frozen because every guard in the worker shares it: an in-place
     * `sort()` in one guard must throw, not reorder another guard's view.
     *
     * @param {...string} pathspecs
     * @returns {readonly string[]}
     */
    list(...pathspecs) {
      const key = pathspecs.join('\0');
      let files = listings.get(key);
      if (files === undefined) {
        files = Object.freeze(
          exec(['ls-files', ...pathspecs], root)
            .split('\n')
            .filter((line) => line !== '')
        );
        listings.set(key, files);
      }
      return files;
    },

    /**
     * The UTF-8 text of `path` (repo-relative, or absolute), read once.
     * Keyed by the resolved absolute path, so a relative and an absolute
     * spelling of the same file share one entry.
     *
     * @param {string} path
     * @returns {string}
     */
    read(path) {
      const absolute = resolve(root, path);
      let entry = texts.get(absolute);
      if (entry === undefined) {
        try {
          entry = { text: read(absolute) };
        } catch (error) {
          entry = { error };
        }
        texts.set(absolute, entry);
      }
      if ('error' in entry) throw entry.error;
      return entry.text;
    },
  };
}

const tree = createTrackedTree({
  root: repoRoot,
  exec: (args, cwd) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      // The largest buffer any guard used before; the full listing is ~0.2 MB.
      maxBuffer: 64 * 1024 * 1024,
    }),
  read: (absolutePath) => readFileSync(absolutePath, 'utf8'),
});

/**
 * Tracked paths (repo-relative, forward slashes), optionally narrowed by git
 * pathspecs. One `git ls-files` per distinct pathspec list per worker.
 *
 * @param {...string} pathspecs
 * @returns {readonly string[]}
 */
export const trackedFiles = (...pathspecs) => tree.list(...pathspecs);

/**
 * `readFileSync(resolve(repoRoot, path), 'utf8')`, memoised per worker,
 * rethrowing the same error when the read failed.
 *
 * @param {string} path
 * @returns {string}
 */
export const readTracked = (path) => tree.read(path);
