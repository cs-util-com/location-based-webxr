// Repo-meta test: a branch adds no line that carries an internal reference.
//
// Why this test matters: comments, sidecars and tests here were written with
// pointers into the project's private working material - the person who
// decides, decision codes of private plans, work-branch numbers, pull-request
// and review numbers. A public reader can follow none of them, and the habit
// spreads because every new comment copies its neighbour. The publish checks
// never looked for them, so the rule held only as far as someone remembered.
//
// Only ADDED lines are checked: the existing lines (over a thousand files)
// stay as they are, by decision, and the guard stops the count from growing.
// The patterns, their measured false positives and how to fix a hit are in
// `internal-references.js.md`; this file builds every pattern token from
// parts, so it carries no hit of its own.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  addedLines,
  findHits,
  formatHits,
  gitMergeBase,
  isSkippedPath,
  matchLine,
  parseAddedLines,
  resolveBase,
} from './internal-references.js';
import { repoRoot } from './tracked-tree.js';

// Tokens from parts, so these lines are not hits themselves.
const OWNER = ['the', 'owner'].join(' ');
const OWNERS = `${'own'}er's`;
const DEC = (suffix) => `${'DE'}C-${suffix}`;
const BRANCH = (n) => `${'r'}${n}`;
const PR = (n) => `${'P'}R #${n}`;
const REVIEW = (n) => `${'rev'}iew ${BRANCH(n)}`;

describe('matchLine', () => {
  // Why: each pattern must fire on the shapes the backlog actually holds.
  it.each([
    [`// ${OWNER} chose this`, 'owner reference'],
    [`// ${OWNER.toUpperCase()} CHOSE THIS`, 'owner reference'],
    [`* the ${'own'}er’s phone`, 'owner reference'],
    [`* ${OWNERS} report`, 'owner reference'],
    [`(${DEC('PE-10')})`, 'decision code'],
    [`see ${DEC('R12-5')}.`, 'decision code'],
    [`${DEC('W1')}:`, 'decision code'],
    [`since ${BRANCH(1316)}, the strip`, 'work-branch number'],
    [`fixed in ${BRANCH(497)}`, 'work-branch number'],
    [`(${PR(983)} review)`, 'pull-request number'],
    [`dropped (#${983}).`, 'pull-request number'],
    [`(#${42})`, 'pull-request number'],
  ])('flags %j as %s', (line, name) => {
    expect(matchLine(line)).toContain(name);
  });

  it('flags a review pointer, and its branch number with it', () => {
    expect(matchLine(`// (${REVIEW(1149)} #4)`)).toEqual([
      'work-branch number',
      'review reference',
    ]);
  });

  // Why: each negative is a measured false positive on main, or a near miss
  // the patterns must not grow into.
  it.each([
    'three.js r185 (MIT licence)',
    "three r184's dispose",
    `'${BRANCH(943)}-gps-plus-slam.csutil.workers.dev'`,
    'the second case (#1) and (#7)',
    'color: #333; background: #ff0000;',
    'r12 and r99 are too short; xr1316 and r1316x are identifiers',
    'the owners of this file, an ownership rule, owner',
    'DECEMBER, decimal, dec-pe-10, DEC- alone',
    'PR#983 without the space, issue 983',
    'review round 2',
  ])('passes %j', (line) => {
    expect(matchLine(line)).toEqual([]);
  });

  it('skips licence texts, lockfiles, vendored copies and binaries', () => {
    const line = `${OWNER} ${DEC('A1')}`;
    for (const file of [
      'LICENSE',
      'GpsPlusSlamJs_AppFramework/NOTICE',
      'GpsPlusSlamJs_QrTrackingDemo/THIRD_PARTY_NOTICES.md',
      'GpsPlusSlamJs_TourViewer/public/third-party-licenses/three.txt',
      'pnpm-lock.yaml',
      'GpsPlusSlamJs_Globe/src/vendor/plugin.ts',
      'a/b/image.png',
    ]) {
      expect(isSkippedPath(file), file).toBe(true);
      expect(matchLine(line, file), file).toEqual([]);
    }
    expect(matchLine(line, 'GpsPlusSlamJs_Osm/src/a.ts')).toEqual([
      'owner reference',
      'decision code',
    ]);
  });

  it('lets the lock files speak of a lock owner, and nothing else', () => {
    const file = 'scripts/test-timing/gate-lock.mjs';
    expect(matchLine(`// once ${OWNER} is gone`, file)).toEqual([]);
    expect(matchLine(`// (${PR(338)})`, file)).toEqual(['pull-request number']);
  });
});

