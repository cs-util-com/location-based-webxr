/**
 * A long text's panel in the item inspector (`../kind-panels/kind-panel.ts`):
 * its dock (`long-text-dock.ts`, the writer and the preview) as the
 * inspector draws it - the writer kept under the head, its title typed in
 * the head (`data-field="title"`), the preview's and the width's buttons
 * beside it (`lt-preview`, `lt-wide`, pressed while on), and no field of
 * its own drawn by the dock (the writer types its text).
 *
 * @see long-text-panel.ts.md
 */
import { iconButton, typed } from "../editor-shell/inspector-fields.js";
import type { KindPanel, KindPanelDraw } from "../kind-panels/kind-panel.js";
import type { LongTextDock } from "./long-text-dock.js";

/** The head's buttons: the preview's and the width's, pressed while on. */
function headButtons(state: {
  readonly preview: boolean;
  readonly wide: boolean;
}): HTMLButtonElement[] {
  const show = iconButton(
    "eye",
    state.preview ? "Hide the preview" : "Show the preview",
    "lt-preview",
  );
  show.setAttribute("aria-pressed", String(state.preview));
  const wider = iconButton(
    "wide",
    state.wide
      ? "Back to the normal width"
      : "Make the inspector wider for writing",
    "lt-wide",
  );
  wider.setAttribute("aria-pressed", String(state.wide));
  return [show, wider];
}

/** The panel of `dock`. */
export function longTextPanel(dock: LongTextDock): KindPanel {
  return {
    sync(item): KindPanelDraw | null {
      const text = item?.longText ?? null;
      const writer = dock.sync(text);
      if (text === null || writer === null) return null;
      const state = dock.state();
      return {
        key: JSON.stringify(state),
        kept: writer,
        ownsFields: true,
        title: () => {
          const input = typed("title", text.title, "ttlin");
          input.setAttribute("aria-label", "Title of the text");
          input.title = "The text's title (Enter keeps it)";
          return input;
        },
        head: () => headButtons(state),
        parts: () => [],
      };
    },
    act(name, item) {
      return item.longText !== null && dock.act(name);
    },
    flush() {
      dock.flush();
    },
  };
}
