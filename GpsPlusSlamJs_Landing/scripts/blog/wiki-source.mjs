// @ts-check
/**
 * wiki-source.mjs — decides where the blog's markdown comes from.
 *
 * The site is built in two very different places:
 *
 * - a developer machine, where the wiki is checked out beside the repo as
 *   `../location-based-webxr.wiki`;
 * - a CDN build host, which has never heard of it and must fetch it.
 *
 * The wiki repository is **public**, so the fetch is an unauthenticated
 * shallow clone — no credentials reach the build host.
 *
 * Precedence is explicit rather than best-effort, because "the blog is
 * out of date" is the symptom of every mistake in this area and it never
 * points at its own cause.
 *
 * Plan: GpsPlusSlamJs_Docs/docs/2026-08-20-0555-marketing-content-automation-plan.md
 */

/** The public wiki repo. Cloneable without credentials. */
export const WIKI_REPO_URL =
  "https://github.com/cs-util-com/location-based-webxr.wiki.git";

/**
 * @param {object} options
 * @param {string | undefined} options.envDir `BLOG_WIKI_DIR`, if set
 * @param {string} options.siblingDir the conventional local checkout path
 * @param {string} options.cloneDir where a fresh clone should land
 * @param {(dir: string) => boolean} options.exists directory-exists seam
 * @param {(url: string, dir: string) => void} options.clone clone seam;
 *   expected to throw on failure
 * @returns {string} the directory to read wiki markdown from
 * @throws {Error} when an explicitly configured directory is absent, or when
 *   the clone fails. Never returns a directory it has not established.
 */
export function resolveWikiDir({
  envDir,
  siblingDir,
  cloneDir,
  exists,
  clone,
}) {
  if (envDir) {
    if (!exists(envDir)) {
      throw new Error(
        `blog: BLOG_WIKI_DIR is set to ${envDir}, which does not exist. ` +
          `Refusing to fall back to another source — publishing from a ` +
          `different place than configured is worse than not publishing.`,
      );
    }
    return envDir;
  }

  if (exists(siblingDir)) {
    return siblingDir;
  }

  // No local copy: this is a build host. Clone failures propagate, because a
  // build that continues without content would deploy an empty /blog/ over a
  // working one.
  clone(WIKI_REPO_URL, cloneDir);
  return cloneDir;
}
