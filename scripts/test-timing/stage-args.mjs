// Decides whether a stage run is a canonical full-suite run that may be
// recorded in docs/test-timings.md. Canonical commands live in stages.mjs,
// so any forwarded CLI arg means the run is filtered and must not record —
// timing rows only ever compare like-for-like full-suite runs.

/**
 * @typedef {Object} RecordingDecision
 * @property {boolean} record - true when this run may update the timing file
 * @property {string[]} extraArgs - forwarded args to append to the command
 * @property {'full-suite' | 'filtered' | 'ci'} reason
 */

/**
 * @param {readonly string[]} argvRest - process argv after the stage name
 * @param {Record<string, string | undefined>} env - process.env (or a stub)
 * @returns {RecordingDecision}
 */
export function decideRecording(argvRest, env) {
  // pnpm forwards a literal "--" separator in some invocation styles; it is
  // not an argument for the wrapped command.
  const extraArgs = argvRest[0] === '--' ? argvRest.slice(1) : [...argvRest];
  if (env.CI) {
    return { record: false, extraArgs, reason: 'ci' };
  }
  if (extraArgs.length > 0) {
    return { record: false, extraArgs, reason: 'filtered' };
  }
  return { record: true, extraArgs, reason: 'full-suite' };
}

/**
 * Appends forwarded args to a shell command string, double-quoting args that
 * contain whitespace or quotes. Quoting is intentionally minimal: forwarded
 * args are file filters and flags typed by a developer, not untrusted input.
 *
 * @param {string} command - canonical shell command from stages.mjs
 * @param {readonly string[]} extraArgs
 * @returns {string}
 */
export function appendArgs(command, extraArgs) {
  if (extraArgs.length === 0) {
    return command;
  }
  const quoted = extraArgs.map((arg) =>
    /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg
  );
  return `${command} ${quoted.join(' ')}`;
}

/**
 * Builds the full shell command for a stage run. On filtered runs (any
 * forwarded arg) the stage's filteredRunArgs are inserted BEFORE the
 * forwarded args — so e.g. test:unit neutralizes its global coverage
 * thresholds (meaningless when only a slice of the suite ran, and the reason
 * single-file TDD loops used to exit 1 despite green tests), while a
 * developer-forwarded flag still comes last and wins on conflicts. A stage
 * may also declare a filteredRunCommand — a cheaper base command substituted
 * on filtered runs only (e.g. test:unit without --coverage: repo-wide
 * coverage of a one-file run is meaningless and expensive; speedup plan
 * Phase C.1). Unfiltered runs — recorded full-suite runs AND CI runs — get
 * the canonical command byte-identical, keeping coverage in every recorded
 * duration and thresholds enforced where they mean something.
 *
 * @param {string} command - canonical shell command from stages.mjs
 * @param {RecordingDecision} decision
 * @param {readonly string[]} [filteredRunArgs] - stage's filtered-run extras
 * @param {string} [filteredRunCommand] - base command for filtered runs
 * @returns {string}
 */
export function buildStageCommand(
  command,
  decision,
  filteredRunArgs = [],
  filteredRunCommand = undefined
) {
  if (decision.extraArgs.length === 0) {
    return command;
  }
  return appendArgs(filteredRunCommand ?? command, [
    ...filteredRunArgs,
    ...decision.extraArgs,
  ]);
}
