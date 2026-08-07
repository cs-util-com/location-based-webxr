# list-formatter.ts

## Purpose

Shared `Intl.ListFormat` instance for formatting human-readable lists with conjunctions (e.g., "A, B, and C").

## Public API

### `listFormatter`

A pre-configured `Intl.ListFormat` instance with English locale, long style, and conjunction type.

```ts
import { listFormatter } from './utils/list-formatter';

listFormatter.format(['Camera', 'Location']); // "Camera and Location"
listFormatter.format(['A', 'B', 'C']); // "A, B, and C"
```

## Invariants & Assumptions

- **Locale**: Hardcoded to `'en'` to match the app's English UI. If i18n is added, update to use the user's locale preference.
- **Singleton**: Module-level instance is created once and reused across all callers.

## Tests

No dedicated tests—covered indirectly by permission error display tests in `hud.test.ts` and `main.test.ts`.
