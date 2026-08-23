// @ts-check
/**
 * channels.mjs — the per-channel publishing rules, as data.
 *
 * Plan decision D3 requires the autonomy level to be "explicit, versioned
 * state the pipeline reads, not a property of the code": every channel starts
 * at review-everything, and each graduates to agent-published individually,
 * when the owner is satisfied with that channel's output. Graduating a channel
 * is therefore a one-word edit here rather than a change to the scheduler.
 *
 * Two channels can never graduate, for reasons outside this repo:
 *
 * - **X** — its rules sanction API posting and prohibit browser automation,
 *   and there is no free API tier for new developers. The free route is a
 *   prefilled composer that a human sends (D17).
 * - **Medium** — stopped issuing API tokens to new integrations on
 *   2025-01-01. Its browser import tool is the only route.
 *
 * Hacker News has no write API at all, so its terminal state is structural
 * rather than a policy choice; Reddit's is a policy choice this project makes
 * deliberately.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/** @typedef {import('./schedule.mjs').ChannelConfig} ChannelConfig */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * @type {Record<string, ChannelConfig & { transport: string, note: string }>}
 */
export const CHANNELS = {
  blog: {
    autonomy: "manual",
    // A day apart at minimum, and no more than three in a rolling week
    // (D20). The cap is the load-bearing one: a five-month-old domain
    // publishing a burst of articles is the shape scaled-content policies
    // target, and throttling publication costs nothing because the queue
    // exists either way.
    minIntervalMs: DAY,
    maxPerWindow: 3,
    windowMs: 7 * DAY,
    transport: "wiki-status-flip",
    note: "Publication is the owner flipping status in the wiki; the site build renders it.",
  },
  devto: {
    autonomy: "manual",
    minIntervalMs: DAY,
    transport: "api",
    note: "Forem API accepts canonical_url, so syndication keeps the search value at home.",
  },
  medium: {
    autonomy: "manual",
    minIntervalMs: DAY,
    transport: "manual-import",
    note: "API closed to new integrations 2025-01-01. Import Story sets the canonical link itself.",
  },
  bluesky: {
    autonomy: "manual",
    minIntervalMs: 20 * HOUR,
    transport: "api",
    note: "Free API. A candidate to graduate first, being the lowest-stakes owned channel.",
  },
  mastodon: {
    autonomy: "manual",
    minIntervalMs: 20 * HOUR,
    transport: "api",
    note: "Free API.",
  },
  x: {
    autonomy: "manual",
    minIntervalMs: 20 * HOUR,
    transport: "prefilled-composer",
    note: "Terminal state: a human presses Post unless the paid API is adopted.",
  },
  reddit: {
    // Three weeks. Communities tolerate roughly one self-promotional post per
    // author per several weeks; exceeding it gets posts removed and accounts
    // shadowbanned, and the damage lands on the project's name.
    autonomy: "manual",
    minIntervalMs: 21 * DAY,
    transport: "manual",
    note: "Human-posted by policy, indefinitely. Each post needs a genuine reason to exist.",
  },
  hackernews: {
    autonomy: "manual",
    minIntervalMs: 21 * DAY,
    transport: "manual",
    note: "No write API exists; the terminal state is structural, not a choice.",
  },
  youtube: {
    autonomy: "manual",
    minIntervalMs: 7 * DAY,
    transport: "api-private-upload",
    note: "Uploaded private by the pipeline; the owner watches it and publishes (D18).",
  },
};

/**
 * Validate a channel table before the scheduler is handed it.
 *
 * @param {Record<string, ChannelConfig>} channels
 * @returns {string[]} problems, empty when the table is usable
 */
export function validateChannels(channels) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, config] of Object.entries(channels)) {
    if (typeof config.minIntervalMs !== "number" || config.minIntervalMs <= 0) {
      problems.push(`${name}: minIntervalMs must be a positive number`);
    }
    if (config.autonomy !== "auto" && config.autonomy !== "manual") {
      problems.push(`${name}: autonomy must be 'auto' or 'manual'`);
    }
    const hasCap = config.maxPerWindow !== undefined;
    const hasWindow = config.windowMs !== undefined;
    if (hasCap !== hasWindow) {
      problems.push(
        `${name}: maxPerWindow and windowMs must be set together — a cap with ` +
          `no window never applies, which reads as a cap that is working`,
      );
    }
  }
  return problems;
}
