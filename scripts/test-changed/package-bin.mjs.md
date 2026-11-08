# package-bin.mjs - a package's CLI tool as an entry script

- Purpose: find the bin script of a tool (vitest, prettier) through the
  package's own dependency resolution, so the fast gate's wrappers
  ([related-unit.mjs](related-unit.mjs.md),
  [changed-files-stage.mjs](changed-files-stage.mjs.md)) run it as
  `node <bin> ...argv`: no shell, so a git-reported file name is never
  interpreted (`$`, backticks, `"`), and no cmd.exe command-line limit.
- Public API: `toolBin(pkgDir, tool)` -> the absolute bin path. Reads
  `<tool>/package.json` resolved from `pkgDir`; a string `bin` or the
  `bin[tool]` entry.
- Invariants & assumptions: the tool's npm name is its bin name (true for
  vitest and prettier). Throws when the tool does not resolve from the
  package or has no such bin; callers fall back to running the whole
  command, or report the error.
- Example: `spawnSync(process.execPath, [toolBin(pkgDir, 'prettier'), '--check', file])`.
- Tests: `package-bin.test.mjs` (resolves vitest's bin from the root, throws
  for an unknown tool).
