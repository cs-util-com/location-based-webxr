/* eslint-disable no-console -- This IS the logging abstraction; console calls are intentional. */
/**
 * Configurable Logger Utility
 *
 * Provides a simple logging API with configurable log levels.
 * This allows disabling verbose logging in production while keeping
 * it available for development and debugging.
 *
 * Also maintains an in-memory ring buffer of recent log entries
 * for display in the expandable log panel UI.
 *
 * Sentry Integration:
 * - All log levels add Sentry breadcrumbs for debugging context
 * - log.warn() reports a standalone Sentry Issue (captureMessage)
 * - log.error() reports a standalone Sentry Issue: captureException for Error
 *   arguments, or a captureMessage fallback for string-only errors
 * - warn/error Issues are grouped by a normalized message template
 *   (['log', level, tag, template]) so dynamic values (frame indices, sizes,
 *   filenames) collapse into one Issue per message kind without merging
 *   genuinely different messages that share a tag
 */

import * as Sentry from '@sentry/browser';

import { createIsolatedRegistry } from './isolated-registry';

/**
 * Log levels in order of verbosity (lower = more verbose)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Global log level - controls what gets logged across all loggers
 */
let globalLogLevel: LogLevel = LogLevel.DEBUG;

/**
 * Maximum number of log entries to keep in the ring buffer
 */
const LOG_BUFFER_MAX_SIZE = 100;

/**
 * Structure for a single log entry in the buffer
 */
export interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly tag: string;
  readonly message: string;
}

/**
 * In-memory ring buffer of recent log entries
 */
let logBuffer: LogEntry[] = [];

/**
 * Subscribers that get notified when new log entries are added
 */
type LogSubscriber = (entry: LogEntry) => void;

/**
 * WHY THE ERROR SINK IS `console.error` AND NOT THIS MODULE'S OWN LOGGING.
 * Reporting a throwing subscriber through the logger would append an entry,
 * which notifies the subscribers, which throws again — an infinite recursion.
 * That hazard is the reason `createIsolatedRegistry` takes the sink as an
 * option instead of importing a logger itself (which would also make
 * `logger → isolated-registry → logger` a cycle the `check:cycles` gate
 * rejects).
 *
 * ADOPTING THE REGISTRY ALSO FIXED AN INCONSISTENCY. The old array snapshotted
 * unsubscribes by accident — `subscribers.filter(...)` REASSIGNS, so a
 * `for...of` already in flight kept the old array — while `push` mutated in
 * place, so a subscriber added during a dispatch received the very entry it
 * had not been subscribed for. Now both defer to the next entry, which is what
 * every other registry in the framework already did.
 */
const subscribers = createIsolatedRegistry<[LogEntry]>({
  onError: (err) => console.error('[Logger] Subscriber threw an error:', err),
});

/**
 * Serialize an Error instance to an object capturing name, message, stack,
 * and any enumerable properties.
 */
function serializeError(error: Error): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  // Copy enumerable properties (e.g., code, retryable)
  for (const key of Object.keys(error)) {
    result[key] = (error as unknown as Record<string, unknown>)[key];
  }
  return result;
}

/**
 * Safely stringify an object, handling circular references.
 * Uses a WeakSet to track seen objects and replaces cycles with a placeholder.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const replacer = (_key: string, val: unknown): unknown => {
    // Handle BigInt
    if (typeof val === 'bigint') {
      return val.toString();
    }
    // Handle objects (check for cycles)
    if (val !== null && typeof val === 'object') {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  };

  try {
    return JSON.stringify(value, replacer);
  } catch {
    // Ultimate fallback if stringify still fails
    return '[Unserializable]';
  }
}

/**
 * Serialize a single argument to a string for the log buffer.
 * Special-cases Error instances and handles circular/complex objects safely.
 */
function serializeArg(arg: unknown): string {
  if (arg === null) {
    return 'null';
  }
  if (arg === undefined) {
    return 'undefined';
  }
  if (typeof arg === 'string') {
    return arg;
  }
  if (typeof arg === 'number' || typeof arg === 'boolean') {
    return String(arg);
  }
  if (typeof arg === 'bigint') {
    return arg.toString();
  }
  if (typeof arg === 'symbol') {
    return arg.toString();
  }
  if (typeof arg === 'function') {
    return arg.name ? `[Function: ${arg.name}]` : '[Function]';
  }
  if (arg instanceof Error) {
    return safeStringify(serializeError(arg));
  }
  // For other objects/arrays, use safe stringify
  return safeStringify(arg);
}

