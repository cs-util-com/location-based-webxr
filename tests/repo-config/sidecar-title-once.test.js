// Repo-meta test: a sidecar's `# ` title line appears once.
//
// Why this test matters: PR #877 merged two sidecars whose whole preamble was
// spliced into the middle of a sentence. A scripted edit had passed the text
// "`$`, a backtick" through `String.replace`, where `` $` `` expands to "the
// input before the match", so the file's own title, purpose and API block
// reappeared inside its Invariants section. Only the bots noticed. A repeated
// title line is the fingerprint of that splice, and it costs nothing to check.

import { describe, it, expect } from 'vitest';

import { readTracked, trackedFiles } from './tracked-tree.js';

/**
 * The splice lands mid-line ("a file name with `# a.mjs - ..."), so the title
 * is searched for anywhere after itself, not only as a whole line.
 * @param {string} text @returns {boolean} the first line is a `# ` title that recurs
 */
export function repeatsTitle(text) {
  const title = text.split(/\r?\n/, 1)[0];
  return title.startsWith('# ') && text.indexOf(title, title.length) !== -1;
}

describe('sidecar title appears once', () => {
  it('detects the splice fingerprint, and only that', () => {
    expect(repeatsTitle('# a.mjs - x\n\n- Purpose: y\n# a.mjs - x\n')).toBe(true);
    expect(repeatsTitle('# a.mjs - x\n\n- runs with `# a.mjs - x\n- more\n')).toBe(true);
    expect(repeatsTitle('# a.mjs - x\n\n- Purpose: see a.mjs\n')).toBe(false);
    expect(repeatsTitle('no title\nno title\n')).toBe(false);
  });

  it('holds for every tracked sidecar', () => {
    const sidecars = trackedFiles('*.ts.md', '*.tsx.md', '*.js.md', '*.mjs.md', '*.cjs.md');
    expect(sidecars.length).toBeGreaterThan(100);
    const bad = sidecars.filter((file) => {
      try {
        return repeatsTitle(readTracked(file));
      } catch {
        return false; // tracked but deleted in the working tree
      }
    });
    expect(bad).toEqual([]);
  });
});
