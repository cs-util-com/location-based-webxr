// @ts-check
/**
 * The globe lab's scope check (the full-globe editor plan's review of the
 * view-core move): `globe-lab.js` is one 5 000-line no-build module whose
 * closures were split across files, and a name that silently resolved to an
 * outer variable (a shadowed `view`) once fed the perf sweep the wrong
 * world frame. Only the two scope rules run, on the lab's page modules, so
 * the check names undefined and shadowed names and nothing about style.
 */
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig({
  files: ["labs/globe/*.js"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: { ...globals.browser },
  },
  linterOptions: { reportUnusedDisableDirectives: "error" },
  rules: {
    "no-undef": "error",
    "no-shadow": ["error", { builtinGlobals: false }],
  },
});