describe('parseAddedLines', () => {
  // Why: a wrong line number sends the reader to the wrong line, and a
  // misread header could drop or invent a whole file of added lines.
  it('numbers added lines in the new file, across files and hunks', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -3 +3,2 @@ context',
      '-old',
      '+new three',
      '+new four',
      '@@ -10,2 +11 @@',
      '-gone',
      '-gone too',
      '+eleven',
      '\\ No newline at end of file',
      'diff --git a/y.md b/y.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/y.md',
      '@@ -0,0 +1,2 @@',
      '++++ b/looks like a header',
      '+second\r',
      'diff --git a/z.md b/z.md',
      'deleted file mode 100644',
      '--- a/z.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { file: 'x.ts', line: 3, text: 'new three' },
      { file: 'x.ts', line: 4, text: 'new four' },
      { file: 'x.ts', line: 11, text: 'eleven' },
      { file: 'y.md', line: 1, text: '+++ b/looks like a header' },
      { file: 'y.md', line: 2, text: 'second' },
    ]);
  });

  it('counts context lines when the diff carries them', () => {
    const diff = ['+++ b/c.js', '@@ -1,3 +1,4 @@', ' a', '+b', ' c', ' d'].join('\n');
    expect(parseAddedLines(diff)).toEqual([{ file: 'c.js', line: 2, text: 'b' }]);
  });

  it('reads a quoted path', () => {
    const diff = ['+++ "b/with \\"quote\\".md"', '@@ -0,0 +1 @@', '+x'].join('\n');
    expect(parseAddedLines(diff)).toEqual([{ file: 'with "quote".md', line: 1, text: 'x' }]);
  });
});

describe('resolveBase', () => {
  // Why: no base must never read as "nothing to check".
  it("takes CI's fetched base first", () => {
    const result = resolveBase({ env: { E2E_TIER_BASE: 'abc' }, mergeBaseWith: () => 'zzz' });
    expect(result).toEqual({ base: 'abc', source: 'E2E_TIER_BASE' });
  });

  it('falls back to the merge base with the first main line that has one', () => {
    const tried = [];
    const result = resolveBase({
      env: {},
      mergeBaseWith: (line) => {
        tried.push(line);
        return line === 'origin/main' ? 'def' : null;
      },
    });
    expect(result.base).toBe('def');
    expect(tried).toEqual(['origin2/main', 'origin/main']);
  });

  it('names why there is no base, in CI and locally', () => {
    const ci = resolveBase({ env: { GITHUB_ACTIONS: 'true' }, mergeBaseWith: () => null });
    expect(ci.base).toBeNull();
    expect(ci.reason).toMatch(/push to main/);
    const local = resolveBase({ env: {}, mergeBaseWith: () => null });
    expect(local.reason).toMatch(/origin2\/main, origin\/main, main/);
  });
});

describe('formatHits', () => {
  it('names file, line and pattern, never the line, and says what to do', () => {
    const message = formatHits([{ file: 'a.ts', line: 7, names: ['decision code'] }]);
    expect(message).toContain('a.ts:7 - decision code');
    expect(message).toContain('Say what the rule means in plain words, or point at a public file.');
  });
});

describe('addedLines on a throwaway repository', () => {
  // Why: the end-to-end proof with an injected base - a committed line, an
  // uncommitted edit and an untracked file are each seen, a moved file adds
  // nothing, and the base's own lines are never read. Built in a temp
  // directory so the real tree is never written to.
  it('finds what the branch adds and nothing the base had', () => {
    const dir = mkdtempSync(join(tmpdir(), 'internal-refs-'));
    const git = (...args) =>
      execFileSync(
        'git',
        [
          '-c',
          'user.email=t@example.com',
          '-c',
          'user.name=t',
          '-c',
          'core.autocrlf=false',
          ...args,
        ],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      ).trim();
    try {
      git('init', '-q', '-b', 'main');
      writeFileSync(join(dir, 'old.md'), `kept: ${OWNER} said so\n`);
      writeFileSync(join(dir, 'moved.md'), `moved: ${DEC('Q1')}\nline two\nline three\n`);
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      git('mv', 'moved.md', 'renamed.md');
      writeFileSync(
        join(dir, 'old.md'),
        `kept: ${OWNER} said so\nclean line\nsince ${BRANCH(1320)}\n`,
      );
      git('add', '.');
      git('commit', '-q', '-m', 'branch');
      writeFileSync(join(dir, 'new.md'), `first\n(${PR(983)})\n`);

      expect(gitMergeBase(dir)('main')).toBe(git('rev-parse', 'HEAD'));
      const hits = findHits(addedLines(dir, base));
      expect(hits).toEqual([
        { file: 'old.md', line: 3, names: ['work-branch number'] },
        { file: 'new.md', line: 2, names: ['pull-request number'] },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the branch', () => {
  const resolved = resolveBase({ env: process.env, mergeBaseWith: gitMergeBase(repoRoot) });

  if (resolved.base === null) {
    // Loud and named: a skipped guard must never look like a clean one.
    process.stderr.write(`internal-references: SKIPPED - ${resolved.reason}\n`);
    it.skip(`adds no internal reference (SKIPPED: ${resolved.reason})`, () => {});
  } else {
    const { base, source } = resolved;
    it('adds no internal reference', () => {
      const lines = addedLines(repoRoot, base);
      const hits = findHits(lines);
      // The evidence line a CI log is read for: which base, how much read.
      // On stderr, because the runner does not print a passing test's
      // console output.
      process.stderr.write(
        `internal-references: diffing against ${base} (${source}): ${lines.length} added lines, ${hits.length} hits\n`,
      );
      expect(hits, formatHits(hits)).toEqual([]);
    }, 30_000);
  }
});
