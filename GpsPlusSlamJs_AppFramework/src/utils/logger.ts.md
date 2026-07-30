# logger.ts

## Purpose

Configurable logging utility that provides a simple API with log levels. Also maintains an in-memory ring buffer of recent log entries for display in the expandable log panel UI (User Feedback Issue #5).

## Public API

### Types

```typescript
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface LogEntry {
  readonly timestamp: number; // Unix timestamp (Date.now())
  readonly level: LogLevel;
  readonly tag: string; // Source module
  readonly message: string; // Stringified log content
}
```

### `createLogger(tag: string): Logger`

Creates a logger with a specific tag prefix.

```typescript
const log = createLogger('GPS');
log.info('Watch started'); // Console: [GPS] Watch started
log.error('Error:', err); // Console: [GPS] Error: <error details>
```

### `setGlobalLogLevel(level: LogLevel): void`

Sets the minimum log level. Messages below this level are not output to console (but still added to buffer).

### `getGlobalLogLevel(): LogLevel`

Returns the current global log level.

### `getLogBuffer(): LogEntry[]`

Returns a **copy** of the log buffer. Safe to mutate without affecting internal state.

### `clearLogBuffer(): void`

Clears all entries from the log buffer.

### `subscribeToLogs(callback: (entry: LogEntry) => void): () => void`

Subscribe to new log entries. Returns an unsubscribe function.

```typescript
const unsubscribe = subscribeToLogs((entry) => {
  console.log('New log:', entry.message);
});

// Later...
unsubscribe();
```

## Invariants & Assumptions

1. **Ring buffer limit:** Maximum 100 entries. When exceeded, oldest entries are dropped.

2. **Buffer vs Console:** All log calls add to buffer regardless of log level. Console output is filtered by `globalLogLevel`.

3. **Safe message serialization:** Arguments are serialized safely to strings:
   - **Error instances:** Serialized to JSON with `name`, `message`, `stack`, and any enumerable properties (e.g., `code`, `retryable`).
   - **Circular references:** Handled gracefully; cycles are replaced with `[Circular]` placeholder.
   - **Special types:** BigInt, Symbol, and functions are converted to descriptive strings.
   - **Null/undefined:** Converted to literal strings `"null"` and `"undefined"`.
   - **Fallback:** If serialization still fails, `[Unserializable]` is used.
   - **Logging never throws** due to serialization errors.

4. **Subscriber notification:** Subscribers are notified synchronously for each log call.

5. **Thread safety:** Not applicable (single-threaded JS), but care is taken to avoid mutation of returned buffer copies.

   **`LogEntry` is fully readonly** — a record is immutable once created. Pinned
   at the type level by the `LogEntry ≡ Readonly<LogEntry>` guard in
   `logger.test.ts` (Finding #6, 2026-03-05 code review), so widening a field
   back to mutable fails the build rather than silently allowing buffer edits.

6. **Sentry integration:** All log levels add Sentry breadcrumbs for debugging context. When an exception is later captured, Sentry will show the trail of log messages leading up to it. Additionally, both `warn` and `error` produce standalone Sentry **Issues** (so the Issues dashboard is the single place to watch anything logged at warn/error level):
   - `log.warn()` calls `Sentry.captureMessage(message, { level: 'warning', fingerprint: [...] })`.
   - `log.error()` with one or more `Error` arguments calls `Sentry.captureException()` for each `Error` (full stack trace).
   - `log.error()` with **no** `Error` argument (string-only) falls back to `Sentry.captureMessage(message, { level: 'error', fingerprint: [...] })`. The fallback is mutually exclusive with `captureException`, so an error carrying an `Error` never also produces a message Issue.
   - **Template-based fingerprint grouping:** the fingerprint is `['log', level, tag, template]`, where `template` is the message with its dynamic tokens normalized. This collapses dynamic values into a single Issue **per message kind**, while two genuinely different messages that share a `tag` stay as separate Issues. The `tag` identifies the source module, not the kind of message, so it is intentionally _not_ the sole grouping key. `debug`/`info` remain breadcrumb-only.
     - **Normalized (replaced with placeholders) by `toFingerprintTemplate`:**
       - UUIDs → `{uuid}` (matched first, before numbers, so digit groups inside a UUID are not shredded).
       - Numbers → `{n}`: signed, decimal, and exponent forms (`-3.5`, `1e3`, `100`). Because numbers run before the quoted-string rule, a quoted path with an embedded index (`"actions/000001.json"`) collapses entirely to `"{str}"`. ISO timestamps fold into a stable (if lossy) numeric template via this rule — no dedicated date rule exists.
       - Quoted strings → `"{str}"` / `'{str}'` (both quote styles).
     - **Deliberately NOT normalized** (verified against real call sites — over-normalizing these would merge distinct problems, which is worse than mild fragmentation):
       - Free-form appended `error.message` text — it carries the actual diagnosis and must keep distinct errors as distinct Issues.
       - Bare (unquoted, non-UUID) identifiers/paths such as `${pointId}`, `${name}`, `${entry.fullPath}` — a rule broad enough to catch these would also swallow ordinary English words (e.g. hex-only words). Wrap such values in quotes at the call site if you want them grouped.

## Examples

```typescript
import {
  createLogger,
  LogLevel,
  setGlobalLogLevel,
  getLogBuffer,
} from './logger';

// Production: suppress debug logs in console
setGlobalLogLevel(LogLevel.INFO);

const log = createLogger('App');
log.debug('Verbose info'); // Not in console, but in buffer
log.info('App started'); // In console and buffer

// Access recent logs
const buffer = getLogBuffer();
console.log(`${buffer.length} log entries in buffer`);
```

## Tests

Unit tests in [logger.test.ts](logger.test.ts) cover:

- Logger creation with tag prefix
- Log level filtering for console output
- Ring buffer storage (100 entry limit)
- Buffer independence (returns copy)
- Buffer entries added regardless of log level
- Subscription and unsubscription
- Multiple subscriber support
- Safe serialization of Error instances (name, message, stack, enumerable props)
- Safe handling of circular references
- Graceful handling of null, undefined, BigInt, Symbol, and functions
- **Sentry integration:**
  - Breadcrumbs added for all log levels (debug, info, warn, error)
  - `captureMessage` called with `'warning'` level and a `['log', 'warning', tag, template]` fingerprint for `log.warn()`
  - Warnings of the same kind (same normalized template) share a fingerprint despite dynamic message content (grouped into one Issue)
  - Genuinely different warnings that share a tag get different fingerprints (kept as separate Issues)
  - `captureException` called for Error objects in `log.error()`
  - Multiple Error objects in single `log.error()` call all reported
  - String-only `log.error()` falls back to `captureMessage` with `'error'` level and a `['log', 'error', tag, template]` fingerprint
  - Numbers and UUIDs in messages are normalized so otherwise-identical lines group together
  - `captureMessage` is NOT called when an `Error` is present in `log.error()` (no duplicate Issue)
  - `captureMessage` NOT called for debug/info logs
  - Non-Error arguments don't trigger `captureException`
  - `log.debug/info/warn` with Error objects don't trigger `captureException`
- **Fingerprint template normalization** (`toFingerprintTemplate`, derived from a review of real call sites):
  - Signed / decimal / exponent numbers all normalize to `{n}`
  - ISO 8601 timestamps group via the number rule (stable, if lossy, template)
  - A double-quoted path with an embedded number fully collapses to `"{str}"` (number rule runs before the quote rule)
  - Single-quoted strings normalize the same as double-quoted
  - A message mixing several token kinds (numbers + quoted filename) groups across differing concrete values
  - Free-form `error.message` text is NOT normalized (distinct errors stay distinct — deliberate boundary)
  - Bare unquoted non-UUID identifiers are NOT normalized (deliberate boundary)
