/**
 * The client's own view of its Overpass slot allocation.
 *
 * **Why this is local and authoritative rather than a wrapper over
 * `/api/status`:** measured 2026-07-28, `/api/status` lags actual consumption.
 * Three concurrent queries returned `200, 429, 200` while a status read 600 ms
 * into the burst still reported the full allocation free. Asking the server
 * "may I?" before each request therefore does not prevent 429s.
 *
 * So slots are counted here, decremented the instant a request is dispatched,
 * and `/api/status` is used only to correct this view and to learn recovery
 * times — never as a pre-flight gate.
 *
 * @see slot-budget.ts.md
 */

import type { OverpassStatus } from "./overpass-status.js";

/** Measured on the public instances 2026-07-28: `Rate limit: 2`. */
const DEFAULT_SLOTS = 2;

/**
 * Ceiling on any single penalty.
 *
 * `Retry-After` and `/api/status` are third-party input. An absurd value must
 * not brick the client for a day; the cost of under-waiting is one more 429,
 * which is cheap and self-correcting.
 */
const DEFAULT_MAX_PENALTY_MS = 120_000;

export interface SlotBudgetOptions {
  /** Initial allocation. Overwritten by {@link OverpassSlotBudget.sync}. */
  readonly slots?: number;
  /** Injected clock, so recovery is testable without waiting for it. */
  readonly now?: () => number;
  readonly maxPenaltyMs?: number;
}

export class OverpassSlotBudget {
  private readonly now: () => number;
  private readonly maxPenaltyMs: number;

  private slots: number;
  private inUse = 0;
  /**
   * Absolute time before which nothing may be dispatched, whatever the
   * operator. Set only by an unqualified {@link penalise}.
   */
  private blockedUntilMs = 0;
  /**
   * Absolute time before which ONE operator may not be dispatched to.
   *
   * Keyed by the operator id `operatorForUrl` returns, not by hostname: three
   * of the five default endpoints are FOSSGIS mirrors sharing one quota, so a
   * per-host account would let a 429 from `lz4.overpass-api.de` be answered by
   * asking `overpass-api.de` — the same wall, one hop along.
   */
  private readonly operatorBlockedUntilMs = new Map<string, number>();
  private isUnlimited = false;

  constructor(options: SlotBudgetOptions = {}) {
    this.slots = options.slots ?? DEFAULT_SLOTS;
    this.now = options.now ?? (() => Date.now());
    this.maxPenaltyMs = options.maxPenaltyMs ?? DEFAULT_MAX_PENALTY_MS;
  }

  /** Total allocation, as last understood. */
  get capacity(): number {
    return this.isUnlimited ? Number.POSITIVE_INFINITY : this.slots;
  }

  /** True when the instance reports no slot limit (`Rate limit: 0`). */
  get unlimited(): boolean {
    return this.isUnlimited;
  }

  /**
   * Slots dispatchable right now. Zero while penalised, regardless of count.
   *
   * **A penalty outranks `unlimited`.** `Rate limit: 0` is a *claim* by a
   * server; a 429 is *evidence*. Observed in the wild on 2026-07-28: the public
   * pool normally reports `Rate limit: 2` but was seen reporting `0` — and if
   * that transient claim let the budget ignore subsequent 429s, the protection
   * this class exists to provide would switch itself off exactly when a server
   * was under enough stress to misreport.
   */
  get available(): number {
    return this.freeSlots();
  }

  /**
   * Slots dispatchable right now **to one named operator**.
   *
   * Differs from {@link available} only by that operator's own penalty; the
   * allocation itself is shared, because it models this client's outbound
   * concurrency rather than any server's quota.
   */
  availableFor(operator: string): number {
    return this.freeSlots([operator]);
  }

