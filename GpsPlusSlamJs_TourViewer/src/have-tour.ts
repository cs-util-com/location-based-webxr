/**
 * "You already have a tour?" (tour editor plan 2026-10-17-1816, W1; the
 * phone half is plan 2026-10-15-0348's round 2): the creator page's box
 * below the map and the six steps. A computer gets the editor (plain
 * markup, no behaviour here); a phone opens a tour - from this device or
 * from its link - through the page's one open path (`archive-open.ts`),
 * then asks "Play it, or continue setting it up?".
 *
 * @see have-tour.ts.md
 */

import { hasFilePicker } from "./file-picker.js";
import { HOST_REFUSED_TEXT, describeOpenCause } from "./open-errors.js";
import type { OpenOutcome } from "./scan-open.js";

/** The box's button labels (async-UI rule: busy while an open runs). */
export const HAVE_TOUR_LABELS = {
  file: "From this device",
  link: "Open the link",
  busy: "Opening…",
} as const;

/** A host that blocks browsers, in the box's words: the way around is the
 *  box's own other button, not step 2's "pick another host" (M1 review
 *  #3) nor the error box's "Open the downloaded file below". */
export const HAVE_TOUR_CORS_TEXT = `${HOST_REFUSED_TEXT}\nDownload the file to this device, then open it with "${HAVE_TOUR_LABELS.file}".`;

/** The box's own line when nothing else words a failure. */
export const HAVE_TOUR_FAILED_TEXT = "This tour could not be opened.";

/** The question once a tour opened from its link. */
export const PLAY_OR_CONTINUE = "Play it, or continue setting it up?";

/** Once a tour opened from a file: it has no link a visitor's page could
 *  open, so only setting it up goes on from here. */
export const FILE_OPENED_ASK =
  "Continue setting it up? To play it, open its link: a tour plays from where it is hosted.";

/**
 * The computer's line about the editor, true for this browser (PR #637
 * review): the editor saves a chosen file into itself where the file
 * picker exists (`file-picker.ts`, the check the editor's own fine print
 * uses too) and gives a new copy elsewhere.
 */
export function editorPitch(win: object): string {
  const does =
    "The editor shows your tour on a map: fix a text, move a pin or remove a photo,";
  return hasFilePicker(win)
    ? `${does} and save it back into the tour file.`
    : `${does} and save a new copy of the tour file to put in place of the old one.`;
}

interface Listening {
  addEventListener(
    type: string,
    handler: (event: { preventDefault(): void }) => void,
  ): void;
}

type Button = Listening & Pick<HTMLButtonElement, "disabled" | "textContent">;

/** The elements the box drives (structural, so the unit tests run in
 *  node). */
export interface HaveTourDom {
  /** "From this device": clicks `fileInput`. */
  fileButton: Button;
  /** The box's own picker; the page's one open path reads the file. */
  fileInput: Listening & Pick<HTMLInputElement, "click" | "value" | "files">;
  /** The link's form; its submit opens the link. */
  form: Listening;
  linkInput: Pick<HTMLInputElement, "value">;
  linkButton: Button;
  /** What the open is doing, or why it failed (a live region). */
  status: Pick<HTMLElement, "textContent" | "hidden">;
  /** The question after an open, with its two answers. */
  ask: Pick<HTMLElement, "hidden">;
  askText: Pick<HTMLElement, "textContent">;
  /** "Play it": the visitor's page for the opened link. */
  play: Pick<HTMLAnchorElement, "href" | "hidden">;
  continueButton: Listening;
}

export interface HaveTourDeps {
  dom: HaveTourDom;
  /** The page's open path for a picked file (`ArchiveOpen.openFile`). */
  openFile: (file: File) => Promise<OpenOutcome>;
  /** The page's open path for a link (`ArchiveOpen.openLink`: once
   *  opened, the link of record; a link that did not open is never handed
   *  on to printing). */
  openLink: (url: string) => Promise<OpenOutcome>;
  /** The visitor's page for a link (`wizard.ts` `visitorLaunchHref`). */
  playHref: (url: string) => string;
  /** The open's own error sentence (the page's error box), for a file. */
  errorText: () => string;
  /** "Continue setting it up": back to the step card. */
  continueSetup: () => void;
}

export function wireHaveTour(deps: HaveTourDeps): void {
  const { dom } = deps;
  dom.fileButton.textContent = HAVE_TOUR_LABELS.file;
  dom.linkButton.textContent = HAVE_TOUR_LABELS.link;

  function busy(on: boolean): void {
    dom.fileButton.disabled = on;
    dom.linkButton.disabled = on;
    dom.fileButton.textContent = on
      ? HAVE_TOUR_LABELS.busy
      : HAVE_TOUR_LABELS.file;
    dom.linkButton.textContent = on
      ? HAVE_TOUR_LABELS.busy
      : HAVE_TOUR_LABELS.link;
  }

  /** The open's own words (the page's error box), except for a host that
   *  blocks browsers; the cause's own sentence where the box is empty.
   *  Never step 2's printing messages: the box is not about printing. */
  function failureText(kind: "file" | "link", cause: string): string {
    if (kind === "link" && cause === "cors") return HAVE_TOUR_CORS_TEXT;
    return (
      deps.errorText() || describeOpenCause(cause) || HAVE_TOUR_FAILED_TEXT
    );
  }

  function say(text: string): void {
    dom.status.textContent = text;
    dom.status.hidden = text === "";
  }

  async function run(
    source: { kind: "file"; name: string } | { kind: "link"; url: string },
    open: () => Promise<OpenOutcome>,
  ): Promise<void> {
    busy(true);
    dom.ask.hidden = true;
    say(
      source.kind === "file" ? `Opening ${source.name}…` : "Opening the tour…",
    );
    // The open path reports its failures as outcomes; a throw is a defect
    // there, and still must not leave the buttons busy.
    const outcome = await open()
      .catch((): OpenOutcome => ({ kind: "failed", cause: "other" }))
      .finally(() => {
        busy(false);
      });
    switch (outcome.kind) {
      case "opened":
        say("");
        if (source.kind === "link") {
          dom.askText.textContent = PLAY_OR_CONTINUE;
          dom.play.href = deps.playHref(source.url);
          dom.play.hidden = false;
        } else {
          dom.askText.textContent = FILE_OPENED_ASK;
          dom.play.hidden = true;
        }
        dom.ask.hidden = false;
        return;
      case "failed":
        say(failureText(source.kind, outcome.cause));
        return;
      case "cancelled":
        say("Kept the tour that is open: its rebuilt file is not saved yet.");
        return;
      case "superseded":
        say("");
    }
  }

  dom.fileButton.addEventListener("click", () => {
    dom.fileInput.click();
  });
  dom.fileInput.addEventListener("change", () => {
    const file = dom.fileInput.files?.[0];
    dom.fileInput.value = "";
    if (file === undefined) return;
    void run({ kind: "file", name: file.name }, () => deps.openFile(file));
  });
  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = dom.linkInput.value.trim();
    if (url === "") return;
    void run({ kind: "link", url }, () => deps.openLink(url));
  });
  dom.continueButton.addEventListener("click", () => {
    dom.ask.hidden = true;
    deps.continueSetup();
  });
}
