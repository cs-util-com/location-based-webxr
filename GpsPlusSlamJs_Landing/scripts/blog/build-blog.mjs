#!/usr/bin/env node
// @ts-check
/**
 * build-blog.mjs — renders the project wiki into `dist-site/blog/`.
 *
 * The wiki (https://github.com/cs-util-com/location-based-webxr/wiki) is where
 * posts are authored and where the owner flips one from draft to published
 * (plan decisions D6 and D14). This script is the only thing that turns that
 * flip into HTML on gps.csutil.com.
 *
 * Two failure modes are deliberately loud, because both are silent by nature:
 *
 * - **No wiki, or an unreadable one.** Emitting an empty `/blog/` would
 *   deploy over a working one and unpublish every article at once, with a
 *   green build. So a missing directory, or one with no markdown in it, is a
 *   hard error (plan decision D19's corollary).
 * - **A draft leaking out.** The parser, the renderer and the sitemap builder
 *   each refuse drafts independently; this script filters them once more and
 *   logs why each was withheld.
 *
 * Usage (from the repo root, via `pnpm run build:site`, or directly):
 *
 *     node GpsPlusSlamJs_Landing/scripts/blog/build-blog.mjs \
 *       --wiki ../location-based-webxr.wiki --out dist-site
 *
 * The wiki location comes from `--wiki`, else `BLOG_WIKI_DIR`, else the
 * sibling checkout `../location-based-webxr.wiki`. A build host without a
 * local checkout clones the public wiki repo first — it needs no credentials.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCatalog, buildSitemap } from "./catalog.mjs";
import { parsePost } from "./post-meta.mjs";
import { renderIndex, renderPost } from "./render.mjs";
import { resolveWikiDir } from "./wiki-source.mjs";

const DEFAULT_ORIGIN = "https://gps.csutil.com";

/**
 * Wiki pages that are navigation rather than content, and are therefore not
 * posts at all.
 *
 * `Home` is the wiki's landing page and cannot be deleted — GitHub recreates
 * it if you try. Names beginning with an underscore are gollum's reserved
 * meta-pages (`_Sidebar`, `_Footer`, `_Header`), which GitHub renders as
 * chrome around every other page.
 *
 * They would be withheld anyway, since none carries a `blog-meta` block — but
 * they would be withheld AS DRAFTS, each logging a reason on every build. That
 * turns the draft log, which exists so a person can confirm nothing leaked,
 * into a list with permanent entries in it.
 *
 * @param {string} fileName
 * @returns {boolean}
 */
function isWikiMetaPage(fileName) {
  return /^(?:home\.md|_)/i.test(fileName);
}

/**
 * @param {object} options
 * @param {string} options.wikiDir checkout of the wiki repository
 * @param {string} options.outDir deploy tree root; `blog/` is created inside
 * @param {string} options.origin absolute origin for canonical URLs
 * @param {(line: string) => void} [options.log]
 * @returns {{ published: number, drafts: number }}
 */
export function buildBlog({ wikiDir, outDir, origin, log = () => {} }) {
  if (!existsSync(wikiDir)) {
    throw new Error(
      `build-blog: wiki checkout not found at ${wikiDir}. Refusing to build ` +
        `an empty /blog/ — deploying it would unpublish every existing post.`,
    );
  }
  // Meta-pages are dropped BEFORE the emptiness check below, so a wiki holding
  // nothing but a Home page still trips the guard rather than quietly
  // deploying an empty /blog/ over a working one.
  const fileNames = readdirSync(wikiDir).filter(
    (name) => /\.md$/i.test(name) && !isWikiMetaPage(name),
  );
  if (fileNames.length === 0) {
    throw new Error(
      `build-blog: no markdown pages in ${wikiDir}. Refusing to build an ` +
        `empty /blog/ — see the note above about unpublishing.`,
    );
  }

  const posts = fileNames.map((fileName) =>
    parsePost(fileName, readFileSync(join(wikiDir, fileName), "utf8")),
  );
  const { published, drafts } = buildCatalog(posts);

  const blogDir = join(outDir, "blog");
  mkdirSync(blogDir, { recursive: true });
  writeFileSync(
    join(blogDir, "index.html"),
    renderIndex(published, { origin }),
    "utf8",
  );
  writeFileSync(
    join(blogDir, "sitemap.xml"),
    buildSitemap(published, { origin }),
    "utf8",
  );
  for (const post of published) {
    const postDir = join(blogDir, post.slug);
    mkdirSync(postDir, { recursive: true });
    writeFileSync(
      join(postDir, "index.html"),
      renderPost(post, { origin }),
      "utf8",
    );
    log(`  published: ${post.slug} (${post.date})`);
  }
  for (const post of drafts) {
    log(`  draft:     ${post.slug} — ${post.draftReason ?? "unknown reason"}`);
  }

  return { published: published.length, drafts: drafts.length };
}

/**
 * @param {readonly string[]} argv
 * @param {string} name flag, e.g. '--wiki'
 * @returns {string | undefined}
 */
function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

// CLI entry — skipped when imported by tests.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  const argv = process.argv.slice(2);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const wikiDir = resolveWikiDir({
    envDir: flag(argv, "--wiki") ?? process.env["BLOG_WIKI_DIR"],
    siblingDir: resolve(repoRoot, "..", "location-based-webxr.wiki"),
    cloneDir: resolve(repoRoot, "node_modules", ".cache", "blog-wiki"),
    exists: existsSync,
    clone: (url, dir) => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      console.log(`• Cloning ${url}`);
      execFileSync("git", ["clone", "--depth", "1", url, dir], {
        stdio: "inherit",
      });
    },
  });
  const outDir = resolve(flag(argv, "--out") ?? join(repoRoot, "dist-site"));
  const origin = flag(argv, "--origin") ?? DEFAULT_ORIGIN;

  console.log(`• Building blog from ${wikiDir}`);
  const result = buildBlog({
    wikiDir,
    outDir,
    origin,
    log: (line) => console.log(line),
  });
  console.log(
    `• Blog: ${result.published} published, ${result.drafts} draft(s) withheld`,
  );
}
