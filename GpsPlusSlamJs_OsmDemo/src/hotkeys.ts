/**
 * Keyboard shortcuts, as one registry rather than as scattered listeners.
 *
 * WHY IT EXISTS (§1.4 step 5, §3.4). Before round 6 this demo had NO hotkey
 * infrastructure at all — the only `keydown` listener in `src/` was on the
 * header-collapse button. Three stages now want shortcuts: §1's time of day,
 * §3's look presets, §6's event clock. Three independent `addEventListener`
 * calls would give three chances to claim the same key, and a duplicate is
 * SILENT — both handlers run, or one shadows the other by registration order,
 * and the symptom is "the preset key sometimes moves the sun too".
 *
 * ONE LISTENER, ONE TABLE. Registration fails loudly on a collision, which turns
 * an unattributable bug into a startup error.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a keymap DSL, not chords, not sequences. The
 * demo needs single keys with a description; anything more is speculative.
 *
 * @see hotkeys.ts.md
 */

/** One shortcut. */
export interface Hotkey {
  /**
   * The `KeyboardEvent.key` value, CASE-SENSITIVELY.
   *
   * `t` and `T` are separate bindings on purpose — "step forwards" and "step
   * backwards" is the obvious pair and it must not collide.
   */
  readonly key: string;
  /** Shown in the help overlay. An undocumented hotkey has one user. */
  readonly description: string;
  readonly handler: () => void;
}

/**
 * Element types that swallow every key, because the user is typing into them.
 *
 * The single most common defect in hand-rolled shortcut handlers is a shortcut
 * firing while someone types. `<select>` is included because the native
 * type-to-jump behaviour is exactly that.
 */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether a key event came from somewhere the user is entering text. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  // `contenteditable` is not a tag, and the demo's panels could gain one.
  return target.isContentEditable;
}

export class HotkeyRegistry {
  private readonly keys = new Map<string, Hotkey>();
  private readonly root: Document;
  /** Held so `dispose()` can remove it — an anonymous one outlives the view. */
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(root: Document) {
    this.root = root;
    this.onKeyDown = (event: KeyboardEvent): void => {
      // MODIFIED PRESSES ARE THE BROWSER'S. Ctrl+T opens a tab; a registry that
      // swallowed it would be actively hostile and the user could not tell why.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const binding = this.keys.get(event.key);
      if (binding === undefined) return;
      event.preventDefault();
      try {
        binding.handler();
      } catch (error) {
        // Reported rather than thrown: an exception escaping a DOM event
        // listener is unattributable at the call site, and one broken shortcut
        // must not be able to affect another.
        console.error(`hotkey "${binding.key}" failed`, error);
      }
    };
    this.root.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Registers a shortcut.
   *
   * @throws if the key is already claimed. Loud on purpose — see the header.
   */
  add(hotkey: Hotkey): void {
    const existing = this.keys.get(hotkey.key);
    if (existing !== undefined) {
      throw new Error(
        `Hotkey "${hotkey.key}" is already registered for "${existing.description}"; ` +
          `"${hotkey.description}" cannot claim it too`,
      );
    }
    this.keys.set(hotkey.key, hotkey);
  }

  /** Every binding, in registration order, for the help overlay. */
  bindings(): readonly Hotkey[] {
    return [...this.keys.values()];
  }

  dispose(): void {
    this.root.removeEventListener("keydown", this.onKeyDown);
    this.keys.clear();
  }
}
