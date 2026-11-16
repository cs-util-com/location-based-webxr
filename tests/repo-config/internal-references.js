// The line matcher and the diff reader behind `internal-references.test.js`:
// which lines a branch ADDS, and which of them carry a reference into the
// project's private working material (a person who decides, a decision code,
// a work-branch number, a pull-request or review number). The why, the
// measured false positives and how to fix a hit are in the sidecar,
// `internal-references.js.md`.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { TIER_BASE_ENV } from '../../scripts/e2e/tier.mjs';
import { firstMergeBase, MAIN_LINES } from '../../scripts/test-changed/select.mjs';

/**
 * @typedef {{
 *   name: string,
 *   regex: RegExp,
 *   skipPath?: RegExp,
 * }} Pattern
 */

/**
 * The reviewed list. Each regex is non-global (only `.test` is used, so no
 * `lastIndex` state leaks between lines). Built from string parts where a
 * literal would itself be a hit in this file's own added lines.
 *
 * @type {readonly Pattern[]}
 */
const PATTERNS = Object.freeze([
  {
    // A person who decides: a public reader cannot ask them, and the line
    // should state the rule itself. Case-insensitive, word-bounded; the
    // typographic apostrophe too. The two lock files say it of a lock's
    // process (the measured false positives), so they are skipped for this
    // pattern only.
    name: 'owner reference',
    regex: new RegExp(`\\b(?:the\\s+${'own'}er|${'own'}er['’]s)\\b`, 'i'),
    skipPath: /^scripts\/test-timing\/(?:gate-lock|run-gate)\.[^/]*$/,
  },
  {
    // A decision code of a private plan: the document that defines it is not
    // in this repository. Case-sensitive, like the codes themselves.
    name: 'decision code',
    regex: new RegExp(`\\b${'DE'}C-[A-Z0-9]+(?:-\\d+)?\\b`),
  },
  {
    // A work-branch number as a word. From 300 up: three.js names its
    // releases the same way and is at the 180s, which were every false
    // positive measured. A preview host name (the number followed by the
    // site's name) is a URL in test data, not a pointer to history.
    name: 'work-branch number',
    regex: /\br(?:[3-9]\d\d|\d{4})\b(?!-gps-plus-slam)/,
  },
  {
    // A pull-request number: the PR's discussion is not the code's
    // documentation. The bare parenthesised form needs two digits or more,
    // because one digit is an item of a numbered list in the same comment.
    name: 'pull-request number',
    regex: new RegExp(`\\b${'P'}R #\\d+\\b|\\(#\\d{2,}\\)`),
  },
  {
    // A pointer to a review round of a work branch.
    name: 'review reference',
    regex: new RegExp(`\\b${'rev'}iew r\\d+\\b`, 'i'),
  },
]);

/**
 * Paths no pattern reads: third-party and licence texts (their words are not
 * ours to change), lockfiles, vendored copies and binary files.
 */
const SKIPPED_PATHS = [
  /(?:^|\/)(?:LICEN[CS]E|NOTICE|COPYING|THIRD[_-]PARTY[^/]*)(?:\.[^/]*)?$/i,
  /(?:^|\/)third-party-licenses\//,
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/,
  /(?:^|\/)vendor\//,
  /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|glb|gltf|bin|ktx2|hdr|exr|zip|gz|br|pdf|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|pbf|mvt|wasm|onnx)$/i,
];

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * @param {string} file repo-relative, forward slashes
 * @returns {boolean} true when no pattern reads this path
 */
export function isSkippedPath(file) {
  return SKIPPED_PATHS.some((re) => re.test(file));
}

/**
 * The names of the patterns `text` matches, in list order; empty for a clean
 * line or a skipped path.
 *
 * @param {string} text one line, without its line break
 * @param {string} [file] repo-relative path, for the path rules
 * @returns {string[]}
 */
export function matchLine(text, file = '') {
  if (file && isSkippedPath(file)) return [];
  return PATTERNS.filter((p) => !(file && p.skipPath?.test(file)) && p.regex.test(text)).map(
    (p) => p.name,
  );
}

/**
 * @typedef {{ file: string, line: number, text: string }} AddedLine
 */

