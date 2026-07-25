#!/usr/bin/env node
// Thin CLI over run-stage.mjs: `node ../scripts/test-timing/timed-stage.mjs
// <stage> [forwarded args...]`. Each leaf script in a package's package.json
// points here; the owning project is resolved from the invoking cwd (pnpm
// runs package scripts with cwd = the package directory). Forwarded args
// (file filters etc.) make the run unrecorded and are appended to the
// canonical command from projects.mjs.
import { resolveProject, PROJECTS } from './projects.mjs';
import { runStage, WORKSPACE_ROOT } from './run-stage.mjs';

const [stageName, ...forwardedArgs] = process.argv.slice(2);
if (!stageName) {
  console.error('usage: timed-stage.mjs <stage> [forwarded args...]');
  process.exit(2);
}

const project = resolveProject(process.cwd(), WORKSPACE_ROOT);
if (!project) {
  console.error(
    `test-timing: no project configured for cwd "${process.cwd()}" — known: ${PROJECTS.map((p) => p.dir).join(', ')}`
  );
  process.exit(2);
}

const { exitCode } = await runStage(project, stageName, forwardedArgs);
process.exit(exitCode);
