#!/usr/bin/env node
// @ts-check
/**
 * drip.mjs — one publishing run.
 *
 * Reads the approval queue and the posting history, asks {@link selectDue}
 * what may go out now, and then either performs the post (channels that have
 * graduated to `auto`) or emits a **post pack** for the owner to send by hand
 * (everything else, which today is everything — see `channels.mjs`).
 *
 * **Dry run is the default and posting is opt-in.** A publishing script whose
 * default action is to publish is one bad invocation away from an accident,
 * and the accident is public. `--post` is required, and any channel with no
 * transport configured stays a pack regardless.
 *
 * Usage:
 *
 *     node scripts/marketing/drip.mjs --queue queue.json --history history.json
 *     node scripts/marketing/drip.mjs ... --post      # actually send
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

import { readFileSync, writeFileSync } from "node:fs";

import { CHANNELS, validateChannels } from "./channels.mjs";
import { selectDue } from "./schedule.mjs";
import {
  blueskyRecord,
  devToArticle,
  mastodonStatus,
  mediumImportSteps,
  xComposerUrl,
} from "./syndicate.mjs";

const DEFAULT_ORIGIN = "https://gps.csutil.com";

/**
 * Build the human-sendable pack for one due item.
 *
 * @param {import('./schedule.mjs').QueueItem & { title?: string, text?: string, slug?: string, tags?: string[], body?: string, description?: string }} item
 * @param {{ origin: string }} options
 * @returns {{ channel: string, instructions: string[], payload?: unknown }}
 */
export function buildPack(item, { origin }) {
  const url = item.slug ? `${origin}/blog/${item.slug}/` : origin;
  const text = item.text ?? item.title ?? "";

  switch (item.channel) {
    case "x":
      return {
        channel: "x",
        instructions: [
          "Open this prefilled composer and press Post:",
          xComposerUrl({ text, url }),
          "A link cannot be prefilled with media — attach an image by hand if the post needs one.",
        ],
      };
    case "medium": {
      const steps = mediumImportSteps(
        { slug: item.slug ?? "", title: item.title ?? "" },
        { origin },
      );
      return { channel: "medium", instructions: steps.steps };
    }
    case "reddit":
    case "hackernews":
      return {
        channel: item.channel,
        instructions: [
          `Post by hand, and only if it genuinely belongs there: ${url}`,
          "Read the community’s current self-promotion rules before posting.",
          "Suggested title and opening comment:",
          text,
        ],
      };
    case "devto":
      return {
        channel: "devto",
        instructions: ["Send this to the Forem API:"],
        payload: devToArticle(
          {
            slug: item.slug ?? "",
            title: item.title ?? "",
            ...(item.description !== undefined
              ? { description: item.description }
              : {}),
            ...(item.tags !== undefined ? { tags: item.tags } : {}),
            ...(item.body !== undefined ? { body: item.body } : {}),
          },
          { origin },
        ),
      };
    case "bluesky":
      return {
        channel: "bluesky",
        instructions: ["Post this record:"],
        payload: blueskyRecord({ text: `${text}\n\n${url}`, url }),
      };
    case "mastodon":
      return {
        channel: "mastodon",
        instructions: ["Post this status:"],
        payload: mastodonStatus({ text, url }),
      };
    default:
      return {
        channel: item.channel,
        instructions: [
          `No pack builder for ${item.channel}; send by hand.`,
          url,
        ],
      };
  }
}

/**
 * Run one drip cycle.
 *
 * @param {object} input
 * @param {readonly any[]} input.queue
 * @param {Record<string, readonly number[]>} input.history
 * @param {number} input.now
 * @param {string} [input.origin]
 * @param {Record<string, ChannelConfigLike>} [input.channels]
 * @param {Record<string, (pack: any) => Promise<void>>} [input.transports]
 *   channel → sender. A channel with no transport can only produce a pack,
 *   whatever its autonomy says — belt and braces.
 * @param {boolean} [input.post] actually send; defaults to false
 * @param {(line: string) => void} [input.log]
 * @returns {Promise<{ posted: string[], packs: any[], withheld: any[] }>}
 *
 * @typedef {import('./schedule.mjs').ChannelConfig} ChannelConfigLike
 */
export async function runDrip({
  queue,
  history,
  now,
  origin = DEFAULT_ORIGIN,
  channels = CHANNELS,
  transports = {},
  post = false,
  log = () => {},
}) {
  const problems = validateChannels(channels);
  if (problems.length > 0) {
    throw new Error(
      `drip: channel table is unusable:\n  ${problems.join("\n  ")}`,
    );
  }

  const { due, withheld } = selectDue({ items: queue, channels, history, now });

  /** @type {string[]} */
  const posted = [];
  /** @type {any[]} */
  const packs = [];

  for (const { item, mode } of due) {
    const pack = buildPack(item, { origin });
    const transport = transports[item.channel];
    const canSend = post && mode === "auto" && typeof transport === "function";

    if (canSend) {
      await transport(pack);
      posted.push(item.id);
      log(`  posted:  ${item.id} → ${item.channel}`);
      continue;
    }

    packs.push({ id: item.id, ...pack });
    const why = !post
      ? "dry run"
      : mode !== "auto"
        ? "channel is review-only"
        : "no transport configured";
    log(`  pack:    ${item.id} → ${item.channel} (${why})`);
  }

  for (const entry of withheld) {
    log(`  held:    ${entry.item.id} → ${entry.item.channel}: ${entry.reason}`);
  }

  return { posted, packs, withheld };
}

/** @param {readonly string[]} argv @param {string} name */
function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

/** @param {string | undefined} path @param {unknown} fallback */
function readJson(path, fallback) {
  if (!path) {
    return fallback;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

// CLI entry — skipped when imported by tests.
if (
  process.argv[1] &&
  process.argv[1].endsWith("drip.mjs") &&
  !process.env["VITEST"]
) {
  const argv = process.argv.slice(2);
  const queue = readJson(flag(argv, "--queue"), []);
  const history = readJson(flag(argv, "--history"), {});
  const post = argv.includes("--post");

  console.log(post ? "• Drip run (POSTING)" : "• Drip run (dry run)");
  const result = await runDrip({
    queue,
    history,
    now: Date.now(),
    post,
    log: (line) => console.log(line),
  });
  console.log(
    `• ${result.posted.length} posted, ${result.packs.length} pack(s) for you, ` +
      `${result.withheld.length} held`,
  );

  const out = flag(argv, "--packs-out");
  if (out) {
    writeFileSync(out, JSON.stringify(result.packs, null, 2), "utf8");
    console.log(`• packs written to ${out}`);
  }
}
