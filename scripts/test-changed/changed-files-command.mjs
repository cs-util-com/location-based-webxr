// Pure rewrite of a package's format command to the files a commit changed,
// for the per-commit fast gate (changed-files-stage.mjs is the shell). Lint
// is deliberately not narrowed: ESLint's typed rules read across files (a
// change in one file can raise an error in another), and `--max-warnings`
// budgets count the whole package, so a lint of the changed files proves
// neither (r1125 review). The stage's own targets stay the scope: a changed file outside them
// is not checked, exactly as the whole-package command would not check it.
// Anything the rewrite cannot read with certainty runs the command whole.

import path from 'node:path';

/** Above this many files the whole command is as cheap and keeps cmd.exe's limit far away. */
export const MAX_FILES = 100;

const TOOLS = {
  prettier: {
    valueFlags: ['--log-level', '--cache-strategy', '--cache-location', '--config', '--ignore-path', '--plugin', '--parser'],
    flags: ['--write', '--check', '--list-different', '-l', '--cache', '--ignore-unknown', '-u', '--no-error-on-unmatched-pattern'],
    accepts: () => true,
  },
};

/**
 * @param {string} command
 * @returns {string[]} words; a double-quoted word is kept whole, unquoted
 */
export function splitCommand(command) {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
}

/** @param {string} target @param {string} file */
function owns(target, file) {
  if (target === '.' || target === './') return true;
  const t = target.replace(/^\.\//, '').replace(/\/$/, '');
  if (/[*?[{]/.test(t)) return path.posix.matchesGlob(file, t);
  return file === t || file.startsWith(`${t}/`);
}

/**
 * @param {string} command - the stage's command, run from the package dir
 * @param {readonly string[]} changed - package-relative changed files that exist
 * @returns {{ mode: 'files', files: string[], command: string }
 *   | { mode: 'skip', reason: string }
 *   | { mode: 'full', reason: string }}
 */
export function narrowCommand(command, changed) {
  const [tool, ...args] = splitCommand(command);
  const spec = TOOLS[/** @type {keyof typeof TOOLS} */ (tool)];
  if (!spec) return { mode: 'full', reason: 'not a prettier command' };
  /** @type {string[]} */
  const options = [];
  /** @type {string[]} */
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (spec.valueFlags.includes(arg)) {
      options.push(arg, args[++i]);
    } else if (spec.flags.includes(arg)) {
      options.push(arg);
    } else if (arg.startsWith('-')) {
      return { mode: 'full', reason: `unknown option ${arg}` };
    } else {
      targets.push(arg);
    }
  }
  if (tool === 'prettier' && !options.includes('--ignore-unknown') && !options.includes('-u')) {
    return { mode: 'full', reason: 'the command has no --ignore-unknown' };
  }
  const files = [...new Set(changed.map((f) => f.replaceAll('\\', '/')))]
    .filter((f) => spec.accepts(f) && targets.some((t) => owns(t, f)))
    .sort();
  if (files.length > MAX_FILES) {
    return { mode: 'full', reason: `${files.length} changed files (more than ${MAX_FILES})` };
  }
  if (files.length === 0) return { mode: 'skip', reason: 'no changed file is in this stage' };
  return {
    mode: 'files',
    files,
    command: [tool, ...options, ...files.map((f) => `"${f}"`)].join(' '),
  };
}
