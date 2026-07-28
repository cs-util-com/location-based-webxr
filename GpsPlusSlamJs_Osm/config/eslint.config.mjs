// @ts-check
import { fileURLToPath } from "node:url";
import globals from "globals";
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

const tsconfigRootDir = fileURLToPath(new URL("..", import.meta.url));
const tsconfigForLint = fileURLToPath(
  new URL("../tsconfig.eslint.json", import.meta.url),
);

export default defineConfig(
  eslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      curly: "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-extend-native": "error",
      // Same ratchet convention as the framework: the `--max-warnings` value in
      // projects.mjs is pinned to the current warning count, so any NEW warning
      // fails the gate. This package starts at 0 — keep it there.
      complexity: ["warn", 10],
      "max-depth": ["warn", 4],
    },
  },

  {
    files: [
      "**/*.test.{js,ts,mts,cts}",
      "**/*.spec.{js,ts,mts,cts}",
      "**/*.property.test.{js,ts}",
    ],
    plugins: {
      vitest,
    },
    languageOptions: {
      globals: {
        ...vitest.environments.env.globals,
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: ["expect", "expectTypeOf"],
        },
      ],
    },
  },

  {
    files: ["**/*.ts", "**/*.cts", "**/*.mts"],
    extends: [
      ...tseslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: tsconfigForLint,
        tsconfigRootDir,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/return-await": ["error", "in-try-catch"],
      "no-console": "warn",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
    },
  },

  {
    files: ["**/*.js", "**/*.mjs"],
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: [
      "**/*.test.{ts,mts,cts}",
      "**/*.spec.{ts,mts,cts}",
      "**/*.property.test.ts",
      "**/*.bench.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-shadow": "off",
      "no-console": "off",
    },
  },

  // Node-only maintenance scripts: plain ESM, not part of the typed project.
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },

  // Ignore generated artefacts and vendor directories
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },

  // Disable ESLint rules that conflict with Prettier (must be last)
  prettierConfig,
);
