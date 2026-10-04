/**
 * An app's build stamp: the commit, the versions and the build time that a
 * Vite `define` block injects at build time.
 *
 * WHY IT IS IN THE FRAMEWORK (2026-09-28). The Recorder had the only copy.
 * The Tour Viewer's troubleshooting recording now writes a `session.json`
 * too, and a recording that cannot say which build made it is a recording
 * nobody can reproduce. The five global names are a contract between the
 * build (which defines them) and this reader, so they have one reader
 * (DEC-H3). The build half is
 * `GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs`.
 *
 * @see build-info.ts.md
 */

/** What a build stamps; the shape `session.json`'s `build` field declares. */
export interface BuildInfo {
  commitHash: string;
  appVersion: string;
  libraryVersion: string;
  frameworkVersion: string;
  buildTime: string;
}

type InjectedBuildKey =
  | '__BUILD_COMMIT__'
  | '__APP_VERSION__'
  | '__LIB_VERSION__'
  | '__FW_VERSION__'
  | '__BUILD_TIME__';

/**
 * `globalThis` as the define block leaves it: a cast rather than a
 * `declare global`, so a library adds no globals to its consumers' type
 * scope.
 */
type InjectedGlobals = { [K in InjectedBuildKey]?: unknown };

/**
 * Each global read as an explicit `globalThis.__NAME__` expression: that is
 * the text Vite's `define` replaces in a build (the app's own code and its
 * dependencies alike), and the property its dev client assigns. A computed
 * `globalThis[name]` - or an alias of `globalThis` - would be replaced in
 * neither, which is why each cast is written out in place (the cast is
 * erased; the emitted code reads `globalThis.__NAME__`).
 */
function readInjectedValues(): Record<InjectedBuildKey, unknown> {
  return {
    __BUILD_COMMIT__: (globalThis as InjectedGlobals).__BUILD_COMMIT__,
    __APP_VERSION__: (globalThis as InjectedGlobals).__APP_VERSION__,
    __LIB_VERSION__: (globalThis as InjectedGlobals).__LIB_VERSION__,
    __FW_VERSION__: (globalThis as InjectedGlobals).__FW_VERSION__,
    __BUILD_TIME__: (globalThis as InjectedGlobals).__BUILD_TIME__,
  };
}

function readInjectedString(name: InjectedBuildKey): string {
  const value = readInjectedValues()[name];

  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid build metadata: ${name}`);
  }

  return value;
}

/**
 * The build stamp. Throws when a constant was never injected (a unit test,
 * or an app without the `define` block): the caller decides whether that
 * costs a label or a field, never the whole record.
 */
export function getBuildInfo(): BuildInfo {
  return {
    commitHash: readInjectedString('__BUILD_COMMIT__'),
    appVersion: readInjectedString('__APP_VERSION__'),
    libraryVersion: readInjectedString('__LIB_VERSION__'),
    frameworkVersion: readInjectedString('__FW_VERSION__'),
    buildTime: readInjectedString('__BUILD_TIME__'),
  };
}
