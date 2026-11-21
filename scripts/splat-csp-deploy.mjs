// @ts-check
/**
 * The site build's check that the splat trainer page ships with its content
 * security policy intact: the policy the source page declares is the one
 * the built page carries, it comes before everything it governs, and every
 * script the built page and its worker ask for is one it lets through.
 *
 * @see splat-csp-deploy.mjs.md
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the splat trainer page lands in the deploy, and its base. */
export const SPLAT_PAGE = 'tour/splat/index.html';
export const SPLAT_BASE = '/tour/';

/** The Splat.js addresses the trainer's code may name. */
const SPLAT_JS_URL =
  /https:\/\/cdn\.jsdelivr\.net\/gh\/arrival-space\/splat\.js@[^"'`\s)]*/g;

/** The built trainer worker's chunks (`splat-trainer.worker.ts`). */
const WORKER_CHUNK = /^splat-trainer\.worker-[\w-]+\.js$/;

/**
 * The content of the page's Content-Security-Policy meta, whitespace
 * collapsed, with the index it was found at; null without one.
 *
 * @param {string} html
 * @returns {{ policy: string, at: number } | null}
 */
export function policyMeta(html) {
  const m =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i.exec(
      html
    );
  if (m === null) return null;
  return { policy: m[1].replace(/\s+/g, ' ').trim(), at: m.index };
}

/**
 * The sources a directive of `policy` allows; empty when it is absent.
 *
 * @param {string} policy
 * @param {string} name
 */
function directive(policy, name) {
  for (const part of policy.split(';')) {
    const [head, ...rest] = part.trim().split(/\s+/);
    if (head === name) return rest;
  }
  return [];
}

/**
 * Throws, naming every problem, unless the built splat page under `siteDir`
 * (the combined deploy folder, `dist-site`):
 * - exists and carries a policy meta equal to the one in `sourceHtml` (the
 *   source page's text);
 * - has that meta before every `<script>` and `<link>`, since a meta policy
 *   governs only what comes after it;
 * - has no inline script, and every script and module preload under
 *   {@link SPLAT_BASE} (this site, so `'self'`);
 * - has at least one trainer worker chunk under `tour/assets/`, and every
 *   Splat.js address those chunks name starts with one of `script-src`'s
 *   sources (a check of nothing must not pass).
 *
 * @param {{ siteDir: string, sourceHtml: string }} options
 */
export function assertSplatPolicyShipped({ siteDir, sourceHtml }) {
  const pagePath = join(siteDir, ...SPLAT_PAGE.split('/'));
  if (!existsSync(pagePath)) {
    throw new Error(
      `Splat page policy check: ${SPLAT_PAGE} is missing from ${siteDir}.`
    );
  }
  const html = readFileSync(pagePath, 'utf8');
  const source = policyMeta(sourceHtml);
  if (source === null) {
    throw new Error(
      'Splat page policy check: the source page declares no policy.'
    );
  }
  /** @type {string[]} */
  const problems = [];
  const built = policyMeta(html);
  if (built === null) {
    problems.push('the built page carries no Content-Security-Policy meta');
  } else if (built.policy !== source.policy) {
    problems.push(
      `its policy differs from the source page's: "${built.policy}"`
    );
  }
  const at = built?.at ?? Infinity;
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    if (tag.index < at) problems.push(`${tag[0]} comes before the policy`);
    const attr = (/** @type {string} */ name) =>
      new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag[0])?.[1];
    if (tag[1].toLowerCase() === 'script') {
      const src = attr('src');
      if (src === undefined) problems.push(`an inline script: ${tag[0]}`);
      else if (!src.startsWith(SPLAT_BASE))
        problems.push(`a script from ${src}`);
    } else if (attr('rel') === 'modulepreload') {
      const href = attr('href') ?? '';
      if (!href.startsWith(SPLAT_BASE))
        problems.push(`a module preload from ${href}`);
    }
  }
  const scriptSrc = built === null ? [] : directive(built.policy, 'script-src');
  const assets = join(siteDir, 'tour', 'assets');
  const chunks = existsSync(assets)
    ? readdirSync(assets).filter((name) => WORKER_CHUNK.test(name))
    : [];
  if (chunks.length === 0) {
    problems.push(
      'no trainer worker chunk (splat-trainer.worker-*.js) in tour/assets/'
    );
  }
  let named = 0;
  for (const name of chunks) {
    const code = readFileSync(join(assets, name), 'utf8');
    for (const [url] of code.matchAll(SPLAT_JS_URL)) {
      named += 1;
      if (
        !scriptSrc.some((s) => s.startsWith('https://') && url.startsWith(s))
      ) {
        problems.push(`${name} loads ${url}, which script-src does not allow`);
      }
    }
  }
  if (chunks.length > 0 && named === 0) {
    problems.push('the trainer worker chunks name no Splat.js address');
  }
  if (problems.length > 0) {
    throw new Error(
      `Splat page policy check (${SPLAT_PAGE}): ${problems.join('; ')}.`
    );
  }
}
