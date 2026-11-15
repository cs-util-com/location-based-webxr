// Repo-meta test: no decision codes from private planning documents in this
// public repository.
//
// Why this test matters: plans kept outside this repository number their
// decisions (a code of the form DEC-<letters/digits>, optionally with further
// dash-separated parts). Those codes were copied into public comments, sidecars
// and tests as shorthand, where they mean nothing to a reader of this
// repository: the document that defines them is not here. A comment that
// cites a code instead of stating the rule tells the reader nothing, and the
// habit spreads because every new comment copies its neighbour.
//
// Two checks, because the backlog is not cleared yet:
//
//  - RETIRED codes must never appear again. A code is retired when every use
//    of it has been rewritten in plain words. The first one retired was the
//    shared-helper rule's code; its deliberate copies now carry the plain
//    marker "deliberate copy (shared-helper rule" instead, so they stay one
//    search away (`duplicate-helpers.test.js` names it).
//  - Every other code is counted, and the count must equal BACKLOG exactly. A
//    new code anywhere raises the count and fails; a rewrite lowers it and
//    fails until BACKLOG is lowered with it, so the ceiling can only fall.
//    This is a single number, not a list of permitted sites.
//
// Unlike most guards here, the listing includes UNTRACKED files
// (`git ls-files --cached --others --exclude-standard`): a guard that reads
// only `git ls-files` cannot see a new file before it is staged, which is
// exactly where a new code would arrive. Gitignored paths (node_modules,
// build output, local timing tables) stay out.
//
// Limits: it matches the DEC- form only. Shorter plan labels (milestone and
// review numbers such as M5a or R14) are too generic to match without
// flagging ordinary identifiers, so they are not guarded. Binary files and
// files over 2 MiB are not read.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { readTracked, repoRoot } from './tracked-tree.js';

/** Codes rewritten in plain words everywhere; each must stay at zero. */
const RETIRED = ['H3'].map((suffix) => `DEC-${suffix}`);

/**
 * The exact number of remaining code occurrences. Lower it when a rewrite
 * removes some; never raise it - write the rule in plain words instead.
 */
const BACKLOG = 2930;

/** A decision code: DEC- followed by dash-separated letter/digit parts. */
const CODE = /\bDEC-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/g;

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|bmp|glb|gltf|bin|ktx2|hdr|exr|zip|gz|br|pdf|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|pbf|mvt|wasm|onnx)$/i;
const MAX_BYTES = 2 * 1024 * 1024;

/** Every decision code in `text`, in order. */
export function findDecisionCodes(text) {
  return text.match(CODE) ?? [];
}

/**
 * Tracked plus untracked, not-ignored files under `root`, repo-relative.
 *
 * @param {string} root
 */
export function listPublicFiles(root) {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((line) => line !== '');
}

/**
 * Every code occurrence in the readable text files of `files`.
 *
 * @param {readonly string[]} files repo-relative paths
 * @param {string} root
 * @param {(path: string) => string} read
 * @returns {{ file: string, code: string }[]}
 */
export function scanForCodes(files, root, read) {
  const hits = [];
  for (const file of files) {
    if (BINARY.test(file)) continue;
    const absolute = resolve(root, file);
    // A tracked file deleted but not yet staged is still listed.
    if (!existsSync(absolute)) continue;
    if (statSync(absolute).size > MAX_BYTES) continue;
    const text = read(file);
    if (text.includes('\0')) continue;
    for (const code of findDecisionCodes(text)) hits.push({ file, code });
  }
  return hits;
}

describe('decision-code guard', () => {
  // Built from parts so this file carries no code of its own.
  const code = (suffix) => `DEC-${suffix}`;

  describe('findDecisionCodes', () => {
    it('finds every code shape the plans use', () => {
      const text = `(${code('H3')}) and ${code('R4-5')}; ${code('GL5-11')}, ${code('SUN-7')}'s, ${code('3')}.`;
      expect(findDecisionCodes(text)).toEqual([
        code('H3'),
        code('R4-5'),
        code('GL5-11'),
        code('SUN-7'),
        code('3'),
      ]);
    });

    it('does not match words that merely start the same way', () => {
      // A code needs the dash and an upper-case part right after it.
      expect(findDecisionCodes('DECEMBER, decimal, DEC- alone, dec-h3, xDEC-H3')).toEqual([]);
    });
  });

  describe('listPublicFiles', () => {
    // The point of this guard over its siblings: a NEW file is seen before it
    // is staged. Proven on a throwaway repository, so the real tree is never
    // written to (the root config runs guards with isolation off).
    it('lists an untracked file and leaves an ignored one out', () => {
      const dir = mkdtempSync(join(tmpdir(), 'decision-codes-'));
      try {
        execFileSync('git', ['init', '-q'], { cwd: dir });
        writeFileSync(join(dir, '.gitignore'), 'ignored.md\n');
        writeFileSync(join(dir, 'new.md'), `see ${code('H3')}\n`);
        writeFileSync(join(dir, 'ignored.md'), `see ${code('H3')}\n`);

        const files = listPublicFiles(dir);
        expect(files).toContain('new.md');
        expect(files).not.toContain('ignored.md');
        const read = (file) => readTracked(join(dir, file));
        expect(scanForCodes(files, dir, read)).toEqual([{ file: 'new.md', code: code('H3') }]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('the tree', () => {
    /** @type {{ file: string, code: string }[]} */
    let hits;
    beforeAll(() => {
      hits = scanForCodes(listPublicFiles(repoRoot), repoRoot, readTracked);
    });

    it('carries no retired code', () => {
      // A non-empty result names the file: state the rule in plain words. For
      // a copy kept on purpose, use the marker named in the header.
      const retired = hits.filter((h) => RETIRED.includes(h.code)).map((h) => `${h.code} @ ${h.file}`);
      expect(retired).toEqual([]);
    });

    it('carries exactly the counted backlog of other codes', () => {
      // Above BACKLOG: a new code was added - write the rule in plain words.
      // Below BACKLOG: a rewrite removed some - lower BACKLOG to the new count.
      expect(hits.length).toBe(BACKLOG);
    });
  });
});