/**
 * Serialize a log call's arguments once (quality-review C-5 — the buffer,
 * breadcrumb, and Sentry-message paths each used to re-serialize the same
 * args, i.e. 2–3× per log call). All downstream consumers take the string.
 */
function serializeArgs(args: unknown[]): string {
  return args.map((arg) => serializeArg(arg)).join(' ');
}

/**
 * Add an entry to the log buffer and notify subscribers
 */
function addToBuffer(level: LogLevel, tag: string, message: string): void {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    tag,
    message,
  };

  logBuffer.push(entry);

  // Ring buffer: remove oldest if over limit
  if (logBuffer.length > LOG_BUFFER_MAX_SIZE) {
    logBuffer.shift();
  }

  // Each subscriber is isolated, so one throwing subscriber cannot stop the
  // others receiving the entry. See the registry's declaration for why the
  // failure goes to `console.error` rather than through this module.
  subscribers.run(entry);
}

/**
 * Get a copy of the current log buffer
 * @returns Array of log entries (copy to prevent external mutation)
 */
export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

/**
 * Clear all entries from the log buffer
 */
export function clearLogBuffer(): void {
  logBuffer = [];
}

/**
 * Subscribe to new log entries
 * @param callback - Function called when a new log entry is added
 * @returns Unsubscribe function
 */
export function subscribeToLogs(callback: LogSubscriber): () => void {
  return subscribers.register(callback);
}

/**
 * Set the global log level
 * @param level - The minimum level to log
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

/**
 * Get the current global log level
 */
export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

/**
 * Logger interface for type safety
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Create a logger with a specific tag prefix
 * @param tag - The tag to prefix all log messages with (e.g., 'GPS', 'Storage')
 * @returns A logger object with debug, info, warn, error methods
 *
 * @example
 * ```typescript
 * const log = createLogger('GPS');
 * log.info('Watch started'); // [GPS] Watch started
 * log.error('Error:', err);  // [GPS] Error: <error details>
 * ```
 */
/**
 * Map LogLevel to Sentry breadcrumb severity.
 * Sentry uses 'warning' (not 'warn') for the warning level.
 */
function toSentryLevel(
  level: LogLevel
): 'debug' | 'info' | 'warning' | 'error' {
  switch (level) {
    case LogLevel.DEBUG:
      return 'debug';
    case LogLevel.INFO:
      return 'info';
    case LogLevel.WARN:
      return 'warning';
    case LogLevel.ERROR:
      return 'error';
    default:
      return 'info';
  }
}

/**
 * Add a Sentry breadcrumb for debugging context.
 * Breadcrumbs are attached to future exceptions, helping trace what happened before an error.
 */
function addSentryBreadcrumb(level: LogLevel, tag: string, body: string): void {
  const message = `[${tag}] ${body}`;
  Sentry.addBreadcrumb({
    category: 'log',
    level: toSentryLevel(level),
    message,
  });
}

/**
 * Normalize a log message body into a stable "template" for Sentry grouping.
 *
 * Replaces the dynamic tokens that typically vary between otherwise-identical
 * log lines (numbers, UUIDs, quoted strings) with placeholders. This makes the
 * fingerprint depend on the *kind* of message rather than its concrete values,
 * so that:
 * - the same message with different dynamic values collapses into one Issue
 *   (e.g. `frame 12` / `frame 87` -> `frame {n}`), and
 * - two genuinely different messages under the same tag stay as separate
 *   Issues (because their templates differ).
 *
 * Order matters: UUIDs are replaced before bare numbers, otherwise the number
 * rule would shred the digit groups inside a UUID first.
 */
function toFingerprintTemplate(body: string): string {
  return (
    body
      // UUIDs (e.g. 3f2504e0-4f89-11d3-9a0c-0305e82c3301)
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '{uuid}'
      )
      // Numbers: optional sign, decimals, exponent (e.g. -3.5, 1e9, 100)
      .replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, '{n}')
      // Quoted strings (filenames, ids) — keep the quotes, blank the contents
      .replace(/"[^"]*"/g, '"{str}"')
      .replace(/'[^']*'/g, "'{str}'")
  );
}

