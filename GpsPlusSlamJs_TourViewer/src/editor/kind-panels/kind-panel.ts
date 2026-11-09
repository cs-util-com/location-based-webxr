/**
 * A kind's own part of the item inspector: what the inspector shows of an
 * item that no field spec (`kinds/edit-kinds.ts` `fields`) can say - a
 * model's notes and sections, a long text's writer - and the buttons of
 * it the kind answers itself. The dock (`editor-shell/shell-inspector.ts`)
 * draws a panel's pieces in their places without knowing the kind, and
 * the shell hands a press to the panel before its own commands. One per
 * kind in `kind-panels.ts`. Types only.
 *
 * @see kind-panel.ts.md
 */
import type { InspectorModel } from "../editor-shell/inspector-model.js";

/** An item as the inspector shows it: what a panel draws from. */
export type PanelItem = Extract<InspectorModel, { kind: "item" }>;

/** What a panel shows of the selected item, for one draw of the dock. */
export interface KindPanelDraw {
  /** The panel's own state the draw shows (a pressed head button): a
   *  draw whose model, dock state and key are the same changes nothing. */
  readonly key: string;
  /** A node kept in the page across draws, under the head (a long
   *  text's writer: its focus, its selection and its undo survive). */
  readonly kept: HTMLElement | null;
  /** The panel types the item's text fields itself: the dock draws none
   *  of them. */
  readonly ownsFields: boolean;
  /** The head's title in place of the dock's own (a long text's title
   *  typed there); null: the dock's. */
  title(): HTMLElement | null;
  /** Buttons in the head, before the fold. */
  head(): readonly HTMLElement[];
  /** Parts drawn after the item's fields, made fresh on each draw. */
  parts(): readonly HTMLElement[];
}

/** A kind's panel: it follows the selection and answers its buttons. */
export interface KindPanel {
  /** Follows the selected item of its kind (null: none, or another
   *  kind's); what to draw, or null for nothing. */
  sync(item: PanelItem | null): KindPanelDraw | null;
  /** Runs a press of one of its buttons (`data-act`) on `item`, the
   *  selection `selected`; false when the act is not its own. */
  act(name: string, item: PanelItem, selected: string): boolean;
  /** Text typed and not yet written goes into the tour now. */
  flush(): void;
}
