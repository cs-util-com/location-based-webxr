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
  gitHead,
  gitMergeBase,
  isSkippedPath,
  matchLine,
  parseAddedLines,
  resolveBase,
} from './internal-references.js';
import { repoRoot } from './tracked-tree.js';

// Tokens from parts, so these lines are not hits themselves. Every number
// and code is made up: none names a real branch, pull request or decision.
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
    // Only the ungated possessive matches this one: nothing stands before
    // it and no decision noun follows, so dropping that alternative fails it.
    [`${OWNERS} phone`, 'owner reference'],
    [`// ${'own'}er decision 2099-01-01`, 'owner reference'],
    [`* (${'Own'}er feedback - a sharper map)`, 'owner reference'],
    [`the ${'own'}er pick, the ${'own'}er verdict`, 'owner reference'],
    [`// ${'own'}er chose the fold`, 'owner reference'],
    [`// ${'own'}er asked for it`, 'owner reference'],
    ...['question', 'request', 'approval', 'interview', 'decided', 'wants', 'approved'].map(
      (word) => [`// ${'own'}er ${word} here`, 'owner reference'],
    ),
    ...['decisions', 'report', 'rule', 'taste', 'default', 'bug', 'reported'].map((word) => [
      `// (${'own'}er ${word} 2099-01-01)`,
      'owner reference',
    ]),
    // A possessive after another word is a hit when a decision noun follows.
    [`the repo ${'own'}er's decision on the XY fold`, 'owner reference'],
    [`the project ${'own'}er’s call`, 'owner reference'],
    [`per the AR ${'own'}er's request`, 'owner reference'],
    [`a site ${'own'}er's rule`, 'owner reference'],
    [['den', 'Eigentümern'].join(' '), 'owner reference'],
    [['die', 'Eigentümerinnen'].join(' '), 'owner reference'],
    [['der', 'Eigentuemerin'].join(' '), 'owner reference'],
    [['laut der', 'Eigentümerin'].join(' '), 'owner reference'],
    [`(${DEC('XY-1')})`, 'decision code'],
    [`see ${DEC('XY7-2')}.`, 'decision code'],
    [`${DEC('XY')}:`, 'decision code'],
    [`since ${BRANCH(4242)}, the strip`, 'work-branch number'],
    [`(${PR(4242)} review)`, 'pull-request number'],
    [`${'P'}R#4242 without the space`, 'pull-request number'],
    [`see ${'p'}r #4242`, 'pull-request number'],
    [`dropped (#${4242}).`, 'pull-request number'],
    [`three rounds (#${4242}, #${4243})`, 'pull-request number'],
    [`the #${4242} review found it`, 'pull-request number'],
    [`the #${4242}'s review found it`, 'pull-request number'],
    [`see ${'pull'}/4242`, 'pull-request number'],
    [`github.com/cs-util-com/location-based-webxr/${'pull'}/4242`, 'pull-request number'],
    [`github.com/cs-util-com/gps-plus-slam/${'pull'}/4242`, 'pull-request number'],
    [`${'P'}Rs #4242/#4243`, 'pull-request number'],
    [`the #${4242} cold review`, 'pull-request number'],
    [`the #${4242}’s review`, 'pull-request number'],
    [`${'pull'} request #4242`, 'pull-request number'],
    [`two rounds (#${4242} and #${4243})`, 'pull-request number'],
    // A grey first shields nothing: the pair is skipped only when both are.
    [`two rounds (#${333} and #${334})`, 'pull-request number'],
    [`two rounds (#${333} and #${4243})`, 'pull-request number'],
    [`dropped (see #${4242}).`, 'pull-request number'],
    [`Raised in review on #${4242}.`, 'pull-request number'],
    [`found by a review bot on #${4242}`, 'pull-request number'],
    [`a repeated number (#${4444}) is a number`, 'pull-request number'],
  ])('flags %j as %s', (line, name) => {
    expect(matchLine(line)).toContain(name);
  });

  // Why: these are colours, yet they are flagged, and the sidecar names them
  // as the accepted cost of the parenthesised form. Pinned on their own so a
  // change that starts letting them through is a visible decision, not a
  // side effect: a decimal-only colour with alpha, and a short decimal-only
  // colour that is no grey (with a leading zero, so the example cannot be
  // read as a real pull-request number).
  it.each([`a colour with alpha (#${4248})`, `a short colour (#0${12})`])(
    'flags the decimal-only colour %j, an accepted false positive',
    (line) => {
      expect(matchLine(line)).toEqual(['pull-request number']);
    },
  );

  it('flags a review pointer, and its branch number with it', () => {
    expect(matchLine(`// (${REVIEW(4242)} #4)`)).toEqual([
      'work-branch number',
      'review reference',
    ]);
  });

  // Why: each negative is a measured false positive on main, or a near miss
  // the patterns must not grow into.
  it.each([
    'three.js r185 (MIT licence)',
    "three r184's dispose",
    `'${BRANCH(4242)}-gps-plus-slam.csutil.workers.dev'`,
    'the second case (#1) and (#7)',
    'color: #333; background: #ff0000;',
    'a grey (#333), black (#000), white (#000000), mid grey (#808080)',
    'a pair of greys (#333 and #000), (#333, #000)',
    'the hole (#171b26) and (#ff6b6b), a list item (#1, #2)',
    'r7 and r42 are too short; xr4242 and r4242x are identifiers',
    'the owners of this file, an ownership rule, owner',
    'a lock owner, the file owner callback, an owner reference, owner decisionsX',
    'maintained by the company (the "Project Owner"), the copyright owner',
    "the Project Owner's rights, the copyright owner’s licence, a dead owner's lock",
    "a dead owner's record, the file owner's process, an owner's decisionsX",
    'Bewohner und Eigentümer dieses Hauses',
    'DECEMBER, decimal, dec-xy-1, DEC- alone',
    'issue 4242, #4242 alone, a review of #4242',
    'upstream github.com/mrdoob/three.js/pull/4242 and pullback/4242',
    'review round 2',
  ])('passes %j', (line) => {
    expect(matchLine(line)).toEqual([]);
  });

  it('skips licence texts, lockfiles, vendored copies and binaries', () => {
    const line = `${OWNER} ${DEC('XY-3')}`;
    for (const file of [
      'LICENSE',
      'GpsPlusSlamJs_AppFramework/NOTICE',
      'GpsPlusSlamJs_QrTrackingDemo/THIRD_PARTY_NOTICES.md',
      'GpsPlusSlamJs_TourViewer/public/third-party-licenses/three.txt',
      'pnpm-lock.yaml',
      'a/b/image.png',
    ]) {
      expect(isSkippedPath(file), file).toBe(true);
      expect(matchLine(line, file), file).toEqual([]);
    }
    for (const file of [
      'GpsPlusSlamJs_Osm/src/a.ts',
      // Project-written code in a folder named vendor is read.
      'GpsPlusSlamJs_Globe/src/vendor/plugin.ts.md',
      // Only the exact upper-case licence names are skipped.
      'src/ui/notice.ts',
      'src/LICENSE.ts',
      'docs/License',
    ]) {
      expect(isSkippedPath(file), file).toBe(false);
      expect(matchLine(line, file), file).toEqual(['owner reference', 'decision code']);
    }
  });

  it('lets the lock files speak of a lock owner, and nothing else', () => {
    const file = 'scripts/test-timing/gate-lock.mjs';
    expect(matchLine(`// once ${OWNER} is gone`, file)).toEqual([]);
    expect(matchLine(`// (${PR(4243)})`, file)).toEqual(['pull-request number']);
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
    expect(ci.reason).toMatch(/shallow checkout has no main line/);
    const local = resolveBase({ env: {}, mergeBaseWith: () => null });
    expect(local.reason).toMatch(/origin2\/main, origin\/main, main/);
  });

  // Why: on a push to main the checkout's main ref is HEAD, so the merge
  // base is HEAD and the diff is empty; a pass there would check nothing.
  it('skips by name in CI when the base is HEAD itself', () => {
    const head = 'a'.repeat(40);
    const merged = resolveBase({
      env: { GITHUB_ACTIONS: 'true' },
      mergeBaseWith: () => head,
      head,
    });
    expect(merged.base).toBeNull();
    expect(merged.reason).toMatch(/is HEAD itself in this CI run/);
    expect(merged.reason).toMatch(/a push to main or a dispatch on it/);
    const fromEnv = resolveBase({
      env: { GITHUB_ACTIONS: 'true', E2E_TIER_BASE: head },
      mergeBaseWith: () => null,
      head,
    });
    expect(fromEnv.base).toBeNull();
    expect(fromEnv.reason).toMatch(/E2E_TIER_BASE/);
  });

  // Why: in CI an unreadable HEAD would hide the case above, and the guard
  // would pass on an empty diff instead of saying it checked nothing.
  it('skips by name in CI when HEAD cannot be read', () => {
    const result = resolveBase({
      env: { GITHUB_ACTIONS: 'true' },
      mergeBaseWith: () => 'b'.repeat(40),
      head: null,
    });
    expect(result.base).toBeNull();
    expect(result.reason).toMatch(/HEAD could not be read/);
    expect(resolveBase({ env: {}, mergeBaseWith: () => 'c', head: null }).base).toBe('c');
  });

  it('keeps a base equal to HEAD outside CI, and another base in CI', () => {
    const head = 'a'.repeat(40);
    expect(resolveBase({ env: {}, mergeBaseWith: () => head, head }).base).toBe(head);
    const other = 'b'.repeat(40);
    const ci = resolveBase({ env: { GITHUB_ACTIONS: 'true' }, mergeBaseWith: () => other, head });
    expect(ci.base).toBe(other);
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
          // A developer's global config must not break the throwaway repo.
          '-c',
          'commit.gpgsign=false',
          '-c',
          `core.hooksPath=${join(dir, 'no-hooks')}`,
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
      writeFileSync(join(dir, 'moved.md'), `moved: ${DEC('XY-4')}\nline two\nline three\n`);
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');

      git('mv', 'moved.md', 'renamed.md');
      writeFileSync(
        join(dir, 'old.md'),
        `kept: ${OWNER} said so\nclean line\nsince ${BRANCH(4242)}\n`,
      );
      git('add', '.');
      git('commit', '-q', '-m', 'branch');
      writeFileSync(join(dir, 'new.md'), `first\n(${PR(4243)})\n`);

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
  const resolved = resolveBase({
    env: process.env,
    mergeBaseWith: gitMergeBase(repoRoot),
    head: gitHead(repoRoot),
  });

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
