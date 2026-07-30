# HTML Fixtures Loader

## Purpose

Loads HTML fragments from `index.html` to ensure tests use the exact same markup as production. This eliminates the duplication problem where test fixtures drift from the actual UI.

## Public API

| Function                  | Parameters     | Returns  | Description                                        |
| ------------------------- | -------------- | -------- | -------------------------------------------------- |
| `extractElementById`      | `elementId`    | `string` | Extract an element's outer HTML by its ID          |
| `extractElementsById`     | `elementIds[]` | `string` | Extract multiple elements and concatenate HTML     |
| `loadSettingsModalHtml`   | -              | `string` | Convenience: load settings-modal element           |
| `loadSettingsButtonHtml`  | -              | `string` | Convenience: load btn-settings element             |
| `loadSettingsTestFixture` | -              | `string` | Load full fixture for settings modal tests         |
| `loadFullIndexHtml`       | -              | `string` | Load full index.html as raw string                 |
| `loadAppCss`              | -              | `string` | Load styles/app.css as raw string                  |
| `clearHtmlCache`          | -              | `void`   | Clear cached HTML and CSS (for testing the loader) |

## Invariants & Assumptions

- `index.html` is located at the project root (two levels up from `src/test-utils/`)
- `styles/app.css` is located at the project root (two levels up from `src/test-utils/`)
- Elements have unique IDs within the document
- HTML parsing is handled by jsdom for robustness (handles comments, scripts, nested tags correctly)
- The loader caches `index.html` content after first read for performance

## Examples

### Basic Usage in Tests

```typescript
import { loadSettingsModalHtml } from '../test-utils/html-fixtures';

beforeEach(() => {
  document.body.innerHTML = loadSettingsModalHtml();
});
```

### Extracting Custom Elements

```typescript
import {
  extractElementById,
  extractElementsById,
} from '../test-utils/html-fixtures';

// Single element
const modal = extractElementById('setup-modal');

// Multiple elements
const html = extractElementsById(['settings-modal', 'setup-modal']);
document.body.innerHTML = html;
```

### Full Settings Test Fixture

```typescript
import { loadSettingsTestFixture } from '../test-utils/html-fixtures';

beforeEach(() => {
  // Includes settings modal + setup modal (with settings button)
  document.body.innerHTML = loadSettingsTestFixture();
});
```

## Tests

See `html-fixtures.test.ts` for coverage of:

- Element extraction by ID
- Nested element handling
- Error cases (missing elements)
- Cache behavior