/** @param {string} raw a path from a `+++ ` header, prefix included */
function headerPath(raw) {
  let path = raw.replace(/\t.*$/, '');
  if (path.startsWith('"') && path.endsWith('"')) path = JSON.parse(path);
  return path === '/dev/null' ? null : path.replace(/^b\//, '');
}

/**
 * The added lines of a unified diff (any context size), with their line
 * numbers in the new file. Hunk lengths decide what is content, so an added
 * line that itself starts with `+++ ` is read as content, not as a header.
 *
 * @param {string} diff output of `git diff --src-prefix=a/ --dst-prefix=b/`
 * @returns {AddedLine[]}
 */
export function parseAddedLines(diff) {
  /** @type {AddedLine[]} */
  const added = [];
  /** @type {string | null} */
  let file = null;
  let oldLeft = 0;
  let newLeft = 0;
  let lineNo = 0;
  for (const rawLine of diff.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (oldLeft > 0 || newLeft > 0) {
      if (line.startsWith('+')) {
        if (file !== null) added.push({ file, line: lineNo, text: line.slice(1) });
        lineNo += 1;
        newLeft -= 1;
      } else if (line.startsWith('-')) {
        oldLeft -= 1;
      } else if (line.startsWith(' ') || line === '') {
        lineNo += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      // `\ No newline at end of file` counts for neither side.
      continue;
    }
    if (line.startsWith('+++ ')) {
      file = headerPath(line.slice(4));
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1]);
      lineNo = Number(hunk[2]);
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3]);
    }
  }
  return added;
}

/**
 * @typedef {{ base: string, source: string } | { base: null, reason: string }} BaseResult
 */

/**
 * The commit the branch's added lines are counted against. CI's fetched base
 * (`E2E_TIER_BASE`: the pull request's base, or a dispatch's merge base with
 * main) wins; locally, the merge base with the first main line that exists.
 * Never a silent "nothing to check": no base is a reason, which the guard
 * reports as a named skip.
 *
 * @param {{ env: Record<string, string | undefined>, mergeBaseWith: (mainLine: string) => string | null }} input
 * @returns {BaseResult}
 */
export function resolveBase({ env, mergeBaseWith }) {
  const fromEnv = env[TIER_BASE_ENV];
  if (fromEnv) return { base: fromEnv, source: TIER_BASE_ENV };
  const merged = firstMergeBase(mergeBaseWith);
  if (merged) return { base: merged, source: `merge base with ${MAIN_LINES.join(' / ')}` };
  return {
    base: null,
    reason: env.GITHUB_ACTIONS
      ? `no ${TIER_BASE_ENV} in this CI run (a push to main, whose lines were checked on their pull request) and the shallow checkout has no main line`
      : `no ${TIER_BASE_ENV} and no merge base with any of ${MAIN_LINES.join(', ')}`,
  };
}

/**
 * `git merge-base HEAD <mainLine>` in `root`, or null.
 *
 * @param {string} root
 * @returns {(mainLine: string) => string | null}
 */
export function gitMergeBase(root) {
  return (mainLine) => {
    try {
      return (
        execFileSync('git', ['merge-base', 'HEAD', mainLine], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null
      );
    } catch {
      return null;
    }
  };
}

/**
 * Every line the working tree adds against `base`: the tracked diff (renames
 * followed, so a moved file adds nothing) plus every line of each untracked,
 * not-ignored file, which `git diff` never lists.
 *
 * @param {string} root
 * @param {string} base a commit or ref
 * @returns {AddedLine[]}
 * @throws when git cannot diff against `base`
 */
export function addedLines(root, base) {
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  const diff = git([
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--unified=0',
    '--find-renames',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    base,
    '--',
  ]);
  const added = parseAddedLines(diff);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter((file) => file !== '' && !isSkippedPath(file));
  for (const file of untracked) {
    const absolute = resolve(root, file);
    if (statSync(absolute).size > MAX_BYTES) continue;
    const text = readFileSync(absolute, 'utf8');
    if (text.includes('\0')) continue;
    text.split('\n').forEach((raw, i) => {
      added.push({ file, line: i + 1, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw });
    });
  }
  return added;
}

/**
 * @typedef {{ file: string, line: number, names: string[] }} Hit
 */

/**
 * @param {readonly AddedLine[]} lines
 * @returns {Hit[]}
 */
export function findHits(lines) {
  /** @type {Hit[]} */
  const hits = [];
  for (const { file, line, text } of lines) {
    const names = matchLine(text, file);
    if (names.length > 0) hits.push({ file, line, names });
  }
  return hits;
}

/**
 * The failure message: file, line and pattern name per hit, never the line
 * itself, then what to write instead.
 *
 * @param {readonly Hit[]} hits
 * @returns {string}
 */
export function formatHits(hits) {
  return [
    `${hits.length} added line(s) carry an internal reference:`,
    ...hits.map((h) => `  ${h.file}:${h.line} - ${h.names.join(', ')}`),
    'Say what the rule means in plain words, or point at a public file.',
    'See tests/repo-config/internal-references.js.md.',
  ].join('\n');
}
