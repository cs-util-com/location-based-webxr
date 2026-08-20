// @ts-check
/**
 * schedule.mjs — decides which approved items may be published right now.
 *
 * This is the safety-critical half of the publishing pipeline (plan decisions
 * D3, D7, D20). Two mistakes it exists to make impossible:
 *
 * - **Publishing something the owner has not approved.** Every channel starts
 *   at review-everything, and approval is a state carried on the item, so an
 *   unapproved item is never due — whatever its channel's autonomy says.
 * - **Posting to a community venue too often.** Reddit and Hacker News
 *   tolerate roughly one self-promotional post per author per several weeks.
 *   Exceeding that gets posts removed and accounts shadowbanned, and the
 *   damage is to the project's name rather than to a throwaway login. So the
 *   interval is data, per channel, and a channel with no interval configured
 *   is an ERROR rather than an invitation.
 *
 * Pure: takes the queue, the channel table, the posting history and the
 * current time, and returns a decision. No I/O, no clock, no network — which
 * is what makes "would this post to Reddit twice in a week?" a unit test
 * rather than a thing you find out afterwards.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/**
 * @typedef {object} QueueItem
 * @property {string} id
 * @property {string} channel
 * @property {string} [status] only `'approved'` is ever released
 * @property {number} [queuedAt] epoch ms; oldest goes first
 */

/**
 * @typedef {object} ChannelConfig
 * @property {'auto' | 'manual'} [autonomy] `'manual'` means a human sends it
 * @property {number} minIntervalMs REQUIRED — no default is safe
 * @property {number} [maxPerWindow] rolling-window cap, e.g. 3
 * @property {number} [windowMs] the window the cap applies over
 */

/**
 * @typedef {object} Decision
 * @property {{ item: QueueItem, mode: 'auto' | 'manual' }[]} due
 * @property {{ item: QueueItem, reason: string, nextEligibleAt?: number }[]} withheld
 */

/**
 * @param {object} input
 * @param {readonly QueueItem[]} input.items the approval queue
 * @param {Record<string, ChannelConfig>} input.channels per-channel rules
 * @param {Record<string, readonly number[]>} input.history epoch ms of past posts
 * @param {number} input.now epoch ms
 * @returns {Decision}
 * @throws {Error} when a channel is configured without `minIntervalMs` — a
 *   missing interval must never read as "unlimited".
 */
export function selectDue({ items, channels, history, now }) {
  for (const [name, config] of Object.entries(channels)) {
    if (typeof config.minIntervalMs !== "number") {
      throw new Error(
        `schedule: channel ${JSON.stringify(name)} has no minIntervalMs. ` +
          `Refusing to assume one — an unbounded posting rate is how an ` +
          `account gets banned.`,
      );
    }
  }

  /** @type {Decision['due']} */
  const due = [];
  /** @type {Decision['withheld']} */
  const withheld = [];
  /** Channels already served in THIS run; one post per channel per run. */
  const served = new Set();

  const ordered = [...items].sort(
    (a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0),
  );

  for (const item of ordered) {
    if (item.status !== "approved") {
      withheld.push({
        item,
        reason: `not approved (status ${JSON.stringify(item.status ?? null)})`,
      });
      continue;
    }

    const config = channels[item.channel];
    if (!config) {
      withheld.push({
        item,
        reason: `unknown channel ${JSON.stringify(item.channel)}`,
      });
      continue;
    }

    if (served.has(item.channel)) {
      withheld.push({
        item,
        reason: `another item was already released to ${item.channel} in this run`,
      });
      continue;
    }

    const past = history[item.channel] ?? [];
    const lastAt = past.length > 0 ? Math.max(...past) : undefined;
    if (lastAt !== undefined && now - lastAt < config.minIntervalMs) {
      withheld.push({
        item,
        reason: `inside ${item.channel}'s minimum interval`,
        nextEligibleAt: lastAt + config.minIntervalMs,
      });
      continue;
    }

    if (config.maxPerWindow !== undefined && config.windowMs !== undefined) {
      const windowStart = now - config.windowMs;
      const inWindow = past.filter((at) => at > windowStart);
      if (inWindow.length >= config.maxPerWindow) {
        const oldestInWindow = Math.min(...inWindow);
        withheld.push({
          item,
          reason:
            `${item.channel} is at its cap of ${config.maxPerWindow} in the ` +
            `last ${Math.round(config.windowMs / 86_400_000)} days`,
          nextEligibleAt: oldestInWindow + config.windowMs,
        });
        continue;
      }
    }

    served.add(item.channel);
    due.push({ item, mode: config.autonomy === "auto" ? "auto" : "manual" });
  }

  return { due, withheld };
}
