#!/usr/bin/env node
// Is the once-per-session full cascade (DEC-G3) still valid for what is about
// to be published?
//
// `push-and-branch` calls this before pushing. Until 2026-08-15 DEC-G3 was
// prose asking an agent to remember a 23-minute command, which is the weakest
// kind of rule this repo has: nothing observes it, so nothing reports it
// missing. The timing artefact already records the git SHA of every cascade,
// so the check costs nothing to run and needs no new bookkeeping.
//
// Exit 0 = fresh (or legitimately exempt); exit 1 = stale, do not push.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * The decision, kept pure so its edge cases are testable without a repo.
 *
 * @param {object} input
 * @param {string | null} input.cascadeSha - git SHA of the newest recorded
 *   full-cascade `total` row, or null when none exists / is unreadable
 * @param {boolean} input.shaKnown - does that SHA exist in this repo's history?
 *   A cascade recorded on another branch or machine is not evidence about HEAD.
 * @param {readonly string[]} input.changedSince - repo-relative paths changed
 *   between that SHA and HEAD (empty means the cascade ran on HEAD itself)
 * @returns {{ fresh: boolean, reason: string }}
 */
export function assessCascadeFreshness({ cascadeSha, shaKnown, changedSince }) {
  if (!cascadeSha) {
    return {
      fresh: false,
      reason:
        'no full-cascade run is recorded in docs/test-timings.md — run `pnpm test` at the webxr root',
    };
  }
  if (!shaKnown) {
    return {
      fresh: false,
      reason: `the newest recorded cascade is from commit ${cascadeSha}, which is not in this branch's history (another branch or machine) — re-run \`pnpm test\``,
    };
  }
  if (changedSince.length === 0) {
    return { fresh: true, reason: `cascade ran on HEAD (${cascadeSha})` };
  }
  // DOCS-ONLY EXEMPTION. A stretch of markdown commits cannot invalidate a test
  // run, and the repo already applies this reasoning elsewhere (the loop
  // prompts let markdown-only commits skip the gate). Without it the check
  // would fire on exactly the commits a session ends with — the summary doc,
  // the decision doc — and an override used every time is not a check.
  const code = changedSince.filter((file) => !file.toLowerCase().endsWith('.md'));
  if (code.length === 0) {
    return {
      fresh: true,
      reason: `only markdown changed since the cascade at ${cascadeSha} (${changedSince.length} file(s))`,
    };
  }
  return {
    fresh: false,
    reason: `${code.length} non-markdown file(s) changed since the cascade at ${cascadeSha} (e.g. ${code
      .slice(0, 3)
      .join(', ')}) — re-run \`pnpm test\` at the webxr root`,
  };
}

/** @returns {string | null} SHA of the newest recorded `total` row */
export function newestCascadeSha(markdown) {
  const block = markdown.match(
    /"total":\s*\{\s*"history":\s*\[([\s\S]*?)\]\s*\}/
  );
  if (!block) {
    return null;
  }
  // History is newest-first, and each entry carries the SHA it ran on.
  const entry = block[1].match(/"git":"([^"]+)"/);
  return entry ? entry[1] : null;
}

function main() {
  /** @type {string | null} */
  let sha = null;
  try {
    sha = newestCascadeSha(
      readFileSync(path.join(WORKSPACE_ROOT, 'docs/test-timings.md'), 'utf8')
    );
  } catch {
    sha = null;
  }

  let shaKnown = false;
  /** @type {string[]} */
  let changedSince = [];
  if (sha) {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
        cwd: WORKSPACE_ROOT,
        stdio: 'ignore',
      });
      shaKnown = true;
      changedSince = execFileSync('git', ['diff', '--name-only', sha, 'HEAD'], {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      shaKnown = false;
    }
  }

  const { fresh, reason } = assessCascadeFreshness({
    cascadeSha: sha,
    shaKnown,
    changedSince,
  });
  if (fresh) {
    console.log(`cascade-freshness: ✔ ${reason}`);
    process.exit(0);
  }
  console.error(
    `cascade-freshness: ✖ the once-per-session full cascade (DEC-G3) is stale.\n  ${reason}\n` +
      '  The per-commit gate does not run dependents’ e2e, so this is the run that catches a break in what another package draws.'
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
