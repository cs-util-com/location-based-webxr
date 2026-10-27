/**
 * Where the tour lives (polish round M2, A6/A7): the host the creator picks
 * first, its own upload-and-link steps, and the stored choice the later
 * steps read. The copy here is provisional (the owner's prototype verdict
 * may restyle it) and lives in one place for that reason. Pure, apart from
 * the injected store.
 *
 * @see tour-host.ts.md
 */

/** The hosts the page knows to work. */
export const TOUR_HOSTS = [
  { id: "drive", label: "Google Drive" },
  { id: "dropbox", label: "Dropbox" },
  { id: "onedrive", label: "OneDrive" },
  { id: "github", label: "GitHub" },
  { id: "own", label: "Your own server" },
] as const;

export type TourHost = (typeof TOUR_HOSTS)[number]["id"];

const HOST_IDS: ReadonlySet<string> = new Set(TOUR_HOSTS.map((h) => h.id));

export function isTourHost(value: unknown): value is TourHost {
  return typeof value === "string" && HOST_IDS.has(value);
}

/** Each host's own steps, ending at the link the next step asks for. */
const HOST_STEPS: Readonly<Record<TourHost, readonly string[]>> = {
  drive: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in Google Drive (e.g. "My tour").',
    'Share the file: "Anyone with the link", then copy the link.',
    "Continue and paste that link.",
  ],
  dropbox: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in Dropbox (e.g. "My tour").',
    "Share the file so anyone with the link can view it, and copy the link.",
    "Continue and paste that link.",
  ],
  onedrive: [
    "Download the empty starter tour below (tour.zip).",
    'Upload it into a folder of its own in OneDrive (e.g. "My tour").',
    'Share the file: "Anyone with the link can view", then copy the link.',
    "Continue and paste that link.",
  ],
  github: [
    "Download the empty starter tour below (tour.zip).",
    'Add it to a public repository on GitHub ("Add file", "Upload files").',
    "Open the file on GitHub and copy its address from the browser.",
    "Continue and paste that link.",
  ],
  own: [
    "Choose where tour.zip will live on your server - you can paste the link before the file exists, and upload it later.",
    "The server must let other sites read the file (Access-Control-Allow-Origin: *) and send parts of it (Accept-Ranges: bytes).",
    "Continue and paste that link.",
  ],
};

export function hostSteps(host: TourHost): readonly string[] {
  return HOST_STEPS[host];
}

/** Where each cloud host is opened to upload (r820 feedback R2). */
const HOST_HOME: Readonly<Record<TourHost, string | null>> = {
  drive: "https://drive.google.com/",
  dropbox: "https://www.dropbox.com/home",
  onedrive: "https://onedrive.live.com/",
  github: "https://github.com/",
  own: null,
};

/** A run of a step's words, or the host's name as a link to the host. */
export interface HostStepPart {
  text: string;
  href?: string;
}

/**
 * The host's steps with the host's name, in the step that sends the
 * creator there, as a link to the host's site (r820 feedback R2: "at least
 * Google Drive as a link, opening drive.google.com in a second tab"). The
 * words are exactly `hostSteps`'; an own server has no link.
 */
export function hostStepParts(
  host: TourHost,
): readonly (readonly HostStepPart[])[] {
  const home = HOST_HOME[host];
  const label = TOUR_HOSTS.find((h) => h.id === host)?.label ?? "";
  let linked = false;
  return HOST_STEPS[host].map((text) => {
    const at = home === null || linked ? -1 : text.indexOf(label);
    if (home === null || at < 0) return [{ text }];
    linked = true;
    return [
      { text: text.slice(0, at) },
      { text: label, href: home },
      { text: text.slice(at + label.length) },
    ].filter((part) => part.text !== "");
  });
}

/** Why the file goes over the hosted one rather than beside it. */
const KEEPS_LINK =
  "so the link - and with it the printed code - stays the same.";

