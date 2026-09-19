/** Bounded serial runner for --compare-map3d; see the sidecar. */
import {
  OPERATOR_COOLDOWN_MS,
  GIVE_UP_AFTER_REFUSALS,
  waitMsBeforeRequest,
} from "./benchmark-matrix.mjs";
import { measureRequest } from "./benchmark-request.mjs";

const defaults = {
  measure: measureRequest,
  now: Date.now,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  save: () => {},
  log: console.log,
  budgetMs: 15 * 60_000,
  maxTotalBytes: 500_000_000,
  requestTimeoutMs: 210_000,
  maxResponseBytes: 120_000_000,
};

export async function runComparison(cells, options = {}) {
  const {
    measure,
    now,
    sleep,
    save,
    log,
    budgetMs,
    maxTotalBytes,
    requestTimeoutMs,
    maxResponseBytes,
  } = { ...defaults, ...options };
  for (const value of [
    budgetMs,
    maxTotalBytes,
    requestTimeoutMs,
    maxResponseBytes,
  ]) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("Budgets must be finite and positive");
  }
  const started = now();
  const results = [];
  const endedAt = {};
  const failures = {};
  let bytes = 0;
  const snapshot = () => ({
    measuredAt: new Date(started).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    runtime: { node: process.version, platform: process.platform },
    settings: {
      budgetMs,
      maxTotalBytes,
      requestTimeoutMs,
      maxResponseBytes,
      cooldownMs: OPERATOR_COOLDOWN_MS,
    },
    plannedCells: cells,
    complete: results.length === cells.length,
    results,
    totals: {
      planned: cells.length,
      sent: results.filter((row) => row.skipped === undefined).length,
      skipped: results.filter((row) => row.skipped !== undefined).length,
      successful: results.filter((row) => row.ok === true).length,
      failed: results.filter((row) => row.ok === false).length,
      decodedBodyBytes: bytes,
    },
  });

  for (const cell of cells) {
    const wait = waitMsBeforeRequest({
      operator: cell.operator,
      now: now(),
      lastRequestAt: endedAt,
    });
    const reason = skipReason(cell.operator, failures, {
      wait,
      remainingMs: budgetMs - (now() - started),
      remainingBytes: maxTotalBytes - bytes,
    });
    if (reason !== undefined) {
      results.push({ ...cell, skipped: reason });
      save(snapshot());
      continue;
    }
    if (wait > 0) {
      log(`cooldown: ${Math.ceil(wait / 1000)}s for ${cell.operator}`);
      await sleep(wait);
    }
    const remainingMs = budgetMs - (now() - started);
    if (remainingMs <= 0) {
      results.push({
        ...cell,
        skipped: "runtime budget exhausted after cooldown",
      });
      save(snapshot());
      continue;
    }
    log(`[${results.length + 1}/${cells.length}] ${cell.id}`);
    const measured = await measure({
      ...cell,
      timeoutMs: Math.min(requestTimeoutMs, remainingMs),
      maxBytes: Math.min(maxResponseBytes, maxTotalBytes - bytes),
    });
    const finished = now();
    endedAt[cell.operator] = finished;
    bytes += measured.bytes ?? 0;
    recordFailure(measured, cell.operator, failures, endedAt, finished);
    results.push({ ...cell, ...measured });
    save(snapshot());
    log(describeResult(measured));
  }
  const result = snapshot();
  save(result);
  return result;
}

function recordFailure(measured, operator, failures, endedAt, finished) {
  if (measured.ok) return;
  failures[operator] = (failures[operator] ?? 0) + 1;
  const retryDelay = retryAfterMs(measured.retryAfter, finished);
  endedAt[operator] = finished + Math.max(0, retryDelay - OPERATOR_COOLDOWN_MS);
}

function describeResult(measured) {
  return `${measured.ok ? "valid" : "FAILED"} ${measured.status ?? ""}: ${measured.totalMs ?? 0}ms, ${measured.bytes ?? 0} decoded bytes`;
}

function skipReason(operator, failures, { wait, remainingMs, remainingBytes }) {
  if ((failures[operator] ?? 0) >= GIVE_UP_AFTER_REFUSALS)
    return "operator stopped after two failed requests";
  if (remainingBytes <= 0) return "decoded-byte budget exhausted";
  if (remainingMs <= wait)
    return "runtime budget insufficient for cooldown and request";
  return undefined;
}

function retryAfterMs(value, now) {
  if (value === undefined || value === null) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
