import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // Central allocation: ../docs/dev-server-ports.md
    port: 5192,
    strictPort: true,
    host: true,
  },
});
