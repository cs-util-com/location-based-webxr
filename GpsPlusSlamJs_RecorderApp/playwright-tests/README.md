# E2E Tests (Playwright)

This directory contains end-to-end tests for the GpsPlusSlamJs Recorder App using Playwright.

## Running Tests

```bash
# From GpsPlusSlamJs_RecorderApp directory
npm run test:e2e
```

## Test Files

| File                              | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `smoke.spec.js`                   | Basic app loading and element existence checks     |
| `setup-modal.spec.js`             | Setup modal workflow (folder selection, scenarios) |
| `enter-ar-flow.spec.js`           | Complete flow from setup to AR mode entry          |
| `button-states.spec.js`           | Button labels, HUD text and the controls layout    |
| `settings-modal.spec.js`          | Settings modal interactions and persistence        |
| `ref-point-picker.spec.js`        | Reference point picker modal interactions          |
| `test-hooks-verification.spec.js` | Verifies testHooks match real application behavior |

## Testing Guidelines

### ✅ DO: Use Test Hooks for Application Logic

The app exposes `window.testHooks` in dev mode for e2e testing. **Always prefer these over DOM manipulation.**

```javascript
// Wait for hooks to be available (they're set up asynchronously)
await page.waitForFunction(() => window.testHooks?.populateScenarios, {
  timeout: 5000,
});

// Call the real application function
await page.evaluate(
  (scenarios) => {
    window.testHooks.populateScenarios(scenarios);
  },
  ['Scenario1', 'Scenario2']
);
```

### ✅ DO: Interact Like Users

Click real buttons, fill real inputs, and use Playwright's locators:

```javascript
const enterButton = page.locator('#btn-enter-ar');
await enterButton.click();

const nameInput = page.locator('#new-scenario-name');
await nameInput.fill('My Scenario');
```

### ✅ DO: Wait for Real State Changes

Use Playwright's built-in assertions that auto-wait:

```javascript
await expect(button).toBeEnabled();
await expect(modal).toBeHidden();
await expect(input).toHaveValue('expected');
```

### ❌ DON'T: Manipulate DOM Directly

This bypasses application logic and can mask bugs:

```javascript
// BAD - bypasses real behavior
await page.evaluate(() => {
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
});

// GOOD - calls real function
await page.evaluate(() => {
  window.testHooks.showRecordingControls();
});
```

### ❌ DON'T: Dispatch Events Manually

If the real code doesn't dispatch an event, your test shouldn't either:

```javascript
// BAD - real populateScenarios doesn't dispatch change
select.dispatchEvent(new Event('change'));

// GOOD - use the real function which handles state correctly
window.testHooks.populateScenarios(['Scenario1']);
```

### When DOM Manipulation Is Acceptable

Some cases where direct DOM access is okay:

1. **Hiding blocking modals** to access elements behind them:

   ```javascript
   await page.evaluate(() => {
     document.getElementById('setup-modal')?.classList.add('hidden');
   });
   ```

2. **Verifying element structure** (existence, attributes) as baseline checks

3. **Setting up fixtures** that have no corresponding app function

## Available Test Hooks

The following functions are exposed via `window.testHooks` (dev mode only):

| Function                                 | Purpose                                      |
| ---------------------------------------- | -------------------------------------------- |
| `populateScenarios(scenarios: string[])` | Simulate folder selection with scenario list |
| `validateEnterButton()`                  | Trigger Enter AR button validation           |
| `showRecordingControls()`                | Show recording UI (stop, ref point buttons)  |
| `hideRecordingControls()`                | Hide recording UI, show start button         |
| `updateGpsInfo(accuracy: number)`        | Show GPS info with accuracy value            |
| `updateArInfo(status: string)`           | Show AR info with tracking status            |

### Example: Complete Test Pattern

```javascript
test('scenario dropdown works correctly', async ({ page }) => {
  // 1. Wait for app and hooks to be ready
  await page.goto('/');
  await page.locator('#setup-modal').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.testHooks?.populateScenarios, {
    timeout: 5000,
  });

  // 2. Call real app functions
  await page.evaluate(() => {
    window.testHooks.populateScenarios(['Existing Scenario']);
  });

  // 3. Interact like a user
  const select = page.locator('#scenario-select');
  await select.selectOption('Existing Scenario');

  // 4. Assert on observable outcomes
  await expect(select).toHaveValue('Existing Scenario');
  const enterButton = page.locator('#btn-enter-ar');
  await expect(enterButton).toBeEnabled();
});
```

## Adding New Test Hooks

If you need to test a function that isn't exposed:

1. Export the function from its module (e.g., `src/ui/hud.ts`)
2. Add it to `testHooks` in `src/main.ts`:

```typescript
void import('./ui/hud').then(({ newFunction, ...others }) => {
  (window as unknown as { testHooks: object }).testHooks = {
    // existing hooks...
    newFunction,
  };
});
```

3. Use it in tests with proper waiting for async initialization

## Related Documentation

- [docs/2026-01-23-e2e-test-problems.md](../../GpsPlusSlamJs_Docs/docs/2026-01-23-e2e-test-problems.md) - Pattern analysis and refactoring history
- [docs/implementation-progress.md](../../GpsPlusSlamJs_Docs/docs/implementation-progress.md) - Development log
