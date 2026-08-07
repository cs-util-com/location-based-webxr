# Reference Point Picker Module

**Purpose:** Provides a modal UI for selecting or creating reference point names, enabling consistent naming across recording sessions and multiple observations of the same physical point.

## Public API

### Types

```typescript
interface RefPointPickerResult {
  id: string; // The selected or entered reference point ID
  isNew: boolean; // True if new name, false if selecting existing
}
```

### Functions

| Function                   | Signature                                                                                              | Description                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `showRefPointPicker`       | `(existingIds: string[], sessionUsage?: Map<string, number>) => Promise<RefPointPickerResult \| null>` | Shows the picker modal. Returns selection or null if cancelled.      |
| `hideRefPointPicker`       | `() => void`                                                                                           | Hides the picker modal (called automatically on selection/cancel).   |
| `isRefPointPickerVisible`  | `() => boolean`                                                                                        | Returns true if picker is currently visible.                         |
| `createRefPointPickerHtml` | `() => string`                                                                                         | Returns the HTML content for the picker modal.                       |
| `cancelRefPointPicker`     | `() => void`                                                                                           | Cancel from outside (e.g., browser back button). Resolves with null. |

## Invariants & Assumptions

- **Single instance:** Only one picker can be shown at a time. The caller (`handleMarkRefPoint`) guards with `isRefPointPickerVisible()` to prevent duplicate invocations.
- **Confirm button disabling:** After the first confirm/cancel/suggestion click, the confirm button is disabled to prevent double-submit. It is re-enabled on the next `showRefPointPicker()` call.
- **Empty validation:** Empty names are not allowed; confirm button has no effect if input is empty.
- **Whitespace trimming:** User input is trimmed before use.
- **Case-sensitive matching:** Existing ID matching is case-sensitive.
- **DOM requirement:** Expects `#ref-point-picker-modal` element to exist in the DOM.
- **Usage partitioning:** When a `sessionUsage` map is provided, suggestions are partitioned: unused ref points first, then used ref points (grayed out with `opacity-50` and a "(used Nx)" badge). Both remain selectable.
- **Navigation integration:** Opening the picker pushes a `history.pushState` entry so the browser back button closes the modal. Closing (confirm/cancel/suggestion) calls `popModalState()` to clean up. External cancel via `cancelRefPointPicker()` resolves with null.

## User Flow

1. User taps "Mark Reference Point" button (📍)
2. Picker modal appears with:
   - Text input for entering/searching
   - List of existing ref point names (from current scenario)
3. User can:
   - Type a new name → Click "Confirm" → Creates new ref point
   - Click existing name → Auto-confirms as re-observation
   - Type to filter existing list → Click matching item
   - Click "Cancel" → No action taken
4. Modal closes and ref point is saved

## Example Usage

```typescript
import {
  showRefPointPicker,
  createRefPointPickerHtml,
} from './ui/ref-point-picker';

// Initialize picker HTML (once, on app startup)
document.getElementById('ref-point-picker-modal').innerHTML =
  createRefPointPickerHtml();

// Later, when user wants to mark a ref point:
const existingIds = ['Bench Corner', 'Fountain', 'Tree A'];
const sessionUsage = new Map([['Fountain', 2]]); // already used 2 times
const result = await showRefPointPicker(existingIds, sessionUsage);

if (result) {
  if (result.isNew) {
    console.log(`Creating new ref point: ${result.id}`);
  } else {
    console.log(`Re-observing existing ref point: ${result.id}`);
  }
} else {
  console.log('User cancelled');
}
```

## Tests

Unit tests in `ref-point-picker.test.ts` cover:

- HTML generation with required element IDs
- Visibility state management
- Promise resolution on confirm/cancel
- Suggestion list population and filtering
- Input validation (empty name rejection, whitespace trimming)
- Click-to-select behavior for existing ref points
- **Issue 5:** Confirm button disabling after first click, re-enabling on next show, double-click prevention
- **Issue 6:** Usage map acceptance, "(used Nx)" badge rendering, list partitioning (unused first), backward compatibility without usage map, correct count display, filtering with partitioned lists
- **Issue 7:** History state push on show, pop on confirm/cancel/suggestion, popstate cancels picker (simulated back button)

## Related Files

- [main.ts](../main.ts) - Wires up the picker to the ref point marking flow
- [navigation.ts](./navigation.ts) - History-based back-button handling for modal
- [ref-point-loader.ts](../storage/ref-point-loader.ts) - Provides `listRefPointIds()` for suggestions
- [index.html](../../index.html) - Contains the modal container element
