import { fileURLToPath } from 'node:url';
export default {
  root: fileURLToPath(new URL('./', import.meta.url)),
  cacheDir: fileURLToPath(new URL('./.vite', import.meta.url)),
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
};