/**
 * Capture a log line as a standalone Sentry Issue (message event).
 *
 * Shared by `reportWarningToSentry` and the string-only branch of
 * `reportErrorsToSentry`. The fingerprint is
 * `['log', level, tag, <normalized template>]` so that dynamic values in the
 * message do not fragment one logical problem into many Issues, while distinct
 * messages from the same tag remain distinct Issues (see
 * {@link toFingerprintTemplate}).
 */
function captureLogMessage(
  level: 'warning' | 'error',
  tag: string,
  body: string
): void {
  const message = `[${tag}] ${body}`;
  Sentry.captureMessage(message, {
    level,
    fingerprint: ['log', level, tag, toFingerprintTemplate(body)],
  });
}

/**
 * Report a warning to Sentry as a standalone message.
 * Called for log.warn() so warnings are independently visible in the
 * Sentry dashboard, not only as breadcrumbs attached to later exceptions.
 */
function reportWarningToSentry(tag: string, body: string): void {
  captureLogMessage('warning', tag, body);
}

/**
 * Report log.error() arguments to Sentry as standalone Issues.
 *
 * - For every argument that is an `Error`, calls `captureException` so the
 *   Issue carries a full stack trace.
 * - If NO argument is an `Error` (a string-only `log.error(...)`), falls back
 *   to a message event so the error still surfaces as an Issue instead of only
 *   a breadcrumb/Log.
 *
 * The fallback is mutually exclusive with `captureException` to avoid duplicate
 * Issues when an Error is present, and groups via the same normalized template
 * fingerprint as warnings (see {@link captureLogMessage}).
 */
function reportErrorsToSentry(
  tag: string,
  args: unknown[],
  body: string
): void {
  let capturedError = false;
  for (const arg of args) {
    if (arg instanceof Error) {
      Sentry.captureException(arg);
      capturedError = true;
    }
  }
  if (!capturedError) {
    captureLogMessage('error', tag, body);
  }
}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;

  // Note: addToBuffer is called unconditionally (before the log level check) by design.
  // The ring buffer captures ALL log entries for the UI log panel, allowing users to
  // inspect debug-level details even when console output is configured for higher levels.
  // This separation provides maximum debugging capability without cluttering the console.
  //
  // Sentry breadcrumbs are also added unconditionally for all log levels.
  // This provides debugging context when exceptions are captured.
  return {
    debug: (...args: unknown[]): void => {
      const body = serializeArgs(args);
      addToBuffer(LogLevel.DEBUG, tag, body);
      addSentryBreadcrumb(LogLevel.DEBUG, tag, body);
      if (globalLogLevel <= LogLevel.DEBUG) {
        console.log(prefix, ...args);
      }
    },
    info: (...args: unknown[]): void => {
      const body = serializeArgs(args);
      addToBuffer(LogLevel.INFO, tag, body);
      addSentryBreadcrumb(LogLevel.INFO, tag, body);
      if (globalLogLevel <= LogLevel.INFO) {
        console.log(prefix, ...args);
      }
    },
    warn: (...args: unknown[]): void => {
      const body = serializeArgs(args);
      addToBuffer(LogLevel.WARN, tag, body);
      addSentryBreadcrumb(LogLevel.WARN, tag, body);
      // Report warnings as standalone Sentry messages for dashboard visibility
      reportWarningToSentry(tag, body);
      if (globalLogLevel <= LogLevel.WARN) {
        console.warn(prefix, ...args);
      }
    },
    error: (...args: unknown[]): void => {
      const body = serializeArgs(args);
      addToBuffer(LogLevel.ERROR, tag, body);
      addSentryBreadcrumb(LogLevel.ERROR, tag, body);
      // Report Error objects to Sentry for visibility in dashboard.
      // String-only errors fall back to captureMessage (see reportErrorsToSentry).
      reportErrorsToSentry(tag, args, body);
      if (globalLogLevel <= LogLevel.ERROR) {
        console.error(prefix, ...args);
      }
    },
  };
}
