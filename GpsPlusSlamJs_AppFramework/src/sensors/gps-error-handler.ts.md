# GPS Error Handler

## Purpose

Converts GPS GeolocationPositionError codes into user-friendly error messages for field use. Essential for the first field test where GPS issues are common.

## Public API

### `getGpsErrorMessage(error: GeolocationPositionError): string`

Maps a GeolocationPositionError to a user-friendly message.

- **Input**: A `GeolocationPositionError` object with `code` property
- **Output**: Human-readable string explaining the error and possible remediation
- **Error modes**: Returns generic message for unknown error codes

### `createGpsErrorHandler(showError: (msg: string) => void): PositionErrorCallback`

Factory that creates a callback suitable for `navigator.geolocation.watchPosition`.

- **Input**: A function to display errors to the user (e.g., `showError` from hud.ts)
- **Output**: A `PositionErrorCallback` that logs and displays GPS errors
- **Error modes**: None; always produces a valid callback

### Constants

- `GPS_ERROR_CODES`: Readonly object mapping symbolic names to error codes (1, 2, 3)
- `GPS_ERROR_MESSAGES`: Readonly object mapping error codes to message strings

## Invariants & Assumptions

- GeolocationPositionError.code follows W3C spec: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
- Messages are designed for field users who may not be technical

## Examples

```typescript
import { createGpsErrorHandler, getGpsErrorMessage } from './gps-error-handler';

// Direct use
const msg = getGpsErrorMessage({
  code: 1,
  message: '',
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3,
});
// → "Location access denied. Please enable GPS in device settings."

// Factory pattern for watchPosition
const errorHandler = createGpsErrorHandler(showError);
navigator.geolocation.watchPosition(onSuccess, errorHandler);
```

## Tests

- [gps-error-handler.test.ts](./gps-error-handler.test.ts): 7 tests covering:
  - PERMISSION_DENIED error mapping
  - POSITION_UNAVAILABLE error mapping
  - TIMEOUT error mapping
  - Unknown error code fallback
  - Factory function callback invocation
  - Error logging behavior
