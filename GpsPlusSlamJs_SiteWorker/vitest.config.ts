import { defineConfig } from "vitest/config";

// Without this file vitest resolves the WORKSPACE-ROOT vitest.config.js
// (config discovery walks up), whose include covers only tests/** — and
// "No test files found" exits red. Node environment on purpose: the worker
// runs server-side and must never depend on DOM globals.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
