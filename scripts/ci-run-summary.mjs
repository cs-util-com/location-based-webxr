// One line about the newest dispatched CI run of a branch: the result channel
// of a branch without a pull request, which has no checks page and no bot
// comment. Usage: `pnpm run ci:summary <branch>`. Exits 0 only on a green run.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'cs-util-com/location-based-webxr';

/**
 * @typedef {Object} RunJob
 * @property {string} name
 * @property {string} status
 * @property {string} conclusion
 */

/**
 * @typedef {Object} CiRun
 * @property {string} url
 * @property {string} headBranch
 * @property {string} headSha
 * @property {string} status
 * @property {string} conclusion
 * @property {RunJob[]} jobs
 */

/**
 * The summary line of one run, from `gh run view --json`.
 *
 * @param {CiRun} run
 * @returns {string}
 * @throws {TypeError} when the run carries no jobs list
 */
export function summarizeRun(run) {
  if (!Array.isArray(run?.jobs)) {
    throw new TypeError('summarizeRun needs the jobs of the run (gh run view --json jobs)');
  }
  const total = run.jobs.length;
  const finished = run.jobs.filter((job) => job.status === 'completed');
  const notGreen = finished.filter((job) => job.conclusion !== 'success');
  const completed = run.status === 'completed';
  const progress = completed
    ? `${finished.length - notGreen.length} of ${total} jobs green`
    : `${finished.length} of ${total} jobs done`;
  const named = notGreen.map((job) => `${job.name} (${job.conclusion})`).join(', ');
  return [
    `${run.headBranch} @ ${run.headSha.slice(0, 8)}: ${completed ? run.conclusion : run.status}`,
    `, ${progress}`,
    named ? `, not green: ${named}` : '',
    ` - ${run.url}`,
  ].join('');
}

/** @param {string} branch @returns {CiRun | undefined} */
function newestDispatchedRun(branch) {
  const repo = process.env.GH_REPO || DEFAULT_REPO;
  /** @param {string[]} args */
  const gh = (...args) =>
    JSON.parse(execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' }));
  const [newest] = gh(
    'run',
    'list',
    '--branch',
    branch,
    '--workflow',
    'ci.yml',
    '--event',
    'workflow_dispatch',
    '--limit',
    '1',
    '--json',
    'databaseId',
  );
  if (!newest) return undefined;
  return gh(
    'run',
    'view',
    String(newest.databaseId),
    '--json',
    'url,headBranch,headSha,status,conclusion,jobs',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const branch = process.argv[2];
  if (!branch) {
    console.error('usage: pnpm run ci:summary <branch>');
    process.exit(2);
  }
  const run = newestDispatchedRun(branch);
  if (!run) {
    console.error(`no dispatched CI run on ${branch}`);
    process.exit(1);
  }
  console.log(summarizeRun(run));
  process.exitCode = run.conclusion === 'success' ? 0 : 1;
}
