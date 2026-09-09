/**
 * `shareOrDownloadBlob` - hand a file to the device's share sheet when the
 * browser can share FILES, and fall back to the save-or-download path
 * otherwise.
 *
 * Why it lives here and not in an app: the recorder has done exactly this
 * since 2026-02-06 (owner feedback), the Tour Viewer's finish step now
 * needs it, and the behaviour carries a CONTRACT - what the user is told
 * happened - which DEC-H3 says is unified rather than copied. Before this
 * module there were two hand-written `<a download>` fallbacks in the
 * repository and one hand-written share dance; the repo's duplicate guard
 * is keyed on NAMES and could see none of it.
 *
 * The result is TWO independent questions, not one enum:
 * - `route` - which mechanism ran. The caller's copy differs, because a
 *   share creates a NEW file in the target app while a save replaces one.
 * - `delivered` - whether anything left the page at all. `downloadBlob`
 *   already answered this for the save picker and the Tour Viewer's finish
 *   already branches on it, so folding it into a single enum would have
 *   deleted a distinction the UI depends on.
 *
 * Two things `delivered` deliberately does NOT tell you, both properties of
 * the Web Share API rather than of this module:
 * - `delivered: false` on the share route means the file did not leave. It
 *   does NOT mean the user cancelled: the Web Share algorithm rejects with
 *   `AbortError` both for a cancelled sheet and for a failed share, and
 *   they cannot be told apart. Copy must not accuse the user.
 * - `delivered: true` on the share route means the data reached the app the
 *   user picked, and nothing about what that app did with it. Copy must not
 *   claim the file is in anyone's cloud folder.
 */

import { createLogger } from '../utils/logger';

import { downloadBlob, type DownloadFileType } from './zip-export.js';

const log = createLogger('ShareOrDownload');

/** Which mechanism ran, and whether anything left the page. */
export interface ShareOrDownloadResult {
  /** `share` = the Web Share sheet; `download` = save picker or anchor. */
  readonly route: 'share' | 'download';
  /**
   * False when nothing left the page: a dismissed save picker, or a share
   * that ended in `AbortError` (cancelled OR failed - indistinguishable).
   */
  readonly delivered: boolean;
}

/** The browser pieces this module uses, injectable so tests need no DOM
 *  navigator and can drive every one of the four outcomes. */
export interface ShareOrDownloadDeps {
  /** Defaults to `matchMedia('(pointer: coarse)')`. See
   *  `prefersFileShare` for why the capability alone is not the question. */
  readonly coarsePointer?: () => boolean;
  /** Defaults to `navigator.canShare`, or a constant false where absent. */
  readonly canShare?: (data: { files: File[] }) => boolean;
  /** Defaults to `navigator.share`; absent means the share route is off. */
  readonly share?: (data: { files: File[] }) => Promise<void>;
  /** Defaults to `downloadBlob`. */
  readonly download?: (
    blob: Blob,
    filename: string,
    fileType: DownloadFileType
  ) => Promise<boolean>;
}

// Both wrappers CALL the method rather than extracting a reference to it:
// `navigator.share` detached from `navigator` throws in some engines, and
// the lint rule that says so is right.
function navigatorCanShare(): ((data: { files: File[] }) => boolean) | null {
  if (typeof navigator === 'undefined') return null;
  if (typeof navigator.canShare !== 'function') return null;
  return (data) => navigator.canShare(data);
}

function navigatorShare(): ((data: { files: File[] }) => Promise<void>) | null {
  if (typeof navigator === 'undefined') return null;
  if (typeof navigator.share !== 'function') return null;
  return (data) => navigator.share(data);
}

/**
 * Is a share sheet the RIGHT hand-off here, not merely a possible one?
 *
 * This is the question every caller actually has, and it is not the same as
 * `canShareFilesOfType`. Desktop Chrome (Windows, macOS) and macOS Safari
 * implement Web Share, files included - checked against MDN and caniuse
 * rather than assumed, because a behaviour change rests on it; Firefox and
 * Linux Chrome are the exceptions. So the capability alone says yes on a
 * desktop - where
 * the share sheet offers Mail and Nearby Share and NO "save to disk", and
 * the file the user is about to be told to upload somewhere never lands on
 * their disk at all. The save picker is the better hand-off there, and it
 * is the one this product's own instructions assume.
 *
 * On a phone the reverse holds: a download drops the file in Downloads and
 * leaves the user to find it in another app, which is the friction the
 * share sheet removes.
 *
 * So the policy is the capability AND a coarse primary pointer. That is a
 * heuristic - a touchscreen laptop answers yes - and it is the right kind
 * of wrong: such a device still has a share sheet, and its user still gets
 * a working hand-off. Getting it backwards on a mouse-driven desktop is
 * the expensive direction, because that is where the file has to reach a
 * folder.
 */
