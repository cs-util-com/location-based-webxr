# Lessons learned: gps-plus-slam-editor-kit

- **`paths` into a dependency's source type-checks that source under the
  kit's flags.** Tried for the framework while setting the kit up: it lost
  `erasableSyntaxOnly` for the kit's own files and failed on a framework
  file (`zip-export.ts`, TS2349). Resolving through the dependency's
  `exports` and built types passed, and is what the bundler does anyway.
- **dependency-cruiser does not resolve a workspace package's `.ts`
  `exports` by default.** The Tour Viewer's rule about the kit passed with
  a planted violation: the import read as unresolvable, and `includeOnly`
  dropped it without a report. Its config now sets
  `enhancedResolveOptions`; a rule about a package is proven by a probe,
  never by a green run.
- **A tree-shaken probe proves nothing in a bundle test.** A planted kit
  module that nothing used was shaken out (`"sideEffects": false`), so the
  Tour Viewer's bundle guard stayed green; the probe had to be used by the
  page to be seen.
- **knip's `includeEntryExports` covers every entry of the workspace,** a
  config file's default export included. The ESLint config is therefore
  named under knip's `eslint.config`, not as an `entry`.
