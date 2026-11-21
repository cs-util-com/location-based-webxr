// Repo-meta test: pins the two cost controls of the Claude review workflow.
//
// Why this test matters: the review bot runs on every same-repo PR push and is
// the costliest CI job per run. Two settings keep that cost bounded, and both
// are one-line edits that nothing else would notice drifting:
//   1. The model is an exact ID, not a floating alias, so a silent alias
//      move cannot change what every review costs.
//   2. PRs that change only throwaway prototype pages skip the review via
//      `paths-ignore`. GitHub skips a `pull_request` workflow only when EVERY
//      changed file matches an ignore pattern, so a PR that also touches any
//      other file is still reviewed. The ignore list must stay limited to the
//      prototype galleries: widening it (to docs, Markdown or source) would
//      silently remove the only automated reader of those changes.
//
// Coverage limits: GitHub's path-filter evaluation itself cannot run locally;
// this test pins the configuration that feeds it, not its behaviour on a PR.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = '.github/workflows/claude-code-review.yml';
const workflow = parseYaml(readFileSync(resolve(repoRoot, workflowPath), 'utf8'));

function reviewStep() {
  const steps = workflow?.jobs?.review?.steps;
  if (!Array.isArray(steps)) throw new Error(`${workflowPath} is missing jobs.review.steps`);
  const step = steps.find(
    (s) => typeof s?.uses === 'string' && s.uses.startsWith('anthropics/claude-code-action@'),
  );
  if (!step) throw new Error(`${workflowPath} has no anthropics/claude-code-action step`);
  return step;
}

describe('claude-code-review.yml cost controls', () => {
  it('pins the review model to an exact model ID through claude_args', () => {
    // The pinned action version has no `model` input; its docs route the model
    // through `claude_args: --model <id>`.
    const args = String(reviewStep().with?.claude_args ?? '');
    const models = [...args.matchAll(/--model\s+(\S+)/g)].map((m) => m[1]);
    expect(models).toEqual(['claude-opus-5-5']);
  });

  it('skips PRs that change only prototype gallery files, and nothing else', () => {
    const trigger = workflow?.on?.pull_request;
    expect(trigger?.paths).toBeUndefined(); // GitHub rejects paths together with paths-ignore
    expect(trigger?.['paths-ignore']).toEqual(['**/public/prototypes/**']);
  });
});
