import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import tailwindcss from '@tailwindcss/vite';

interface PackageJsonWithVersion {
  version: string;
}

function isPackageJsonWithVersion(
  value: unknown
): value is PackageJsonWithVersion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as { version?: unknown }).version === 'string';
}

function readPkgVersion(relPath: string): string {
  const abs = fileURLToPath(new URL(relPath, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(abs, 'utf-8'));

  if (!isPackageJsonWithVersion(parsed)) {
    throw new Error(
      `Package JSON at ${abs} does not contain a string version.`
    );
  }

  return parsed.version;
}

function readInstalledPkgVersion(pkgName: string): string {
  // Read the package's own package.json from RecorderApp's node_modules. This
  // works for both top-level installs and transitive deps that pnpm has
  // nested under another package (e.g. `gps-plus-slam-js` is now reached via
  // the framework's nested `node_modules/`, not at the top level).
  // Reading via `require.resolve('<pkg>/package.json')` does not work when the
  // package restricts subpath access via its `exports` field.
  const candidates = [
    `../node_modules/${pkgName}/package.json`,
    `../node_modules/gps-plus-slam-app-framework/node_modules/${pkgName}/package.json`,
  ];

  let lastErr: unknown;
  for (const rel of candidates) {
    const abs = fileURLToPath(new URL(rel, import.meta.url));
    try {
      const parsed: unknown = JSON.parse(readFileSync(abs, 'utf-8'));
      if (!isPackageJsonWithVersion(parsed)) {
        throw new Error(
          `Package JSON for ${pkgName} at ${abs} does not contain a string version.`
        );
      }
      return parsed.version;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new Error(
    `Could not locate package.json for ${pkgName} in any expected node_modules location. Last error: ${String(lastErr)}`
  );
}

function gitCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'dev';
  }
}

function createBuildMetadataDefine(): Record<string, string> {
  const commitHash = gitCommitHash();
  const buildTime = new Date().toISOString();
  const appVersion = readPkgVersion('../package.json');
  const libraryVersion = readInstalledPkgVersion('gps-plus-slam-js');
  const frameworkVersion = readInstalledPkgVersion(
    'gps-plus-slam-app-framework'
  );

  return {
    __BUILD_COMMIT__: JSON.stringify(commitHash),
    'globalThis.__BUILD_COMMIT__': JSON.stringify(commitHash),
    __BUILD_TIME__: JSON.stringify(buildTime),
    'globalThis.__BUILD_TIME__': JSON.stringify(buildTime),
    __APP_VERSION__: JSON.stringify(appVersion),
    'globalThis.__APP_VERSION__': JSON.stringify(appVersion),
    __LIB_VERSION__: JSON.stringify(libraryVersion),
    'globalThis.__LIB_VERSION__': JSON.stringify(libraryVersion),
    __FW_VERSION__: JSON.stringify(frameworkVersion),
    'globalThis.__FW_VERSION__': JSON.stringify(frameworkVersion),
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    port: 5173,
    // Required for WebXR on Android via USB debugging
    host: true,
    https: false, // WebXR requires HTTPS in production, but localhost is allowed
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('../index.html', import.meta.url)),
        arHittestTest: fileURLToPath(
          new URL('../ar-hittest-test.html', import.meta.url)
        ),
      },
    },
  },
  define: createBuildMetadataDefine(),
  plugins: [
    // TAILWIND, BUILT HERE RATHER THAN FETCHED AT RUNTIME. It used to come from
    // `cdn.tailwindcss.com`, which made every page load — including every e2e
    // `page.goto` — wait on a third-party host. See `styles/tailwind.css` for
    // what that cost and for the one behavioural difference the swap has.
    tailwindcss(),
    // Upload source maps to Sentry during production builds.
    // Only loaded when SENTRY_AUTH_TOKEN is set — without it the plugin
    // errors during `vite build`. Local dev and public-repo contributors
    // build without the token and get no Sentry source-map upload.
    process.env.SENTRY_AUTH_TOKEN &&
      sentryVitePlugin({
        org: 'cs-util-com',
        project: 'js-gps-recorder',
      }),
  ],
});
