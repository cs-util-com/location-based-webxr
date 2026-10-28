/**
 * The desktop editor's card beside the selected marker (M6 E1, the chosen
 * variant 1's popover; editing since E2a): what the object is, its text,
 * a photo from the zip, how precise its position is, and the arrow that
 * points at its marker; the "off the map view" chip when the marker
 * leaves the view. Every text is set with `textContent`; a photo is
 * checked by `image-cap.ts` before it is decoded on screen, and its
 * object URL is revoked when the card closes or shows something else
 * (M6 E1 plan review #2).
 *
 * @see editor-card.ts.md
 */

import { pictureProblem } from "../image-cap.js";
import { wirePinTextCounter } from "../pin-text.js";
import { BLOCK_KIND_LABEL } from "../object-describe.js";
import type { EditorItem } from "./editor-model.js";
import { placePopover, type Box } from "./popover-place.js";

/** Fired on the card when its content changed size (a photo landed). */
export const CARD_RESIZED = "card-resized";

/** The card's width where the window has room (the prototype's). */
const CARD_WIDTH_PX = 320;

/** R7's precision, both figures (M6 E1 plan review #10). */
const PRECISION_LINE =
  "Placed from GPS alignment: about 0.1-0.7 m near a code, 1-3 m further away.";

const CODE_LINE =
  "Measured on site by the phone. To move a printed code, measure it again there.";

const STATION_LINE =
  "A station of the story: visitors reach it here. Its steps are edited in a later version.";

export interface EditorCardDom {
  readonly card: HTMLElement;
  readonly inner: HTMLElement;
  readonly arrow: HTMLElement;
  readonly chip: HTMLElement;
  readonly chipText: HTMLElement;
  readonly chipShow: HTMLButtonElement;
}

/** What the card offers for the item shown (M6 E2a). */
export interface CardView {
  /** A pin or a photo of the tour: Move and Delete, and a pin's text. */
  readonly editable: boolean;
  /** Its marker is being dragged (Move): Done and Cancel instead. */
  readonly moving: boolean;
  /** It was moved since the last save: the height line. */
  readonly moved: boolean;
  /** The last action's outcome or refusal, or "". */
  readonly message: string;
}

const READ_ONLY: CardView = {
  editable: false,
  moving: false,
  moved: false,
  message: "",
};

/** Said after a move on the map (E2 plan: the 2D map keeps the height). */
const MOVED_LINE =
  "Height kept from the phone; on sloped ground it may be off.";

export interface EditorCard {
  show(item: EditorItem, view?: CardView): void;
  hide(): void;
  /** Follow the marker: `anchor` its ground point in window pixels (null
   *  without one), `free` the window's free part, `avoid` a box in it the
   *  card keeps clear of (`placePopover`). */
  place(
    anchor: { x: number; y: number } | null,
    free: Box,
    avoid?: Box | null,
  ): void;
  /** The item shown, or null. */
  shown(): EditorItem | null;
  /** Set the outcome line in place - no rebuild, so a click that blurred
   *  the text field still lands on its button (E2a review #3). */
  note(text: string): void;
  /** Commit the text field's typing, if any (a Save does it first). */
  commit(): void;
  /** The text field holds typing not yet committed. */
  dirty(): boolean;
}

function kindLabel(item: EditorItem): string {
  if (item.kind === "code") return item.title;
  if (item.kind === "station") return "Station";
  // The kind in the one rule's words (`object-describe.ts`).
  return BLOCK_KIND_LABEL[item.kind === "photo" ? "picture" : "shortText"];
}

