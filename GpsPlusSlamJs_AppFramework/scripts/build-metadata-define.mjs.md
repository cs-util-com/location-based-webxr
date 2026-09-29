# build-metadata-define.mjs

## Purpose

The build half of an app's build stamp: the Vite `define` block that injects
the five constants [`src/utils/build-info.ts`](../src/utils/build-info.ts.md)
reads (`__BUILD_COMMIT__`, `__BUILD_TIME__`, `__APP_VERSION__`,
`__LIB_VERSION__`, `__FW_VERSION__`). One copy for every app that stamps its
recordings (DEC-H3): the RecorderApp (`config/vite.config.ts`) and the Tour
Viewer (`vite.config.ts`) import it by relative path. It moved out of the
Recorder's Vite config on 2026-09-28, when the Tour Viewer's troubleshooting
recording needed the same stamp (authoring recording plan 2026-09-28-0953,
§7a finding 2).

Node-only and build-time: it reads git and the file system, so it lives in
`scripts/` (not in `src/`, whose `dist` is browser code) and is not published
(`files: ["dist"]`).

## Public API

- `createBuildMetadataDefine(appDir, deps?) -> Record<string, string>` - the
  `define` block for the app whose package directory is `appDir`. Each
  constant appears twice with the same JSON-quoted value: bare, and as
  `globalThis.__NAME__` (the expression the reader uses). `deps.commitHash`
  and `deps.now` are test seams.
- `readInstalledPackageVersion(appDir, pkgName) -> string` - an installed
  package's version, from its own package.json, at the app's top level or
  nested under the framework (where pnpm puts `gps-plus-slam-js`). Throws when
  neither exists.

## Invariants & assumptions

- The commit is `git rev-parse --short HEAD`, or `"dev"` where git is not
  available. Everything else must exist: a version that cannot be read throws
  and fails the build, so no build ships a made-up version.
- All values are computed once per call, so the two keys of a constant can
  never disagree.
- Reading `<pkg>/package.json` through `require.resolve` fails for a package
  whose `exports` does not list it, hence the direct file reads.

## Examples

```ts
// an app's vite.config.ts
import { fileURLToPath } from 'node:url';
import { createBuildMetadataDefine } from '../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs';

export default defineConfig({
  define: createBuildMetadataDefine(
    fileURLToPath(new URL('.', import.meta.url))
  ),
});
```

## Tests

`build-metadata-define.test.mjs` (in the framework's unit run): the block's
exact keys and values over a pnpm-shaped fake app directory; the round trip
through `getBuildInfo` with the block applied as Vite's dev client applies it;
a package found at the top level or nested; a missing package throws.
