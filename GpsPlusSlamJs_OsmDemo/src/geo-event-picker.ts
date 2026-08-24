/**
 * The quest time picker: it opens on the FIRST press, alongside the search
 * (F4f, DEC-U13).
 *
 * WHY IT EXISTS. Pressing the button twice used to run the identical search
 * twice — and "identical" is exact rather than approximate: the event is a pure
 * function of tile and quarter-hour, so within one 15-minute slot the second
 * press cannot produce anything new. It read as a broken button.
 *
 * **THE FIX FOR THAT WAS ITSELF REVERSED (2026-08-19).** Giving the SECOND
 * press a different meaning removed the identical re-run, and the twelfth
 * testing session then reported the two-step as the problem: the choice should
 * be visible immediately. So the dialog now opens on the first press, next to
 * a search that still runs — which removes the original complaint by a
 * different route, because no press re-runs anything without the user having
 * changed the question first.
 *
 * The paragraph this replaces argued the opposite ("the dialog appears only
 * once there is a result to be dissatisfied with"), and it was left standing
 * for a commit after the behaviour changed. Recorded rather than quietly
 * deleted, because it is a real design argument that lost to a real report.
 *
 * WHY IT ALSO CLEARS. The #271 e2e review recorded the geo-event marker as the
 * one thing `resetUi` could not reset, "because no control and no store action
 * removes it". W2 supplied the action; this supplies the control. It is not a
 * test affordance bolted on — a user who has found an event and wants the map
 * back has no other way either.
 *
 * NOT A `<dialog>` ELEMENT. `showModal()` traps focus and dims the page, which
 * is right for a decision that blocks and wrong for this: the map underneath is
 * the thing being consulted while choosing a time. It follows `#hotkey-help` and
 * `#details`, which are `hidden`-toggled `<aside>`s for the same reason.
 *
 * @see geo-event-picker.ts.md
 */

import {
  parseLocalInstant,
  toDateValue,
  toTimeValue,
} from "./event-instant.js";

export interface GeoEventPickerOptions {
  readonly container: HTMLElement;
  /** Run a search for a chosen local instant, in epoch ms. */
  readonly onSearch: (requested: number) => void;
  /** Take the current event off the map. */
  readonly onClear: () => void;
}

export class GeoEventPicker {
  private readonly container: HTMLElement;
  private readonly onSearch: (requested: number) => void;
  private readonly onClear: () => void;
  private readonly dateInput: HTMLInputElement;
  private readonly timeInput: HTMLInputElement;
  private readonly error: HTMLElement;

  constructor(options: GeoEventPickerOptions) {
    this.container = options.container;
    this.onSearch = options.onSearch;
    this.onClear = options.onClear;

    // BUILT HERE, NOT IN `index.html`. The two inputs, the two buttons and the
    // error line are one interaction, and splitting them between markup and
    // wiring is how a control ends up with no listener. `main.ts` supplies an
    // empty `<aside>` and this owns everything inside it — the same division
    // `attachLayerToggles` and `LegendView` already use.
    const heading = document.createElement("strong");
    heading.textContent = "Find an event at";

    this.dateInput = document.createElement("input");
    this.dateInput.type = "date";
    this.dateInput.id = "geo-event-date";

    this.timeInput = document.createElement("input");
    this.timeInput.type = "time";
    this.timeInput.id = "geo-event-time";
    // FIFTEEN MINUTES, matching the event grid. A one-minute step offers a
    // precision the answer cannot carry: every instant inside a quarter resolves
    // to the same slot, so the extra digits would silently do nothing.
    this.timeInput.step = String(15 * 60);

    const search = document.createElement("button");
    search.type = "button";
    search.id = "geo-event-search";
    search.textContent = "Search again";
    search.addEventListener("click", () => {
      const requested = parseLocalInstant(
        this.dateInput.value,
        this.timeInput.value,
      );
      if (requested === undefined) {
        // SAID, not swallowed. Falling back to "now" would run a search for a
        // time the user did not ask for while the dialog showed the one they
        // did — the class of quiet disagreement this demo keeps removing.
        this.error.textContent = "Pick a date and a time first.";
        return;
      }
      this.error.textContent = "";
      this.close();
      this.onSearch(requested);
    });

    const clear = document.createElement("button");
    clear.type = "button";
    clear.id = "geo-event-clear";
    clear.textContent = "Clear event";
    clear.addEventListener("click", () => {
      this.close();
      this.onClear();
    });

    this.error = document.createElement("span");
    this.error.className = "geo-event-error";

    this.container.replaceChildren(
      heading,
      this.dateInput,
      this.timeInput,
      search,
      clear,
      this.error,
    );
    this.container.hidden = true;
  }

  /** Whether the dialog is currently showing. */
  get isOpen(): boolean {
    return !this.container.hidden;
  }

  /**
   * Shows the dialog, with both boxes set to `at`.
   *
   * PRE-FILLED WITH THE INSTANT THE CALLER NAMES rather than left blank, so the
   * common edit is "make it two hours later" rather than "type a whole date".
   * The caller passes the event currently on the map, or now.
   */
  open(at: Date): void {
    this.dateInput.value = toDateValue(at);
    this.timeInput.value = toTimeValue(at);
    this.error.textContent = "";
    this.container.hidden = false;
  }

  close(): void {
    this.container.hidden = true;
  }

  /**
   * Open if closed, closed if open.
   *
   * NO PRODUCTION CALLER SINCE 2026-08-19 (F4f): the button opens the picker on
   * the first press and does not toggle it. Kept rather than deleted because it
   * is the honest primitive for a control that toggles, and the demo is one
   * decision away from wanting it again — but it is exercised only by its own
   * test, so a reader should not infer that pressing the button twice closes
   * anything. It does not; `main.ts` guards on {@link isOpen} instead, so a
   * second press cannot overwrite a time the user has just typed.
   */
  toggle(at: Date): void {
    if (this.isOpen) this.close();
    else this.open(at);
  }
}