  /**
   * Slots dispatchable given the operators a caller could actually reach.
   *
   * `undefined` or empty means "unqualified" and answers on the global penalty
   * alone — the pre-2026-08-19 behaviour, kept because this class is exported
   * from the package index and external callers hold it.
   */
  private freeSlots(operators?: readonly string[]): number {
    if (this.now() < this.blockedUntilMs) return 0;
    // EVERY operator, not any. A pool with one live operator left is still a
    // pool this client can fetch from, and refusing here is precisely the bug
    // being fixed. See `tryAcquire`.
    if (
      operators !== undefined &&
      operators.length > 0 &&
      operators.every((operator) => this.operatorBlocked(operator))
    ) {
      return 0;
    }
    if (this.isUnlimited) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.slots - this.inUse);
  }

  private operatorBlocked(operator: string): boolean {
    return this.now() < (this.operatorBlockedUntilMs.get(operator) ?? 0);
  }

  /**
   * Takes a slot if one is free.
   *
   * Answers immediately and never waits: whether to give up and serve cache or
   * to wait for a slot is the caller's decision, and the two callers want
   * opposite things (the movement trigger gives up, an explicit prefetch waits).
   *
   * Every `true` must be paired with exactly one {@link release}.
   */
  tryAcquire(operators?: readonly string[]): boolean {
    // NOT short-circuited on `isUnlimited`: a penalty from a real 429 must
    // still block, even on an instance claiming no limit. See `available`.
    if (this.freeSlots(operators) <= 0) return false;
    // Counted SYMMETRICALLY, including while unlimited. Callers pair every
    // `true` with a `release()` in a `finally`, so skipping the increment here
    // let those releases drive `inUse` to 0 against acquisitions that were
    // never counted. A later `sync` reporting a real `Rate limit: N` would then
    // resume from an understated `inUse` and could exceed the allocation until
    // the next pessimistic snapshot — the one direction of error this class
    // exists to prevent. `available` and `capacity` already ignore `inUse`
    // while unlimited, so counting costs nothing.
    this.inUse++;
    return true;
  }

  /**
   * Returns a slot taken by {@link tryAcquire}.
   *
   * Idempotent below zero on purpose. A release path that runs in both a
   * `then` and a `finally`, or on both completion and abort, would otherwise
   * hand out free quota — silently, and in the direction that gets an IP
   * blocked.
   */
  release(): void {
    this.inUse = Math.max(0, this.inUse - 1);
  }

  /**
   * Blocks dispatch for `ms`, after a 429 or an explicit `Retry-After`.
   *
   * Takes the LONGEST outstanding penalty rather than the most recent: with two
   * 429s in flight, letting a short second penalty cancel a long first one puts
   * the client straight back into the wall.
   */
  penalise(ms: number, operator?: string): void {
    const clamped = Math.min(Math.max(0, ms), this.maxPenaltyMs);
    const until = this.now() + clamped;
    if (operator === undefined) {
      this.blockedUntilMs = Math.max(this.blockedUntilMs, until);
      return;
    }
    // Longest-wins WITHIN an operator, for the reason above; independent
    // ACROSS them, because a short penalty from one server must neither
    // shorten nor lengthen another's.
    this.operatorBlockedUntilMs.set(
      operator,
      Math.max(this.operatorBlockedUntilMs.get(operator) ?? 0, until),
    );
  }

  /**
   * Milliseconds until dispatch is permitted again.
   *
   * `0` when a slot is free **and** when slots are merely in use — "busy"
   * resolves when our own in-flight request completes, which the caller is
   * already awaiting, so there is no meaningful duration to report. A non-zero
   * value always means "the server told us to wait".
   */
  msUntilAvailable(operators?: readonly string[]): number {
    // Reported even when unlimited, for the same reason: a 429 we actually
    // received is better evidence than a rate-limit line we were told.
    const global = Math.max(0, this.blockedUntilMs - this.now());
    if (operators === undefined || operators.length === 0) return global;
    // THE SOONEST, not the longest. This value becomes
    // `RateLimitedError.retryAfterMs`, which `area-loader`'s prefetch sleeps
    // on; reporting the longest would idle past the moment the
    // faster-recovering operator could legitimately have been asked.
    const soonest = Math.min(
      ...operators.map((operator) =>
        Math.max(
          0,
          (this.operatorBlockedUntilMs.get(operator) ?? 0) - this.now(),
        ),
      ),
    );
    return Math.max(global, soonest);
  }

  /**
   * Corrects this view from an `/api/status` snapshot.
   *
   * **Asymmetric on purpose.** A sync may make the client more cautious and
   * never less: the server reported free slots while it was actively 429-ing
   * us, so believing an optimistic snapshot would reset the budget using the
   * very response that proves optimism wrong. A pessimistic snapshot IS
   * trusted, because it means something consumed the allocation that we did not
   * account for — another tab, another process, a retry we lost track of.
   *
   * The allocation SIZE is always adopted, since a self-hosted or
   * differently-configured instance may allow more or fewer than the public 2.
   */
  sync(status: OverpassStatus, operator?: string): void {
    this.isUnlimited = status.unlimited;
    if (status.unlimited) {
      // Deliberately does NOT clear an existing penalty. A server reporting
      // "no limit" while we hold a fresh 429 from it is contradicting itself,
      // and the 429 is the observation.
      return;
    }

    if (Number.isFinite(status.rateLimit) && status.rateLimit > 0) {
      this.slots = status.rateLimit;
    }

    // "Zero free and no recovery time" is UNINFORMATIVE, not bad news.
    //
    // The parser infers zero from the absence of the `N slots available now.`
    // line, because that is how Overpass reports exhaustion — but a real
    // exhausted response always also carries `Slot available after:` lines. A
    // body with neither is something else: a changed format, a truncated
    // response, a proxy's idea of helpful. Acting on it would set inUse to the
    // full allocation with nothing to ever release it and no penalty to expire,
    // which soft-locks the client permanently. Ignore it and fly on local
    // accounting, which is the authority anyway.
    const availabilityIsKnown =
      status.slotsAvailable > 0 || status.slotsAvailableAtMs.length > 0;
    if (!availabilityIsKnown) return;

    if (status.slotsAvailable < this.available) {
      // Trust the pessimistic view: assume everything the server has not
      // reported free is spent.
      this.inUse = Math.max(0, this.slots - status.slotsAvailable);
    }

    if (status.slotsAvailable <= 0 && status.nextSlotAtMs !== undefined) {
      // Server clock in, local clock out — a device with a skewed clock still
      // waits the right duration.
      //
      // ATTRIBUTED to the operator whose `/api/status` this is. `syncBudget`
      // deliberately asks the pool's FIRST entry rather than a drawn one, so
      // this recovery time describes exactly one operator; penalising the whole
      // pool with it would re-create the bug at a second call site.
      this.penalise(status.nextSlotAtMs - status.serverTimeMs, operator);
    }
  }
}