/** How each host replaces a file under the same link. Google Drive's is
 *  for a computer (the editor's Done, W2): on the phone its steps come from
 *  the link itself (`driveReplaceSteps`), which knows the file's name. */
const REPLACE_HOW: Readonly<Record<TourHost, string>> = {
  drive:
    'In Google Drive (drive.google.com), open the folder with your tour, choose New, then File upload, pick the file and choose "Replace existing file" - Drive replaces only a file of the same name. If Drive does not ask, it uploaded a second copy: delete that copy.',
  dropbox:
    "In Dropbox, upload it into the same folder with the same name so it overwrites the old file - never delete the old one first, which ends the link - then open your link once to check.",
  onedrive:
    'In OneDrive, upload it into the same folder with the same name and choose "Replace".',
  github: "On GitHub, commit it over the same path in the same repository.",
  own: "Put it on your server at the same place, under the same name.",
};

/** How the saved zip replaces the hosted one under the same link, so the
 *  printed code keeps working (step 6). Google Drive: null - its steps
 *  come from the link itself (`driveReplaceSteps`), which knows the
 *  file's name. */
export function hostReplaceText(host: TourHost): string | null {
  if (host === "drive") return null;
  return `Last thing: upload this zip over the one at your link, ${KEEPS_LINK} ${REPLACE_HOW[host]}`;
}

/** The same on a computer (the editor's Done, tour editor plan
 *  2026-10-17-1816, W2), naming the saved file, Drive included. */
export function hostReplaceOnComputer(
  host: TourHost,
  fileName: string,
): string {
  return `Upload ${fileName} over the file at your tour's link, ${KEEPS_LINK} ${REPLACE_HOW[host]}`;
}

/** The hostnames each cloud host's links (share pages and their raw
 *  forms) are served from. */
const HOST_NAMES: Readonly<
  Record<Exclude<TourHost, "own">, readonly string[]>
> = {
  drive: ["drive.google.com", "drive.usercontent.google.com"],
  dropbox: ["dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com"],
  onedrive: ["1drv.ms", "onedrive.live.com"],
  github: ["github.com", "raw.githubusercontent.com"],
};

/**
 * The cloud host a link points to, or null for any other link (an own
 * server, or not a link). Step 2 judges a missing file by it (M0c review):
 * where the link points decides whether it can come before its file, not
 * the tile picked once in step 1 and kept across tours.
 */
export function hostOfLink(link: string): TourHost | null {
  let hostname: string;
  try {
    hostname = new URL(link).hostname;
  } catch {
    return null;
  }
  for (const [host, names] of Object.entries(HOST_NAMES)) {
    if (names.includes(hostname)) return host as TourHost;
  }
  return null;
}

/** Whether the host needs a file before it gives a link: every cloud host;
 *  an own server's link is known before the file exists. */
export function needsStarterZip(host: TourHost): boolean {
  return host !== "own";
}

/** The store slice the choice lives in (`localStorage`). */
export interface TourHostStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The storage key of the choice; the landing reads it to tell a
 *  returning device (`landing/landing-skip.ts`). */
export const HOST_KEY = "tour-viewer.wizard.host";

/** The stored host, or null: none chosen, an unknown value, or a store
 *  that is missing or throws (site data blocked). */
export function readTourHost(
  store: TourHostStore | undefined,
): TourHost | null {
  if (store === undefined) return null;
  try {
    const value = store.getItem(HOST_KEY);
    return isTourHost(value) ? value : null;
  } catch {
    return null;
  }
}

/** Store the choice, or clear it with null (a deselected tile); a store
 *  that throws is ignored (the choice then lasts this page only). */
export function writeTourHost(
  store: TourHostStore | undefined,
  host: TourHost | null,
): void {
  try {
    // An empty value reads back as no choice (`readTourHost`).
    store?.setItem(HOST_KEY, host ?? "");
  } catch {
    // Site data blocked: the choice holds for this page only.
  }
}
