/**
 * A tiny subscribe/emit registry.
 *
 * Both `SceneAdapter` implementations expose the same two event seams (`onTap`,
 * `onAudioEnded`) with the same subscribe-returns-unsubscribe shape, and the
 * gate's duplication check rightly objects to writing that twice. Pure and
 * dependency-free, so it lives in `core/` and both layers may use it.
 */

export interface ListenerSet<TArgs extends readonly unknown[]> {
  /** Subscribe; the returned function unsubscribes and is safe to call twice. */
  add(listener: (...args: TArgs) => void): () => void;
  emit(...args: TArgs): void;
  clear(): void;
  readonly size: number;
}

export function createListenerSet<
  TArgs extends readonly unknown[],
>(): ListenerSet<TArgs> {
  const listeners = new Set<(...args: TArgs) => void>();
  return {
    add(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(...args) {
      // Iterate a copy: a listener may unsubscribe (or subscribe) while running.
      for (const listener of [...listeners]) listener(...args);
    },
    clear() {
      listeners.clear();
    },
    get size() {
      return listeners.size;
    },
  };
}
