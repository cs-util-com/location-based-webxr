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
  // Base JavaScript recommendations
  eslint.configs.recommended,

  // Shared project defaults
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
      complexity: ["warn", 10],
      "max-depth": ["warn", 4],
      // This package consumes the closed-source core only via the curated
      // `gps-plus-slam-app-framework` re-exports — never a direct dependency on
      // `gps-plus-slam-js`. Mirrors the other example apps' import convention.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "gps-plus-slam-js",
              message:
                "Import core symbols from 'gps-plus-slam-app-framework' (or a subpath like '/visualization') instead.",
            },
          ],
          patterns: [
            {
              group: ["gps-plus-slam-js/*"],
              message:
                "Import via 'gps-plus-slam-app-framework' subpaths instead of reaching into 'gps-plus-slam-js' submodules.",
            },
          ],
        },
      ],
    },
  },

  // Vitest-aware overrides for colocated test files
  {
    files: ["**/*.test.{js,ts,tsx,mts,cts}", "**/*.spec.{js,ts,tsx,mts,cts}"],
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

  // TypeScript-specific rules only run on TypeScript sources
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.cts", "**/*.mts"],
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

  // Allow underscore-prefixed unused params in plain JS files as well
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
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

  // Relax strict TypeScript rules for test files (vitest matchers return `any`
  // by design; the unbound-method pattern is spy introspection, not a bug).
  {
    files: ["**/*.test.{ts,tsx,mts,cts}", "**/*.spec.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-shadow": "off",
      "no-console": "off",
    },
  },

  // Ignore generated artefacts, vendor directories, and the Vite/Vitest config
  // shims (root .ts files intentionally outside the type-aware project).
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "vite.config.ts",
      "vitest.config.ts",
    ],
  },

  // Disable ESLint rules that conflict with Prettier (must be last)
  prettierConfig,
);
