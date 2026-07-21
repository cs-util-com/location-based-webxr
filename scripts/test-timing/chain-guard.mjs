// Drift guard between the two definitions of the gate: the stages.mjs array
// (which run-gate.mjs executes and the md rows mirror) and the package.json
// `&&` chain scripts (test:core, check:all) that developers still invoke
// directly. Produces human-readable warnings only — the gate never fails
// because of the guard (plan §4).

const PNPM_RUN_RE = /^pnpm run (\S+)$/;
// The wrapper lives at the workspace ROOT here, so package-level scripts
// reference it as `../scripts/...` while root-level scripts use `scripts/...`
// — both spellings are canonical (webxr multi-package layout).
const WRAPPER_RE = /^node (?:\.\.\/)?scripts\/test-timing\/timed-stage\.mjs (\S+)$/;

/**
 * Splits a chain script into its `&&` members and flattens nested
 * `pnpm run <name>` references to leaf script names. Non-reference members
 * (raw commands) are returned verbatim. Circular chain references are
 * dropped (each chain script is expanded at most once per call) so a
 * malformed package.json can never overflow the stack — the guard must
 * degrade to warnings, not crash (plan §4).
 *
 * @param {Record<string, string | undefined>} scripts - package.json scripts
 * @param {string} name - chain script name to expand
 * @param {Set<string>} [visited] - chain names already expanded (recursion guard)
 * @returns {string[]}
 */
export function expandChain(scripts, name, visited = new Set()) {
  if (visited.has(name)) {
    return [];
  }
  visited.add(name);
  const value = scripts[name];
  if (!value) {
    return [];
  }
  /** @type {string[]} */
  const leaves = [];
  for (const part of value.split('&&').map((p) => p.trim())) {
    const match = PNPM_RUN_RE.exec(part);
    if (!match) {
      leaves.push(part);
      continue;
    }
    const referenced = match[1];
    const referencedValue = scripts[referenced] ?? '';
    const isNestedChain = referencedValue
      .split('&&')
      .every((p) => PNPM_RUN_RE.test(p.trim()));
    if (isNestedChain && referencedValue.includes('&&')) {
      leaves.push(...expandChain(scripts, referenced, visited));
    } else {
      leaves.push(referenced);
    }
  }
  return leaves;
}

/**
 * Whether a package.json script value is canonical wiring for a stage: the
 * exact wrapper invocation, or a `&&` chain whose LAST member is the wrapper
 * invocation and whose earlier members are each `pnpm run <other stage>`
 * (webxr layout: e2e stage scripts chain their framework-build stage first
 * so standalone `pnpm run test:e2e` still builds — stale-dist footgun).
 *
 * @param {string} value - package.json script value
 * @param {string} stageName - the stage this script belongs to
 * @param {readonly string[]} stageNames - all configured stage names
 * @returns {boolean}
 */
export function isWrappedStageScript(value, stageName, stageNames) {
  const members = value.split('&&').map((part) => part.trim());
  const last = members[members.length - 1];
  const wrapperMatch = WRAPPER_RE.exec(last ?? '');
  if (!wrapperMatch || wrapperMatch[1] !== stageName) {
    return false;
  }
  return members.slice(0, -1).every((member) => {
    const runMatch = PNPM_RUN_RE.exec(member);
    return runMatch !== null && stageNames.includes(runMatch[1]);
  });
}

/**
 * @param {Record<string, string | undefined>} scripts - package.json scripts
 * @param {readonly string[]} stageNames - stages.mjs order
 * @param {readonly string[]} [chainNames] - chain scripts to check
 * @param {readonly string[]} [rawStageNames] - stages whose package.json
 *   script intentionally does NOT route through the wrapper (webxr:
 *   build:framework — dev flows and Playwright webServer spawns call the
 *   script and must not record). The script must still EXIST; it may hold
 *   any command.
 * @returns {string[]} warnings (empty when consistent)
 */
export function checkChainDrift(
  scripts,
  stageNames,
  chainNames = ['test:core', 'check:all'],
  rawStageNames = []
) {
  // A Set because nested chains (test:core expands check:all) surface the
  // same drift from multiple chains; warnings are keyed by the drift itself.
  /** @type {Set<string>} */
  const warnings = new Set();

  for (const stage of stageNames) {
    const value = scripts[stage];
    if (value === undefined) {
      warnings.add(
        `stage "${stage}" from stages.mjs has no package.json script`
      );
      continue;
    }
    if (rawStageNames.includes(stage)) {
      continue; // intentionally unwrapped; existence was checked above
    }
    if (!isWrappedStageScript(value, stage, stageNames)) {
      warnings.add(
        `script "${stage}" does not invoke the timed-stage.mjs wrapper — its runs will not be recorded`
      );
    }
  }

  for (const chain of chainNames) {
    if (scripts[chain] === undefined) {
      continue;
    }
    const leaves = expandChain(scripts, chain);
    /** @type {number[]} */
    const seenPositions = [];
    for (const leaf of leaves) {
      const position = stageNames.indexOf(leaf);
      if (position === -1) {
        warnings.add(
          `"${leaf}" is referenced by a package.json chain but missing from stages.mjs — it gets no timing row`
        );
        continue;
      }
      seenPositions.push(position);
    }
    const sorted = [...seenPositions].sort((a, b) => a - b);
    if (seenPositions.some((p, i) => p !== sorted[i])) {
      warnings.add(
        `chain "${chain}" runs stages in a different order than stages.mjs`
      );
    }
  }

  return [...warnings];
}
