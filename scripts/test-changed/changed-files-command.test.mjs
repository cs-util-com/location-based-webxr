// Why this test matters: in the per-commit fast gate a package's format and
// lint stages check only the files the commit changed, by rewriting the
// stage's own command. A rewrite that widens the scope formats files the
// stage never owned; one that drops a target silently leaves a changed file
// unchecked; one that misreads an option's value as a target does both. So
// every target kind, every option kind and every fallback is pinned here.
import { describe, it, expect } from 'vitest';
import { narrowCommand, splitCommand } from './changed-files-command.mjs';

const PRETTIER =
  'prettier --log-level warn --write --cache --cache-strategy content --ignore-unknown --no-error-on-unmatched-pattern "src" "config" "*.html" README.md package.json';
const ESLINT = 'eslint . --config config/eslint.config.mjs --max-warnings 37 --concurrency auto';

describe('splitCommand', () => {
  it('splits on spaces and keeps a double-quoted word whole, without its quotes', () => {
    expect(splitCommand('eslint "labs/globe/*.js" --config a.mjs')).toEqual([
      'eslint',
      'labs/globe/*.js',
      '--config',
      'a.mjs',
    ]);
  });
});

describe('narrowCommand: prettier', () => {
  it('formats only the changed files inside the stage targets (folder, glob, file)', () => {
    const r = narrowCommand(PRETTIER, ['src/a.ts', 'index.html', 'README.md', 'public/x.css', 'docs/n.md']);
    expect(r).toEqual({
      mode: 'files',
      files: ['README.md', 'index.html', 'src/a.ts'],
      command:
        'prettier --log-level warn --write --cache --cache-strategy content --ignore-unknown --no-error-on-unmatched-pattern "README.md" "index.html" "src/a.ts"',
    });
  });

  it('a glob does not cross folders: "*.html" owns index.html, not src/page.html', () => {
    expect(narrowCommand(PRETTIER, ['sub/page.html'])).toEqual({
      mode: 'skip',
      reason: 'no changed file is in this stage',
    });
  });

  it('does not read an option value as a target', () => {
    // `content` (the value of --cache-strategy) is no folder of the stage.
    expect(narrowCommand(PRETTIER, ['content/a.ts']).mode).toBe('skip');
  });

  it('runs whole without --ignore-unknown (a file prettier cannot parse would fail)', () => {
    expect(narrowCommand('prettier --write "src"', ['src/a.ts'])).toEqual({
      mode: 'full',
      reason: 'the command has no --ignore-unknown',
    });
  });
});

describe('narrowCommand: eslint', () => {
  it('lints only the changed scripts, keeps every option and silences ignored-file warnings', () => {
    expect(narrowCommand(ESLINT, ['src/a.ts', 'src/b.css', 'index.html', 'config/x.mjs'])).toEqual({
      mode: 'files',
      files: ['config/x.mjs', 'src/a.ts'],
      command:
        'eslint --config config/eslint.config.mjs --max-warnings 37 --concurrency auto --no-warn-ignored "config/x.mjs" "src/a.ts"',
    });
  });

  it('keeps a narrow target narrow', () => {
    const cmd = 'eslint "labs/globe/*.js" --config config/eslint.config.mjs --max-warnings 0';
    expect(narrowCommand(cmd, ['labs/globe/a.js', 'labs/other/b.js'])).toMatchObject({
      files: ['labs/globe/a.js'],
    });
    expect(narrowCommand(cmd, ['src/a.ts']).mode).toBe('skip');
  });
});

describe('narrowCommand: fallbacks', () => {
  it('runs whole for another tool, an unknown option or too many files', () => {
    expect(narrowCommand('stylelint "*.css"', ['a.css'])).toEqual({
      mode: 'full',
      reason: 'not a prettier or eslint command',
    });
    expect(narrowCommand('eslint . --new-flag', ['a.ts'])).toEqual({
      mode: 'full',
      reason: 'unknown option --new-flag',
    });
    const many = Array.from({ length: 101 }, (_, i) => `src/f${i}.ts`);
    expect(narrowCommand(ESLINT, many)).toEqual({ mode: 'full', reason: '101 changed files (more than 100)' });
  });

  it('accepts backslash paths and ignores duplicates', () => {
    expect(narrowCommand(ESLINT, ['src\\a.ts', 'src/a.ts'])).toMatchObject({ files: ['src/a.ts'] });
  });
});
