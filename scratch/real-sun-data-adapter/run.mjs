// Disposable runner: reuse installed workspace tools without editing manifests.
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('./', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const task = process.argv[2] ?? 'dev';
if (task === 'test' || task === 'check') {
  const script = task === 'test' ? 'node_modules/vitest/vitest.mjs'
    : 'GpsPlusSlamJs_AppFramework/node_modules/typescript/bin/tsc';
  const args = task === 'test' ? ['run', '--config', `${root}vitest.config.mjs`]
    : ['-p', `${root}tsconfig.json`];
  const result = spawnSync(process.execPath, [repo + script, ...args], { cwd: repo, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else if (task === 'browser') {
  await import('./tests/browser.mjs');
} else {
  const { createServer, build } = await import('../../GpsPlusSlamJs_SunPositionDemo/node_modules/vite/dist/node/index.js');
  const config = { root, configFile: false, cacheDir: `${root}.vite`,
    server: { host: '127.0.0.1', port: Number(process.argv[3] ?? 0), strictPort: true, fs: { allow: [repo] } },
    build: { outDir: `${root}dist`, rolldownOptions: { input: [
      `${root}index.html`, `${root}a-commands/index.html`, `${root}b-configuration/index.html`, `${root}c-snapshot/index.html`,
    ] } },
  };
  if (task === 'build') await build(config);
  else if (task === 'dev') {
    const server = await createServer(config);
    await server.listen(); server.printUrls();
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(); });
  } else throw new Error('Use dev [port], test, check, build, or browser');
}