export function prefersFileShare(
  fileType: DownloadFileType,
  deps: ShareOrDownloadDeps = {}
): boolean {
  return canShareFilesOfType(fileType, deps) && hasCoarsePointer(deps);
}

function hasCoarsePointer(deps: ShareOrDownloadDeps): boolean {
  if (deps.coarsePointer !== undefined) return deps.coarsePointer();
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    // A window that cannot answer is treated as a desktop: the save path
    // works everywhere, the share sheet does not.
    return false;
  }
}

/**
 * Can this browser share a file of `fileType` at all? The raw CAPABILITY -
 * most callers want `prefersFileShare` instead.
 *
 * For LABELLING a button before the file exists. "Share" on a desktop that
 * cannot share files is a lie, and "Download" on a phone that can is a
 * worse description of what the button does - so the label is decided from
 * the capability, once, rather than guessed from the platform.
 *
 * `canShare` is evaluated against real `File` objects, and at wire time
 * there is no file yet, so the probe uses a one-byte dummy with the right
 * name and MIME type. It is never shared.
 *
 * Returns false wherever the API, `navigator` or `File` is missing - which
 * covers node, and is why the seam layer can call it during boot.
 */
export function canShareFilesOfType(
  fileType: DownloadFileType,
  deps: ShareOrDownloadDeps = {}
): boolean {
  const canShare = deps.canShare ?? navigatorCanShare();
  if (canShare === null) return false;
  if (deps.share === undefined && navigatorShare() === null) return false;
  if (typeof File === 'undefined') return false;
  try {
    const probe = new File([new Uint8Array(1)], `probe${fileType.extension}`, {
      type: fileType.mimeType,
    });
    return canShare({ files: [probe] });
  } catch (err) {
    // A browser that throws on a probe cannot be relied on to share. Logged
    // rather than swallowed: silently labelling the button "Download"
    // forever is exactly the kind of thing nobody would ever find.
    log.warn(
      `canShare probe threw for ${fileType.mimeType}, treating as no share:`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

/**
 * The share attempt, split out so the public function stays one decision
 * deep: a `ShareOrDownloadResult` when the share route SETTLED the
 * question (handed over, or aborted), or `null` meaning "not shareable
 * here, or the share failed in a way a download can still rescue".
 */
async function tryShare(
  blob: Blob,
  filename: string,
  fileType: DownloadFileType,
  deps: ShareOrDownloadDeps
): Promise<ShareOrDownloadResult | null> {
  const share = deps.share ?? navigatorShare();
  const canShare = deps.canShare ?? navigatorCanShare();
  if (share === null || canShare === null || typeof File === 'undefined') {
    return null;
  }
  // The SAME policy the label was chosen from, so the word on the button
  // and the mechanism behind it cannot disagree. Asked here rather than
  // left to the caller because a caller that forgot would produce exactly
  // that disagreement, silently.
  if (!hasCoarsePointer(deps)) return null;
  const file = new File([blob], filename, { type: fileType.mimeType });
  // Re-asked with the REAL file: the wire-time probe used a one-byte dummy,
  // and some platforms refuse a specific file (its size, its type) even
  // when the type in general is shareable.
  if (!canShare({ files: [file] })) return null;
  try {
    await share({ files: [file] });
    log.info(`Shared ${filename} via the Web Share API`);
    return { route: 'share', delivered: true };
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') {
      // Cancelled OR failed - the algorithm uses one error for both.
      log.info(`Share of ${filename} ended without handing the file over`);
      return { route: 'share', delivered: false };
    }
    log.warn(
      `Web Share failed for ${filename}, falling back to download:`,
      error.message
    );
    return null;
  }
}

/**
 * Share `blob` as a file if the browser can, else save or download it.
 *
 * Never throws for a cancelled share or a dismissed picker - those are
 * `delivered: false`. A share that fails for any other reason falls back to
 * the download route rather than surfacing, because the file the user asked
 * for is still deliverable that way; only a failing DOWNLOAD rejects, which
 * is `downloadBlob`'s existing contract.
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string,
  fileType: DownloadFileType,
  deps: ShareOrDownloadDeps = {}
): Promise<ShareOrDownloadResult> {
  const shared = await tryShare(blob, filename, fileType, deps);
  if (shared !== null) return shared;
  const download = deps.download ?? downloadBlob;
  return {
    route: 'download',
    delivered: await download(blob, filename, fileType),
  };
}
