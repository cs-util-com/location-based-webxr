import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

const useMkcert = process.env.VITE_DISABLE_MKCERT !== '1';

export default defineConfig({
  plugins: useMkcert ? [mkcert()] : [],
  server: {
    port: 5173,
    host: true,
  },
});
