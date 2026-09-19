/** Bounded serial runner for --compare-map3d; see the sidecar. */
import {
  OPERATOR_COOLDOWN_MS,
  GIVE_UP_AFTER_REFUSALS,
  waitMsBeforeRequest,
} from "./benchmark-matrix.mjs";
import { measureRequest } from "./benchmark-request.mjs";

const defaults = {
  measure: measureRequest,
  // Opt-in: every existing caller and every historical artifact predates slot
  // gating, so leaving it undefined keeps those invocations reproducible.
  readStatus: undefined,
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
    readStatus,
    now,
    sleep,
    save,
    log,
    budgetMs,
    maxTotalBytes,
    requestTimeoutMs,
    maxResponseBytes,
  } = { ...defaults, ...options };
  assertBudgets([budgetMs, maxTotalBytes, requestTimeoutMs, maxResponseBytes]);
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
    const gate = await awaitSlot({
      readStatus,
      url: cell.url,
      sleep,
      log,
      remainingMs: () => budgetMs - (now() - started),
    });
    if (gate.skipped !== undefined) {
      results.push({ ...cell, statusBefore: gate.statusBefore, ...gate });
      save(snapshot());
      continue;
    }
    const { statusBefore } = gate;
    const requestBudgetMs = budgetMs - (now() - started);
    log(`[${results.length + 1}/${cells.length}] ${cell.id}`);
    const measured = await measure({
      ...cell,
      timeoutMs: Math.min(requestTimeoutMs, requestBudgetMs),
      maxBytes: Math.min(maxResponseBytes, maxTotalBytes - bytes),
    });
    const finished = now();
    endedAt[cell.operator] = finished;
    bytes += measured.bytes ?? 0;
    recordFailure(measured, cell.operator, failures, endedAt, finished);
    const statusAfter = await readStatusOnFailure(readStatus, measured, cell);
    results.push({
      ...cell,
      ...measured,
      ...(statusBefore === undefined ? {} : { statusBefore }),
      ...(statusAfter === undefined ? {} : { statusAfter }),
    });
    save(snapshot());
    log(describeResult(measured, statusAfter));
  }
  const result = snapshot();
  save(result);
  return result;
}

function assertBudgets(values) {
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("Budgets must be finite and positive");
  }
}

/**
 * A second status reading, taken only after a FAILED request.
 *
 * Reading after every success would double the request count against the
 * operator for no diagnostic gain. Reading after a refusal is the entire point:
 * "slots were free before and after" is what separates a query killed on
 * arrival from one that merely queued.
 */
async function readStatusOnFailure(readStatus, measured, cell) {
  if (readStatus === undefined || measured.ok) return undefined;
  return readStatus({ url: cell.url });
}

/**
 * Waits for a real slot before issuing, per `/api/status`.
 *
 * The blind cooldown assumes a slot frees on a fixed schedule; the status
 * endpoint says when one actually does. Reading it also makes a refusal
 * attributable, which is the part that matters most: a 504 arriving in ~10 s
 * with slots still free is a query killed on arrival, not queueing, and without
 * a reading the two are indistinguishable.
 *
 * Returns `{ statusBefore }`, or `{ statusBefore, skipped }` when the reported
 * wait would consume the rest of the budget. `statusBefore` is undefined when
 * no reader was supplied.
 */
async function awaitSlot({ readStatus, url, sleep, log, remainingMs }) {
  if (readStatus === undefined) return {};
  const first = await readStatus({ url });
  if (first.waitMs <= 0) return { statusBefore: first };
  if (first.waitMs >= remainingMs()) {
    return {
      statusBefore: first,
      skipped: `no slot for ${Math.ceil(first.waitMs / 1000)}s, beyond remaining budget`,
    };
  }
  log(`slot wait: ${Math.ceil(first.waitMs / 1000)}s for ${url}`);
  await sleep(first.waitMs);
  // Re-read rather than trusting the first snapshot's estimate: the wait was
  // derived from the server's clock at the moment it answered.
  return { statusBefore: await readStatus({ url }) };
}

function recordFailure(measured, operator, failures, endedAt, finished) {
  if (measured.ok) return;
  failures[operator] = (failures[operator] ?? 0) + 1;
  const retryDelay = retryAfterMs(measured.retryAfter, finished);
  endedAt[operator] = finished + Math.max(0, retryDelay - OPERATOR_COOLDOWN_MS);
}

function describeResult(measured, statusAfter) {
  const slots =
    statusAfter?.ok === true
      ? `, ${statusAfter.slotsAvailable} slots free`
      : "";
  return `${measured.ok ? "valid" : "FAILED"} ${measured.status ?? ""}: ${measured.totalMs ?? 0}ms, ${measured.bytes ?? 0} decoded bytes${slots}`;
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
