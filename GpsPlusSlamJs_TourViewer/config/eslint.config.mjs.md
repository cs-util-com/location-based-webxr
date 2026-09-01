# eslint.config.mjs

## Purpose

ESLint flat config for the AnchorStarter example. Mirrors the AppFramework /
RecorderApp configs so every package in the repo shares one lint contract:
type-aware TypeScript rules, Vitest-aware overrides for test files, and a
Prettier-compatibility layer.

## Key rules

- `eslint.configs.recommended` + `typescript-eslint` recommended +
  `recommendedTypeChecked` (type-aware) on all `*.ts` sources.
- `no-restricted-imports`: the starter must consume the core library only via
  `gps-plus-slam-app-framework` re-exports — never import `gps-plus-slam-js`
  directly. Matches the RecorderApp architectural boundary.
- `@typescript-eslint/consistent-type-imports`, `return-await` (in-try-catch),
  `no-shadow` (TS variant), `no-console` (warn), `complexity`/`max-depth` warns.
- Test files (`*.test.ts` / `*.spec.ts` / `*.property.test.ts`) relax the
  unsafe-assignment / unbound-method / no-shadow / no-console rules that fire on
  standard Vitest patterns.

## Invariants & assumptions

- Type-aware linting reads `../tsconfig.eslint.json` (src + config + tests).
- `vite.config.ts` is ignored: it is a root `.ts` file intentionally kept
  outside the type-aware project, so linting it with `project` would error.

## Usage

```bash
pnpm run lint        # eslint . --config config/eslint.config.mjs
```

## Tests

No unit test; exercised by the `lint` gate inside `pnpm test`.