export function createEditorCard(
  dom: EditorCardDom,
  deps: {
    /** A photo's bytes from the open tour
     *  (`TourSession.loadContentEntry`). */
    readonly loadImage: (item: EditorItem) => Promise<Blob>;
    readonly onClose: () => void;
    readonly onReveal: () => void;
    /** A pin's text was committed (blur or Ctrl+Enter). */
    readonly onText?: (id: string, text: string) => void;
    readonly onMove?: (id: string) => void;
    readonly onMoveDone?: () => void;
    readonly onMoveCancel?: () => void;
    readonly onDelete?: (id: string) => void;
  },
): EditorCard {
  let current: EditorItem | null = null;
  let objectUrl: string | null = null;
  /** Bumped on every show and hide: a photo read that lands for an item
   *  no longer shown is dropped. */
  let generation = 0;

  /** The pin's text field shown, its item, and the text last committed:
   *  kept across re-renders of the same item, so typing survives a
   *  refresh (a save ending mid-typing, E2a review #3). */
  let field: {
    readonly el: HTMLTextAreaElement;
    readonly label: HTMLLabelElement;
    /** The text's "12 / 40" (`pin-text.ts`), which the field names. */
    readonly count: HTMLOutputElement;
    readonly counter: { update(): void };
    readonly id: string;
    committed: string;
  } | null = null;
  /** The outcome line, set in place by `note`. */
  let messageEl: HTMLElement | null = null;

  function commitField(): void {
    if (field === null || field.el.value === field.committed) return;
    field.committed = field.el.value;
    deps.onText?.(field.id, field.el.value);
  }

  function textField(item: EditorItem): HTMLElement[] {
    if (field !== null && field.id === item.id) {
      // The same pin again (a refresh): the field and its typing stay.
      if (field.el.value === field.committed) {
        field.el.value = item.title;
        field.counter.update();
      }
      field.committed = item.title;
      return [field.label, field.el, field.count];
    }
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = "Text";
    label.htmlFor = "card-text";
    const el = document.createElement("textarea");
    el.id = "card-text";
    el.rows = 3;
    el.value = item.title;
    el.addEventListener("blur", commitField);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        commitField();
      }
    });
    const count = document.createElement("output");
    count.id = "card-text-count";
    count.className = "note-line text-count";
    count.htmlFor.add(el.id);
    el.setAttribute("aria-describedby", count.id);
    const counter = wirePinTextCounter(el, count);
    field = { el, label, count, counter, id: item.id, committed: item.title };
    return [label, el, count];
  }

  /** Tell the page the card changed size, so it is placed again. */
  function resized(): void {
    dom.card.dispatchEvent(new Event(CARD_RESIZED));
  }

  function freeUrl(): void {
    if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  function line(text: string, error = false, warn = false): HTMLElement {
    const p = document.createElement("p");
    p.className = error
      ? "note-line error"
      : warn
        ? "note-line warn"
        : "note-line";
    p.textContent = text;
    return p;
  }

  function loadPhoto(item: EditorItem, into: HTMLElement): void {
    const mine = generation;
    const status = line("Loading the photo…");
    into.append(status);
    deps
      .loadImage(item)
      .then(async (blob) => {
        const problem = await pictureProblem(blob);
        if (mine !== generation) return;
        if (problem !== null) {
          status.replaceWith(line(`This photo is not shown: ${problem}`, true));
          resized();
          return;
        }
        freeUrl();
        objectUrl = URL.createObjectURL(blob);
        const img = document.createElement("img");
        img.className = "card-photo";
        img.alt = item.title;
        // The card grows when the photo lands: the page places it again
        // (a card placed while loading could end below the window).
        img.addEventListener("load", resized);
        img.src = objectUrl;
        status.replaceWith(img);
      })
      .catch((err: unknown) => {
        if (mine !== generation) return;
        status.replaceWith(
          line(
            `This photo cannot be read: ${
              err instanceof Error ? err.message : String(err)
            }. If the file changed on disk, open it again.`,
            true,
          ),
        );
        resized();
      });
  }

  function button(
    text: string,
    className: string,
    run: () => void,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className;
    b.textContent = text;
    b.addEventListener("click", run);
    return b;
  }

  /** Move and Delete, or - while moving - the drag's Done and Cancel. */
  function actionsFor(item: EditorItem, view: CardView): HTMLElement {
    const row = document.createElement("div");
    row.className = "card-actions";
    if (view.moving) {
      const hint = document.createElement("p");
      hint.className = "move-hint";
      hint.textContent = "Drag the marker to its new place.";
      row.append(
        hint,
        button("Done", "btn primary small", () => deps.onMoveDone?.()),
        button("Cancel", "btn small", () => deps.onMoveCancel?.()),
      );
      return row;
    }
    const grow = document.createElement("span");
    grow.className = "grow";
    row.append(
      button("Move", "btn small", () => deps.onMove?.(item.id)),
      grow,
      button("Delete", "btn small danger", () => deps.onDelete?.(item.id)),
    );
    return row;
  }

  dom.chipShow.addEventListener("click", () => {
    deps.onReveal();
  });

  return {
    show(item, view = READ_ONLY) {
      // The same photo stays on screen across re-renders after an edit.
      const samePhoto =
        current?.id === item.id &&
        current.image === item.image &&
        objectUrl !== null;
      if (!samePhoto) {
        generation += 1;
        freeUrl();
      }
      current = item;
      const head = document.createElement("div");
      head.className = "card-head";
      const chip = document.createElement("span");
      chip.className = "kind-chip";
      chip.textContent = kindLabel(item);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "btn ghost icon-btn";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.addEventListener("click", () => {
        deps.onClose();
      });
      head.append(chip, close);
      const body: HTMLElement[] = [head];
      if (item.kind === "photo" && item.image !== undefined) {
        const holder = document.createElement("div");
        body.push(holder);
        if (samePhoto && objectUrl !== null) {
          const img = document.createElement("img");
          img.className = "card-photo";
          img.alt = item.title;
          img.src = objectUrl;
          holder.append(img);
        } else {
          loadPhoto(item, holder);
        }
      }
      if (view.editable && item.kind === "pin") {
        body.push(...textField(item));
      } else if (item.kind !== "code") {
        field = null;
        const text = document.createElement("p");
        text.className = "card-text";
        text.textContent = item.title;
        body.push(text);
      }
      body.push(
        line(
          item.kind === "code"
            ? CODE_LINE
            : item.kind === "station"
              ? STATION_LINE
              : PRECISION_LINE,
        ),
        line(item.meta),
      );
      if (view.moved) body.push(line(MOVED_LINE, false, true));
      messageEl = line(view.message);
      messageEl.hidden = view.message === "";
      body.push(messageEl);
      if (view.editable) body.push(actionsFor(item, view));
      const foot = document.createElement("div");
      foot.className = "card-foot";
      const key = document.createElement("kbd");
      key.textContent = "Esc";
      foot.append(key, " close");
      body.push(foot);
      // `replaceChildren` detaches the reused field, and a focused element
      // that leaves the document loses the focus: the creator typing while
      // a save ends would type into nothing (PR #611 review).
      const typing =
        field !== null && document.activeElement === field.el
          ? {
              el: field.el,
              from: field.el.selectionStart,
              to: field.el.selectionEnd,
            }
          : null;
      dom.inner.replaceChildren(...body);
      dom.card.hidden = false;
      if (typing !== null && typing.el.isConnected) {
        typing.el.focus();
        typing.el.setSelectionRange(typing.from, typing.to);
      }
    },
    hide() {
      generation += 1;
      freeUrl();
      current = null;
      field = null;
      messageEl = null;
      dom.card.hidden = true;
      dom.chip.hidden = true;
      dom.inner.replaceChildren();
    },
    place(anchor, free, avoid) {
      if (current === null) return;
      // Never wider than the free area: on a phone a 320 px card covered
      // the folded rail (E1 review #7).
      dom.card.style.width = `${String(
        Math.max(200, Math.min(CARD_WIDTH_PX, free.right - free.left)),
      )}px`;
      // Measured while shown: a hidden card has no size.
      dom.card.hidden = false;
      if (anchor === null) {
        // Nothing on the map to point at (a code without a stored
        // position): the card stands at the free area's corner, its text
        // says why, and no "off the map view" chip offers a pan that
        // cannot happen (E1 review #3).
        dom.chip.hidden = true;
        dom.card.style.left = `${String(free.left)}px`;
        dom.card.style.top = `${String(free.top)}px`;
        dom.card.dataset["side"] = "none";
        return;
      }
      const placement = placePopover({
        anchor,
        // A note's bubble centre sits 24 px above its tip (the
        // marker's 41 px anchor, `editor-map.ts`); a code is centred.
        lift: current.kind === "code" || current.kind === "station" ? 0 : 24,
        gap: current.kind === "code" || current.kind === "station" ? 26 : 30,
        size: {
          width: dom.card.offsetWidth,
          height: dom.card.offsetHeight,
        },
        free,
        avoid,
      });
      if (!placement.visible) {
        dom.card.hidden = true;
        const title = current.title;
        dom.chipText.textContent = `${
          title.length > 40 ? `${title.slice(0, 40)}…` : title
        } is off the map view`;
        dom.chip.hidden = false;
        return;
      }
      dom.chip.hidden = true;
      dom.card.hidden = false;
      dom.card.style.left = `${String(placement.x)}px`;
      dom.card.style.top = `${String(placement.y)}px`;
      dom.card.dataset["side"] = placement.side;
      if (placement.side === "below") {
        dom.arrow.style.top = "";
        dom.arrow.style.left = `${String(placement.arrow)}px`;
      } else {
        dom.arrow.style.left = "";
        dom.arrow.style.top = `${String(placement.arrow)}px`;
      }
    },
    shown() {
      return current;
    },
    note(text) {
      if (messageEl === null) return;
      messageEl.textContent = text;
      messageEl.hidden = text === "";
      resized();
    },
    commit: commitField,
    dirty() {
      return field !== null && field.el.value !== field.committed;
    },
  };
}
