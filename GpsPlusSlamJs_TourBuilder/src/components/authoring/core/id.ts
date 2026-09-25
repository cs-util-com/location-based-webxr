/**
 * Pure, stateless id generation for component 10 (TASK.md §2.3). No `nanoid`
 * dependency exists anywhere in the workspace; ids are derived from the
 * draft's own existing ids rather than a hidden mutable counter, so a session
 * that already has entries (e.g. resumed from a replay) never collides.
 *
 * @see plans/2026-08-07-authoring-plan.md (decision AU5)
 */

/** Next `prefix-N` not already present in `existingIds`, N starting at 1. */
export function nextId(prefix: string, existingIds: readonly string[]): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const match = re.exec(id);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return `${prefix}-${max + 1}`;
}
